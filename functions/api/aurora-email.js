const RESEND_API_URL = "https://api.resend.com/emails";
const SENDER = "Aurora Forecast Now <alerts@tinyneed.com>";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_REQUEST_BYTES = 40_000;
const MAX_SUBJECT_LENGTH = 160;
const MAX_TEXT_LENGTH = 12_000;
const MAX_HTML_LENGTH = 30_000;

export async function onRequestPost({ request, env }) {
  const relaySecret = normalizeSecret(env.AURORA_EMAIL_RELAY_SECRET);
  const apiKey = normalizeSecret(env.RESEND_API_KEY);
  if (relaySecret.length < 32 || !apiKey) {
    return json({ error: "Email relay is not configured." }, 503);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return json({ error: "Request is too large." }, 413);
  }
  if (!await validSignature(request, body, relaySecret, env)) {
    return json({ error: "Unauthorized." }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const message = normalizeMessage(payload);
  if (!message) {
    return json({ error: "Invalid email message." }, 400);
  }

  const send = typeof env.RESEND_FETCH === "function" ? env.RESEND_FETCH : fetch;
  const response = await send(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: SENDER,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
  });

  if (!response.ok) {
    console.warn(`Aurora email relay failed with provider status ${response.status}`);
    return json({ error: "Email delivery failed." }, 502);
  }
  return json({ ok: true });
}

async function validSignature(request, body, secret, env) {
  const timestamp = Number(request.headers.get("X-Aurora-Timestamp"));
  const signature = request.headers.get("X-Aurora-Signature") || "";
  const nowMs = typeof env.AURORA_EMAIL_RELAY_NOW === "function"
    ? env.AURORA_EMAIL_RELAY_NOW()
    : Date.now();
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(nowMs / 1000) - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }
  const expected = `v1=${await hmacHex(`${timestamp}.${body}`, secret)}`;
  return constantTimeEqual(signature, expected);
}

function normalizeMessage(payload) {
  const to = String(payload?.to || "").trim().toLowerCase();
  const subject = normalizeHeader(payload?.subject, MAX_SUBJECT_LENGTH);
  const text = String(payload?.text || "").trim();
  const html = String(payload?.html || "").trim();
  if (!EMAIL_PATTERN.test(to) || to.length > 254 || !subject || !text) return null;
  if (text.length > MAX_TEXT_LENGTH || html.length > MAX_HTML_LENGTH) return null;
  return { to, subject, text, html };
}

function normalizeHeader(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSecret(value) {
  return String(value || "").trim();
}

async function hmacHex(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
