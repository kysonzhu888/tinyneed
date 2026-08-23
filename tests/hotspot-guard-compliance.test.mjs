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
    page.includes('href="/hotspot-guard/buy/web"'),
    "the Plus checkout link must use the measurable first-party web alias",
  );
});

test("all source-specific checkout aliases resolve to the same Creem product", async () => {
  const redirects = await readFile(new URL("../_redirects", import.meta.url), "utf8");
  for (const path of [
    "/hotspot-guard/buy",
    "/hotspot-guard/buy/web",
    "/hotspot-guard/buy/app-plus",
    "/hotspot-guard/buy/app-limit",
  ]) {
    const alias = redirects.split("\n").find((line) => line.startsWith(`${path} `));
    assert.ok(alias, `${path} alias is missing`);
    assert.ok(alias.includes(CHECKOUT_URL), `${path} points at a different checkout`);
    assert.match(alias, /\s302(?:\s|$)/, `${path} must stay a mutable 302`);
  }
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

test("the privacy policy discloses the aggregate funnel and its hard exclusions", async () => {
  const privacy = await readFile(
    new URL("../hotspot-guard/privacy/index.html", import.meta.url),
    "utf8",
  );
  for (const disclosure of [
    "purchase source",
    "event type, amount, currency, time, and result",
    "does not store your email, name, customer ID",
    "do not join these events into a user journey",
  ]) {
    assert.ok(privacy.includes(disclosure), `privacy policy is missing: ${disclosure}`);
  }
});
