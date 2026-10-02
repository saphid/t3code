import { afterEach, describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import { EnvironmentId, WS_METHODS, type ClientProviderServerFrame } from "@t3tools/contracts";
import {
  EnvironmentRegistry,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import { MOBILE_UI_CAPABILITIES } from "./mobileUiProviders";
import type { MobileUiProviders } from "./mobileClientProviderConnection";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobileExtensionTransport } from "./mobileExtensionTransport";

// The runtime boundary is mocked; the HTTP transport, schemas and prepared
// connection lookup remain real. No mobile storage or socket is opened.
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("effect/unstable/reactivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect/unstable/reactivity")>();
  return { ...actual, AtomRegistry: { ...actual.AtomRegistry, getResult: vi.fn() } };
});
afterEach(() => vi.restoreAllMocks());

const fixture = Effect.fnUntraced(function* (fetcher: typeof fetch, ui?: MobileUiProviders) {
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("e"),
    label: "Fixture",
    httpBaseUrl: "https://fixture.example",
    wsBaseUrl: "wss://fixture.example/ws",
  });
  const connection: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  const prepared = yield* SubscriptionRef.make(Option.some(connection));
  const session = yield* SubscriptionRef.make(Option.none<RpcSession>());
  const supervisor = { prepared, session, target } as EnvironmentSupervisor["Service"];
  const registry = {
    run: (id, effect) => {
      expect(id).toBe(target.environmentId);
      return Effect.provideService(effect, EnvironmentSupervisor, supervisor);
    },
    runStream: (id, stream) => {
      expect(id).toBe(target.environmentId);
      return Stream.provideService(stream, EnvironmentSupervisor, supervisor);
    },
    followStream: (id, stream) => {
      expect(id).toBe(target.environmentId);
      return Stream.provideService(stream, EnvironmentSupervisor, supervisor);
    },
  } satisfies Pick<EnvironmentRegistry["Service"], "run" | "followStream" | "runStream">;
  const http = yield* Layer.build(remoteHttpClientLayer(fetcher));
  const context = Context.merge(
    http,
    Context.make(EnvironmentRegistry, registry as EnvironmentRegistry["Service"]),
  );
  const release = vi.fn();
  vi.spyOn(appAtomRegistry, "mount").mockReturnValue(release);
  vi.mocked(AtomRegistry.getResult).mockReturnValue(Effect.succeed(context));
  const owner = new AbortController();
  let hash = "a".repeat(64);
  const transport = yield* Effect.promise(() =>
    mobileExtensionTransport("e", "t3.pack", () => hash, owner.signal, ui),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => owner.abort()));
  return {
    transport,
    owner,
    release,
    prepared,
    session,
    setHash: (value: string) => (hash = value),
  };
});

describe("mobile transport borrowing the environment supervisor", () => {
  it.effect("reads the current prepared connection and installation hash on every invocation", () =>
    Effect.gen(function* () {
      const calls: { url: string; body: unknown }[] = [];
      const f = yield* fixture(async (url, init) => {
        calls.push({ url: String(url), body: await new Request(String(url), init).json() });
        return Response.json({ result: null });
      });
      const request = {
        id: "t3.orchestration/status",
        versionRange: "^1.0.0",
        method: "getCapabilities",
        input: {},
        context: {
          resource: { namespace: "t3.thread", id: "t", environmentId: "e" },
          client: "mobile",
        },
      };
      const signal = new AbortController().signal;
      yield* Effect.promise(() => f.transport.invokeApi(request, signal));
      yield* SubscriptionRef.update(
        f.prepared,
        Option.map((value) => ({ ...value, httpBaseUrl: "https://replacement.example" })),
      );
      f.setHash("b".repeat(64));
      yield* Effect.promise(() => f.transport.invokeApi(request, signal));
      expect(calls).toEqual([
        {
          url: "https://fixture.example/api/extensions/api/invoke",
          body: { installationId: "t3.pack", expectedContentHash: "a".repeat(64), request },
        },
        {
          url: "https://replacement.example/api/extensions/api/invoke",
          body: { installationId: "t3.pack", expectedContentHash: "b".repeat(64), request },
        },
      ]);
      f.owner.abort();
      expect(f.release).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("interrupts in-flight HTTP when the surface owner is disposed", () =>
    Effect.gen(function* () {
      let started!: () => void;
      const fetched = new Promise<void>((resolve) => (started = resolve));
      let finish!: (response: Response) => void;
      const response = new Promise<Response>((resolve) => (finish = resolve));
      let fetchSignal: AbortSignal | null | undefined;
      const f = yield* fixture((_url, init) => {
        fetchSignal = init?.signal;
        started();
        return response;
      });
      const pending = f.transport.list(new AbortController().signal);
      // Settle either branch before inspecting cancellation, without a timeout.
      const result = pending.then(
        () => "completed",
        () => "cancelled",
      );
      yield* Effect.promise(() => fetched);
      f.owner.abort();
      finish(Response.json({ installations: [] }));
      expect(yield* Effect.promise(() => result)).toBe("cancelled");
      expect(fetchSignal?.aborted).toBe(true);
      expect(f.release).toHaveBeenCalledTimes(1);
      yield* Effect.promise(() =>
        expect(f.transport.list(new AbortController().signal)).rejects.toThrow(),
      );
    }),
  );
});

const socketFixture = Effect.fnUntraced(function* (connectionId: string, register = true) {
  const frames = yield* Queue.unbounded<ClientProviderServerFrame>();
  const opened = yield* Deferred.make<void>();
  const closed = yield* Deferred.make<void>();
  const end = yield* Deferred.make<boolean>();
  const sent = yield* Queue.unbounded<unknown>();
  const apiOpened = yield* Queue.unbounded<unknown>();
  const apiFrames = yield* Queue.unbounded<import("@t3tools/contracts").ExtensionApiStreamFrame>();
  const descriptors = [
    { id: "t3.client/theme", version: "1.0.0" },
    { id: "t3.client/navigation", version: "1.0.0" },
  ];
  const client = {
    [WS_METHODS.subscribeExtensionApi]: (input: unknown) =>
      Stream.concat(
        Stream.fromEffect(Queue.offer(apiOpened, input)).pipe(Stream.drain),
        Stream.fromQueue(apiFrames),
      ),
    [WS_METHODS.extensionsClientProvidersConnect]: (input: { providers: typeof descriptors }) => {
      expect(input.providers).toEqual(descriptors);
      const registration = Stream.fromEffect(
        Deferred.succeed(opened, undefined).pipe(
          Effect.as({
            type: "registered",
            connectionId,
            accepted: descriptors,
            rejected: [],
          } as ClientProviderServerFrame),
        ),
      );
      return Stream.concat(
        register ? registration : registration.pipe(Stream.drain),
        Stream.merge(
          Stream.fromQueue(frames),
          Stream.fromEffect(
            Deferred.await(end).pipe(
              Effect.flatMap((fail) =>
                fail
                  ? Effect.fail(new Error("Unknown request tag: clientProviders.connect"))
                  : Effect.void,
              ),
            ),
          ).pipe(Stream.drain),
          { haltStrategy: "either" },
        ),
      ).pipe(Stream.ensuring(Deferred.succeed(closed, undefined)));
    },
    [WS_METHODS.extensionsClientProvidersRespond]: (payload: unknown) =>
      Queue.offer(sent, payload).pipe(Effect.asVoid),
    [WS_METHODS.extensionsClientProvidersEmit]: (payload: unknown) =>
      Queue.offer(sent, payload).pipe(Effect.asVoid),
  } as unknown as RpcSession["client"];
  const socket = { client } as RpcSession;
  return { socket, frames, opened, closed, sent, apiOpened, apiFrames, end };
});

const unstampedRequest = {
  id: "t3.orchestration/status",
  versionRange: "^1.0.0",
  method: "getCapabilities",
  input: {},
  context: {
    resource: { namespace: "t3.thread", id: "t", environmentId: "e" },
    client: "mobile",
  },
  clientConnectionId: "borrowed",
};

function unavailableUi(
  resetConnection: MobileUiProviders["resetConnection"] = vi.fn(),
): MobileUiProviders {
  return {
    providers: new Map(),
    descriptors: [
      { id: "t3.client/theme", version: "1.0.0" },
      { id: "t3.client/navigation", version: "1.0.0" },
    ],
    capabilities: MOBILE_UI_CAPABILITIES,
    resetConnection,
    dispose: vi.fn(),
    notifyAppearanceChanged: vi.fn(),
    notifyInstallationsChanged: vi.fn(),
  };
}

/** Capture the registration bound; advancing it is explicit, never a wall-clock sleep. */
function registrationTimer() {
  let fire!: () => void;
  let scheduled!: () => void;
  const ready = new Promise<void>((resolve) => (scheduled = resolve));
  const original = globalThis.setTimeout;
  const timer = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation((callback, delay, ...args) => {
      if (
        delay !== undefined &&
        delay > 9_000 &&
        delay <= 10_000 &&
        typeof callback === "function"
      ) {
        fire = () => callback(...args);
        scheduled();
      }
      return original(callback, delay, ...args);
    });
  return {
    ready,
    fire: () => fire(),
    refuseWaiting: () =>
      timer.mockImplementation((callback, delay, ...args) => {
        if (delay !== undefined && delay > 9_000 && delay <= 10_000)
          throw new Error("Registration wait after connect ended");
        return original(callback, delay, ...args);
      }),
  };
}

function unavailableServer(bodies: { request: { clientConnectionId?: string; id: string } }[]) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = (await new Request(String(url), init).json()) as {
      request: { clientConnectionId?: string; id: string };
    };
    bodies.push(body);
    expect(body.request).not.toHaveProperty("clientConnectionId");
    return body.request.id.startsWith("t3.ui/")
      ? Response.json(
          {
            _tag: "ExtensionOperationError",
            operation: "invoke",
            detail: "client-target-required",
          },
          { status: 400 },
        )
      : Response.json({ result: { ok: true } });
  };
}

it.effect("does not hold non-UI calls when no socket registration is current", () =>
  Effect.gen(function* () {
    const bodies: { request: { clientConnectionId?: string; id: string } }[] = [];
    const f = yield* fixture(unavailableServer(bodies), unavailableUi());
    registrationTimer().refuseWaiting();
    expect(
      yield* Effect.promise(() =>
        f.transport.invokeApi(unstampedRequest, new AbortController().signal),
      ),
    ).toEqual({ ok: true });
    expect(bodies).toHaveLength(1);
    f.owner.abort();
  }),
);

for (const failure of [true, false]) {
  it.effect(
    `releases held and subsequent non-UI calls when connect ${failure ? "errors" : "ends"}`,
    () =>
      Effect.gen(function* () {
        let dispose!: () => void;
        const disposed = new Promise<void>((resolve) => (dispose = resolve));
        const ui = unavailableUi(dispose);
        const bodies: { request: { clientConnectionId?: string; id: string } }[] = [];
        const f = yield* fixture(unavailableServer(bodies), ui);
        const socket = yield* socketFixture("unused", false);
        yield* SubscriptionRef.set(f.session, Option.some(socket.socket));
        yield* Deferred.await(socket.opened);
        const bound = registrationTimer();
        const pending = f.transport.invokeApi(unstampedRequest, new AbortController().signal);
        const result = pending.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        yield* Effect.promise(() => bound.ready);
        yield* Deferred.succeed(socket.end, failure);
        yield* Effect.promise(() => disposed);
        expect(yield* Effect.promise(() => result)).toEqual({ value: { ok: true } });
        bound.refuseWaiting();
        expect(
          yield* Effect.promise(() =>
            f.transport.invokeApi(unstampedRequest, new AbortController().signal),
          ),
        ).toEqual({ ok: true });
        yield* Effect.promise(() =>
          expect(
            f.transport.invokeApi(
              { ...unstampedRequest, id: "t3.ui/theme", method: "getState" },
              new AbortController().signal,
            ),
          ).rejects.toThrow("client-target-required"),
        );
        expect(bodies).toHaveLength(3);
        f.owner.abort();
      }),
  );
}

it.effect("sends unstamped non-UI calls and honest UI errors after the registration bound", () =>
  Effect.gen(function* () {
    const bodies: { request: { clientConnectionId?: string; id: string } }[] = [];
    const f = yield* fixture(unavailableServer(bodies), unavailableUi());
    const socket = yield* socketFixture("unused", false);
    yield* SubscriptionRef.set(f.session, Option.some(socket.socket));
    yield* Deferred.await(socket.opened);
    const bound = registrationTimer();
    const invoke = async (id: string, method: string) => {
      const pending = f.transport.invokeApi(
        { ...unstampedRequest, id, method },
        new AbortController().signal,
      );
      const result = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await bound.ready;
      bound.fire();
      return result;
    };
    expect(
      yield* Effect.promise(() => invoke(unstampedRequest.id, unstampedRequest.method)),
    ).toEqual({ value: { ok: true } });
    expect(yield* Effect.promise(() => invoke("t3.ui/theme", "getState"))).toEqual({
      error: expect.objectContaining({
        message: expect.stringContaining("client-target-required"),
      }),
    });
    expect(bodies).toHaveLength(2);
    f.owner.abort();
    yield* Deferred.await(socket.closed);
  }),
);

it.effect("preserves the server's UI error when registration never arrives", () =>
  Effect.gen(function* () {
    const bodies: { request: { clientConnectionId?: string; id: string } }[] = [];
    const f = yield* fixture(unavailableServer(bodies), unavailableUi());
    const socket = yield* socketFixture("unused", false);
    yield* SubscriptionRef.set(f.session, Option.some(socket.socket));
    yield* Deferred.await(socket.opened);
    const bound = registrationTimer();
    const pending = f.transport.invokeApi(
      { ...unstampedRequest, id: "t3.ui/theme", method: "getState" },
      new AbortController().signal,
    );
    const result = expect(pending).rejects.toThrow("client-target-required");
    yield* Effect.promise(() => bound.ready);
    bound.fire();
    yield* Effect.promise(() => result);
    expect(bodies).toHaveLength(1);
    f.owner.abort();
    yield* Deferred.await(socket.closed);
  }),
);

it.effect(
  "stamps only the registered mobile identity and cleans registrations on socket replacement and unmount",
  () =>
    Effect.gen(function* () {
      const closeWatcher = vi.fn();
      const resetConnection = vi.fn();
      const ui: MobileUiProviders = {
        providers: new Map([
          [
            "t3.client/theme",
            {
              invoke: async () => null,
              openStream: (call) => {
                call.emit({ type: "snapshot", value: null });
                return closeWatcher;
              },
            },
          ],
        ]),
        descriptors: [
          { id: "t3.client/theme", version: "1.0.0" },
          { id: "t3.client/navigation", version: "1.0.0" },
        ],
        capabilities: MOBILE_UI_CAPABILITIES,
        resetConnection,
        dispose: vi.fn(),
        notifyAppearanceChanged: vi.fn(),
        notifyInstallationsChanged: vi.fn(),
      };
      let expectedId = "first";
      const bodies: unknown[] = [];
      const f = yield* fixture(async (url, init) => {
        const body = (await new Request(String(url), init).json()) as {
          request: { clientConnectionId?: string };
        };
        bodies.push(body);
        if (body.request.clientConnectionId !== expectedId)
          return Response.json(
            {
              _tag: "ExtensionOperationError",
              operation: "invoke",
              detail: "client-target-denied",
            },
            { status: 400 },
          );
        return Response.json({ result: { ok: true } });
      }, ui);
      const first = yield* socketFixture("first");
      yield* SubscriptionRef.set(f.session, Option.some(first.socket));
      const request = {
        id: "t3.ui/theme",
        versionRange: "^1",
        method: "getState",
        input: {},
        context: {
          resource: { namespace: "t3.thread", id: "t", environmentId: "e" },
          client: "mobile",
        },
        clientConnectionId: "borrowed",
      };
      expect(
        yield* Effect.promise(() => f.transport.invokeApi(request, new AbortController().signal)),
      ).toEqual({ ok: true });
      yield* Deferred.await(first.opened);
      yield* Queue.offer(first.frames, {
        type: "subscriptionOpen",
        subscriptionId: "s",
        apiId: "t3.client/theme",
        name: "watchState",
        input: {},
        caller: {
          installationId: "t3.pack",
          contentHash: "a".repeat(64),
          installationGeneration: 37,
        },
        context: {
          ...request.context,
          resource: { ...request.context.resource, environmentId: EnvironmentId.make("e") },
        },
      });
      expect(yield* Queue.take(first.sent)).toEqual({
        correlationId: "s",
        event: { type: "snapshot", value: null },
      });
      const replacement = yield* socketFixture("replacement");
      expectedId = "replacement";
      yield* SubscriptionRef.set(f.session, Option.some(replacement.socket));
      yield* Deferred.await(first.closed);
      yield* Deferred.await(replacement.opened);
      expect(closeWatcher).toHaveBeenCalledTimes(1);
      expect(resetConnection).toHaveBeenCalledTimes(1);
      expect(
        yield* Effect.promise(() => f.transport.invokeApi(request, new AbortController().signal)),
      ).toEqual({ ok: true });
      expect(bodies).toEqual(
        ["first", "replacement"].map((clientConnectionId) => ({
          installationId: "t3.pack",
          expectedContentHash: "a".repeat(64),
          request: { ...request, clientConnectionId },
        })),
      );
      f.owner.abort();
      expect(resetConnection).toHaveBeenCalledTimes(2);
      yield* Deferred.await(replacement.closed);
      expect(f.release).toHaveBeenCalledTimes(1);
      yield* Effect.promise(() =>
        expect(f.transport.invokeApi(request, new AbortController().signal)).rejects.toThrow(),
      );
    }),
);

it.effect(
  "stamps ordinary streams and each resumed session with its own authenticated identity",
  () =>
    Effect.gen(function* () {
      const ui: MobileUiProviders = {
        providers: new Map(),
        descriptors: [
          { id: "t3.client/theme", version: "1.0.0" },
          { id: "t3.client/navigation", version: "1.0.0" },
        ],
        capabilities: MOBILE_UI_CAPABILITIES,
        resetConnection: vi.fn(),
        dispose: vi.fn(),
        notifyAppearanceChanged: vi.fn(),
        notifyInstallationsChanged: vi.fn(),
      };
      const f = yield* fixture(async () => Response.json({}), ui);
      const first = yield* socketFixture("first");
      yield* SubscriptionRef.set(f.session, Option.some(first.socket));
      yield* Deferred.await(first.opened);
      const request = {
        id: "t3.ui/theme",
        versionRange: "^1",
        name: "subscribeState",
        input: {},
        context: {
          resource: { namespace: "t3.thread", id: "t", environmentId: "e" },
          client: "mobile",
        },
        clientConnectionId: "borrowed",
      };
      const iterator = f.transport.subscribeResumableApi!(request, new AbortController().signal)[
        Symbol.asyncIterator
      ]();
      const initial = iterator.next();
      expect(yield* Queue.take(first.apiOpened)).toEqual({
        installationId: "t3.pack",
        expectedContentHash: "a".repeat(64),
        request: { ...request, clientConnectionId: "first" },
      });
      const frame = { streamId: "s", sequence: 1, type: "snapshot", value: null } as const;
      yield* Queue.offer(first.apiFrames, frame);
      expect(yield* Effect.promise(() => initial)).toEqual({ done: false, value: frame });
      const suspension = iterator.next();
      yield* SubscriptionRef.set(f.session, Option.none());
      expect(yield* Effect.promise(() => suspension)).toEqual({ done: false, value: null });
      yield* Deferred.await(first.closed);
      const replacement = yield* socketFixture("replacement");
      yield* SubscriptionRef.set(f.session, Option.some(replacement.socket));
      yield* Deferred.await(replacement.opened);
      const resumed = iterator.next();
      expect(yield* Queue.take(replacement.apiOpened)).toEqual({
        installationId: "t3.pack",
        expectedContentHash: "a".repeat(64),
        request: { ...request, clientConnectionId: "replacement" },
      });
      yield* Queue.offer(replacement.apiFrames, frame);
      expect(yield* Effect.promise(() => resumed)).toEqual({ done: false, value: frame });
      yield* Effect.promise(async () => {
        await iterator.return?.();
      });
      const ordinaryStream = f.transport.subscribeApi(request, new AbortController().signal);
      const ordinary = ordinaryStream[Symbol.asyncIterator]();
      const next = ordinary.next();
      expect(yield* Queue.take(replacement.apiOpened)).toMatchObject({
        request: { clientConnectionId: "replacement" },
      });
      yield* Queue.offer(replacement.apiFrames, frame);
      expect(yield* Effect.promise(() => next)).toEqual({ done: false, value: frame });
      yield* Effect.promise(async () => {
        await ordinary.return?.();
      });
      f.owner.abort();
      yield* Deferred.await(replacement.closed);
    }),
);
