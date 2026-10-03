import {
  ConnectionBlockedError,
  ConnectionDriver,
  ConnectionTransientError,
  Connectivity,
  type ConnectionAttemptError,
  type SupervisorConnectionState,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import {
  remoteHttpClientLayer,
  type RpcSession,
  type WsRpcProtocolClient,
} from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2Command,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import { T3Credential } from "./credential.ts";
import { makeEnvironment } from "./environment.ts";

const credentialFor = (name: string) =>
  new T3Credential({
    environmentId: EnvironmentId.make(`environment-${name}`),
    label: `Environment ${name}`,
    httpBaseUrl: `https://${name}.example.test/`,
    wsBaseUrl: `wss://${name}.example.test/`,
    token: Redacted.make(`token-${name}`),
  });

interface FakeServer {
  readonly client: Record<string, unknown>;
  readonly capabilities?: Record<string, unknown>;
  readonly closed?: Effect.Effect<never, ConnectionAttemptError>;
}

const fakeSession = (credential: T3Credential, server: FakeServer): RpcSession => ({
  client: server.client as unknown as WsRpcProtocolClient,
  initialConfig: Effect.succeed({
    environment: {
      environmentId: credential.environmentId,
      label: credential.label,
      serverVersion: "0.0.0-test",
      orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
      capabilities: server.capabilities ?? {},
    },
  } as never),
  subscribeServerConfig: () => Stream.empty,
  ready: Effect.void,
  probe: Effect.void,
  closed: server.closed ?? Effect.never,
});

const shellOf = (threadIds: ReadonlyArray<string>) => () =>
  Stream.make({
    kind: "snapshot",
    snapshot: {
      schemaVersion: 1,
      snapshotSequence: 1,
      projects: [],
      threads: threadIds.map((id) => ({ id, title: id })),
      archivedThreads: [],
    },
  });

/** Serves `/api/auth/session`; omitting scopes mimics servers that do not report them. */
const sessionHttpLayer = (scopes: ReadonlyArray<string> | undefined) =>
  remoteHttpClientLayer(((input) =>
    String(input).endsWith("/api/auth/session")
      ? Promise.resolve(
          Response.json({
            authenticated: true,
            auth: {
              policy: "remote-reachable",
              bootstrapMethods: ["one-time-token"],
              sessionMethods: ["bearer-access-token"],
              sessionCookieName: "t3_session",
            },
            ...(scopes === undefined ? {} : { scopes }),
          }),
        )
      : Promise.reject(new Error(`Unexpected request: ${String(input)}`))) satisfies typeof fetch);

const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

/** A connection driver that hands out one scripted session per attempt. */
const environmentWith = Effect.fn("TestEnvironment.make")(function* (
  credential: T3Credential,
  attempts: ReadonlyArray<FakeServer | ConnectionAttemptError>,
  scopes?: ReadonlyArray<string>,
) {
  const count = yield* SubscriptionRef.make(0);
  const driver = ConnectionDriver.ConnectionDriver.of({
    connect: (entry) =>
      Effect.gen(function* () {
        const attempt = yield* SubscriptionRef.getAndUpdate(count, (value) => value + 1);
        const next = attempts[Math.min(attempt, attempts.length - 1)];
        if (next === undefined) return yield* Effect.die(new Error("No scripted attempt."));
        if ("_tag" in next) return yield* next;
        return {
          prepared: {
            environmentId: credential.environmentId,
            label: credential.label,
            httpBaseUrl: credential.httpBaseUrl,
            socketUrl: `${credential.wsBaseUrl}ws`,
            httpAuthorization: { _tag: "Bearer" as const, token: "token" },
            target: entry.target,
          },
          session: fakeSession(credential, next),
        };
      }),
  });
  const environment = yield* makeEnvironment(credential).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ConnectionDriver.ConnectionDriver, driver),
        Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.never }),
        Wakeups.layer({ changes: Stream.never }),
        cryptoLayer,
        sessionHttpLayer(scopes),
      ),
    ),
  );
  return { environment, attempts: count };
});

const awaitPhase = (
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  phase: SupervisorConnectionState["phase"],
) =>
  SubscriptionRef.changes(state).pipe(
    Stream.filter((value) => value.phase === phase),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

describe("external environment client", () => {
  it.effect("reports the negotiated protocol, capabilities and granted scopes", () =>
    Effect.gen(function* () {
      const { environment } = yield* environmentWith(
        credentialFor("one"),
        [{ client: {}, capabilities: { connectionProbe: true } }],
        ["orchestration:read"],
      );

      const negotiated = yield* environment.negotiation;
      expect(negotiated.environment.orchestrationProtocolVersion).toBe(
        ORCHESTRATION_PROTOCOL_VERSION,
      );
      expect(negotiated.environment.capabilities).toEqual({ connectionProbe: true });
      expect(negotiated.scopes).toEqual(["orchestration:read"]);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves scopes unknown when an older server does not report them", () =>
    Effect.gen(function* () {
      const { environment } = yield* environmentWith(credentialFor("one"), [{ client: {} }]);

      expect((yield* environment.negotiation).scopes).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect("fails at once, without retrying, when the server needs an update", () =>
    Effect.gen(function* () {
      const outdated = new ConnectionBlockedError({
        reason: "unsupported",
        detail: "This client requires a newer server.",
        serverUpdateRequired: true,
      });
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [outdated]);

      expect(yield* Effect.flip(environment.ready)).toBe(outdated);
      expect(
        yield* Effect.flip(
          environment.request(ORCHESTRATION_V2_WS_METHODS.getThreadProjection, {
            threadId: ThreadId.make("thread-1"),
          }),
        ),
      ).toBe(outdated);
      yield* TestClock.adjust("10 minutes");
      expect(yield* SubscriptionRef.get(attempts)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("reconnects after a dropped socket and serves later requests on the new session", () =>
    Effect.gen(function* () {
      const dropped = yield* Deferred.make<never, ConnectionAttemptError>();
      const served: Array<string> = [];
      const projectionFrom = (session: string) => () =>
        Effect.sync(() => {
          served.push(session);
          return { session } as never;
        });
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [
        {
          client: { [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: projectionFrom("first") },
          closed: Deferred.await(dropped),
        },
        { client: { [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: projectionFrom("second") } },
      ]);
      const getProjection = environment.request(ORCHESTRATION_V2_WS_METHODS.getThreadProjection, {
        threadId: ThreadId.make("thread-1"),
      });

      yield* getProjection;
      yield* Deferred.fail(
        dropped,
        new ConnectionTransientError({ reason: "transport", detail: "socket closed" }),
      );
      yield* awaitPhase(environment.state, "backoff");
      const waiting = yield* Effect.forkChild(getProjection);
      yield* TestClock.adjust("5 minutes");
      yield* Fiber.join(waiting);

      expect(served).toEqual(["first", "second"]);
      expect(yield* SubscriptionRef.get(attempts)).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("resolves delivery from the projection on servers without server-side context", () =>
    Effect.gen(function* () {
      const commands: Array<OrchestrationV2Command> = [];
      const projections: Array<unknown> = [];
      const client = {
        [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command: OrchestrationV2Command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: commands.length };
          }),
        [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: (input: unknown) =>
          Effect.sync(() => {
            projections.push(input);
            return { runs: [], providerThreads: [], providerSessions: [], messages: [] } as never;
          }),
      };
      const old = yield* environmentWith(credentialFor("old"), [{ client }]);
      const current = yield* environmentWith(credentialFor("new"), [
        { client, capabilities: { serverResolvedCommandContext: true } },
      ]);
      const threadId = ThreadId.make("thread-1");

      yield* old.environment.sendMessage({ threadId, text: "from an old server" });
      yield* current.environment.sendMessage({ threadId, text: "from a new server" });

      expect(projections).toEqual([{ threadId }]);
      expect(commands).toMatchObject([
        {
          type: "message.dispatch",
          threadId,
          text: "from an old server",
          dispatchMode: { type: "start_immediately" },
        },
        {
          type: "message.dispatch",
          threadId,
          text: "from a new server",
          deliveryIntent: "auto",
          dispatchMode: { type: "start_immediately" },
        },
      ]);
      expect(commands[0]).not.toHaveProperty("deliveryIntent");
    }).pipe(Effect.scoped),
  );

  it.effect("keeps two environments independent", () =>
    Effect.gen(function* () {
      const dropped = yield* Deferred.make<never, ConnectionAttemptError>();
      const one = yield* environmentWith(credentialFor("one"), [
        {
          client: { [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: shellOf(["one-a", "one-b"]) },
          closed: Deferred.await(dropped),
        },
        { client: { [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: shellOf(["one-a"]) } },
      ]);
      const two = yield* environmentWith(credentialFor("two"), [
        { client: { [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: shellOf(["two-a"]) } },
      ]);

      expect((yield* one.environment.shell).threads.map((thread) => thread.id)).toEqual([
        "one-a",
        "one-b",
      ]);
      yield* Deferred.fail(
        dropped,
        new ConnectionTransientError({ reason: "transport", detail: "socket closed" }),
      );
      yield* awaitPhase(one.environment.state, "backoff");

      expect((yield* two.environment.shell).threads.map((thread) => thread.id)).toEqual(["two-a"]);
      expect((yield* SubscriptionRef.get(two.environment.state)).phase).toBe("connected");
      expect(yield* SubscriptionRef.get(two.attempts)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("serves the request after reconnect on the new session", () =>
    Effect.gen(function* () {
      const served: Array<string> = [];
      const projectionFrom = (session: string) => () =>
        Effect.sync(() => {
          served.push(session);
          return { session } as never;
        });
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [
        { client: { [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: projectionFrom("first") } },
        { client: { [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: projectionFrom("second") } },
      ]);
      yield* environment.ready;
      yield* environment.disconnect;
      yield* awaitPhase(environment.state, "available");

      yield* environment.reconnect;
      yield* environment.ready;
      yield* environment.request(ORCHESTRATION_V2_WS_METHODS.getThreadProjection, {
        threadId: ThreadId.make("thread-1"),
      });

      expect(served).toEqual(["second"]);
      expect(yield* SubscriptionRef.get(attempts)).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("reports a block found by the reconnect attempt", () =>
    Effect.gen(function* () {
      const revoked = new ConnectionBlockedError({
        reason: "authentication",
        detail: "The session was revoked.",
      });
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [
        { client: {} },
        revoked,
      ]);
      yield* environment.ready;
      yield* environment.disconnect;
      yield* awaitPhase(environment.state, "available");

      yield* environment.reconnect;

      expect(
        yield* Effect.flip(
          environment.request(ORCHESTRATION_V2_WS_METHODS.getThreadProjection, {
            threadId: ThreadId.make("thread-1"),
          }),
        ),
      ).toBe(revoked);
      expect(yield* SubscriptionRef.get(attempts)).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("waits for the retried attempt after a block", () =>
    Effect.gen(function* () {
      const blocked = new ConnectionBlockedError({
        reason: "permission",
        detail: "This device is not allowed yet.",
      });
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [
        blocked,
        { client: {} },
      ]);
      expect(yield* Effect.flip(environment.ready)).toBe(blocked);

      yield* environment.retryNow;
      yield* environment.ready;

      expect(yield* SubscriptionRef.get(attempts)).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("reports the block found by the retried attempt", () =>
    Effect.gen(function* () {
      const first = new ConnectionBlockedError({ reason: "permission", detail: "first" });
      const second = new ConnectionBlockedError({ reason: "permission", detail: "second" });
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [
        first,
        second,
      ]);
      expect(yield* Effect.flip(environment.ready)).toBe(first);

      yield* environment.retryNow;

      expect(yield* Effect.flip(environment.ready)).toBe(second);
      expect(yield* SubscriptionRef.get(attempts)).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("stays disconnected when retried without a reconnect", () =>
    Effect.gen(function* () {
      const { environment, attempts } = yield* environmentWith(credentialFor("one"), [
        { client: {} },
      ]);
      yield* environment.ready;
      yield* environment.disconnect;
      yield* awaitPhase(environment.state, "available");

      yield* environment.retryNow;

      expect(yield* Effect.flip(environment.ready)).toMatchObject({
        _tag: "EnvironmentRpcUnavailableError",
      });
      expect(yield* SubscriptionRef.get(attempts)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("reports a caller disconnect instead of waiting forever", () =>
    Effect.gen(function* () {
      const { environment } = yield* environmentWith(credentialFor("one"), [{ client: {} }]);
      yield* environment.ready;
      yield* environment.disconnect;
      yield* awaitPhase(environment.state, "available");

      expect(yield* Effect.flip(environment.ready)).toMatchObject({
        _tag: "EnvironmentRpcUnavailableError",
      });
    }).pipe(Effect.scoped),
  );
});
