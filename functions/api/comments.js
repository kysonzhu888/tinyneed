const MAX_NAME_LENGTH = 40;
const MAX_BODY_LENGTH = 600;
const MAX_COMMENTS_PER_RESPONSE = 30;
const RESEND_API_URL = "https://api.resend.com/emails";

// 反垃圾：同一 IP 每 RATE_LIMIT_WINDOW_SEC 秒最多发 RATE_LIMIT_MAX 条评论。
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SEC = 60;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const pageSlug = normalizeText(url.searchParams.get("pageSlug") || "home", 80);
  const comments = await listComments(env, pageSlug);
  return json({ comments });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const pageSlug = normalizeText(payload.pageSlug || "home", 80) || "home";

  // 蜜罐：正常用户看不到 website 字段（表单里隐藏）；bot 填了就假装成功，不写库、不暴露识别逻辑。
  if (normalizeText(payload.website, 200)) {
    return json({ ok: true, comments: await listComments(env, pageSlug) }, 201);
  }

  const name = normalizeText(payload.name || "Reader", MAX_NAME_LENGTH) || "Reader";
  const body = normalizeText(payload.comment || payload.body, MAX_BODY_LENGTH);

  if (!body) {
    return json({ error: "Comment cannot be empty." }, 400);
  }

  // 限流：D1 滑动窗口。check-then-act 非原子，边界轻微超发可接受，够挡脚本刷屏。
  if (await isRateLimited(env, request)) {
    return json({ error: "You're posting too fast. Please wait a minute and try again." }, 429);
  }

  const id = crypto.randomUUID();
  await env.COMMENTS_DB
    .prepare(`
      INSERT INTO comments (id, page_slug, name, body)
      VALUES (?, ?, ?, ?)
    `)
    .bind(id, pageSlug, name, body)
    .run();

  scheduleCommentNotification(context, {
    id,
    pageSlug,
    name,
    body,
    pageUrl: buildCommentPageUrl(request.url, env),
    siteName: env.COMMENT_SITE_NAME || new URL(request.url).hostname,
  });

  const comments = await listComments(env, pageSlug);
  return json({ ok: true, comments }, 201);
}

async function isRateLimited(env, request) {
  const db = env.COMMENTS_DB;
  if (!db) {
    return false;
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const bucket = await hashIp(ip);

  try {
    // 顺手清掉过期行，表很小，成本可忽略。
    await db.prepare(`DELETE FROM comment_rate_limits WHERE expires_at <= unixepoch()`).run();

    const row = await db
      .prepare(`SELECT hits FROM comment_rate_limits WHERE bucket = ? AND expires_at > unixepoch()`)
      .bind(bucket)
      .first();

    if (row && Number(row.hits) >= RATE_LIMIT_MAX) {
      return true;
    }

    await db
      .prepare(`
        INSERT INTO comment_rate_limits (bucket, hits, expires_at)
        VALUES (?1, 1, unixepoch() + ?2)
        ON CONFLICT(bucket) DO UPDATE SET
          hits = CASE WHEN comment_rate_limits.expires_at > unixepoch()
                      THEN comment_rate_limits.hits + 1 ELSE 1 END,
          expires_at = CASE WHEN comment_rate_limits.expires_at > unixepoch()
                            THEN comment_rate_limits.expires_at ELSE unixepoch() + ?2 END
      `)
      .bind(bucket, RATE_LIMIT_WINDOW_SEC)
      .run();

    return false;
  } catch (error) {
    // 限流表缺失或 D1 抖动时，不阻断正常评论，只记录。
    console.warn("Rate limit check failed", error);
    return false;
  }
}

async function hashIp(ip) {
  const data = new TextEncoder().encode(`tinyneed-rl:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function listComments(env, pageSlug) {
  const { results } = await env.COMMENTS_DB
    .prepare(`
      SELECT id, name, body, created_at
      FROM comments
      WHERE page_slug = ? AND status = 'visible'
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .bind(pageSlug, MAX_COMMENTS_PER_RESPONSE)
    .all();

  return (results || []).map((row) => ({
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
  }));
}

function normalizeText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function scheduleCommentNotification(context, comment) {
  if (!context.waitUntil) {
    return;
  }

  context.waitUntil(
    sendCommentNotification(context.env, comment).catch((error) => {
      console.warn("Comment notification failed", error);
    }),
  );
}

async function sendCommentNotification(env, comment) {
  const apiKey = normalizeSecret(env.RESEND_API_KEY);
  const recipients = splitRecipients(env.COMMENT_NOTIFY_TO || env.COMMENT_NOTIFY_EMAIL);
  const from = normalizeHeaderValue(env.COMMENT_NOTIFY_FROM);
  if (!apiKey || !recipients.length || !from) {
    return;
  }

  const subject = normalizeHeaderValue(`[${comment.siteName}] New comment`);
  const text = [
    `New comment on ${comment.siteName}`,
    "",
    `Page: ${comment.pageUrl}`,
    `Page slug: ${comment.pageSlug}`,
    `Name: ${comment.name}`,
    "",
    comment.body,
    "",
    `Comment ID: ${comment.id}`,
  ].join("\n");
  const html = `
    <h2>New comment on ${escapeHtml(comment.siteName)}</h2>
    <p><strong>Page:</strong> <a href="${escapeHtml(comment.pageUrl)}">${escapeHtml(comment.pageUrl)}</a></p>
    <p><strong>Page slug:</strong> ${escapeHtml(comment.pageSlug)}</p>
    <p><strong>Name:</strong> ${escapeHtml(comment.name)}</p>
    <blockquote>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</blockquote>
    <p><small>Comment ID: ${escapeHtml(comment.id)}</small></p>
  `;

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
  }
}

function buildCommentPageUrl(requestUrl, env) {
  const url = new URL(requestUrl);
  url.pathname = env.COMMENT_PAGE_PATH || "/";
  url.search = "";
  url.hash = "comments";
  return url.toString();
}

function splitRecipients(value) {
  return String(value || "")
    .split(",")
    .map((item) => normalizeHeaderValue(item))
    .filter(Boolean);
}

function normalizeHeaderValue(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function normalizeSecret(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
