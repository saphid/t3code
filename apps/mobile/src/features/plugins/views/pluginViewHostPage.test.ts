import * as NodeWorkerThreads from "node:worker_threads";

import { PLUGIN_VIEW_FRAME_ATTRIBUTES } from "@t3tools/client-runtime/plugin-views/document";
import {
  PLUGIN_VIEW_CONNECT_MESSAGE,
  PLUGIN_VIEW_MESSAGE_MAX_BYTES,
  PLUGIN_VIEW_READY_MESSAGE,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  decodePluginViewHostPageMessage,
  type PluginViewHostPageMessage,
  pluginViewHostPage,
  pluginViewHostPageCommand,
} from "./pluginViewHostPage";

// The wrapper document carries script and line separators; the page must hand it over intact.
const WRAPPER = '<!doctype html><script>alert("</script>")</script>\u2028<iframe srcdoc="x">';

interface Posted {
  readonly message: unknown;
  readonly target: string;
  readonly transfer: ReadonlyArray<NodeWorkerThreads.MessagePort>;
}

/**
 * Runs the real page script against a stand-in DOM: one iframe whose child
 * window is the view, a native bridge that records what the page sends,
 * and Node's MessageChannel in place of the browser's.
 */
function loadHostPage(options: { readonly restricted: boolean }) {
  const page = pluginViewHostPage({ document: WRAPPER, title: "Board" });
  const script = page.slice(
    page.indexOf("<script>") + "<script>".length,
    page.lastIndexOf("</script>"),
  );
  const listeners = new Set<(event: { source: unknown; data: unknown }) => void>();
  const sent: PluginViewHostPageMessage[] = [];
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  const view: {
    posted: Posted[];
    postMessage: (...args: [unknown, string, NodeWorkerThreads.MessagePort[]]) => void;
  } = {
    posted: [],
    postMessage: (message, target, transfer) => view.posted.push({ message, target, transfer }),
  };
  const frame = {
    attributes: new Map<string, string>(),
    title: "",
    srcdoc: "",
    removed: false,
    contentWindow: { 0: view },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    remove() {
      this.removed = true;
    },
  };
  const appended: unknown[] = [];
  const window: Record<string, unknown> = {
    __t3SubframesRestricted: options.restricted ? true : undefined,
    ReactNativeWebView: {
      postMessage: (data: string) => {
        sent.push(Option.getOrThrow(decodePluginViewHostPageMessage(data)));
        for (const waiter of waiters.splice(0))
          if (sent.length >= waiter.count) waiter.resolve();
          else waiters.push(waiter);
      },
    },
    addEventListener: (
      _type: string,
      listener: (event: { source: unknown; data: unknown }) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: { source: unknown; data: unknown }) => void,
    ) => listeners.delete(listener),
  };
  const document = {
    createElement: () => frame,
    body: { appendChild: (node: unknown) => appended.push(node) },
  };
  new Function("window", "document", "MessageChannel", script)(
    window,
    document,
    NodeWorkerThreads.MessageChannel,
  );
  const host = window.__t3PluginViewHost as { post: (text: string) => void; close: () => void };
  return {
    frame,
    view,
    appended,
    sent,
    host,
    dispatch: (source: unknown, data: unknown) => {
      for (const listener of listeners) listener({ source, data });
    },
    listening: () => listeners.size > 0,
    /** Resolves once the page has sent `count` messages to native in total. */
    sentCount: (count: number) =>
      new Promise<void>((resolve) => {
        if (sent.length >= count) resolve();
        else waiters.push({ count, resolve });
      }),
  };
}

const connect = (page: ReturnType<typeof loadHostPage>) => {
  page.dispatch(page.view, { type: PLUGIN_VIEW_READY_MESSAGE });
  const port = page.view.posted[0]?.transfer[0];
  if (port === undefined) throw new Error("The view got no port.");
  return port;
};

describe("pluginViewHostPage", () => {
  it("creates the sandboxed wrapper through the DOM with the builder's document intact", () => {
    const page = loadHostPage({ restricted: true });
    expect(Object.fromEntries(page.frame.attributes)).toEqual({ ...PLUGIN_VIEW_FRAME_ATTRIBUTES });
    expect(page.frame.srcdoc).toBe(WRAPPER);
    expect(page.frame.title).toBe("Board");
    expect(page.appended).toEqual([page.frame]);
  });

  it("hands only the view's window one port, once, and tells native whether subframes are restricted", () => {
    const page = loadHostPage({ restricted: true });
    page.dispatch({}, { type: PLUGIN_VIEW_READY_MESSAGE });
    page.dispatch(page.view, { type: "something-else" });
    page.dispatch(page.view, PLUGIN_VIEW_READY_MESSAGE);
    expect(page.view.posted).toEqual([]);
    expect(page.sent).toEqual([]);

    const port = connect(page);
    expect(page.view.posted).toHaveLength(1);
    expect(page.view.posted[0]).toMatchObject({
      message: { type: PLUGIN_VIEW_CONNECT_MESSAGE },
      target: "*",
    });
    expect(page.view.posted[0]?.transfer).toHaveLength(1);
    expect(page.sent).toEqual([{ type: "connected", restricted: true }]);
    // Connected: the page reads no window message any more.
    expect(page.listening()).toBe(false);
    page.dispatch(page.view, { type: PLUGIN_VIEW_READY_MESSAGE });
    expect(page.view.posted).toHaveLength(1);
    port.close();
  });

  it("reports a WebView without the subframe patch as unrestricted", () => {
    const page = loadHostPage({ restricted: false });
    connect(page).close();
    expect(page.sent).toEqual([{ type: "connected", restricted: false }]);
  });

  it("relays every port message with the facts the bridge judges it by", async () => {
    const page = loadHostPage({ restricted: true });
    const port = connect(page);
    const extra = new NodeWorkerThreads.MessageChannel();
    port.postMessage('{"_tag":"pong","n":1}');
    port.postMessage("x".repeat(PLUGIN_VIEW_MESSAGE_MAX_BYTES * 3));
    port.postMessage({ not: "text" });
    port.postMessage("with a port", [extra.port1]);
    await page.sentCount(5);
    expect(page.sent.slice(1)).toEqual([
      { type: "message", text: '{"_tag":"pong","n":1}', ports: 0 },
      // Too large either way; native never carries more than one byte past the bound.
      { type: "message", text: "x".repeat(PLUGIN_VIEW_MESSAGE_MAX_BYTES + 1), ports: 0 },
      { type: "message", text: null, ports: 0 },
      { type: "message", text: "with a port", ports: 1 },
    ]);
    port.close();
    extra.port2.close();
  });

  it("delivers native's messages to the view, and closing ends the port and removes the frame", async () => {
    const page = loadHostPage({ restricted: true });
    const port = connect(page);
    const received = new Promise<unknown>((resolve) => port.once("message", resolve));
    new Function("window", pluginViewHostPageCommand.post('{"_tag":"ping","n":1}'))({
      __t3PluginViewHost: page.host,
    });
    // Node's port emits the message value itself.
    expect(await received).toBe('{"_tag":"ping","n":1}');

    const closed = new Promise<void>((resolve) => port.once("close", () => resolve()));
    new Function("window", pluginViewHostPageCommand.close)({ __t3PluginViewHost: page.host });
    await closed;
    expect(page.frame.removed).toBe(true);
    // Nothing more reaches native or the view.
    page.host.post('{"_tag":"ping","n":2}');
    expect(page.sent).toEqual([{ type: "connected", restricted: true }]);
  });

  it("decodes only what the page sends", () => {
    for (const data of [
      "not json",
      "{}",
      '{"type":"connected"}',
      '{"type":"message","text":1,"ports":0}',
      '{"type":"message","text":"a","ports":-1}',
    ])
      expect(Option.isNone(decodePluginViewHostPageMessage(data))).toBe(true);
  });
});
