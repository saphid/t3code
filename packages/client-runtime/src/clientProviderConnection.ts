// @effect-diagnostics globalTimers:off - Host registration waits use a local bounded timer outside any Effect runtime.
import type {
  ClientProviderEmitEvent,
  ClientProviderServerFrame,
  ClientProvidersRespondInput,
} from "@t3tools/contracts";

type InvokeFrame = Extract<ClientProviderServerFrame, { type: "invoke" }>;
type OpenFrame = Extract<ClientProviderServerFrame, { type: "subscriptionOpen" }>;

export type ClientProviderInvokeCall<Context = InvokeFrame["context"]> = Omit<
  Pick<InvokeFrame, "method" | "input" | "context" | "caller">,
  "context"
> & {
  readonly context: Context;
  readonly signal: AbortSignal;
};
export type ClientProviderStreamCall<Context = OpenFrame["context"]> = Omit<
  Pick<OpenFrame, "name" | "input" | "context" | "caller">,
  "context"
> & {
  readonly context: Context;
  readonly emit: (event: ClientProviderEmitEvent) => void;
};
export interface ClientLocalProvider<Context = InvokeFrame["context"]> {
  invoke(
    call: ClientProviderInvokeCall<Context>,
  ): InvokeFrame["input"] | Promise<InvokeFrame["input"]>;
  openStream?(call: ClientProviderStreamCall<Context>): (() => void) | Promise<() => void>;
}

/** Only deliberate provider errors may expose their message to an installed pack. */
export class ClientProviderOpError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function checkAbort(signal: AbortSignal) {
  // React Native's AbortSignal does not implement throwIfAborted.
  if (signal.aborted) throw new Error("Client provider request cancelled");
}

/** Replace an untrusted page hint with the id minted for the host's own session. */
export function stampClientProviderRequest<
  A extends { readonly clientConnectionId?: string | undefined },
>(request: A, connectionId: string | undefined) {
  const { clientConnectionId: _untrusted, ...rest } = request;
  return { ...rest, ...(connectionId === undefined ? {} : { clientConnectionId: connectionId }) };
}

/**
 * Adapters choose the wait lifetime: web waits across reconnects; mobile waits
 * for one socket registration. Clearing waitFor releases calls unstamped.
 */
export function createClientProviderConnectionHint<Key = void>(
  read: (key: Key | undefined) => {
    readonly connectionId?: string | undefined;
    readonly waitFor: "registration" | "reconnect" | undefined;
  },
) {
  const waiters = new Set<() => void>();
  const connectionId = async (signal: AbortSignal, timeoutMs = 10_000, key?: Key) => {
    checkAbort(signal);
    const state = read(key);
    if (state.connectionId !== undefined || state.waitFor === undefined) return state.connectionId;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        waiters.delete(changed);
        resolve();
      };
      const changed = () => {
        const state = read(key);
        if (state.connectionId !== undefined || state.waitFor === undefined) done();
      };
      const timer = setTimeout(done, timeoutMs);
      waiters.add(changed);
      signal.addEventListener("abort", done, { once: true });
      if (signal.aborted) done();
      else changed();
    });
    checkAbort(signal);
    return read(key).connectionId;
  };
  return {
    connectionId,
    changed: () => {
      for (const wake of waiters) wake();
    },
    async stamp<A extends { readonly clientConnectionId?: string | undefined }>(
      request: A,
      signal: AbortSignal,
      timeoutMs = 10_000,
      key?: Key,
    ) {
      return stampClientProviderRequest(request, await connectionId(signal, timeoutMs, key));
    },
  };
}

function providerError(error: unknown, stream = false) {
  return {
    code:
      error instanceof ClientProviderOpError
        ? error.code
        : stream
          ? "client-provider-unavailable"
          : "provider-rejected",
    message: (error instanceof ClientProviderOpError
      ? error.message
      : stream
        ? "Provider stream is unavailable"
        : "Provider failed"
    ).slice(0, 2000),
  };
}

function safelyClose(close: (() => void) | undefined) {
  try {
    close?.();
  } catch {
    /* A watcher must not interrupt other cleanup. */
  }
}

/** One connect stream's dispatcher. Adapters own the socket, providers and reconnect lifetime. */
export function createClientProviderSession(deps: {
  readonly providers: ReadonlyMap<string, ClientLocalProvider>;
  readonly respond: (payload: ClientProvidersRespondInput) => void;
  readonly emit: (id: string, event: ClientProviderEmitEvent) => void;
  readonly requireAccepted?: boolean;
  readonly registered?: (connectionId: string) => void;
  readonly disposed?: () => void;
}) {
  let disposed = false;
  let identity: string | undefined;
  let accepted = new Set<string>();
  const pending = new Map<string, AbortController>();
  const subscriptions = new Map<string, { closed: boolean; close?: () => void }>();
  const provider = (id: string, stream = false) => {
    const local = deps.providers.get(id);
    if (!local || (deps.requireAccepted && (!identity || !accepted.has(id))))
      throw new ClientProviderOpError(
        "client-provider-unavailable",
        stream ? "Provider stream is unavailable" : "Provider is unavailable",
      );
    return local;
  };
  const closeSubscription = (id: string) => {
    const subscription = subscriptions.get(id);
    subscriptions.delete(id);
    if (subscription) {
      subscription.closed = true;
      safelyClose(subscription.close);
    }
  };
  return {
    get currentConnectionId() {
      return identity;
    },
    async receive(frame: ClientProviderServerFrame) {
      if (disposed) return;
      switch (frame.type) {
        case "registered":
          identity = frame.connectionId;
          accepted = new Set(frame.accepted.map(({ id }) => id));
          deps.registered?.(identity);
          return;
        case "invoke": {
          const controller = new AbortController();
          pending.set(frame.requestId, controller);
          const active = () =>
            !disposed && !controller.signal.aborted && pending.get(frame.requestId) === controller;
          try {
            const value = await provider(frame.apiId).invoke({
              ...frame,
              signal: controller.signal,
            });
            if (active())
              deps.respond({ requestId: frame.requestId, ok: true, value: value ?? null });
          } catch (error) {
            if (active())
              deps.respond({ requestId: frame.requestId, ok: false, error: providerError(error) });
          } finally {
            if (pending.get(frame.requestId) === controller) pending.delete(frame.requestId);
          }
          return;
        }
        case "cancel":
          pending.get(frame.requestId)?.abort();
          return;
        case "subscriptionOpen": {
          closeSubscription(frame.subscriptionId);
          const subscription: { closed: boolean; close?: () => void } = { closed: false };
          subscriptions.set(frame.subscriptionId, subscription);
          const emit = (event: ClientProviderEmitEvent) => {
            if (!disposed && !subscription.closed) deps.emit(frame.subscriptionId, event);
          };
          try {
            const local = provider(frame.apiId, true);
            if (!local.openStream)
              throw new ClientProviderOpError(
                "client-provider-unavailable",
                "Provider stream is unavailable",
              );
            const close = await local.openStream({ ...frame, emit });
            if (disposed || subscription.closed) safelyClose(close);
            else subscription.close = close;
          } catch (error) {
            emit({ type: "closed", value: null, error: providerError(error, true) });
            if (subscriptions.get(frame.subscriptionId) === subscription)
              closeSubscription(frame.subscriptionId);
          }
          return;
        }
        case "subscriptionClose":
          closeSubscription(frame.subscriptionId);
          return;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      identity = undefined;
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      for (const id of subscriptions.keys()) closeSubscription(id);
      deps.disposed?.();
    },
  };
}
