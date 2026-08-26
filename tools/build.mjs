import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const deploy = new URL("../.deploy/", import.meta.url);
const receiptClaimRoot = new URL("../receiptclaim/", import.meta.url);
const receiptClaimDeploy = new URL("../.deploy-receiptclaim/", import.meta.url);
const siteConfig = JSON.parse(await readFile(new URL("../site.config.json", import.meta.url), "utf8"));
const cloudflareWebAnalyticsScriptURL = "https://static.cloudflareinsights.com/beacon.min.js";
const cloudflareWebAnalyticsTag = `<script defer src="${cloudflareWebAnalyticsScriptURL}" data-cf-beacon='${JSON.stringify({ token: siteConfig.cloudflareWebAnalyticsToken })}'></script>`;

// 🚨 allowlist 是安全边界：wrangler.toml / schema.sql / site.config.json / tools
//    绝不能进 .deploy（会被 Cloudflare Pages 当静态文件公开）。
//    functions/ 必须包含——Cloudflare 会把它编译成 Pages Functions（API），漏了会抹掉线上接口。
const include = [
  "index.html",
  "404.html",
  "styles.css",
  "script.js",
  "robots.txt",
  "sitemap.xml",
  "ads.txt",
  "_redirects",
  // _headers 和 _redirects 一样是 Pages 的控制文件，漏了不会报错——
  // 只是所有自定义响应头静默失效（当前用途是给 appcast.json 设短缓存）。
  "_headers",
  "about",
  "contact",
  "privacy",
  "receiptclaim",
  "hotspot-guard",
  "hostspend",
  "assets",
  "functions"
];

const receiptClaimInclude = [
  "index.html",
  "_redirects",
  "404.html",
  "privacy",
  // The paywall links to /terms/ to satisfy App Store Guideline 3.1.2, which
  // requires functional links to both terms and privacy. Omitting it here does
  // not fail the build — the page just never deploys and the link 404s, which
  // is exactly how a review rejection gets shipped.
  "terms",
  "support",
  "robots.txt",
  "sitemap.xml",
  "assets"
];

async function buildAllowlist(sourceRoot, targetRoot, items) {
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  for (const item of items) {
    const from = new URL(item, sourceRoot);
    if (!existsSync(from)) continue;
    const to = new URL(item, targetRoot);
    await cp(from, to, { recursive: true });
  }
}

async function injectCloudflareWebAnalytics(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryURL = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      await injectCloudflareWebAnalytics(new URL(`${entry.name}/`, directory));
      continue;
    }

    if (!entry.name.endsWith(".html")) continue;
    const html = await readFile(entryURL, "utf8");
    if (!/<\/html>/i.test(html)) continue;

    const existingBeacons = html.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) ?? [];
    if (existingBeacons.length > 1) {
      throw new Error(`Multiple Cloudflare Web Analytics tags in ${entryURL.pathname}`);
    }
    if (existingBeacons.length === 1) {
      if (!html.includes(cloudflareWebAnalyticsTag)) {
        throw new Error(`Cloudflare Web Analytics tag does not match site config in ${entryURL.pathname}`);
      }
      continue;
    }

    const instrumentedHtml = html.replace(
      /^([ \t]*)<\/body>/im,
      `$1  ${cloudflareWebAnalyticsTag}\n$1</body>`,
    );
    if (instrumentedHtml === html) {
      throw new Error(`Missing closing body tag in ${entryURL.pathname}`);
    }
    await writeFile(entryURL, instrumentedHtml);
  }
}

await buildAllowlist(root, deploy, include);
await buildAllowlist(receiptClaimRoot, receiptClaimDeploy, receiptClaimInclude);
await cp(new URL("styles.css", root), new URL("styles.css", receiptClaimDeploy));
await injectCloudflareWebAnalytics(receiptClaimDeploy);

console.log("Built .deploy and .deploy-receiptclaim");
