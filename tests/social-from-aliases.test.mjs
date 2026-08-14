import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/// 社媒渠道归因别名（`/from/<source>/<product>`）的契约测试。
///
/// 为什么这几行 redirect 值得单测：**它们是唯一的渠道计数器**。
/// CF free plan 没有 referer / query / 完整 UA，所以「这次分发有没有用」
/// 只能靠 path 命中来回答。一条写坏的别名不会报错、页面照常打开、
/// 读者毫无感觉——只是那次分发在边缘日志里永久不可归因，而你要等到
/// 28 天后跑 kill gate 时才发现分母是空的。
///
/// 🚨 这里刻意**不**断言「有哪几条别名」——那会退化成同义反复：
/// 从 _redirects 派生一份清单再拿去和 _redirects 比，删一行两边一起缩水。
/// 断言的是与文件内容无关的**形状规则**，所以新增别名不会让它变红，
/// 而写错别名一定会。

const redirectsPath = fileURLToPath(new URL("../_redirects", import.meta.url));
const lines = readFileSync(redirectsPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

/// 🚨 候选行必须把**历史前缀 `/go/` 也收进来**，否则前缀断言不可达：
/// 只挑 /from/ 开头的行，一条写成 /go/ 的别名会被静默跳过而不是判错——
/// 那恰好就是本测试要防的「别名坏了但没人知道」。2026-08-14 的负向对照
/// 实测到了这个洞：把一行改回 /go/，整个文件仍然全绿。
const ALIAS_PREFIXES = ["/from/", "/go/"];
const fromRules = lines
  .filter((line) => ALIAS_PREFIXES.some((prefix) => line.startsWith(prefix)))
  .map((line) => {
    const [from, to, status] = line.split(/\s+/);
    return { from, to, status, line };
  });

/// 与 docs/20260715/独立产品运营/统一UTM与转化事件规范.md 的字典一致。
/// 同一个平台只允许一个 source 值——不能 twitter / x / X 混用。
const ALLOWED_SOURCES = new Set([
  "x", "tiktok", "youtube", "instagram", "facebook", "reddit",
  "pinterest", "bluesky", "linkedin", "indie_hackers", "newsletter",
]);
const ALLOWED_MEDIUMS = new Set([
  "organic_social", "community", "creator", "email", "referral", "qr",
]);

test("至少存在一条 /from/ 别名——否则社媒发布无从计数", () => {
  assert.ok(fromRules.length > 0, "_redirects 里没有任何 /from/ 别名");
});

test("路径形状必须是 /from/<source>/<product>", () => {
  for (const rule of fromRules) {
    const parts = rule.from.split("/").filter(Boolean);
    assert.equal(parts.length, 3, `别名层级不对：${rule.from}`);
    assert.equal(parts[0], "from", `别名前缀必须是 from（读作「来自」）而不是 go：${rule.from}`);
  }
});

test("一律 302，不许 301——渠道会停、目标会换，301 会被永久缓存在读者浏览器里", () => {
  for (const rule of fromRules) {
    assert.equal(rule.status, "302", `${rule.from} 用了 ${rule.status}`);
  }
});

test("目标必须带 utm_source 与 utm_medium——否则将来接 GA4 时这批流量是黑的", () => {
  for (const rule of fromRules) {
    assert.match(rule.to, /[?&]utm_source=/, `${rule.from} 目标缺 utm_source`);
    assert.match(rule.to, /[?&]utm_medium=/, `${rule.from} 目标缺 utm_medium`);
  }
});

/// 这条是真正抓错的那条：复制一行别名去开新渠道时，人最容易改了 path
/// 却忘了改 utm_source，于是 reddit 的点击在未来的 GA4 里被记成 x。
test("utm_source 必须与 path 里的 source 段一致", () => {
  for (const rule of fromRules) {
    const source = rule.from.split("/").filter(Boolean)[1];
    const utmSource = new URL(rule.to, "https://tinyneed.com").searchParams.get("utm_source");
    assert.equal(utmSource, source, `${rule.from} 的 utm_source 是 ${utmSource}`);
  }
});

test("utm_source / utm_medium 取值必须在既有 UTM 字典里", () => {
  for (const rule of fromRules) {
    const params = new URL(rule.to, "https://tinyneed.com").searchParams;
    assert.ok(ALLOWED_SOURCES.has(params.get("utm_source")),
      `${rule.from} 的 utm_source=${params.get("utm_source")} 不在字典里`);
    assert.ok(ALLOWED_MEDIUMS.has(params.get("utm_medium")),
      `${rule.from} 的 utm_medium=${params.get("utm_medium")} 不在字典里`);
  }
});
