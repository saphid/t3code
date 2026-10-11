import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  AuthTerminalOperateScope,
  type AuthSessionState,
  type TerminalAttachInput,
  type TerminalAttachStreamEvent,
  type TerminalMetadataStreamEvent,
  type TerminalSummary,
  type TerminalSessionSnapshot,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { vi } from "vite-plus/test";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createTerminalEnvironmentAtoms,
  type TerminalBufferState,
  terminalOutputText,
} from "./terminal.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("terminal-environment"),
  label: "Terminal environment",
  httpBaseUrl: "https://terminal.example.test",
  wsBaseUrl: "wss://terminal.example.test",
});
const INPUT = { threadId: "thread-1", terminalId: "terminal-1", cwd: "/repo" };
const SNAPSHOT: TerminalSessionSnapshot = {
  ...INPUT,
  worktreePath: null,
  status: "running",
  pid: 123,
  history: "initial history",
  exitCode: null,
  exitSignal: null,
  label: "Terminal 1",
  updatedAt: "2026-10-12T00:00:00.000Z",
};
const SUMMARY: TerminalSummary = { ...SNAPSHOT, hasRunningSubprocess: false };

vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => grantedSession }),
}));
const grantedSession = Atom.make(
  AsyncResult.success<AuthSessionState>({
    authenticated: true,
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    scopes: [AuthTerminalOperateScope],
    permissions: [AuthTerminalOperateScope],
  }),
);

const makeHarness = Effect.fn("TestTerminal.makeHarness")(function* () {
  const metadataEvents = yield* Queue.unbounded<TerminalMetadataStreamEvent>();
  yield* Queue.offer(metadataEvents, { type: "snapshot", terminals: [SUMMARY] });
  const opened = yield* Queue.unbounded<{
    input: TerminalAttachInput;
    events: Queue.Queue<TerminalAttachStreamEvent>;
    released: Deferred.Deferred<void>;
  }>();
  const calls: Array<TerminalAttachInput> = [];
  let active = 0;
  const subscribe = (input: TerminalAttachInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<TerminalAttachStreamEvent>();
        const released = yield* Deferred.make<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            calls.push(input);
            active += 1;
          }),
          () =>
            Effect.sync(() => {
              active -= 1;
            }).pipe(Effect.andThen(Deferred.succeed(released, undefined))),
        );
        yield* Queue.offer(opened, { input, events, released });
        return Stream.fromQueue(events);
      }),
    );
  const client = {
    [WS_METHODS.terminalAttach]: subscribe,
    [WS_METHODS.terminalObserve]: subscribe,
    [WS_METHODS.subscribeTerminalMetadata]: () => Stream.fromQueue(metadataEvents),
    [WS_METHODS.terminalOpen]: () =>
      Queue.offer(metadataEvents, { type: "upsert", terminal: SUMMARY }).pipe(Effect.as(SNAPSHOT)),
    [WS_METHODS.terminalRestart]: () =>
      Queue.offer(metadataEvents, { type: "upsert", terminal: SUMMARY }).pipe(Effect.as(SNAPSHOT)),
  } as unknown as WsRpcProtocolClient;
  const session = (): RpcSession => ({
    client,
    initialConfig: Effect.never,
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  });
  const sessions = yield* SubscriptionRef.make(Option.some(session()));
  const supervisor = EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: sessions,
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const environments = EnvironmentRegistry.of({
    run: (_environmentId, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor, supervisor),
    followStream: (_environmentId, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisor),
  } as EnvironmentRegistry["Service"]);
  const runtime = Atom.runtime(Layer.succeed(EnvironmentRegistry, environments));
  const atoms = createTerminalEnvironmentAtoms(runtime);
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  const metadataChanges = yield* Queue.unbounded<ReadonlyArray<TerminalSummary>>();
  const unmountMetadata = registry.subscribe(
    atoms.metadata({ environmentId: TARGET.environmentId, input: null }),
    (result) => {
      if (AsyncResult.isSuccess(result)) Queue.offerUnsafe(metadataChanges, result.value);
    },
    { immediate: true },
  );
  yield* Effect.addFinalizer(() => Effect.sync(unmountMetadata));
  yield* Stream.fromQueue(metadataChanges).pipe(
    Stream.filter((terminals) => terminals.length === 1),
    Stream.runHead,
  );
  const publishMetadata = (event: TerminalMetadataStreamEvent, exists: boolean) =>
    Queue.clear(metadataChanges).pipe(
      Effect.andThen(Queue.offer(metadataEvents, event)),
      Effect.andThen(
        Stream.fromQueue(metadataChanges).pipe(
          Stream.filter(
            (terminals) =>
              terminals.some((terminal) => terminal.terminalId === INPUT.terminalId) === exists,
          ),
          Stream.runHead,
          Effect.asVoid,
        ),
      ),
    );
  return {
    atoms,
    registry,
    opened,
    calls,
    publishMetadata,
    active: () => active,
    reconnect: () => SubscriptionRef.set(sessions, Option.some(session())),
  };
});

const observeState = Effect.fn("TestTerminal.observeState")(function* <E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<TerminalBufferState, E>>,
) {
  const states = yield* Queue.unbounded<TerminalBufferState>();
  const unmount = registry.subscribe(
    atom,
    (result) => {
      if (AsyncResult.isSuccess(result) && result.value.version > 0) {
        Queue.offerUnsafe(states, result.value);
      }
    },
    { immediate: true },
  );
  yield* Effect.addFinalizer(() => Effect.sync(unmount));
  return { states, unmount };
});

describe("terminal subscription lifecycle", () => {
  it.effect.each(["attach", "observe"] as const)(
    "keeps live %s warm across unmount/remount without another subscription",
    (mode) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const input =
            mode === "attach" ? INPUT : { threadId: INPUT.threadId, terminalId: INPUT.terminalId };
          const atom = harness.atoms[mode]({ environmentId: TARGET.environmentId, input });
          const reader = yield* observeState(harness.registry, atom);
          const subscription = yield* Queue.take(harness.opened);
          yield* Queue.offer(subscription.events, { type: "snapshot", snapshot: SNAPSHOT });
          expect(terminalOutputText((yield* Queue.take(reader.states)).output)).toBe(
            "initial history",
          );
          reader.unmount();
          // Allow queued reader cleanup to run before remounting within the idle TTL.
          yield* Effect.yieldNow;
          expect(harness.active()).toBe(1);
          expect(yield* Deferred.isDone(subscription.released)).toBe(false);
          yield* Queue.offer(subscription.events, {
            type: "output",
            threadId: INPUT.threadId,
            terminalId: INPUT.terminalId,
            data: " while hidden",
          });
          const remounted = yield* observeState(harness.registry, atom);
          yield* Stream.fromQueue(remounted.states).pipe(
            Stream.filter(
              (state) => terminalOutputText(state.output) === "initial history while hidden",
            ),
            Stream.runHead,
          );
          expect(harness.calls).toEqual([input]);

          // A real connection replacement still resubscribes a live terminal.
          yield* harness.reconnect();
          yield* Queue.take(harness.opened);
          yield* Deferred.await(subscription.released);
          expect(harness.calls).toEqual([input, input]);
          expect(harness.active()).toBe(1);
        }),
      ),
  );

  it.effect("keeps the stream while another reader remains mounted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const atom = harness.atoms.attach({ environmentId: TARGET.environmentId, input: INPUT });
        const first = yield* observeState(harness.registry, atom);
        const second = yield* observeState(harness.registry, atom);
        const subscription = yield* Queue.take(harness.opened);
        first.unmount();
        yield* Queue.offer(subscription.events, { type: "snapshot", snapshot: SNAPSHOT });
        expect((yield* Queue.take(second.states)).status).toBe("running");
        expect(harness.calls).toEqual([INPUT]);
        expect(yield* Deferred.isDone(subscription.released)).toBe(false);
      }),
    ),
  );

  it.effect("attaches once after an idle cache expires and metadata changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
        const harness = yield* makeHarness();
        const atom = harness.atoms.attach({ environmentId: TARGET.environmentId, input: INPUT });
        const reader = yield* observeState(harness.registry, atom);
        const subscription = yield* Queue.take(harness.opened);
        yield* harness.publishMetadata(
          { type: "remove", threadId: INPUT.threadId, terminalId: INPUT.terminalId },
          false,
        );
        reader.unmount();
        yield* Effect.yieldNow;
        vi.advanceTimersByTime(10 * 60_000);
        yield* Deferred.await(subscription.released);
        yield* harness.publishMetadata({ type: "upsert", terminal: SUMMARY }, true);
        const remounted = yield* observeState(harness.registry, atom);
        const reopened = yield* Queue.take(harness.opened);
        yield* Queue.offer(reopened.events, { type: "snapshot", snapshot: SNAPSHOT });
        yield* Queue.take(remounted.states);
        expect(harness.calls).toEqual([INPUT, INPUT]);
        expect(harness.active()).toBe(1);
      }),
    ),
  );

  it.effect.each([
    { mode: "attach", leaveView: true },
    { mode: "attach", leaveView: false },
    { mode: "observe", leaveView: true },
  ] as const)(
    "does not resubscribe a closed terminal ($mode, leaveView=$leaveView) on reconnect",
    ({ mode, leaveView }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const input =
            mode === "attach" ? INPUT : { threadId: INPUT.threadId, terminalId: INPUT.terminalId };
          const atom = harness.atoms[mode]({ environmentId: TARGET.environmentId, input });
          const reader = yield* observeState(harness.registry, atom);
          const subscription = yield* Queue.take(harness.opened);
          yield* Queue.offer(subscription.events, { type: "snapshot", snapshot: SNAPSHOT });
          yield* Queue.take(reader.states);
          yield* Queue.offer(subscription.events, {
            type: "closed",
            threadId: INPUT.threadId,
            terminalId: INPUT.terminalId,
          });
          const closed = yield* Queue.take(reader.states);
          expect(closed.status).toBe("closed");
          expect(terminalOutputText(closed.output)).toBe("initial history");
          yield* harness.publishMetadata(
            { type: "remove", threadId: INPUT.threadId, terminalId: INPUT.terminalId },
            false,
          );
          if (leaveView) reader.unmount();

          // A different visible terminal acknowledges the replacement RPC session.
          const controlInput = { ...INPUT, terminalId: "terminal-2" };
          harness.registry.mount(
            harness.atoms.attach({ environmentId: TARGET.environmentId, input: controlInput }),
          );
          yield* Queue.take(harness.opened);
          yield* harness.reconnect();
          yield* Stream.fromQueue(harness.opened).pipe(
            Stream.filter(({ input }) => input.terminalId === controlInput.terminalId),
            Stream.runHead,
          );
          expect(harness.calls.filter(({ terminalId }) => terminalId === INPUT.terminalId)).toEqual(
            [input],
          );
          yield* Deferred.await(subscription.released);
          expect(harness.active()).toBe(1);

          // The closed snapshot remains warm without reviving its live subscription.
          const remounted = yield* observeState(harness.registry, atom);
          expect((yield* Queue.take(remounted.states)).status).toBe("closed");
          expect(harness.calls.filter(({ terminalId }) => terminalId === INPUT.terminalId)).toEqual(
            [input],
          );
          const result = harness.registry.get(atom);
          expect(AsyncResult.isSuccess(result) && !result.waiting).toBe(true);
        }),
      ),
  );

  it.effect("continues observing an exited session so explicit restart can update it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const atom = harness.atoms.attach({ environmentId: TARGET.environmentId, input: INPUT });
        const reader = yield* observeState(harness.registry, atom);
        const subscription = yield* Queue.take(harness.opened);
        yield* Queue.offer(subscription.events, {
          type: "snapshot",
          snapshot: { ...SNAPSHOT, status: "exited", pid: null, exitCode: 0 },
        });
        expect((yield* Queue.take(reader.states)).status).toBe("exited");
        expect(yield* Deferred.isDone(subscription.released)).toBe(false);
        yield* Queue.offer(subscription.events, {
          type: "restarted",
          threadId: INPUT.threadId,
          terminalId: INPUT.terminalId,
          snapshot: SNAPSHOT,
        });
        expect((yield* Queue.take(reader.states)).status).toBe("running");
        expect(harness.calls).toEqual([INPUT]);
      }),
    ),
  );

  it.effect.each(["open", "restart"] as const)(
    "resumes a completed attachment after an explicit %s with different launch inputs",
    (command) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const atom = harness.atoms.attach({ environmentId: TARGET.environmentId, input: INPUT });
          const reader = yield* observeState(harness.registry, atom);
          const subscription = yield* Queue.take(harness.opened);
          yield* Queue.offer(subscription.events, {
            type: "closed",
            threadId: INPUT.threadId,
            terminalId: INPUT.terminalId,
          });
          expect((yield* Queue.take(reader.states)).status).toBe("closed");
          yield* Deferred.await(subscription.released);
          yield* harness.publishMetadata(
            { type: "remove", threadId: INPUT.threadId, terminalId: INPUT.terminalId },
            false,
          );
          const result = yield* Effect.promise(() =>
            harness.atoms[command].run(harness.registry, {
              environmentId: TARGET.environmentId,
              input: { ...INPUT, cols: 100, rows: 30 },
            }),
          );
          expect(AsyncResult.isSuccess(result)).toBe(true);
          const reopened = yield* Queue.take(harness.opened);
          yield* Queue.offer(reopened.events, { type: "snapshot", snapshot: SNAPSHOT });
          yield* Stream.fromQueue(reader.states).pipe(
            Stream.filter((state) => state.status === "running"),
            Stream.runHead,
          );
          expect(harness.calls).toEqual([INPUT, INPUT]);
        }),
      ),
  );

  it.effect.each(["open", "restart"] as const)(
    "does not reattach a running terminal after an explicit %s",
    (command) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const atom = harness.atoms.attach({ environmentId: TARGET.environmentId, input: INPUT });
          const reader = yield* observeState(harness.registry, atom);
          const subscription = yield* Queue.take(harness.opened);
          yield* Queue.offer(subscription.events, { type: "snapshot", snapshot: SNAPSHOT });
          yield* Queue.take(reader.states);
          const result = yield* Effect.promise(() =>
            harness.atoms[command].run(harness.registry, {
              environmentId: TARGET.environmentId,
              input: { ...INPUT, cols: 100, rows: 30 },
            }),
          );
          expect(AsyncResult.isSuccess(result)).toBe(true);
          expect(harness.calls).toEqual([INPUT]);
          expect(yield* Deferred.isDone(subscription.released)).toBe(false);
          yield* Queue.offer(subscription.events, {
            type: "output",
            threadId: INPUT.threadId,
            terminalId: INPUT.terminalId,
            data: " after command",
          });
          expect(terminalOutputText((yield* Queue.take(reader.states)).output)).toBe(
            "initial history after command",
          );
        }),
      ),
  );

  it.effect.each([
    { mode: "attach", leaveView: true },
    { mode: "attach", leaveView: false },
    { mode: "observe", leaveView: true },
    { mode: "observe", leaveView: false },
  ] as const)(
    "resumes $mode when another device reopens its terminal (leaveView=$leaveView)",
    ({ mode, leaveView }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const input =
            mode === "attach" ? INPUT : { threadId: INPUT.threadId, terminalId: INPUT.terminalId };
          const atom = harness.atoms[mode]({ environmentId: TARGET.environmentId, input });
          const reader = yield* observeState(harness.registry, atom);
          const subscription = yield* Queue.take(harness.opened);
          yield* Queue.offer(subscription.events, {
            type: "closed",
            threadId: INPUT.threadId,
            terminalId: INPUT.terminalId,
          });
          expect((yield* Queue.take(reader.states)).status).toBe("closed");
          yield* Deferred.await(subscription.released);
          yield* harness.publishMetadata(
            { type: "remove", threadId: INPUT.threadId, terminalId: INPUT.terminalId },
            false,
          );
          if (leaveView) reader.unmount();
          yield* harness.publishMetadata({ type: "upsert", terminal: SUMMARY }, true);
          const remounted = leaveView ? yield* observeState(harness.registry, atom) : reader;
          const reopened = yield* Queue.take(harness.opened);
          yield* Queue.offer(reopened.events, {
            type: "snapshot",
            snapshot: { ...SNAPSHOT, history: "new process" },
          });
          yield* Stream.fromQueue(remounted.states).pipe(
            Stream.filter((state) => terminalOutputText(state.output) === "new process"),
            Stream.runHead,
          );
          expect(harness.calls).toEqual([input, input]);
          yield* harness.publishMetadata(
            { type: "upsert", terminal: { ...SUMMARY, label: "Busy", hasRunningSubprocess: true } },
            true,
          );
          expect(harness.calls).toEqual([input, input]);
          expect(yield* Deferred.isDone(reopened.released)).toBe(false);
        }),
      ),
  );
});
