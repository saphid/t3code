/**
 * Mounts a verified view document in an opaque-origin frame and hands it one
 * MessagePort. The port is the only channel: window messages other than the
 * frame's own `ready` are ignored, a second `ready` never gets a second port,
 * and any further load of the frame tears the mount down.
 *
 * The load guard only detects; it cannot prevent a view committing another
 * document. Prevention is the `wrapper` navigation policy on web (see
 * viewDocument.ts) and a native veto on desktop and iOS.
 */
import { VIEW_FRAME_SANDBOX, type ViewNavigationPolicy } from "./viewDocument";
const MAX_MESSAGE_BYTES = 64 * 1024;

export interface IsolatedViewMount {
  readonly dispose: (reason: string) => void;
  readonly post: (message: unknown) => void;
}

export interface IsolatedViewStats {
  loads: number;
  connects: number;
  ignoredWindowMessages: number;
  droppedPortMessages: number;
  teardownReason: string | null;
}

export function mountIsolatedView(input: {
  readonly frame: HTMLIFrameElement;
  readonly documentSource: string;
  readonly generation: number;
  readonly navigationPolicy: ViewNavigationPolicy;
  readonly init: unknown;
  readonly stats: IsolatedViewStats;
  readonly onMessage: (message: unknown) => void;
}): IsolatedViewMount {
  const { frame, stats } = input;
  let port: MessagePort | null = null;
  let disposed = false;

  const dispose = (reason: string) => {
    if (disposed) return;
    disposed = true;
    stats.teardownReason = reason;
    window.removeEventListener("message", onWindowMessage);
    frame.removeEventListener("load", onLoad);
    port?.close();
    port = null;
    frame.removeAttribute("srcdoc");
    frame.src = "about:blank";
  };

  // With a policy wrapper the view is the wrapper's only child frame.
  const viewWindow = () =>
    input.navigationPolicy === "wrapper" ? (frame.contentWindow?.[0] ?? null) : frame.contentWindow;

  const onWindowMessage = (event: MessageEvent) => {
    const target = viewWindow();
    if (target === null || event.source !== target) return;
    const isReady =
      typeof event.data === "object" &&
      event.data !== null &&
      (event.data as { type?: unknown }).type === "t3-view:ready";
    if (!isReady || port !== null || disposed) {
      stats.ignoredWindowMessages += 1;
      return;
    }
    const channel = new MessageChannel();
    port = channel.port1;
    stats.connects += 1;
    port.addEventListener("message", (portEvent) => {
      if (disposed) return;
      if (JSON.stringify(portEvent.data ?? null).length > MAX_MESSAGE_BYTES) {
        stats.droppedPortMessages += 1;
        return;
      }
      input.onMessage(portEvent.data);
    });
    port.start();
    // An opaque origin cannot be named as a target. The source check binds the
    // port to this browsing context, not to a document: only the navigation
    // policy keeps that context on the verified document.
    target.postMessage(
      { type: "t3-view:connect", generation: input.generation, init: input.init },
      "*",
      [channel.port2],
    );
  };

  // srcdoc loads once. Any further load is the view navigating or reloading
  // itself into a document the host never verified.
  const onLoad = () => {
    stats.loads += 1;
    if (stats.loads > 1) dispose("frame-navigated");
  };

  window.addEventListener("message", onWindowMessage);
  frame.addEventListener("load", onLoad);
  frame.setAttribute("sandbox", VIEW_FRAME_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("allow", "");
  frame.srcdoc = input.documentSource;

  return {
    dispose,
    post: (message) => {
      if (!disposed) port?.postMessage(message);
    },
  };
}
