/**
 * The React Native side of a mounted plugin view on iOS. The host page
 * (`pluginViewHostPage`) owns the frame and the view's port; this side reads
 * what the page relays and serves it through the shared bridge, exactly as
 * the web host serves its MessagePort.
 */
import {
  makePluginViewBridge,
  type PluginViewBridge,
  type PluginViewCloseReason,
} from "@t3tools/client-runtime/plugin-views/bridge";
import {
  PLUGIN_VIEW_MAX_VIOLATIONS,
  PLUGIN_VIEW_MESSAGE_BURST,
  type PluginView,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";

import { decodePluginViewHostPageMessage, pluginViewHostPageCommand } from "./pluginViewHostPage";

/**
 * Messages that arrive between `connected` and the bridge starting. A burst
 * this long already ends the mount with violations, so later ones never matter.
 */
const MAX_PENDING_MESSAGES = PLUGIN_VIEW_MESSAGE_BURST + PLUGIN_VIEW_MAX_VIOLATIONS;

type PortMessage = { readonly text: string | null; readonly ports: number };

/**
 * Follows one host page. Its first message reports whether this WebView
 * keeps subframes from native, and is sent before any other frame exists, so
 * only that first report is trusted; only `restricted: true` sends the page
 * `document`. Anything else first, a later report, or a second `connected`
 * means the page can no longer be told apart from a subframe: `onRefuse` runs
 * once and nothing more reaches the bridge. `onConnect` runs once, when the
 * view has its port.
 */
export function makePluginViewRelay(options: {
  readonly document: string;
  readonly inject: (script: string) => void;
  readonly onConnect: () => void;
  readonly onRefuse: () => void;
}) {
  let phase: "starting" | "mounted" | "connected" | "refused" = "starting";
  let bridge: PluginViewBridge | null = null;
  const pending: PortMessage[] = [];
  const deliver = (target: PluginViewBridge, message: PortMessage) =>
    target.receive(message.text ?? undefined, message.ports);
  const refuse = () => {
    // Before `mount` the page has no frame to close.
    if (phase !== "starting") options.inject(pluginViewHostPageCommand.close);
    phase = "refused";
    bridge = null;
    pending.length = 0;
    options.onRefuse();
  };

  return {
    /** Every `onMessage` payload from the WebView; anything else the page could send is ignored. */
    receive: (data: string) => {
      if (phase === "refused") return;
      const decoded = decodePluginViewHostPageMessage(data);
      if (phase === "starting") {
        if (Option.isNone(decoded) || decoded.value.type !== "host" || !decoded.value.restricted)
          return refuse();
        phase = "mounted";
        return options.inject(pluginViewHostPageCommand.mount(options.document));
      }
      if (Option.isNone(decoded)) return;
      const message = decoded.value;
      switch (message.type) {
        case "host":
          return refuse();
        case "connected":
          if (phase !== "mounted") return refuse();
          phase = "connected";
          return options.onConnect();
        case "message":
          if (phase !== "connected") return;
          if (bridge !== null) return deliver(bridge, message);
          if (pending.length < MAX_PENDING_MESSAGES) pending.push(message);
      }
    },
    /** The host's end of the view's port, as the bridge sees it. */
    port: {
      post: (text: string) => {
        if (phase !== "refused") options.inject(pluginViewHostPageCommand.post(text));
      },
      close: () => options.inject(pluginViewHostPageCommand.close),
    },
    attach: (next: PluginViewBridge) => {
      if (phase === "refused") return;
      bridge = next;
      for (const message of pending.splice(0)) deliver(next, message);
    },
  };
}

/**
 * Serves one connected view until the scope closes. The bridge closes the
 * page's port and reports `onClose` once, whatever ends the mount.
 */
export const runPluginViewRelayMount = Effect.fnUntraced(function* <E, R>(options: {
  readonly relay: ReturnType<typeof makePluginViewRelay>;
  readonly view: Pick<PluginView, "pluginId" | "viewId" | "title">;
  /** Bound by the host to the mount's environment, installation, generation and view. */
  readonly call: (handler: string, input: Schema.Json) => Effect.Effect<Schema.Json, E, R>;
  readonly onClose: (reason: PluginViewCloseReason) => void;
}) {
  const bridge = yield* makePluginViewBridge({
    view: {
      pluginId: options.view.pluginId,
      viewId: options.view.viewId,
      title: options.view.title,
    },
    port: options.relay.port,
    call: options.call,
    onClose: options.onClose,
  });
  options.relay.attach(bridge);
  return yield* Effect.never;
});
