import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  environmentExtensionsHttp,
  environmentExtensionApiStream,
  environmentResumableExtensionApiStream,
} from "@t3tools/client-runtime/state/extensions";
import { subscribe } from "@t3tools/client-runtime/rpc";
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
): Promise<MobileExtensionTransport> {
  if (signal.aborted) throw new Error("Extension transport cancelled");
  const release = appAtomRegistry.mount(connectionAtomRuntime);
  let released = false;
  const abort = () => {
    signal.removeEventListener("abort", abort);
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
    Effect.runPromise(effect.pipe(Effect.provide(context)), {
      signal: AbortSignal.any([signal, callSignal]),
    });
  const environmentId = EnvironmentId.make(environment);
  const registry = await run(EnvironmentRegistry, signal).catch((error) => {
    abort();
    throw error;
  });
  const connected = Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared)) return yield* Effect.fail(new Error("Environment not connected"));
    return prepared.value;
  });
  async function* values<A, E>(stream: Stream.Stream<A, E, Services>, callSignal: AbortSignal) {
    const lifetime = AbortSignal.any([signal, callSignal]);
    const iterator = Stream.toAsyncIterableWith(stream, context)[Symbol.asyncIterator]();
    const abort = () => {
      void iterator.return?.().catch(() => {});
    };
    lifetime.addEventListener("abort", abort, { once: true });
    try {
      if (lifetime.aborted) throw new Error("Cancelled");
      while (!lifetime.aborted) {
        const next = await iterator.next();
        if (next.done || lifetime.aborted) return;
        yield next.value;
      }
    } finally {
      lifetime.removeEventListener("abort", abort);
      await iterator.return?.();
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
    invokeApi: async (request, callSignal) =>
      (
        await http(
          (prepared) =>
            environmentExtensionsHttp.invokeApi(
              prepared,
              decodeInvoke({ installationId, expectedContentHash: hash(), request }),
            ),
          callSignal,
        )
      ).result,
    async *subscribeApi(request, callSignal) {
      for await (const { cursor, ...frame } of values(
        environmentExtensionApiStream(environmentId, subscribePayload(request)),
        callSignal,
      ))
        yield { ...frame, ...(cursor === undefined ? {} : { cursor }) };
    },
    async *subscribeResumableApi(request, callSignal) {
      for await (const value of values(
        environmentResumableExtensionApiStream(environmentId, () => subscribePayload(request)),
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
      const lifetime = AbortSignal.any([callSignal, controller.signal]);
      const changes = registry.followStream(
        environmentId,
        subscribe(WS_METHODS.subscribeExtensionCatalogue, {}, { streamBufferSize: 1 }),
      );
      void run(
        Stream.runForEach(changes, () => Effect.sync(changed)),
        lifetime,
      ).catch(() => {
        if (!lifetime.aborted) changed();
      });
      return () => controller.abort();
    },
  };
}
