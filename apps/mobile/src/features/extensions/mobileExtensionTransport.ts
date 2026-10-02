import {
  createClientProviderConnectionHint,
  stampClientProviderRequest,
} from "@t3tools/client-runtime/client-provider-connection";
import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  environmentExtensionsHttp,
  environmentExtensionApiStream,
  environmentResumableExtensionApiStream,
} from "@t3tools/client-runtime/state/extensions";
import {
  subscribe,
  subscribeDynamicUntilCompleteWithSuspensions,
  type RpcSession,
} from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  ExtensionApiInvokeInput,
  ExtensionApiSubscribeInput,
  ExtensionApiDiscoverInput,
  ExtensionInvokeInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/unstable/reactivity";
import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import type { MobileExtensionTransport } from "./mobileExtensionHost";
import {
  createMobileClientProviderSession,
  type MobileUiProviders,
} from "./mobileClientProviderConnection";
import { withMobileUiSignal, checkMobileUiAbort, mobileUiLifetime } from "./mobileUiAbort";

const decodeInvoke = Schema.decodeUnknownSync(ExtensionApiInvokeInput);
const decodeSubscribe = Schema.decodeUnknownSync(ExtensionApiSubscribeInput);
const decodeDiscover = Schema.decodeUnknownSync(ExtensionApiDiscoverInput);
const decodeTool = Schema.decodeUnknownSync(ExtensionInvokeInput);

/** Borrows the production runtime; never creates or closes an environment connection. */
export async function mobileExtensionTransport(
  environment: string,
  installationId: string,
  hash: () => string,
  signal: AbortSignal,
  ui?: MobileUiProviders,
): Promise<MobileExtensionTransport> {
  if (signal.aborted) throw new Error("Extension transport cancelled");
  const release = appAtomRegistry.mount(connectionAtomRuntime);
  let released = false;
  let connectionStreamEnded = false;
  const endedSockets = new WeakSet<RpcSession>();
  let current:
    | { socket: RpcSession; dispatcher: ReturnType<typeof createMobileClientProviderSession> }
    | undefined;
  const connectionHint = createClientProviderConnectionHint<RpcSession>((socket) => ({
    connectionId:
      !socket || current?.socket === socket ? current?.dispatcher.currentConnectionId : undefined,
    // An ended mobile socket is final; only its registration can satisfy the wait.
    waitFor:
      !released && !connectionStreamEnded && !(socket && endedSockets.has(socket))
        ? "registration"
        : undefined,
  }));
  const wakeConnections = connectionHint.changed;
  const abort = () => {
    signal.removeEventListener("abort", abort);
    current?.dispatcher.dispose();
    current = undefined;
    wakeConnections();
    if (!released) {
      released = true;
      release();
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  const context = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime),
    { signal },
  ).catch((error) => {
    abort();
    throw error;
  });
  type Services = typeof context extends import("effect/Context").Context<infer S> ? S : never;
  const run = <A, E>(effect: Effect.Effect<A, E, Services>, callSignal: AbortSignal) =>
    withMobileUiSignal([signal, callSignal], (lifetime) =>
      Effect.runPromise(effect.pipe(Effect.provide(context)), { signal: lifetime }),
    );
  const environmentId = EnvironmentId.make(environment);
  const registry = await run(EnvironmentRegistry, signal).catch((error) => {
    abort();
    throw error;
  });
  const connectionId = async (callSignal: AbortSignal, socket?: RpcSession) => {
    if (!ui) return undefined;
    checkMobileUiAbort(signal);
    checkMobileUiAbort(callSignal);
    if (connectionStreamEnded || (socket && endedSockets.has(socket))) return undefined;
    if (!current && !socket) {
      const active = await run(
        registry.run(
          environmentId,
          Effect.flatMap(EnvironmentSupervisor, (supervisor) =>
            SubscriptionRef.get(supervisor.session),
          ),
        ),
        callSignal,
      );
      if (Option.isNone(active) || endedSockets.has(active.value)) return undefined;
      socket = active.value;
    }
    socket ??= current?.socket;
    return withMobileUiSignal([signal, callSignal], (lifetime) =>
      connectionHint.connectionId(lifetime, 10_000, socket),
    );
  };
  if (ui) {
    const connections = registry.followStream(
      environmentId,
      Stream.unwrap(
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor;
          return SubscriptionRef.changes(supervisor.session).pipe(
            Stream.switchMap(
              Option.match({
                onNone: () => {
                  wakeConnections();
                  return Stream.empty;
                },
                onSome: (socket) =>
                  Stream.unwrap(
                    Effect.gen(function* () {
                      const dispatcher = yield* Effect.acquireRelease(
                        Effect.sync(() => {
                          const dispatcher = createMobileClientProviderSession(
                            ui,
                            {
                              respond: (payload) => {
                                void Effect.runPromise(
                                  socket.client[WS_METHODS.extensionsClientProvidersRespond](
                                    payload,
                                  ),
                                  { signal },
                                ).catch(() => {});
                              },
                              emit: (correlationId, event) => {
                                void Effect.runPromise(
                                  socket.client[WS_METHODS.extensionsClientProvidersEmit]({
                                    correlationId,
                                    event,
                                  }),
                                  { signal },
                                ).catch(() => {});
                              },
                            },
                            wakeConnections,
                          );
                          current = { socket, dispatcher };
                          wakeConnections();
                          return dispatcher;
                        }),
                        (dispatcher) =>
                          Effect.sync(() => {
                            dispatcher.dispose();
                            endedSockets.add(socket);
                            if (current?.dispatcher === dispatcher) {
                              current = undefined;
                            }
                            wakeConnections();
                          }),
                      );
                      return socket.client[WS_METHODS.extensionsClientProvidersConnect](
                        { providers: ui.descriptors },
                        { streamBufferSize: 8 },
                      ).pipe(
                        Stream.tap((frame) =>
                          Effect.sync(() => {
                            void dispatcher.receive(frame).catch(() => {});
                          }),
                        ),
                        Stream.catchCause(() => Stream.empty),
                      );
                    }),
                  ),
              }),
            ),
          );
        }),
      ),
    );
    void run(Stream.runDrain(connections), signal)
      .catch(() => {})
      .finally(() => {
        current?.dispatcher.dispose();
        current = undefined;
        connectionStreamEnded = true;
        wakeConnections();
      });
  }
  const stamp = async <A extends { clientConnectionId?: string }>(
    request: A,
    callSignal: AbortSignal,
    socket?: RpcSession,
  ) => {
    return stampClientProviderRequest(request, await connectionId(callSignal, socket));
  };
  const connected = Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared)) return yield* Effect.fail(new Error("Environment not connected"));
    return prepared.value;
  });
  async function* values<A, E>(stream: Stream.Stream<A, E, Services>, callSignal: AbortSignal) {
    const lifetime = mobileUiLifetime([signal, callSignal]);
    const iterator = Stream.toAsyncIterableWith(stream, context)[Symbol.asyncIterator]();
    const abort = () => {
      void iterator.return?.().catch(() => {});
    };
    lifetime.signal.addEventListener("abort", abort, { once: true });
    try {
      if (lifetime.signal.aborted) throw new Error("Cancelled");
      while (!lifetime.signal.aborted) {
        const next = await iterator.next();
        if (next.done || lifetime.signal.aborted) return;
        yield next.value;
      }
    } finally {
      lifetime.signal.removeEventListener("abort", abort);
      try {
        await iterator.return?.();
      } finally {
        lifetime.dispose();
      }
    }
  }
  const http = async <A, E>(
    operation: (prepared: Effect.Success<typeof connected>) => Effect.Effect<A, E, Services>,
    callSignal: AbortSignal,
  ) => {
    const prepared = await run(registry.run(environmentId, connected), callSignal);
    return run(operation(prepared), callSignal);
  };
  const subscribePayload = (request: Parameters<MobileExtensionTransport["subscribeApi"]>[0]) =>
    decodeSubscribe({ installationId, expectedContentHash: hash(), request });
  return {
    list: async (callSignal) =>
      (await http(environmentExtensionsHttp.list, callSignal)).installations,
    client: (id, expectedContentHash, callSignal) =>
      http(
        (prepared) => environmentExtensionsHttp.client(prepared, { id, expectedContentHash }),
        callSignal,
      ),
    asset: (id, expectedContentHash, path, callSignal) =>
      http(
        (prepared) => environmentExtensionsHttp.asset(prepared, { id, expectedContentHash, path }),
        callSignal,
      ),
    invokeApi: async (request, callSignal) => {
      const bound = await stamp(request, callSignal);
      return (
        await http(
          (prepared) =>
            environmentExtensionsHttp.invokeApi(
              prepared,
              decodeInvoke({ installationId, expectedContentHash: hash(), request: bound }),
            ),
          callSignal,
        )
      ).result;
    },
    async *subscribeApi(request, callSignal) {
      for await (const { cursor, ...frame } of values(
        environmentExtensionApiStream(
          environmentId,
          subscribePayload(await stamp(request, callSignal)),
        ),
        callSignal,
      ))
        yield { ...frame, ...(cursor === undefined ? {} : { cursor }) };
    },
    async *subscribeResumableApi(request, callSignal) {
      for await (const value of values(
        ui
          ? registry
              .followStream(
                environmentId,
                subscribeDynamicUntilCompleteWithSuspensions(
                  WS_METHODS.subscribeExtensionApi,
                  (socket) =>
                    Effect.promise(async () =>
                      subscribePayload(await stamp(request, callSignal, socket)),
                    ),
                  { streamBufferSize: 1 },
                ).pipe(Stream.map(Option.some), Stream.concat(Stream.succeed(Option.none()))),
              )
              .pipe(
                Stream.takeWhile(Option.isSome),
                Stream.map((frame) => frame.value),
              )
          : environmentResumableExtensionApiStream(environmentId, () =>
              subscribePayload(stampClientProviderRequest(request, undefined)),
            ),
        callSignal,
      )) {
        if (Option.isNone(value)) yield null;
        else {
          const { cursor, ...frame } = value.value;
          yield { ...frame, ...(cursor === undefined ? {} : { cursor }) };
        }
      }
    },
    discoverApis: async (viewContext, callSignal) =>
      (
        await http(
          (prepared) =>
            environmentExtensionsHttp.discoverApis(
              prepared,
              decodeDiscover({ installationId, expectedContentHash: hash(), context: viewContext }),
            ),
          callSignal,
        )
      ).apis,
    invokeTool: async (toolId, input, viewContext, expectedContentHash, callSignal) =>
      (
        await http(
          (prepared) =>
            environmentExtensionsHttp.invoke(
              prepared,
              decodeTool({ toolId, input, context: viewContext, expectedContentHash }),
            ),
          callSignal,
        )
      ).result,
    watch(changed, callSignal) {
      const controller = new AbortController();
      const lifetime = mobileUiLifetime([callSignal, controller.signal]);
      const changes = registry.followStream(
        environmentId,
        subscribe(WS_METHODS.subscribeExtensionCatalogue, {}, { streamBufferSize: 1 }),
      );
      void run(
        Stream.runForEach(changes, () => Effect.sync(changed)),
        lifetime.signal,
      )
        .catch(() => {
          if (!lifetime.signal.aborted) changed();
        })
        .finally(() => lifetime.dispose());
      return () => {
        controller.abort();
        lifetime.dispose();
      };
    },
  };
}
