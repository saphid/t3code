import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "./index.js";

crypto.subtle.timingSafeEqual ??= (left, right) => {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= a[index % a.length] ^ b[index % b.length];
  }
  return difference === 0;
};

const baseEnv = {
  CF_ACCOUNT_ID: "account", GRAFANA_APP_ID: "app", CF_API_TOKEN: "api-token",
  INVITE_TOKEN: "valid-token", INVITE_EXPIRES_AT: String(Date.now() + 60_000),
};

test("GET rejects invalid and expired invitations", async () => {
  assert.equal((await handleRequest(new Request("https://stats.t3play.dev/join?invite=wrong"), baseEnv)).status, 403);
  assert.equal((await handleRequest(new Request("https://stats.t3play.dev/join?invite=valid-token"), { ...baseEnv, INVITE_EXPIRES_AT: "not-a-date" })).status, 410);
  assert.equal((await handleRequest(new Request("https://stats.t3play.dev/join?invite=valid-token"), { ...baseEnv, INVITE_EXPIRES_AT: String(Date.now() - 1) })).status, 410);
  assert.equal((await handleRequest(new Request("https://stats.t3play.dev/join?invite=undefined"), { ...baseEnv, INVITE_TOKEN: undefined })).status, 403);
});

test("GET displays a side-effect-free email form", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("unexpected fetch"); };
  const response = await handleRequest(new Request("https://stats.t3play.dev/join?invite=valid-token"), baseEnv);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /method="post"/);
  assert.match(html, /name="invite" value="valid-token"/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(fetches, 0);
  globalThis.fetch = originalFetch;
});

test("POST enrolls the claimed email and presents one-login continuation", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (!init.method) return Response.json({ success: true, result: [{ name: "Team", decision: "allow", precedence: 7, include: [] }] });
    return Response.json({ success: true, result: {} });
  };
  try {
    const body = new URLSearchParams({ invite: "valid-token", email: "Person@Example.com" });
    const response = await handleRequest(new Request("https://stats.t3play.dev/join", { method: "POST", body }), baseEnv);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /single verification code/);
    assert.match(html, /href="https:\/\/stats\.t3play\.dev\/login"/);
    assert.equal(requests.length, 2);
    const policy = JSON.parse(requests[1].init.body);
    assert.equal(policy.precedence, 8);
    assert.deepEqual(policy.include, [{ email: { email: "person@example.com" } }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("POST rejects malformed email and expired invite without calling Cloudflare", async () => {
  const malformed = new URLSearchParams({ invite: "valid-token", email: "not-an-email" });
  assert.equal((await handleRequest(new Request("https://stats.t3play.dev/join", { method: "POST", body: malformed }), baseEnv)).status, 400);
  const expired = new URLSearchParams({ invite: "valid-token", email: "person@example.com" });
  assert.equal((await handleRequest(new Request("https://stats.t3play.dev/join", { method: "POST", body: expired }), { ...baseEnv, INVITE_EXPIRES_AT: "NaN" })).status, 403);
});
