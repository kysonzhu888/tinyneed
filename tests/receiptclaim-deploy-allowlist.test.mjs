/// Guards the ReceiptClaim deploy allowlist against a silent omission.
///
/// `tools/build.mjs` copies only the entries named in its allowlist, and
/// `buildAllowlist` skips anything missing with `continue` — no error, no
/// warning. A page can therefore exist in the repo, be linked from the app,
/// and simply never deploy. This repo has shipped that failure three times
/// (missing `functions` wiped the live API, a stray `wrangler.toml` leaked a
/// D1 database id, a missing `_headers` silently dropped every response
/// header), so the invariant is asserted rather than remembered.
///
/// The check reads the build script as text instead of importing it: the
/// module runs the whole build at import time (top-level await), so importing
/// it from a test would wipe and rebuild the deploy directories as a side
/// effect of running the suite.

import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const buildScript = await readFile(new URL("../tools/build.mjs", import.meta.url), "utf8");

/// Paths the shipped app links to. A 404 on either one is an App Store
/// Guideline 3.1.2 rejection, which is why they are pinned here by name.
const REQUIRED_PAGES = ["privacy", "terms", "support"];

function receiptClaimAllowlist() {
  const match = buildScript.match(/const receiptClaimInclude = \[([\s\S]*?)\]/);
  assert.ok(match, "receiptClaimInclude array not found in tools/build.mjs");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("every app-linked ReceiptClaim page is in the deploy allowlist", () => {
  const allowlist = receiptClaimAllowlist();
  for (const page of REQUIRED_PAGES) {
    assert.ok(
      allowlist.includes(page),
      `"${page}" is missing from receiptClaimInclude, so receiptclaim.tinyneed.com/${page}/ will 404 after deploy`,
    );
  }
});

test("every app-linked ReceiptClaim page has a source file", async () => {
  for (const page of REQUIRED_PAGES) {
    const source = new URL(`../receiptclaim/${page}/index.html`, import.meta.url);
    await assert.doesNotReject(
      access(source),
      `receiptclaim/${page}/index.html is missing, so the allowlist entry copies nothing`,
    );
  }
});

test("the ReceiptClaim allowlist excludes server-side configuration", () => {
  const allowlist = receiptClaimAllowlist();
  for (const forbidden of ["wrangler.toml", "schema.sql", "site.config.json", "tools"]) {
    assert.ok(
      !allowlist.includes(forbidden),
      `"${forbidden}" must never deploy as a public static file`,
    );
  }
});
