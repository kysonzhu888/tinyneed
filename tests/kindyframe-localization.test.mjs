import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ships a bilingual KindyFrame card with locale-aware destination", async () => {
  const homepage = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(homepage, /data-copy-en="KindyFrame"/);
  assert.match(homepage, /data-copy-zh="小芽照"/);
  assert.match(homepage, /data-kindyframe-link/);
  assert.match(homepage, /https:\/\/photo\.gojito\.top\/\?lang=en/);
  assert.match(homepage, /8 live tools/);
});

test("shared homepage localization keeps KindyFrame and HostSpend locale links aligned", async () => {
  const localization = await readFile(path.join(root, "hostspend/localization.js"), "utf8");
  assert.match(localization, /data-kindyframe-localized/);
  assert.match(localization, /photo\.gojito\.top\/\?lang=/);
  assert.match(localization, /data-hostspend-localized/);
});
