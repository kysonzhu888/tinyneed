import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("resolves HostSpend locale from URL before browser language", async () => {
  const moduleURL = pathToFileURL(path.join(root, "hostspend/localization.js"));
  const { resolveHostSpendLocale } = await import(moduleURL.href);

  assert.equal(resolveHostSpendLocale("?lang=en", "zh-CN"), "en");
  assert.equal(resolveHostSpendLocale("?lang=zh-Hans", "en-US"), "zh-Hans");
  assert.equal(resolveHostSpendLocale("", "zh-CN"), "zh-Hans");
  assert.equal(resolveHostSpendLocale("", "fr-FR"), "en");
  assert.equal(resolveHostSpendLocale("?lang=unsupported", "zh-SG"), "zh-Hans");
});

test("ships a bilingual HostSpend entry and project page", async () => {
  execFileSync(process.execPath, ["tools/build.mjs"], { cwd: root, stdio: "pipe" });

  const homepage = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(homepage, /href="\/hostspend\/"/);
  assert.match(homepage, /data-copy-en="HostSpend"/);
  assert.match(homepage, /data-copy-zh="民宿家底"/);

  for (const relativePath of ["hostspend/index.html", ".deploy/hostspend/index.html"]) {
    assert.equal(existsSync(path.join(root, relativePath)), true, relativePath);
    const page = await readFile(path.join(root, relativePath), "utf8");
    assert.match(page, /HostSpend/, relativePath);
    assert.match(page, /民宿家底/, relativePath);
    assert.match(page, /data-locale="zh-Hans"/, relativePath);
    assert.match(page, /data-locale="en"/, relativePath);
    assert.match(page, /https:\/\/jiadi\.gojito\.top\//, relativePath);
  }

  assert.equal(existsSync(path.join(root, ".deploy/hostspend/localization.js")), true);
  assert.equal(existsSync(path.join(root, ".deploy/hostspend/styles.css")), true);
});
