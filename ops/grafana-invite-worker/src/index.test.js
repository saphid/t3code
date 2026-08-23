import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "./index.js";

// Cloudflare's Web Crypto includes this method; Node 24 does not yet.
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
  CF_ACCOUNT_ID: "account",
  GRAFANA_APP_ID: "app",
  CF_API_TOKEN: "api-token",
  INVITE_TOKEN: "valid-token",
  INVITE_EXPIRES_AT: String(Date.now() + 60_000),
};

test("rejects an invalid invitation", async () => {
  const response = await handleRequest(
    new Request("https://stats.t3play.dev/join?invite=wrong"),
    baseEnv,
    {},
  );
  assert.equal(response.status, 403);
});

test("rejects an expired invitation", async () => {
  const response = await handleRequest(
    new Request("https://stats.t3play.dev/join?invite=valid-token"),
    { ...baseEnv, INVITE_EXPIRES_AT: String(Date.now() - 1) },
    {},
  );
  assert.equal(response.status, 410);
});

test("adds the verified email and redirects without leaking the invite", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (!init.method) {
      return Response.json({
        success: true,
        result: [
          {
            name: "Team",
            decision: "allow",
            precedence: 1,
            include: [{ email: { email: "owner@example.com" } }],
          },
        ],
      });
    }
    return Response.json({ success: true, result: {} });
  };

  try {
    const response = await handleRequest(
      new Request("https://stats.t3play.dev/join?invite=valid-token"),
      baseEnv,
      {
        access: {
          getIdentity: async () => ({ email: "Person@Example.com" }),
        },
      },
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://stats.t3play.dev/login");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(requests.length, 2);
    const body = JSON.parse(requests[1].init.body);
    assert.deepEqual(body.include, [
      { email: { email: "person@example.com" } },
    ]);
    assert.match(body.name, /^Invite [0-9a-f]{12}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
