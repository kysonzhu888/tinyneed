import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const deploy = new URL("../.deploy/", import.meta.url);
const receiptClaimRoot = new URL("../receiptclaim/", import.meta.url);
const receiptClaimDeploy = new URL("../.deploy-receiptclaim/", import.meta.url);

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
  "about",
  "contact",
  "privacy",
  "receiptclaim",
  "assets",
  "functions"
];

const receiptClaimInclude = [
  "index.html",
  "404.html",
  "privacy",
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

await buildAllowlist(root, deploy, include);
await buildAllowlist(receiptClaimRoot, receiptClaimDeploy, receiptClaimInclude);
await cp(new URL("styles.css", root), new URL("styles.css", receiptClaimDeploy));

console.log("Built .deploy and .deploy-receiptclaim");
