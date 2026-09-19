import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import type {
  ClientProviderEmitEvent,
  ClientProviderServerFrame,
  ClientProvidersRespondInput,
  EnvironmentId,
} from "@t3tools/contracts";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import {
  environmentClientProviderEmit,
  environmentClientProviderRespond,
  environmentClientProvidersStream,
  environmentConnectionStateChanges,
} from "@t3tools/client-runtime/state/extensions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { connectionAtomRuntime } from "../connection/runtime";
import { ClientProviderOpError, type ClientLocalProvider } from "./clientProviderTypes";

/**
 * The client side of the `t3.client/*` seam: owns the connect stream's
 * lifetime, dispatches server frames to the local providers, and answers them
 * through `respond`/`emit`. One instance per environment.
 */

export interface ClientProviderConnectionDeps {
  readonly environmentId: EnvironmentId;
  readonly providers: ReadonlyMap<string, ClientLocalProvider>;
  readonly descriptors: readonly { readonly id: string; readonly version: string }[];
  /**
   * Commits staged `ClientHost.registerGlobalCommands` sets (and replays
   * committed ones) through each installation's invokeApi path. Runs once the
   * socket registers and again whenever installations change while live.
   */
  readonly flushGlobalCommands: (signal: AbortSignal) => Promise<void>;
}

export interface ClientProviderConnection {
  readonly stop: () => void;
  /** Re-run the staged-commit flush while the socket is registered. */
  readonly notifyInstallationsChanged: () => void;
}

const connectionIds = new Map<string, string>();

/** The socket-bound id the server minted for this environment's live seam, if any. */
export function currentClientConnectionId(environmentId: string): string | undefined {
  return connectionIds.get(environmentId);
}

/** Provider-facing emit — fire-and-forget over the current session. */
export function emitClientProviderEvent(
  environmentId: EnvironmentId,
  correlationId: string,
  event: ClientProviderEmitEvent,
) {
  void Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime).pipe(
      Effect.flatMap((context) =>
        environmentClientProviderEmit(environmentId, { correlationId, event }).pipe(
          Effect.provide(context),
        ),
      ),
    ),
  ).catch(() => {});
}

export function startClientProviderConnection(
  deps: ClientProviderConnectionDeps,
): ClientProviderConnection {
  const lifecycle = new AbortController();
  const flush = () => {
    if (!connectionIds.has(deps.environmentId) || lifecycle.signal.aborted) return;
    void deps.flushGlobalCommands(lifecycle.signal).catch(() => {});
  };
  void runConnectionLoop(deps, lifecycle.signal).catch(() => {});
  return { stop: () => lifecycle.abort(), notifyInstallationsChanged: flush };
}

/**
 * Each iteration opens one connect stream on the current session. A transport
 * drop ends the iteration — the socket's connectionId and open subscriptions
 * die with it, then the loop waits for the next connected phase and reopens.
 */
async function runConnectionLoop(deps: ClientProviderConnectionDeps, signal: AbortSignal) {
  const context = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime),
    { signal },
  );
  const emitEvent = (correlationId: string, event: ClientProviderEmitEvent) =>
    emitClientProviderEvent(deps.environmentId, correlationId, event);
  const respond = (payload: ClientProvidersRespondInput) => {
    void Effect.runPromise(
      environmentClientProviderRespond(deps.environmentId, payload).pipe(Effect.provide(context)),
    ).catch(() => {});
  };
  while (!signal.aborted) {
    const subscriptions = new Map<string, () => void>();
    const pending = new Map<string, AbortController>();
    try {
      const iterable = Stream.toAsyncIterableWith(
        environmentClientProvidersStream(deps.environmentId, {
          providers: [...deps.descriptors],
        }),
        context,
      );
      for await (const frame of iterable) {
        if (signal.aborted) return;
        handleFrame(deps, frame, emitEvent, respond, subscriptions, pending, signal);
      }
    } catch {
      // Transport or session failure — fall through to the reconnect wait.
    } finally {
      connectionIds.delete(deps.environmentId);
      for (const close of subscriptions.values()) close();
      for (const controller of pending.values()) controller.abort();
      subscriptions.clear();
      pending.clear();
    }
    if (signal.aborted) return;
    // A non-transport failure (e.g. a rejected connect) would otherwise spin.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (signal.aborted) return;
    await waitForReconnect(deps.environmentId, signal).catch(() => {});
  }
}

function handleFrame(
  deps: ClientProviderConnectionDeps,
  frame: ClientProviderServerFrame,
  emitEvent: (correlationId: string, event: ClientProviderEmitEvent) => void,
  respond: (payload: ClientProvidersRespondInput) => void,
  subscriptions: Map<string, () => void>,
  pending: Map<string, AbortController>,
  signal: AbortSignal,
) {
  switch (frame.type) {
    case "registered": {
      connectionIds.set(deps.environmentId, frame.connectionId);
      void deps.flushGlobalCommands(signal).catch(() => {});
      return;
    }
    case "invoke": {
      const provider = deps.providers.get(frame.apiId);
      const controller = new AbortController();
      pending.set(frame.requestId, controller);
      void (async () => {
        try {
          if (!provider)
            throw new ClientProviderOpError(
              "client-provider-unavailable",
              `No local provider for ${frame.apiId}`,
            );
          const value = await provider.invoke({
            method: frame.method,
            input: frame.input,
            context: frame.context as ViewContext,
            caller: frame.caller,
            signal: controller.signal,
          });
          respond({ requestId: frame.requestId, ok: true, value: value ?? null });
        } catch (error) {
          respond({
            requestId: frame.requestId,
            ok: false,
            error: {
              code: error instanceof ClientProviderOpError ? error.code : "provider-rejected",
              message: (error instanceof Error ? error.message : "Provider failed").slice(0, 2000),
            },
          });
        } finally {
          pending.delete(frame.requestId);
        }
      })();
      return;
    }
    case "cancel": {
      pending.get(frame.requestId)?.abort();
      return;
    }
    case "subscriptionOpen": {
      const provider = deps.providers.get(frame.apiId);
      const emit = (event: ClientProviderEmitEvent) => emitEvent(frame.subscriptionId, event);
      if (!provider?.openStream) {
        emit({ type: "closed", value: null });
        return;
      }
      Promise.resolve(
        provider.openStream({
          name: frame.name,
          input: frame.input,
          context: frame.context as ViewContext,
          caller: frame.caller,
          emit,
        }),
      ).then(
        (close) => {
          // A close racing the async open wins — never leak the subscription.
          if (subscriptions.has(frame.subscriptionId)) {
            // Remove the close-pending marker so the map does not retain it.
            subscriptions.delete(frame.subscriptionId);
            close();
            return;
          }
          subscriptions.set(frame.subscriptionId, close);
        },
        () => emit({ type: "closed", value: null }),
      );
      return;
    }
    case "subscriptionClose": {
      const close = subscriptions.get(frame.subscriptionId);
      if (close === undefined) {
        // The open is still resolving — mark it so its completion closes.
        subscriptions.set(frame.subscriptionId, () => {});
        return;
      }
      close();
      subscriptions.delete(frame.subscriptionId);
      return;
    }
  }
}

/** Resolves once the environment reports a connected phase, or on abort. */
async function waitForReconnect(environmentId: EnvironmentId, signal: AbortSignal) {
  const context = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime),
    { signal },
  );
  const iterable = Stream.toAsyncIterableWith(
    environmentConnectionStateChanges(environmentId),
    context,
  );
  const iterator = iterable[Symbol.asyncIterator]();
  const cancel = () => void iterator.return?.().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const next = await iterator.next();
      if (next.done) return;
      if (next.value.phase === "connected") return;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await iterator.return?.();
  }
}
