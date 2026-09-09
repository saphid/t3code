import { expect, it } from "@effect/vitest";
import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  ExtensionOperationError,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { SessionTokenRevokedError, type RevalidatedSession } from "../auth/SessionStore.ts";
import { makeSessionApiAuthority } from "./sessionApiAuthority.ts";

const isExtensionOperationError = Schema.is(ExtensionOperationError);

function fixture() {
  const scopes: AuthEnvironmentScope[] = [AuthOrchestrationReadScope, AuthAccessWriteScope];
  const session = {
    sessionId: AuthSessionId.make("session-a"),
    subject: "fixture",
    method: "bearer-access-token" as const,
    scopes,
    expiresAt: DateTime.makeUnsafe(1000),
  };
  let current: RevalidatedSession = {
    ...session,
    scopes: [...scopes],
    expiresAt: DateTime.makeUnsafe(10_000),
  };
  let revoked = false;
  const sessions = {
    revalidate: () =>
      revoked
        ? Effect.fail(
            new SessionTokenRevokedError({
              sessionId: session.sessionId,
              revokedAt: DateTime.makeUnsafe(0),
            }),
          )
        : Effect.succeed(current),
  };
  return {
    session,
    sessions,
    setCurrent(next: RevalidatedSession) {
      current = next;
    },
    revoke() {
      revoked = true;
    },
  };
}
const check = (root: { revalidate(): void | Promise<void> }) =>
  Effect.tryPromise({
    try: async () => root.revalidate(),
    catch: (error) => {
      if (isExtensionOperationError(error)) return error;
      throw error;
    },
  });

it.effect("captures nonsecret immutable identity and does not widen read authority", () =>
  Effect.gen(function* () {
    const f = fixture();
    const root = yield* makeSessionApiAuthority(
      f.session,
      "environment-a",
      AuthOrchestrationReadScope,
      f.sessions,
    );
    f.session.scopes.length = 0;
    f.session.subject = "mutated";
    expect(root.principal).toEqual({
      kind: "environment-session",
      id: "session-a",
      environmentId: "environment-a",
      subject: "fixture",
      scopes: [AuthOrchestrationReadScope, AuthAccessWriteScope],
    });
    expect(Object.isFrozen(root.principal)).toBe(true);
    expect(Object.isFrozen(root.principal.scopes)).toBe(true);
    expect(root.allowWrite).toBe(false);
    yield* check(root);
  }),
);

it.effect("intersects original and persisted scopes without adding persisted rights", () =>
  Effect.gen(function* () {
    const f = fixture();
    f.session.scopes = [AuthOrchestrationReadScope];
    const root = yield* makeSessionApiAuthority(
      f.session,
      "environment-a",
      AuthOrchestrationReadScope,
      f.sessions,
    );
    expect(root.principal.scopes).toEqual([AuthOrchestrationReadScope]);
    expect(root.allowWrite).toBe(false);
  }),
);

it.effect("requires both current and original write permission for write roots", () =>
  Effect.gen(function* () {
    const f = fixture();
    const root = yield* makeSessionApiAuthority(
      f.session,
      "environment-a",
      AuthAccessWriteScope,
      f.sessions,
    );
    expect(root.allowWrite).toBe(true);
    f.setCurrent({ ...f.session, scopes: [AuthOrchestrationReadScope] });
    const error = yield* check(root).pipe(Effect.flip);
    expect(error).toMatchObject({ _tag: "ExtensionOperationError" });
    const denied = yield* makeSessionApiAuthority(
      f.session,
      "environment-a",
      AuthAccessWriteScope,
      f.sessions,
    ).pipe(Effect.flip);
    expect(denied._tag).toBe("ExtensionOperationError");
  }),
);

it.effect(
  "retains the injected clock across the Promise callback and expires the original token",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const root = yield* makeSessionApiAuthority(
        f.session,
        "environment-a",
        AuthOrchestrationReadScope,
        f.sessions,
      );
      yield* check(root);
      yield* TestClock.adjust(1000);
      const error = yield* check(root).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ExtensionOperationError" });
    }),
);

it.effect("rejects revocation and changed persisted identity during revalidation", () =>
  Effect.gen(function* () {
    const f = fixture();
    const root = yield* makeSessionApiAuthority(
      f.session,
      "environment-a",
      AuthOrchestrationReadScope,
      f.sessions,
    );
    f.setCurrent({ ...f.session, subject: "another-person" });
    expect(yield* check(root).pipe(Effect.flip)).toMatchObject({ _tag: "ExtensionOperationError" });
    f.setCurrent({ ...f.session });
    f.revoke();
    expect(yield* check(root).pipe(Effect.flip)).toMatchObject({ _tag: "ExtensionOperationError" });
  }),
);
