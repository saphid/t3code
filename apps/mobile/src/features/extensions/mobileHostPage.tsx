import * as React from "react";
import { createRoot } from "react-dom/client";
import { createExtensionHost } from "@t3tools/extension-sdk/host";
import { ExtensionSurface, type SurfaceRenderer } from "@t3tools/extension-sdk/react";
import type { ClientFactory, ClientHost } from "@t3tools/extension-sdk/environment";
import type {
  ApiDiscovery,
  ApiStreamFrame,
  ApiStreamInvocation,
} from "@t3tools/extension-sdk/capabilities";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import { createPageBridge } from "./mobileExtensionBridge";

export interface MobilePageBootstrap {
  generation: string;
  code: string;
  context: ViewContext;
  surfaceId: string;
  environmentLabel: string;
  cssVars: Record<string, string>;
  insets: { top: number; right: number; bottom: number; left: number };
  keyboardInset: number;
}
declare global {
  interface Window {
    ReactNativeWebView: { postMessage(message: string): void };
    __t3MobileBootstrap: MobilePageBootstrap;
    __t3MobileReceive(message: string): void;
  }
}
const bootstrap = window.__t3MobileBootstrap;
// ReactNativeWebView is a native bridge, whose postMessage has no target-origin argument.
// eslint-disable-next-line unicorn/require-post-message-target-origin
const nativePost = (message: string) => window.ReactNativeWebView.postMessage(message);
const post = (kind: string) =>
  nativePost(JSON.stringify({ generation: bootstrap.generation, kind }));
const bridge = createPageBridge({ generation: bootstrap.generation, send: nativePost });
const host = createExtensionHost<SurfaceRenderer>({ authorize: () => false });
let viewId: string | undefined;
let root: ReturnType<typeof createRoot> | undefined;
let visible = true;
let disposed = false;
async function* frames(
  request: ApiStreamInvocation,
  signal: AbortSignal,
  resumable = false,
  onSuspended?: () => void,
) {
  for await (const frame of bridge.subscribe({ request, resumable }, signal)) {
    if (frame === null) onSuspended?.();
    else yield frame as ApiStreamFrame;
  }
}
const api: ClientHost = {
  React,
  invokeApi: async (request, signal) => (await bridge.invoke("invoke", request, signal)) as Json,
  subscribeApi: frames,
  resumableStreams: {
    version: 4,
    subscribeApi: (request, signal, options) => frames(request, signal, true, options?.onSuspended),
  },
  discoverApis: async (context, signal) =>
    (await bridge.invoke("discover", context, signal)) as readonly ApiDiscovery[],
  invokeTool: async (toolId, input, context, signal) =>
    (await bridge.invoke("tool", { toolId, input, context }, signal)) as Json,
  async readAsset(path, signal) {
    let offset = 0;
    let bytes: Uint8Array | undefined;
    let mediaType = "";
    let sha256 = "";
    do {
      const chunk = (await bridge.invoke("asset", { path, offset }, signal)) as {
        bytes: number[];
        byteLength: number;
        mediaType: string;
        sha256: string;
      };
      if (!bytes) {
        if (
          !Number.isSafeInteger(chunk.byteLength) ||
          chunk.byteLength < 0 ||
          chunk.byteLength > 8 * 1024 * 1024
        )
          throw new Error("Asset too large");
        bytes = new Uint8Array(chunk.byteLength);
        mediaType = chunk.mediaType;
        sha256 = chunk.sha256;
      }
      if (
        chunk.byteLength !== bytes.length ||
        chunk.mediaType !== mediaType ||
        chunk.sha256 !== sha256 ||
        chunk.bytes.length > 32 * 1024 ||
        (chunk.bytes.length === 0 && offset < bytes.length) ||
        offset + chunk.bytes.length > bytes.length
      )
        throw new Error("Asset transfer failed");
      bytes.set(chunk.bytes, offset);
      offset += chunk.bytes.length;
    } while (offset < bytes.length);
    return { bytes, mediaType, sha256 };
  },
  environmentLabel: () => bootstrap.environmentLabel,
};
function presentation(value: Pick<MobilePageBootstrap, "cssVars" | "insets" | "keyboardInset">) {
  for (const [name, token] of Object.entries(value.cssVars))
    if (/^--[a-zA-Z0-9-]+$/.test(name)) document.documentElement.style.setProperty(name, token);
  for (const [edge, inset] of Object.entries(value.insets))
    document.documentElement.style.setProperty(`--t3-safe-area-${edge}`, `${inset}px`);
  document.documentElement.style.setProperty("--t3-keyboard-inset", `${value.keyboardInset}px`);
}
function dispose() {
  if (disposed) return;
  disposed = true;
  bridge.dispose();
  root?.unmount();
  if (viewId) host.close(viewId);
}
window.__t3MobileReceive = (message) => {
  if (bridge.receive(message)) return;
  try {
    const value = JSON.parse(message) as {
      generation: string;
      kind: string;
      payload: MobilePageBootstrap & { visible: boolean };
    };
    if (value.generation !== bootstrap.generation) return;
    if (value.kind === "dispose") dispose();
    if (value.kind === "presentation" && value.payload) {
      presentation(value.payload);
      visible = value.payload.visible;
      if (viewId) {
        if (visible) void host.show(viewId);
        else host.hide(viewId);
      }
    }
  } catch {
    post("failure");
  }
};
async function mount() {
  presentation(bootstrap);
  const url = URL.createObjectURL(new Blob([bootstrap.code], { type: "text/javascript" }));
  try {
    const loaded = (await import(url)) as { default: ClientFactory };
    if (disposed) return;
    const extension = loaded.default(api);
    const surface = extension.manifest.surfaces.find((item) => item.id === bootstrap.surfaceId);
    if (!surface?.clients.includes("mobile")) throw new Error("Unsupported surface");
    host.register(extension);
    viewId = await host.open({
      version: 1,
      surfaceId: surface.id,
      context: bootstrap.context,
      placement: "side-panel",
      stateVersion: surface.stateVersion,
      restoreState: null,
      fallback: "Extension unavailable",
    });
    if (disposed) {
      host.close(viewId);
      return;
    }
    root = createRoot(document.getElementById("root")!);
    root.render(<ExtensionSurface host={host} viewId={viewId} />);
    if (!visible) host.hide(viewId);
    post("mounted");
  } finally {
    URL.revokeObjectURL(url);
  }
}
window.addEventListener("pagehide", dispose);
window.addEventListener("error", () => post("failure"));
window.addEventListener("unhandledrejection", () => post("failure"));
post("ready");
void mount().catch(() => {
  document.getElementById("root")!.textContent =
    "Extension unavailable. Check the connection and installation grants.";
  post("failure");
});
