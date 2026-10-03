/**
 * The trusted page in the main frame of the iOS plugin view WebView. It
 * creates the policy wrapper frame through the DOM, exactly as the web host
 * does, answers the view's `ready` with one MessagePort, and relays that
 * port to native: port messages go out through `ReactNativeWebView`, and
 * native answers come back through `injectJavaScript`. The bridge itself
 * (bounds, rate, calls, liveness) runs in React Native.
 *
 * The page is the only frame with native authority. The patched WebView
 * (`t3RestrictSubframes`) drops script messages from subframes and refuses
 * any navigation a subframe starts, and marks this page with
 * `window.__t3SubframesRestricted`. The page reads that marker before any
 * other frame exists and reports it as its first message, so the report
 * cannot be forged. Without the marker it stops there; with it, native sends
 * the view's document through `mount`. A build without the patch therefore
 * never receives the view's bytes, let alone runs them.
 */
import {
  NonNegativeInt,
  PLUGIN_VIEW_CONNECT_MESSAGE,
  PLUGIN_VIEW_MESSAGE_MAX_BYTES,
  PLUGIN_VIEW_READY_MESSAGE,
} from "@t3tools/contracts";
import { PLUGIN_VIEW_FRAME_ATTRIBUTES } from "@t3tools/client-runtime/plugin-views/document";
import * as Schema from "effect/Schema";

/** What the page tells native. */
const PluginViewHostPageMessage = Schema.Union([
  /** The page's first message: whether this WebView keeps subframes from native. */
  Schema.Struct({ type: Schema.Literal("host"), restricted: Schema.Boolean }),
  /** The view asked for its port and got it. */
  Schema.Struct({ type: Schema.Literal("connected") }),
  /** One port message: its text (null when it was not text) and how many ports it carried. */
  Schema.Struct({
    type: Schema.Literal("message"),
    text: Schema.NullOr(Schema.String),
    ports: NonNegativeInt,
  }),
]);
export type PluginViewHostPageMessage = typeof PluginViewHostPageMessage.Type;

export const decodePluginViewHostPageMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(PluginViewHostPageMessage),
);

/** Scripts native injects: load the view's document once, send the view one host message, or end the mount. */
export const pluginViewHostPageCommand = {
  mount: (document: string) => `window.__t3PluginViewHost.mount(${JSON.stringify(document)});true;`,
  post: (text: string) => `window.__t3PluginViewHost.post(${JSON.stringify(text)});true;`,
  close: "window.__t3PluginViewHost.close();true;",
} as const;

/**
 * The view inherits this policy and can only narrow it: no network, no
 * frames beyond srcdoc, inline script only where the view's own hashes allow.
 */
const HOST_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

// Plain ES5 in a string: Hermes keeps no source text for functions to serialize.
const HOST_PAGE_SCRIPT = `(function (config) {
  "use strict";
  var native = window.ReactNativeWebView;
  var send = function (message) { native.postMessage(JSON.stringify(message)); };
  // No other frame exists yet, so this report is the page's own.
  var restricted = window.__t3SubframesRestricted === true;
  send({ type: "host", restricted: restricted });
  if (!restricted) return;
  var frame = null;
  var port = null;
  var closed = false;
  var relay = function (event) {
    if (closed) return;
    var ports = event.ports.length;
    for (var i = 0; i < ports; i++) event.ports[i].close();
    var data = event.data;
    // Longer text is too large however it encodes, and so is this prefix.
    var text = typeof data !== "string" ? null
      : data.length > config.maxText ? data.slice(0, config.maxText + 1) : data;
    send({ type: "message", text: text, ports: ports });
  };
  var onReady = function (event) {
    var view = frame.contentWindow ? frame.contentWindow[0] : null;
    if (!view || event.source !== view) return;
    var data = event.data;
    if (typeof data !== "object" || data === null || data.type !== config.ready) return;
    window.removeEventListener("message", onReady);
    var channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = relay;
    port.onmessageerror = function () {
      if (!closed) send({ type: "message", text: null, ports: 0 });
    };
    // The view's origin is opaque, so "*" is the only target that reaches it.
    view.postMessage({ type: config.connect }, "*", [channel.port2]);
    send({ type: "connected" });
  };
  Object.defineProperty(window, "__t3PluginViewHost", {
    value: Object.freeze({
      mount: function (html) {
        if (frame !== null || closed) return;
        frame = document.createElement("iframe");
        frame.setAttribute("sandbox", config.sandbox);
        frame.setAttribute("referrerpolicy", config.referrerpolicy);
        frame.setAttribute("allow", config.allow);
        frame.title = config.title;
        window.addEventListener("message", onReady);
        frame.srcdoc = html;
        document.body.appendChild(frame);
      },
      post: function (text) { if (port !== null && !closed) port.postMessage(text); },
      close: function () {
        closed = true;
        window.removeEventListener("message", onReady);
        if (port !== null) port.close();
        if (frame !== null) frame.remove();
      },
    }),
  });
})`;

/** Embeds data in a script element: no `</script`, and no line separators in old engines. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/** The host page for one mount; the view's document (the builder's policy wrapper) follows through `mount`. */
export function pluginViewHostPage(input: { readonly title: string }) {
  const config = scriptJson({
    title: input.title,
    sandbox: PLUGIN_VIEW_FRAME_ATTRIBUTES.sandbox,
    referrerpolicy: PLUGIN_VIEW_FRAME_ATTRIBUTES.referrerpolicy,
    allow: PLUGIN_VIEW_FRAME_ATTRIBUTES.allow,
    ready: PLUGIN_VIEW_READY_MESSAGE,
    connect: PLUGIN_VIEW_CONNECT_MESSAGE,
    maxText: PLUGIN_VIEW_MESSAGE_MAX_BYTES,
  });
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${HOST_PAGE_CSP}"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><script>${HOST_PAGE_SCRIPT}(${config});</script></body></html>`;
}
