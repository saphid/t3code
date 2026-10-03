/**
 * The web and desktop side of a mounted plugin view, kept free of React so
 * the handshake and lifetime rules can be tested without a DOM.
 *
 * Whether a surface mounts is decided by `resolvePluginViewTarget`, shared
 * with mobile from client-runtime. `awaitPluginViewReady` is the only
 * window-message listener: it hands the view exactly one port.
 * `runPluginViewMount` serves that port through the shared bridge until its
 * scope closes.
 */
import {
  makePluginViewBridge,
  type PluginViewCloseReason,
} from "@t3tools/client-runtime/plugin-views/bridge";
import {
  PLUGIN_VIEW_CONNECT_MESSAGE,
  PLUGIN_VIEW_READY_MESSAGE,
  type PluginView,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

interface MessageSourceWindow {
  readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
}

/**
 * Waits for the view's `ready` and answers it with one `connect` carrying one
 * port. Only a message whose source is the view's window (the wrapper frame's
 * child) is read at all; once connected, the listener is gone, so a second
 * `ready` never gets a port. Returns a function that stops waiting.
 */
export function awaitPluginViewReady(options: {
  readonly host: Pick<Window, "addEventListener" | "removeEventListener">;
  /** The view's window now; it can change if the view navigates. */
  readonly viewWindow: () => unknown;
  readonly onConnect: (port: MessagePort) => void;
}): () => void {
  const listener = (event: MessageEvent) => {
    const source = event.source;
    if (source === null || source !== options.viewWindow()) return;
    const data: unknown = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("type" in data) ||
      data.type !== PLUGIN_VIEW_READY_MESSAGE
    )
      return;
    stop();
    const channel = new MessageChannel();
    // The view's origin is opaque, so "*" is the only target that reaches it.
    (source as unknown as MessageSourceWindow).postMessage(
      { type: PLUGIN_VIEW_CONNECT_MESSAGE },
      "*",
      [channel.port2],
    );
    options.onConnect(channel.port1);
  };
  const stop = () => options.host.removeEventListener("message", listener);
  options.host.addEventListener("message", listener);
  return stop;
}

/**
 * Serves one connected view until the scope closes. Every port message goes
 * to the bridge with its transferred port count; the bridge closes the port
 * and reports `onClose` once, whatever ends the mount.
 */
export const runPluginViewMount = Effect.fnUntraced(function* <E, R>(options: {
  readonly port: MessagePort;
  readonly view: Pick<PluginView, "pluginId" | "viewId" | "title">;
  /** Bound by the host to the mount's environment, installation, generation and view. */
  readonly call: (handler: string, input: Schema.Json) => Effect.Effect<Schema.Json, E, R>;
  readonly onClose: (reason: PluginViewCloseReason) => void;
}) {
  const { port } = options;
  const bridge = yield* makePluginViewBridge({
    view: {
      pluginId: options.view.pluginId,
      viewId: options.view.viewId,
      title: options.view.title,
    },
    port: { post: (text) => port.postMessage(text), close: () => port.close() },
    call: options.call,
    onClose: options.onClose,
  });
  port.addEventListener("message", (event) => bridge.receive(event.data, event.ports.length));
  // A message that could not be deserialized is not text.
  port.addEventListener("messageerror", () => bridge.receive(undefined, 0));
  port.start();
  return yield* Effect.never;
});
