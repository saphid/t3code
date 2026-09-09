import {
  AuthAccessWriteScope,
  ExtensionOperationError,
  type AuthEnvironmentScope,
  type EnvironmentSessionPrincipalShape,
} from "@t3tools/contracts";
import type { HostApiRootAuthority } from "@t3tools/extension-runtime";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import type { SessionStore } from "../auth/SessionStore.ts";

const denied = () =>
  new ExtensionOperationError({
    operation: "api.authorize",
    detail: "The authenticated extension caller is no longer authorized.",
  });

/** Capture verified identity and attenuated scopes without retaining credential material. */
export const makeSessionApiAuthority = Effect.fn("Extensions.makeSessionApiAuthority")(function* (
  session: AuthenticatedSession | EnvironmentSessionPrincipalShape,
  environmentId: string,
  requiredScope: AuthEnvironmentScope,
  sessions: Pick<SessionStore["Service"], "revalidate">,
) {
  const captured = Object.freeze({
    sessionId: session.sessionId,
    subject: session.subject,
    method: session.method,
    scopes: Object.freeze([...session.scopes]),
    expiresAt: session.expiresAt,
  });
  const read = Effect.fn("Extensions.revalidateApiAuthority")(function* () {
    const current = yield* sessions
      .revalidate(captured.sessionId)
      .pipe(Effect.mapError(() => denied()));
    const now = yield* DateTime.now;
    if (
      current.subject !== captured.subject ||
      current.method !== captured.method ||
      !captured.scopes.includes(requiredScope) ||
      !current.scopes.includes(requiredScope) ||
      (captured.expiresAt !== undefined &&
        DateTime.toEpochMillis(captured.expiresAt) <= DateTime.toEpochMillis(now))
    )
      return yield* denied();
    return current;
  });
  const current = yield* read();
  const scopes = Object.freeze(captured.scopes.filter((scope) => current.scopes.includes(scope)));
  const principal = Object.freeze({
    kind: "environment-session" as const,
    id: captured.sessionId,
    environmentId,
    subject: captured.subject,
    scopes,
  });
  const clock = yield* Clock.Clock;
  return {
    principal,
    allowWrite: requiredScope === AuthAccessWriteScope,
    revalidate: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const next = yield* read();
          if (!scopes.every((scope) => next.scopes.includes(scope))) return yield* denied();
        }).pipe(Effect.provideService(Clock.Clock, clock)),
      ),
  } satisfies HostApiRootAuthority;
});
