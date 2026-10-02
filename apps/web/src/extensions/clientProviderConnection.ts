import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import type {
  ClientProviderEmitEvent,
  ClientProvidersRespondInput,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  environmentClientProviderEmit,
  environmentClientProviderRespond,
  environmentClientProvidersStream,
  environmentConnectionStateChanges,
} from "@t3tools/client-runtime/state/extensions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { connectionAtomRuntime } from "../connection/runtime";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ClientLocalProvider } from "./clientProviderTypes";
import {
  createClientProviderSession,
  createClientProviderConnectionHint,
  type ClientLocalProvider as SharedLocalProvider,
} from "@t3tools/client-runtime/client-provider-connection";
import { noteClientProviderConnection } from "./extensionCommandRegistry";

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
/** The loop instance that minted the current connection id — a stale teardown must not clear a replacement's identity. */
const connectionOwners = new Map<string, object>();

/** Loops whose connect is in flight: a registration (or its failure) is imminent. */
const connectingSeams = new Map<string, Set<object>>();
/** Wakes calls held until the in-flight connect settles. */
const connectionHints = new Map<string, ReturnType<typeof createClientProviderConnectionHint>>();
function connectionHint(environmentId: string) {
  let hint = connectionHints.get(environmentId);
  if (!hint) {
    hint = createClientProviderConnectionHint(() => ({
      connectionId: connectionIds.get(environmentId),
      connecting: connectingSeams.has(environmentId) && !unsupportedSeams.has(environmentId),
    }));
    if (connectingSeams.has(environmentId) || connectionIds.has(environmentId))
      connectionHints.set(environmentId, hint);
  }
  return hint;
}
/** Environments whose server lacks the seam: calls leave unstamped at once until the next connection. */
const unsupportedSeams = new Set<string>();

/** The socket-bound id the server minted for this environment's live seam, if any. */
export function currentClientConnectionId(environmentId: string): string | undefined {
  return connectionIds.get(environmentId);
}

function markConnecting(environmentId: string, owner: object) {
  const owners = connectingSeams.get(environmentId) ?? new Set();
  owners.add(owner);
  connectingSeams.set(environmentId, owners);
}

function wakeWaiters(environmentId: string) {
  connectionHints.get(environmentId)?.changed();
  if (!connectingSeams.has(environmentId) && !connectionIds.has(environmentId))
    connectionHints.delete(environmentId);
}

/** The connect registered or ended: release held calls either way. */
function settleConnecting(environmentId: string, owner: object) {
  const owners = connectingSeams.get(environmentId);
  if (!owners?.delete(owner)) return;
  if (owners.size === 0) connectingSeams.delete(environmentId);
  wakeWaiters(environmentId);
}

/** The server rejected the connect as an unknown RPC — an older server without the seam. */
function isUnknownRequestTag(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Unknown request tag:");
}

/** Waits at most one registration bound, then sends once with the host's hint when available. */
export async function withClientConnectionId<A>(
  environmentId: string,
  signal: AbortSignal,
  send: (clientConnectionId: string | undefined) => Promise<A>,
): Promise<A> {
  return send(await connectionHint(environmentId).connectionId(signal));
}

/** `withClientConnectionId` for streams. */
export async function* withClientConnectionIdFrames<A>(
  environmentId: string,
  signal: AbortSignal,
  open: (clientConnectionId: string | undefined) => AsyncIterable<A>,
): AsyncGenerator<A, void> {
  yield* open(await connectionHint(environmentId).connectionId(signal));
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

/** Per-iteration seam state, shared with `stop` so teardown never waits on the iterator. */
interface ConnectionIteration {
  session?: ReturnType<typeof createClientProviderSession> | undefined;
}

export function startClientProviderConnection(
  deps: ClientProviderConnectionDeps,
): ClientProviderConnection {
  const lifecycle = new AbortController();
  const owner = {};
  const iteration: ConnectionIteration = {};
  const teardownIteration = () => {
    iteration.session?.dispose();
    iteration.session = undefined;
    if (connectionOwners.get(deps.environmentId) === owner) {
      connectionIds.delete(deps.environmentId);
      connectionOwners.delete(deps.environmentId);
      noteClientProviderConnection(deps.environmentId, false);
    }
    // An ended connect stream releases ordinary calls until the next attempt.
    settleConnecting(deps.environmentId, owner);
    wakeWaiters(deps.environmentId);
  };
  const flush = () => {
    if (!connectionIds.has(deps.environmentId) || lifecycle.signal.aborted) return;
    void deps.flushGlobalCommands(lifecycle.signal).catch(() => {});
  };
  // Calls made before the first connect registers are held, not rejected.
  unsupportedSeams.delete(deps.environmentId);
  markConnecting(deps.environmentId, owner);
  void runConnectionLoop(deps, lifecycle.signal, owner, iteration, teardownIteration)
    .catch(() => {})
    .finally(() => settleConnecting(deps.environmentId, owner));
  return {
    stop: () => {
      lifecycle.abort();
      teardownIteration();
    },
    notifyInstallationsChanged: flush,
  };
}

/**
 * Each iteration opens one connect stream on the current session. A transport
 * drop ends the iteration — the socket's connectionId and open subscriptions
 * die with it, then the loop waits for the next connected phase and reopens.
 */
async function runConnectionLoop(
  deps: ClientProviderConnectionDeps,
  signal: AbortSignal,
  owner: object,
  iteration: ConnectionIteration,
  teardownIteration: () => void,
) {
  const context = await Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, connectionAtomRuntime),
    { signal },
  );
  // The web SDK uses plain resource IDs and exact optional fields; the wire
  // contract brands those IDs. Keep that existing type boundary in this adapter.
  const providers = new Map<string, SharedLocalProvider>(
    [...deps.providers].map(([id, provider]) => [
      id,
      {
        invoke: (call) => provider.invoke({ ...call, context: call.context as ViewContext }),
        ...(provider.openStream
          ? {
              openStream: (call) =>
                provider.openStream!({ ...call, context: call.context as ViewContext }),
            }
          : {}),
      },
    ]),
  );
  const emitEvent = (correlationId: string, event: ClientProviderEmitEvent) =>
    emitClientProviderEvent(deps.environmentId, correlationId, event);
  const respond = (payload: ClientProvidersRespondInput) => {
    void Effect.runPromise(
      environmentClientProviderRespond(deps.environmentId, payload).pipe(Effect.provide(context)),
    ).catch(() => {});
  };
  while (!signal.aborted) {
    let unsupported = false;
    const session = createClientProviderSession({
      providers,
      emit: emitEvent,
      respond,
      registered: (connectionId) => {
        connectionIds.set(deps.environmentId, connectionId);
        connectionOwners.set(deps.environmentId, owner);
        unsupportedSeams.delete(deps.environmentId);
        settleConnecting(deps.environmentId, owner);
        noteClientProviderConnection(deps.environmentId, true);
        void deps.flushGlobalCommands(signal).catch(() => {});
      },
    });
    iteration.session = session;
    markConnecting(deps.environmentId, owner);
    try {
      const iterable = Stream.toAsyncIterableWith(
        environmentClientProvidersStream(deps.environmentId, {
          providers: [...deps.descriptors],
        }),
        context,
      );
      const iterator = iterable[Symbol.asyncIterator]();
      // Some transports never unblock `next()` on their own — race the pull
      // against the abort signal so `stop()` is observed immediately.
      let resolveAborted: () => void = () => {};
      const aborted = new Promise<"aborted">((resolve) => {
        resolveAborted = () => resolve("aborted");
      });
      signal.addEventListener("abort", resolveAborted, { once: true });
      try {
        while (!signal.aborted) {
          const next = await Promise.race([iterator.next(), aborted]);
          if (next === "aborted" || signal.aborted) return;
          // A clean EOF ends this iteration only — teardown runs, then the
          // loop waits for the transport's next connected phase and reopens.
          if (next.done) break;
          try {
            void session.receive(next.value).catch(() => {});
          } catch {
            // A malformed frame or throwing provider hook must not kill the seam.
          }
        }
      } finally {
        signal.removeEventListener("abort", resolveAborted);
        await iterator.return?.().catch(() => {});
      }
    } catch (error) {
      // Transport or session failure — fall through to the reconnect wait.
      unsupported = isUnknownRequestTag(error);
    } finally {
      teardownIteration();
    }
    if (signal.aborted) return;
    if (unsupported) {
      // The server lacks the seam: release held and later calls. The next
      // connection may reach an upgraded server, so only a drop clears this
      // (and calls hold again) before the loop retries.
      unsupportedSeams.add(deps.environmentId);
      wakeWaiters(deps.environmentId);
    }
    // A non-transport failure (e.g. a rejected connect) would otherwise spin.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (signal.aborted) return;
    await waitForReconnect(
      deps.environmentId,
      signal,
      unsupported
        ? () => {
            unsupportedSeams.delete(deps.environmentId);
            markConnecting(deps.environmentId, owner);
          }
        : undefined,
    ).catch(() => {});
  }
}

/**
 * Resolves once the environment reports a connected phase, or on abort. With
 * `onDrop`, the current connection does not count: it waits for a drop, calls
 * `onDrop`, then for the next connected phase.
 */
async function waitForReconnect(
  environmentId: EnvironmentId,
  signal: AbortSignal,
  onDrop?: () => void,
) {
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
      if (next.value.phase !== "connected") {
        onDrop?.();
        onDrop = undefined;
      } else if (onDrop === undefined) return;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await iterator.return?.();
  }
}
