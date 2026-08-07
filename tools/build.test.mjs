import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listHtmlDocuments(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const htmlDocuments = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      htmlDocuments.push(...await listHtmlDocuments(entryPath));
      continue;
    }

    if (!entry.name.endsWith(".html")) continue;
    const contents = await readFile(entryPath, "utf8");
    if (/<\/html>/i.test(contents)) htmlDocuments.push(entryPath);
  }

  return htmlDocuments;
}

test("builds real 404 pages for the TinyNeed and ReceiptClaim deployments", async () => {
  execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "pipe" });

  for (const relativePath of [".deploy/404.html", ".deploy-receiptclaim/404.html"]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, relativePath);
    assert.match(await readFile(path.join(root, relativePath), "utf8"), /<title>.*not found/i);
  }

  assert.equal(existsSync(path.join(root, ".deploy/wrangler.toml")), false);
  assert.equal(
    existsSync(path.join(root, ".deploy/functions/api/aurora-email.js")),
    true,
    "Aurora email relay must be bundled with the TinyNeed Pages deployment",
  );
  assert.equal(existsSync(path.join(root, ".deploy/tests")), false);
  assert.equal(existsSync(path.join(root, ".deploy-receiptclaim/wrangler.toml")), false);
  assert.equal(
    await readFile(path.join(root, ".deploy-receiptclaim/styles.css"), "utf8"),
    await readFile(path.join(root, "styles.css"), "utf8"),
  );
  assert.deepEqual(
    (await readdir(path.join(root, ".deploy-receiptclaim"))).sort(),
    ["404.html", "_redirects", "assets", "index.html", "privacy", "robots.txt", "sitemap.xml", "styles.css", "support", "terms"],
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
    assert.match(homepage, /Google ML Kit processes receipt images on-device/i, relativePath);
    assert.match(homepage, /limited, unlinked diagnostic and usage metrics/i, relativePath);
    assert.match(homepage, /does not send receipt images or recognized text/i, relativePath);
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
    assert.match(privacyPolicy, /per-installation identifier/i, relativePath);
    assert.match(privacyPolicy, /feature input and output sizes/i, relativePath);
    assert.match(privacyPolicy, /feature versions/i, relativePath);
    assert.match(
      privacyPolicy,
      /not intended to uniquely identify a user or physical device/i,
      relativePath,
    );
    assert.match(privacyPolicy, /does not use these metrics for advertising or tracking/i, relativePath);
    assert.match(privacyPolicy, /ml-kit\/android-data-disclosure/i, relativePath);
    assert.match(privacyPolicy, /ml-kit\/ios-data-disclosure/i, relativePath);
    assert.match(privacyPolicy, /Android.*diagnostics and usage analytics/i, relativePath);
    assert.match(privacyPolicy, /does not accept or upload receipt photos/i, relativePath);
  }
});

test("injects Cloudflare Web Analytics exactly once into every ReceiptClaim HTML document", async () => {
  execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "pipe" });

  const deployRoot = path.join(root, ".deploy-receiptclaim");
  const htmlDocuments = await listHtmlDocuments(deployRoot);
  assert.ok(htmlDocuments.length > 0);

  for (const htmlPath of htmlDocuments) {
    const contents = await readFile(htmlPath, "utf8");
    const beacons = contents.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) ?? [];
    assert.equal(beacons.length, 1, path.relative(root, htmlPath));
    assert.match(contents, /data-cf-beacon='\{"token":"[a-f0-9]{32}"\}'/, path.relative(root, htmlPath));
  }
});
