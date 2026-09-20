import { assert, it } from "@effect/vitest";
import {
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  isUsageLimitFailureSignal,
  makeProviderFailure,
  makeProviderFailureTurnItem,
  MAX_PROVIDER_FAILURE_CODE_LENGTH,
  MAX_PROVIDER_FAILURE_MESSAGE_LENGTH,
} from "./ProviderFailure.ts";
import { IdAllocatorV2, layer as idAllocatorLayer } from "./IdAllocator.ts";

it("redacts credentials and URL secrets from provider failures", () => {
  const failure = makeProviderFailure({
    message:
      'request failed: Authorization: Bearer bearer-secret https://user:pass@example.test/path?access_token=url-secret#fragment {"token":"json-secret"} api_key=key-secret sk-abcdefghijklmnop',
    code: "provider_rejected",
    class: "provider_error",
  });

  assert.equal(failure.class, "provider_error");
  assert.equal(failure.code, "provider_rejected");
  assert.include(failure.message, "[REDACTED]");
  assert.include(failure.message, "https://example.test/path");
  assert.notInclude(failure.message, "bearer-secret");
  assert.notInclude(failure.message, "user:pass");
  assert.notInclude(failure.message, "url-secret");
  assert.notInclude(failure.message, "json-secret");
  assert.notInclude(failure.message, "key-secret");
  assert.notInclude(failure.message, "sk-abcdefghijklmnop");
});

it("replaces unsafe control characters without stripping whitespace", () => {
  const failure = makeProviderFailure({ message: "before\u0000\u0007\t\nafter\u007f" });

  assert.equal(failure.message, "before  \t\nafter");
});

it("bounds provider-controlled failure strings", () => {
  const failure = makeProviderFailure({
    message: "m".repeat(MAX_PROVIDER_FAILURE_MESSAGE_LENGTH + 500),
    code: "c".repeat(MAX_PROVIDER_FAILURE_CODE_LENGTH + 50),
  });

  assert.equal(failure.message.length, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);
  assert.equal(failure.code?.length, MAX_PROVIDER_FAILURE_CODE_LENGTH);
  assert.match(failure.message, /…$/u);
  assert.match(failure.code ?? "", /…$/u);
});

it("does not split a surrogate pair at the truncation boundary", () => {
  const failure = makeProviderFailure({
    message: `${"a".repeat(MAX_PROVIDER_FAILURE_MESSAGE_LENGTH - 2)}🚀tail`,
  });

  assert.equal(failure.message.length, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH - 1);
  assert.equal(failure.message.at(-1), "…");
  assert.notMatch(failure.message.slice(0, -1), /[\uD800-\uDBFF]$/u);
});

it("does not expose error or Effect cause messages", () => {
  const cause = new Error("private command output", { cause: new Error("private nested output") });
  for (const value of [cause, Cause.fail(cause), "private string", { message: "private object" }]) {
    assert.equal(makeProviderFailure({ cause: value }).message, "Provider turn failed.");
    assert.equal(
      makeProviderFailure({ cause: value, message: "Provider connection closed." }).message,
      "Provider connection closed.",
    );
  }
});

it("does not serialize arbitrary provider causes", () => {
  const failure = makeProviderFailure({
    cause: {
      payload: { authorization: "Bearer nested-secret" },
      stack: "private provider stack",
    },
    class: "transport_error",
  });

  assert.deepEqual(failure, {
    class: "transport_error",
    message: "Provider turn failed.",
    code: null,
    retryable: null,
  });
});

it("detects usage-limit failure signals from structured codes", () => {
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "Something went wrong.", code: "usageLimitExceeded" }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "Something went wrong.", code: "api_error_429" }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "Something went wrong.", code: "rate_limited" }),
  );
  assert.isFalse(
    isUsageLimitFailureSignal({
      message: "Something went wrong.",
      code: "responseStreamDisconnected",
    }),
  );
  assert.isFalse(isUsageLimitFailureSignal({ message: "Something went wrong.", code: null }));
});

it("detects usage-limit failure signals from provider messages", () => {
  assert.isTrue(
    isUsageLimitFailureSignal({
      message: "You've hit your usage limit. Try again at 8:22 PM.",
      code: null,
    }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "Rate limit reached for model.", code: null }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "Out of tokens for this window.", code: null }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "You exceeded your current quota.", code: null }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({
      message: "Quota exceeded for metric: generate_requests_per_model",
      code: null,
    }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({
      message: "Your credit balance is too low to access the Anthropic API",
      code: null,
    }),
  );
  assert.isTrue(
    isUsageLimitFailureSignal({ message: "Something failed.", code: "insufficient_quota" }),
  );
  assert.isFalse(
    isUsageLimitFailureSignal({ message: "The response stream disconnected.", code: null }),
  );
  // Local disk exhaustion is not an account usage limit, in either word order.
  assert.isFalse(
    isUsageLimitFailureSignal({ message: "bash: write failed: disk quota exceeded", code: null }),
  );
  assert.isFalse(
    isUsageLimitFailureSignal({ message: "exceeded the allowed disk quota", code: null }),
  );
  assert.isFalse(
    isUsageLimitFailureSignal({ message: "Something failed.", code: "disk_quota_exceeded" }),
  );
  // Non-English provider text is not matched; unknown stays provider_error.
  assert.isFalse(
    isUsageLimitFailureSignal({ message: "Limite d'utilisation atteinte.", code: null }),
  );
});

it.effect("labels usage-limit terminal failures as out of tokens", () =>
  Effect.gen(function* () {
    const idAllocator = yield* IdAllocatorV2;
    const item = makeProviderFailureTurnItem({
      idAllocator,
      driver: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-usage-limit-title"),
      runId: RunId.make("run-usage-limit-title"),
      nodeId: NodeId.make("node-usage-limit-title"),
      providerThreadId: ProviderThreadId.make("provider-thread-usage-limit-title"),
      providerTurnId: ProviderTurnId.make("provider-turn-usage-limit-title"),
      itemOrdinal: 1,
      failure: makeProviderFailure({
        message: "You've hit your usage limit.",
        code: "usageLimitExceeded",
        class: "usage_limit",
      }),
      occurredAt: DateTime.makeUnsafe("2026-09-19T12:00:00.000Z"),
    });

    assert.equal(item.title, "Out of tokens");
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it.effect("keys terminal failure items by provider turn across retries and fallback paths", () =>
  Effect.gen(function* () {
    const idAllocator = yield* IdAllocatorV2;
    const driver = ProviderDriverKind.make("codex");
    const runId = RunId.make("run:provider-failure-id");
    const base = {
      idAllocator,
      driver,
      threadId: ThreadId.make("thread:provider-failure-id"),
      runId,
      nodeId: NodeId.make("node:provider-failure-id"),
      providerThreadId: ProviderThreadId.make("provider-thread:provider-failure-id"),
      itemOrdinal: 101,
      failure: makeProviderFailure({ message: "Provider failed" }),
      occurredAt: DateTime.makeUnsafe("2026-06-22T12:00:00.000Z"),
    } as const;
    const firstTurnId = ProviderTurnId.make("provider-turn:provider-failure-id:first");
    const secondTurnId = ProviderTurnId.make("provider-turn:provider-failure-id:second");

    const firstAttempt = makeProviderFailureTurnItem({
      ...base,
      providerTurnId: firstTurnId,
    });
    const retriedAttempt = makeProviderFailureTurnItem({
      ...base,
      providerTurnId: secondTurnId,
    });
    const ingestorFallback = makeProviderFailureTurnItem({
      ...base,
      runId: null,
      nodeId: null,
      providerTurnId: firstTurnId,
    });

    assert.notEqual(firstAttempt.id, retriedAttempt.id);
    assert.equal(firstAttempt.id, ingestorFallback.id);
    assert.equal(firstAttempt.ordinal, 101);
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it("reclassifies overload provider errors as retryable provider_busy", () => {
  // The Codex incident: retries exhausted upstream, then a terminal capacity error.
  const codex = makeProviderFailure({
    message: "Selected model is at capacity. Please try a different model.",
    code: "serverOverloaded",
    class: "provider_error",
  });
  assert.equal(codex.class, "provider_busy");
  assert.isTrue(codex.retryable);
  assert.equal(
    makeProviderFailure({
      message: "Claude API overloaded error.",
      code: "api_error_529",
      class: "provider_error",
    }).class,
    "provider_busy",
  );
  assert.equal(
    makeProviderFailure({ message: "The server is currently overloaded.", class: "provider_error" })
      .class,
    "provider_busy",
  );
});

it("keeps permanent and already-classified failures out of provider_busy", () => {
  // A proxy 503 for a revoked credential must not be retried automatically.
  const revoked = makeProviderFailure({
    message:
      "unexpected status 503 Service Unavailable: auth_unavailable: no auth available (providers=codex)",
    code: "http_503",
    class: "provider_error",
  });
  assert.equal(revoked.class, "provider_error");
  assert.isNull(revoked.retryable);
  assert.equal(
    makeProviderFailure({ message: "server overloaded", code: "overloaded", class: "usage_limit" })
      .class,
    "usage_limit",
  );
  assert.equal(
    makeProviderFailure({ message: "The server is overloaded.", class: "transport_error" }).class,
    "transport_error",
  );
  assert.equal(
    makeProviderFailure({ message: "Disk at capacity while writing.", class: "provider_error" })
      .class,
    "provider_error",
  );
});
