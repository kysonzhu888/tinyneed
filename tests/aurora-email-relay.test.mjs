import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/aurora-email.js";

const SECRET = "test-only-aurora-relay-secret-with-32-bytes";
const NOW_SECONDS = 1_784_584_800;

test("aurora relay verifies the signed request and fixes the sender identity", async () => {
  const resendCalls = [];
  const payload = {
    to: "viewer@example.com",
    subject: "Confirm your aurora alert",
    text: "Confirm: https://auroraforecastnow.com/api/alerts/confirm?token=private",
    html: "<p>Confirm your aurora alert.</p>",
  };
  const response = await onRequestPost({
    request: await signedRequest(payload),
    env: relayEnv(resendCalls),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].url, "https://api.resend.com/emails");
  assert.equal(resendCalls[0].body.from, "Aurora Forecast Now <alerts@tinyneed.com>");
  assert.deepEqual(resendCalls[0].body.to, ["viewer@example.com"]);
  assert.equal(resendCalls[0].body.subject, payload.subject);
  assert.equal(resendCalls[0].body.text, payload.text);
  assert.equal(resendCalls[0].body.html, payload.html);
});

test("aurora relay rejects invalid or stale signatures before contacting Resend", async () => {
  const resendCalls = [];
  const invalid = await onRequestPost({
    request: new Request("https://tinyneed.com/api/aurora-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Aurora-Timestamp": String(NOW_SECONDS),
        "X-Aurora-Signature": "v1=invalid",
      },
      body: JSON.stringify({
        to: "viewer@example.com",
        subject: "Invalid",
        text: "This must not send.",
      }),
    }),
    env: relayEnv(resendCalls),
  });
  assert.equal(invalid.status, 401);

  const stale = await onRequestPost({
    request: await signedRequest({
      to: "viewer@example.com",
      subject: "Stale",
      text: "This must not send.",
    }, NOW_SECONDS - 601),
    env: relayEnv(resendCalls),
  });
  assert.equal(stale.status, 401);
  assert.equal(resendCalls.length, 0);
});

test("aurora relay rejects malformed recipient and oversized content", async () => {
  const resendCalls = [];
  const malformed = await onRequestPost({
    request: await signedRequest({
      to: "not-an-email",
      subject: "Invalid",
      text: "This must not send.",
    }),
    env: relayEnv(resendCalls),
  });
  assert.equal(malformed.status, 400);

  const oversized = await onRequestPost({
    request: await signedRequest({
      to: "viewer@example.com",
      subject: "Too large",
      text: "x".repeat(12_001),
    }),
    env: relayEnv(resendCalls),
  });
  assert.equal(oversized.status, 400);
  assert.equal(resendCalls.length, 0);
});

async function signedRequest(payload, timestamp = NOW_SECONDS) {
  const body = JSON.stringify(payload);
  const signature = await sign(`${timestamp}.${body}`, SECRET);
  return new Request("https://tinyneed.com/api/aurora-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Aurora-Timestamp": String(timestamp),
      "X-Aurora-Signature": `v1=${signature}`,
    },
    body,
  });
}

function relayEnv(resendCalls) {
  return {
    AURORA_EMAIL_RELAY_SECRET: SECRET,
    AURORA_EMAIL_RELAY_NOW: () => NOW_SECONDS * 1000,
    RESEND_API_KEY: "test-resend-key",
    RESEND_FETCH: async (url, init) => {
      resendCalls.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return Response.json({ id: "email-test-id" });
    },
  };
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
