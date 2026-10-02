import type {
  ClientProviderServerFrame,
  ClientProvidersRespondInput,
  ClientProviderEmitEvent,
} from "@t3tools/contracts";
import { MobileUiProviderError, type createMobileUiProviders } from "./mobileUiProviders";
import { checkMobileUiAbort } from "./mobileUiAbort";

export type MobileUiProviders = ReturnType<typeof createMobileUiProviders>;

/** One authenticated socket registration. Replies never cross into a replacement session. */
export function createMobileClientProviderSession(
  ui: MobileUiProviders,
  send: {
    respond: (payload: ClientProvidersRespondInput) => void;
    emit: (id: string, event: ClientProviderEmitEvent) => void;
  },
) {
  let disposed = false;
  let identity: string | undefined;
  let accepted = new Set<string>();
  const waiters = new Set<() => void>();
  const pending = new Map<string, AbortController>();
  const subscriptions = new Map<string, () => void>();
  const provider = (id: string) => {
    if (disposed || !identity || !accepted.has(id))
      throw new MobileUiProviderError(
        "client-provider-unavailable",
        "Mobile UI connection is unavailable",
      );
    const value = ui.providers.get(id);
    if (!value)
      throw new MobileUiProviderError(
        "client-provider-unavailable",
        "Mobile UI provider is unavailable",
      );
    return value;
  };
  return {
    async connectionId(signal: AbortSignal, timeoutMs = 10_000) {
      checkMobileUiAbort(signal);
      if (!identity && !disposed)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            waiters.delete(done);
            resolve();
          };
          const timer = setTimeout(done, timeoutMs);
          waiters.add(done);
          signal.addEventListener("abort", done, { once: true });
        });
      checkMobileUiAbort(signal);
      return disposed ? undefined : identity;
    },
    async receive(frame: ClientProviderServerFrame) {
      if (disposed) return;
      switch (frame.type) {
        case "registered":
          identity = frame.connectionId;
          accepted = new Set(frame.accepted.map(({ id }) => id));
          for (const done of waiters) done();
          return;
        case "invoke": {
          const controller = new AbortController();
          pending.set(frame.requestId, controller);
          try {
            const value = await provider(frame.apiId).invoke({
              ...frame,
              signal: controller.signal,
            });
            if (!disposed && !controller.signal.aborted)
              send.respond({ requestId: frame.requestId, ok: true, value });
          } catch (error) {
            if (!disposed && !controller.signal.aborted)
              send.respond({
                requestId: frame.requestId,
                ok: false,
                error: {
                  code: error instanceof MobileUiProviderError ? error.code : "provider-rejected",
                  message: (error instanceof Error ? error.message : "Provider failed").slice(
                    0,
                    2000,
                  ),
                },
              });
          } finally {
            pending.delete(frame.requestId);
          }
          return;
        }
        case "cancel":
          pending.get(frame.requestId)?.abort();
          return;
        case "subscriptionOpen": {
          const emit = (event: ClientProviderEmitEvent) => {
            if (!disposed) send.emit(frame.subscriptionId, event);
          };
          try {
            const local = provider(frame.apiId);
            if (!local.openStream)
              throw new MobileUiProviderError(
                "client-provider-unavailable",
                "Mobile UI stream is unavailable",
              );
            subscriptions.get(frame.subscriptionId)?.();
            subscriptions.set(frame.subscriptionId, local.openStream({ ...frame, emit }));
          } catch (error) {
            emit({
              type: "closed",
              value: null,
              error: {
                code:
                  error instanceof MobileUiProviderError
                    ? error.code
                    : "client-provider-unavailable",
                message: (error instanceof Error
                  ? error.message
                  : "Mobile UI stream is unavailable"
                ).slice(0, 2000),
              },
            });
          }
          return;
        }
        case "subscriptionClose": {
          const close = subscriptions.get(frame.subscriptionId);
          subscriptions.delete(frame.subscriptionId);
          close?.();
          return;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      identity = undefined;
      for (const done of waiters) done();
      for (const controller of pending.values()) controller.abort();
      for (const close of subscriptions.values()) {
        try {
          close();
        } catch {
          /* Keep cleaning the remaining registrations. */
        }
      }
      pending.clear();
      subscriptions.clear();
      ui.resetConnection();
    },
  };
}
