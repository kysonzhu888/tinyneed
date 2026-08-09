import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/// Hotspot Guard 更新清单的契约测试。
///
/// 为什么值得单测一个四行的 JSON：**它的消费者不在这个仓库里**。
/// 客户端（hotspot-guard 的 `UpdateManifest`）用严格解码，字段名拼错、
/// 版本号带上 build 号、下载地址写成 http——每一种都仍是合法 JSON，
/// 却会让所有用户静默地永远收不到更新，而且服务端这边没有任何报错。
/// 这里把客户端的解析规则复刻一遍，让不匹配在部署前就变红。

const appcastPath = fileURLToPath(
  new URL("../hotspot-guard/appcast.json", import.meta.url),
);
const appcast = JSON.parse(readFileSync(appcastPath, "utf8"));

/// 与客户端 `AppVersion` 一致：只接受 1–4 段纯数字，段间用点。
/// 客户端拒绝 "1.0.11 (12)"、"v1.0.11"、"latest"。
const NUMERIC_VERSION = /^\d+(\.\d+){0,3}$/;

test("必填字段齐全", () => {
  assert.equal(typeof appcast.latestVersion, "string");
  assert.equal(typeof appcast.downloadURL, "string");
});

test("版本号是纯数字点分格式——客户端会拒绝带 build 号或前缀的写法", () => {
  assert.match(appcast.latestVersion, NUMERIC_VERSION);
  assert.doesNotMatch(appcast.latestVersion, /[()a-zA-Z]/);
});

test("下载地址必须是 https——客户端会拒绝 http，用户会收不到任何提示", () => {
  const url = new URL(appcast.downloadURL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "tinyneed.com");
});

test("下载地址指向稳定别名而不是某个具体版本的 zip", () => {
  // 直接写死 zip 路径的话，发版时要改两个地方，漏一个就发旧版
  assert.equal(new URL(appcast.downloadURL).pathname, "/hotspot-guard/download");
});

test("可选字段若存在，格式也必须对", () => {
  if (appcast.releaseNotesURL !== undefined) {
    assert.equal(new URL(appcast.releaseNotesURL).protocol, "https:");
  }
  if (appcast.minimumSystemVersion !== undefined) {
    assert.match(appcast.minimumSystemVersion, NUMERIC_VERSION);
  }
});

test("清单体积远小于客户端 64 KB 的上限", () => {
  assert.ok(readFileSync(appcastPath).byteLength < 4096);
});

test("🚨 appcast.json 与 _headers 都必须在 build allowlist 里", () => {
  // build.mjs 是 allowlist 制：不在名单里的文件**不会进 .deploy**，
  // 而且不报错。表现是「本地文件在、线上 404」或「响应头静默失效」，
  // 这个仓库已经为此踩过两次（functions 漏掉抹掉线上 API、
  // wrangler.toml 误入被公开）。
  const build = readFileSync(
    fileURLToPath(new URL("../tools/build.mjs", import.meta.url)),
    "utf8",
  );
  const include = build.slice(
    build.indexOf("const include = ["),
    build.indexOf("];", build.indexOf("const include = [")),
  );
  assert.match(include, /"hotspot-guard"/, "appcast.json 所在目录必须在 allowlist");
  assert.match(include, /"_headers"/, "_headers 不在 allowlist 时缓存头会静默失效");
  // 反向：安全边界不能破
  assert.doesNotMatch(include, /"wrangler\.toml"/);
  assert.doesNotMatch(include, /"site\.config\.json"/);
  assert.match(include, /"functions"/, "漏掉 functions 会抹掉线上 API");
});

test("🚨 版本化清单路径必须有 200 rewrite 回同一份 appcast.json", () => {
  // 1.0.14+ 客户端请求 /hotspot-guard/appcast/<version>.json——版本进 path
  // 是 CF free plan 下拿到版本分布的唯一办法（边缘日志没有完整 UA）。
  // rewrite 必须是 200 而不是 302：302 会让同一次 check-in 在日志里
  // 变成两条请求，且多一跳网络往返。
  const redirects = readFileSync(
    fileURLToPath(new URL("../_redirects", import.meta.url)),
    "utf8",
  );
  const line = redirects
    .split("\n")
    .find((row) => row.startsWith("/hotspot-guard/appcast/"));
  assert.ok(line, "_redirects 里必须有 /hotspot-guard/appcast/* 的 rewrite");
  const [source, target, status] = line.trim().split(/\s+/);
  assert.equal(source, "/hotspot-guard/appcast/*");
  assert.equal(target, "/hotspot-guard/appcast.json");
  assert.equal(status, "200", "必须是 200 rewrite，不能是 30x redirect");
});

test("🚨 客户端拼出的版本化路径必须落在 rewrite 的匹配范围里", () => {
  // 复刻客户端 UpdateChecker.manifestURL(currentVersion:) 的产物形态。
  // 两边不匹配的表现是：新客户端更新检查 404，且服务端没有任何报错。
  const clientPath = "/hotspot-guard/appcast/1.0.13.json";
  assert.ok(clientPath.startsWith("/hotspot-guard/appcast/"),
    "客户端路径必须命中 /hotspot-guard/appcast/* 通配");
  assert.match(clientPath, /^\/hotspot-guard\/appcast\/\d+(\.\d+){0,3}\.json$/);
});

test("🚨 版本化路径的响应头必须与扁平路径一致（短缓存 + JSON）", () => {
  // _headers 是按请求 URL 匹配的：rewrite 不会继承目标路径的响应头，
  // 漏配的表现是版本化路径拿默认长缓存，发新版后新客户端最晚数小时
  // 才能看到——而扁平路径的老客户端 5 分钟就看到了，行为分裂最难排查。
  const headers = readFileSync(
    fileURLToPath(new URL("../_headers", import.meta.url)),
    "utf8",
  );
  const blocks = headers.split(/\n(?=\S)/);
  const flat = blocks.find((b) => b.startsWith("/hotspot-guard/appcast.json"));
  const versioned = blocks.find((b) => b.startsWith("/hotspot-guard/appcast/*"));
  assert.ok(flat, "扁平路径的 _headers 块必须保留——≤1.0.13 客户端还在用");
  assert.ok(versioned, "_headers 里必须有 /hotspot-guard/appcast/* 块");
  const rules = (block) => block.trim().split("\n").slice(1)
    .map((row) => row.trim()).filter(Boolean).sort();
  assert.deepEqual(rules(versioned), rules(flat),
    "两条路径的响应头必须逐条一致，避免缓存行为分裂");
});

test("🚨 appcast 的版本不得高于 _redirects 里 302 别名实际指向的包", () => {
  // 两者不一致时的表现是：客户端说"有 1.0.12"，点下载却拿到 1.0.11 的包，
  // 用户会认为更新功能坏了。发版必须同时改这两个文件。
  const redirects = readFileSync(
    fileURLToPath(new URL("../_redirects", import.meta.url)),
    "utf8",
  );
  const line = redirects
    .split("\n")
    .find((row) => row.startsWith("/hotspot-guard/download"));
  assert.ok(line, "_redirects 里必须有 /hotspot-guard/download 别名");
  const zipVersion = line.match(/HotspotGuard-Pro-([\d.]+)\.zip/)?.[1];
  assert.ok(zipVersion, "别名必须指向一个带版本号的 zip");
  assert.equal(
    appcast.latestVersion,
    zipVersion,
    `appcast 写 ${appcast.latestVersion}，但 302 别名指向 ${zipVersion} 的包`,
  );
});
