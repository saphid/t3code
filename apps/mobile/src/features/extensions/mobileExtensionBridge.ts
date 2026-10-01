export type BridgeOperation = "invoke" | "discover" | "tool" | "asset";
type Envelope = {
  version: 1;
  generation: string;
  id: number;
  kind: "call" | "subscribe" | "cancel" | "ack" | "result" | "frame" | "end" | "error";
  operation?: BridgeOperation;
  payload?: unknown;
  sequence?: number;
  error?: string;
};

export const MAX_BRIDGE_MESSAGE = 1_048_576;
const operations = new Set(["invoke", "discover", "tool", "asset"]);
const kinds = new Set(["call", "subscribe", "cancel", "ack", "result", "frame", "end", "error"]);

function decode(message: string, generation: string): Envelope | null {
  if (message.length > MAX_BRIDGE_MESSAGE) return null;
  try {
    const value = JSON.parse(message) as Partial<Envelope> | null;
    if (
      !value ||
      value.version !== 1 ||
      value.generation !== generation ||
      !Number.isSafeInteger(value.id) ||
      (value.id ?? 0) < 1 ||
      !kinds.has(value.kind ?? "")
    )
      return null;
    if (value.kind === "call" && !operations.has(value.operation ?? "")) return null;
    if (
      (value.kind === "ack" || value.kind === "frame") &&
      (!Number.isSafeInteger(value.sequence) || (value.sequence ?? 0) < 1)
    )
      return null;
    if (value.kind === "error" && typeof value.error !== "string") return null;
    return value as Envelope;
  } catch {
    return null;
  }
}

function sender(options: { generation: string; send: (message: string) => void }) {
  return (message: Omit<Envelope, "version" | "generation">) => {
    const encoded = JSON.stringify({ version: 1, generation: options.generation, ...message });
    if (encoded.length > MAX_BRIDGE_MESSAGE) throw new Error("BridgeMessageTooLarge");
    options.send(encoded);
  };
}

export function createNativeBridge(options: {
  generation: string;
  send: (message: string) => void;
  invoke: (operation: BridgeOperation, payload: unknown, signal: AbortSignal) => Promise<unknown>;
  subscribe: (payload: unknown, signal: AbortSignal) => AsyncIterable<unknown>;
  maxRequests?: number;
  maxStreams?: number;
}) {
  const send = sender(options);
  const pending = new Map<
    number,
    { controller: AbortController; stream: boolean; sequence: number; ack?: () => void }
  >();
  let disposed = false;
  const cancel = (id: number) => {
    const item = pending.get(id);
    pending.delete(id);
    item?.controller.abort();
    item?.ack?.();
  };
  const run = async (message: Envelope) => {
    const stream = message.kind === "subscribe";
    if (pending.has(message.id)) return;
    const streamCount = [...pending.values()].filter((item) => item.stream).length;
    if (
      pending.size >= (options.maxRequests ?? 32) ||
      (stream && streamCount >= (options.maxStreams ?? 8))
    ) {
      send({ kind: "error", id: message.id, error: "BridgeBusy: too many active requests" });
      return;
    }
    const item = {
      controller: new AbortController(),
      stream,
      sequence: 0,
      ack: undefined as (() => void) | undefined,
    };
    pending.set(message.id, item);
    const signal = item.controller.signal;
    try {
      if (!stream) {
        const payload = await options.invoke(message.operation!, message.payload, signal);
        if (!signal.aborted && !disposed) send({ kind: "result", id: message.id, payload });
      } else {
        const iterator = options.subscribe(message.payload, signal)[Symbol.asyncIterator]();
        const abort = () => {
          void iterator.return?.().catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          while (!signal.aborted) {
            const next = await iterator.next();
            if (signal.aborted) break;
            if (next.done) {
              send({ kind: "end", id: message.id });
              break;
            }
            item.sequence += 1;
            const acknowledged = new Promise<void>((resolve) => {
              item.ack = resolve;
            });
            send({ kind: "frame", id: message.id, sequence: item.sequence, payload: next.value });
            await acknowledged;
          }
        } finally {
          signal.removeEventListener("abort", abort);
          await iterator.return?.();
        }
      }
    } catch (error) {
      const detail =
        error instanceof Error &&
        /^(UnsupportedOnMobile|MobileContextDenied|BridgeMessageTooLarge)/.test(error.message)
          ? error.message.slice(0, 300)
          : "Connection unavailable. Reconnect or check installation grants.";
      if (!signal.aborted && !disposed) send({ kind: "error", id: message.id, error: detail });
    } finally {
      if (pending.get(message.id) === item) pending.delete(message.id);
    }
  };
  return {
    receive(message: string) {
      const value = decode(message, options.generation);
      if (!value || disposed) return false;
      if (value.kind === "cancel") cancel(value.id);
      else if (value.kind === "ack") {
        const item = pending.get(value.id);
        if (item?.stream && item.sequence === value.sequence) {
          const ack = item.ack;
          item.ack = undefined;
          ack?.();
        }
      } else if (value.kind === "call" || value.kind === "subscribe")
        void run(value).catch(() => cancel(value.id));
      else return false;
      return true;
    },
    dispose() {
      disposed = true;
      for (const id of pending.keys()) cancel(id);
    },
    activeCount: () => pending.size,
  };
}

export function createPageBridge(options: {
  generation: string;
  send: (message: string) => void;
  maxRequests?: number;
}) {
  const send = sender(options);
  const listeners = new Map<number, (message: Envelope) => void>();
  let nextId = 0;
  let disposed = false;
  return {
    receive(message: string) {
      const value = decode(message, options.generation);
      if (!value || disposed) return false;
      listeners.get(value.id)?.(value);
      return true;
    },
    async invoke(
      operation: BridgeOperation,
      payload: unknown,
      signal: AbortSignal,
    ): Promise<unknown> {
      if (signal.aborted || disposed)
        return Promise.reject(new Error("Bridge cancelled or disposed"));
      if (listeners.size >= (options.maxRequests ?? 32))
        throw new Error("BridgeBusy: too many active requests");
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const finish = () => {
          listeners.delete(id);
          signal.removeEventListener("abort", abort);
        };
        const abort = () => {
          finish();
          try {
            send({ kind: "cancel", id });
          } catch {
            /* The native channel can disappear on eviction. */
          }
          reject(new Error("Bridge cancelled"));
        };
        listeners.set(id, (message) => {
          if (message.kind === "result") {
            finish();
            resolve(message.payload);
          }
          if (message.kind === "error") {
            finish();
            reject(new Error(message.error));
          }
        });
        signal.addEventListener("abort", abort, { once: true });
        try {
          send({ kind: "call", id, operation, payload });
        } catch (error) {
          finish();
          reject(error);
        }
      });
    },
    async *subscribe(payload: unknown, signal: AbortSignal): AsyncGenerator<unknown> {
      if (signal.aborted || disposed) throw new Error("Bridge cancelled or disposed");
      if (listeners.size >= (options.maxRequests ?? 32))
        throw new Error("BridgeBusy: too many active requests");
      const id = ++nextId;
      let queued: Envelope | undefined;
      let sequence = 0;
      let wake: (() => void) | undefined;
      const abort = () => {
        queued = {
          version: 1,
          generation: options.generation,
          kind: "error",
          id,
          error: "Bridge cancelled",
        };
        wake?.();
      };
      listeners.set(id, (message) => {
        if (queued) {
          queued = { ...message, kind: "error", error: "BridgeProtocolError: unexpected frame" };
        } else queued = message;
        wake?.();
      });
      signal.addEventListener("abort", abort, { once: true });
      try {
        send({ kind: "subscribe", id, payload });
        while (!signal.aborted) {
          if (!queued)
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          wake = undefined;
          const message = queued;
          queued = undefined;
          if (!message) continue;
          if (message.kind === "error") throw new Error(message.error);
          if (message.kind === "end") return;
          if (message.kind !== "frame" || message.sequence !== sequence + 1)
            throw new Error("BridgeProtocolError");
          sequence = message.sequence;
          yield message.payload;
          if (!signal.aborted && !disposed) send({ kind: "ack", id, sequence: message.sequence });
        }
      } finally {
        signal.removeEventListener("abort", abort);
        listeners.delete(id);
        try {
          send({ kind: "cancel", id });
        } catch {
          /* The native channel can disappear on eviction. */
        }
      }
    },
    dispose() {
      disposed = true;
      for (const [id, listener] of listeners) {
        try {
          send({ kind: "cancel", id });
        } catch {
          /* The native channel can disappear on eviction. */
        }
        listener({
          version: 1,
          generation: options.generation,
          kind: "error",
          id,
          error: "Bridge disposed",
        });
      }
      listeners.clear();
    },
  };
}
