/**
 * Desktop renderer side of the private browser engine host contract
 * (P08-ENGINE-ATTACH, P08-HOST-AUTHORITY, P08-NAV-ACK).
 *
 * `BrowserEngineHostConnection` registers this window as the engine host of
 * the desktop's own environment. Each hosted webview then claims its guest
 * under the guest's webContents id and reports page status through
 * `usePreviewBridge`; the server executes `t3.browser/sessions` page commands
 * by sending them here. Web and mobile clients never mount any of this.
 */
import {
  BROWSER_ENGINE_FAVICON_MAX_LENGTH,
  type BrowserEngineCommand,
  type BrowserEngineHostCommandResultInput,
  type BrowserEnginePageStatus,
  type DesktopPreviewBridge,
  type DesktopPreviewTabState,
  PREVIEW_ZOOM_LEVELS,
  type PreviewNavStatus,
  type PreviewZoomFactor,
} from "@t3tools/contracts";
import { create } from "zustand";

const TITLE_MAX_LENGTH = 512;

interface BrowserEngineHostStoreState {
  /** The registered host id per environment; absent while not hosting. */
  readonly hostConnectionIdByEnvironment: Record<string, string>;
  readonly setHostConnectionId: (environmentId: string, hostConnectionId: string | null) => void;
}

export const useBrowserEngineHostStore = create<BrowserEngineHostStoreState>()((set) => ({
  hostConnectionIdByEnvironment: {},
  setHostConnectionId: (environmentId, hostConnectionId) =>
    set((state) => {
      const current = state.hostConnectionIdByEnvironment[environmentId] ?? null;
      if (current === hostConnectionId) return state;
      const { [environmentId]: _previous, ...rest } = state.hostConnectionIdByEnvironment;
      return {
        hostConnectionIdByEnvironment:
          hostConnectionId === null ? rest : { ...rest, [environmentId]: hostConnectionId },
      };
    }),
}));

/**
 * Latest observed state of each guest this window renders, keyed by runtime
 * tab id. Commands are checked against it so a command fenced on a replaced
 * guest is refused instead of landing on its successor.
 */
const hostedTabs = new Map<string, DesktopPreviewTabState>();

export function recordHostedTabState(runtimeTabId: string, state: DesktopPreviewTabState): void {
  hostedTabs.set(runtimeTabId, state);
}

export function forgetHostedTab(runtimeTabId: string): void {
  hostedTabs.delete(runtimeTabId);
}

/** The engine generation of a guest is its serialized webContents id. */
export function engineGenerationOf(state: DesktopPreviewTabState): string | null {
  return state.webContentsId === null ? null : String(state.webContentsId);
}

function closestZoomStep(factor: number): number {
  let closest = 0;
  for (let index = 1; index < PREVIEW_ZOOM_LEVELS.length; index += 1) {
    if (
      Math.abs(PREVIEW_ZOOM_LEVELS[index]! - factor) <
      Math.abs(PREVIEW_ZOOM_LEVELS[closest]! - factor)
    ) {
      closest = index;
    }
  }
  return closest;
}

function projectNavStatus(status: DesktopPreviewTabState["navStatus"]): PreviewNavStatus {
  if (status.kind === "Idle") return { _tag: "Idle" };
  const title = status.title.slice(0, TITLE_MAX_LENGTH);
  if (status.kind === "LoadFailed") {
    return {
      _tag: "LoadFailed",
      url: status.url,
      title,
      code: status.code,
      description: status.description,
    };
  }
  return { _tag: status.kind, url: status.url, title };
}

/** Projects observed desktop state into the bounded engine report. */
export function toEnginePageStatus(state: DesktopPreviewTabState): BrowserEnginePageStatus {
  const favicon =
    state.favicon && state.favicon.dataUrl.length <= BROWSER_ENGINE_FAVICON_MAX_LENGTH
      ? { dataUrl: state.favicon.dataUrl, pageUrl: state.favicon.pageUrl }
      : null;
  return {
    navStatus: projectNavStatus(state.navStatus),
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    zoomFactor: PREVIEW_ZOOM_LEVELS[closestZoomStep(state.zoomFactor)] as PreviewZoomFactor,
    appearance: state.colorScheme,
    audioMuted: state.audioMuted,
    audible: state.audible,
    favicon,
  };
}

type CommandResult = BrowserEngineHostCommandResultInput["result"];

type EngineCommandBridge = Pick<
  DesktopPreviewBridge,
  | "goBack"
  | "goForward"
  | "refresh"
  | "hardReload"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "setColorScheme"
  | "setAudioMuted"
>;

const rejected = (reason: Extract<CommandResult, { outcome: "rejected" }>["reason"]) =>
  ({ outcome: "rejected", reason }) as const;

/**
 * Runs one server-issued page command on the guest it is fenced to. The
 * desktop bridge only steps zoom along the ladder, so a zoom target is
 * honored when it is the reset level or one step from the observed factor;
 * any other target is `not-applicable` rather than an emulated multi-step.
 */
export async function executeEngineCommand(
  bridge: EngineCommandBridge,
  runtimeTabId: string,
  engineGeneration: string,
  command: BrowserEngineCommand,
): Promise<CommandResult> {
  const state = hostedTabs.get(runtimeTabId);
  if (state === undefined) return rejected("session-not-found");
  if (engineGenerationOf(state) !== engineGeneration) return rejected("stale-generation");
  try {
    switch (command._tag) {
      case "back":
        if (!state.canGoBack) return rejected("not-applicable");
        await bridge.goBack(runtimeTabId);
        break;
      case "forward":
        if (!state.canGoForward) return rejected("not-applicable");
        await bridge.goForward(runtimeTabId);
        break;
      case "reload":
        await bridge.refresh(runtimeTabId);
        break;
      case "hardReload":
        await bridge.hardReload(runtimeTabId);
        break;
      case "zoom": {
        const current = closestZoomStep(state.zoomFactor);
        const target = closestZoomStep(command.zoomFactor);
        if (target === current) break;
        if (command.zoomFactor === 1) await bridge.resetZoom(runtimeTabId);
        else if (target === current + 1) await bridge.zoomIn(runtimeTabId);
        else if (target === current - 1) await bridge.zoomOut(runtimeTabId);
        else return rejected("not-applicable");
        break;
      }
      case "setAppearance":
        await bridge.setColorScheme(runtimeTabId, command.appearance);
        break;
      case "setAudioMuted":
        await bridge.setAudioMuted(runtimeTabId, command.muted);
        break;
    }
  } catch {
    return rejected("failed");
  }
  return { outcome: "applied" };
}
