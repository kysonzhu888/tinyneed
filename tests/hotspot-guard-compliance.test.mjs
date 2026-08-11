/// Guards the four things Creem's compliance review requires of the Hotspot
/// Guard page, so a future edit cannot quietly take one of them away again.
///
/// On 2026-08-10 the store was rejected for live payments on exactly these
/// grounds: the paid product had no reachable purchase path (the CTA had been
/// pulled while payments were disabled), and the page carried no privacy
/// policy link, no terms link, and no support address. Each re-review costs
/// another 24-48 hours, so the invariants are asserted rather than remembered.
///
/// The deadlock is worth spelling out, because it is what makes the purchase
/// link non-negotiable: payments stay disabled until the purchase path is
/// live, so pulling the link to protect buyers is what blocks approval.

import { readFile, access } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const page = await readFile(new URL("../hotspot-guard/index.html", import.meta.url), "utf8");

/// The live Creem product. A different id here means buyers land on someone
/// else's checkout, so it is pinned rather than pattern-matched.
const CHECKOUT_URL = "https://www.creem.io/payment/prod_4ShjWH61KJYiHl0vRYcRHO";

test("the Hotspot Guard page offers a reachable purchase path", () => {
  assert.ok(
    page.includes(CHECKOUT_URL),
    "the Plus checkout link is missing; Creem rejects a paid product with no live purchase path",
  );
});

test("the in-app checkout alias resolves to the same Creem product", async () => {
  const redirects = await readFile(new URL("../_redirects", import.meta.url), "utf8");
  const alias = redirects
    .split("\n")
    .find((line) => line.startsWith("/hotspot-guard/buy "));
  // The macOS app hardcodes /hotspot-guard/buy. Drop this line and every
  // installed copy's "Get Plus" button 404s, with no way to fix it remotely.
  assert.ok(alias, "the /hotspot-guard/buy alias is missing; the app's buy button links here");
  assert.ok(
    alias.includes(CHECKOUT_URL),
    "the buy alias points somewhere other than the pinned Creem product",
  );
});

test("the Hotspot Guard page links its policies and a support address", () => {
  for (const link of [
    'href="/hotspot-guard/privacy/"',
    'href="/hotspot-guard/terms/"',
    "mailto:hello@tinyneed.com",
  ]) {
    assert.ok(page.includes(link), `${link} is missing from hotspot-guard/index.html`);
  }
});

test("the linked policy pages exist as source files", async () => {
  for (const slug of ["privacy", "terms"]) {
    const source = new URL(`../hotspot-guard/${slug}/index.html`, import.meta.url);
    await assert.doesNotReject(
      access(source),
      `hotspot-guard/${slug}/index.html is missing, so the footer link 404s`,
    );
  }
});

test("the page does not advertise Plus as unavailable while it links a checkout", () => {
  /// Both strings shipped at some point next to a live price. Creem's checklist
  /// treats a claim the site contradicts as a truthfulness failure, and a buyer
  /// reading "not on sale yet" above a Buy button has no idea which is true.
  for (const stale of ["Purchases open", "not on sale yet"]) {
    assert.ok(
      !page.includes(stale),
      `"${stale}" contradicts the live checkout link on the same page`,
    );
  }
});
