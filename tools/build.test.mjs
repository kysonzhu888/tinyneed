import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("builds real 404 pages for the TinyNeed and ReceiptClaim deployments", async () => {
  execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "pipe" });

  for (const relativePath of [".deploy/404.html", ".deploy-receiptclaim/404.html"]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, relativePath);
    assert.match(await readFile(path.join(root, relativePath), "utf8"), /<title>.*not found/i);
  }

  assert.equal(existsSync(path.join(root, ".deploy/wrangler.toml")), false);
  assert.equal(existsSync(path.join(root, ".deploy-receiptclaim/wrangler.toml")), false);
  assert.equal(
    await readFile(path.join(root, ".deploy-receiptclaim/styles.css"), "utf8"),
    await readFile(path.join(root, "styles.css"), "utf8"),
  );
  assert.deepEqual(
    (await readdir(path.join(root, ".deploy-receiptclaim"))).sort(),
    ["404.html", "assets", "index.html", "privacy", "robots.txt", "sitemap.xml", "styles.css", "support"],
  );
});

test("states the current ReceiptClaim platform availability without dead store links", async () => {
  execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "pipe" });

  for (const relativePath of ["receiptclaim/index.html", ".deploy-receiptclaim/index.html"]) {
    const homepage = await readFile(path.join(root, relativePath), "utf8");
    assert.match(homepage, /iOS: Preparing for App Review/, relativePath);
    assert.match(homepage, /Android: Not yet available on Google Play/, relativePath);
    assert.doesNotMatch(homepage, /apps\.apple\.com|play\.google\.com/, relativePath);
  }
});

test("distinguishes app privacy from website analytics", async () => {
  execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "pipe" });

  for (const relativePath of ["receiptclaim/index.html", ".deploy-receiptclaim/index.html"]) {
    const homepage = await readFile(path.join(root, relativePath), "utf8");
    assert.match(homepage, /ReceiptClaim app has no account system, analytics/i, relativePath);
    assert.match(homepage, /website uses Cloudflare Web Analytics/i, relativePath);
    assert.match(homepage, /never receives receipt content/i, relativePath);
  }

  for (const relativePath of [
    "receiptclaim/privacy/index.html",
    ".deploy-receiptclaim/privacy/index.html",
  ]) {
    const privacyPolicy = await readFile(path.join(root, relativePath), "utf8");
    assert.match(privacyPolicy, /Website analytics/, relativePath);
    assert.match(privacyPolicy, /Cloudflare Web Analytics/, relativePath);
    assert.match(privacyPolicy, /does not accept or upload receipt photos/i, relativePath);
  }
});
