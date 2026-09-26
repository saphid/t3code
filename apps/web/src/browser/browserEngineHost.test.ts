import {
  BrowserEnginePageStatus,
  type BrowserEngineCommand,
  type DesktopPreviewTabState,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  executeEngineCommand,
  forgetHostedTab,
  recordHostedTabState,
  toEnginePageStatus,
} from "./browserEngineHost";

const RUNTIME_TAB = "runtime-tab";

const tabState = (overrides: Partial<DesktopPreviewTabState> = {}): DesktopPreviewTabState => ({
  tabId: RUNTIME_TAB,
  webContentsId: 41,
  navStatus: { kind: "Success", url: "http://localhost:5173/", title: "Dev" },
  canGoBack: true,
  canGoForward: false,
  zoomFactor: 1,
  pictureInPicture: false,
  remoteLive: false,
  colorScheme: "system",
  audioMuted: false,
  audible: false,
  controller: "human",
  updatedAt: "2026-09-26T00:00:00.000Z",
  ...overrides,
});

const makeBridge = () => ({
  goBack: vi.fn(async () => {}),
  goForward: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  hardReload: vi.fn(async () => {}),
  setZoomFactor: vi.fn(async () => {}),
  setColorScheme: vi.fn(async () => {}),
  setAudioMuted: vi.fn(async () => {}),
});

const run = (
  bridge: ReturnType<typeof makeBridge>,
  command: BrowserEngineCommand,
  generation = "41",
) => executeEngineCommand(bridge, RUNTIME_TAB, generation, command);

afterEach(() => forgetHostedTab(RUNTIME_TAB));

describe("executeEngineCommand", () => {
  it("refuses commands for unknown or replaced guests without touching the bridge", async () => {
    const bridge = makeBridge();
    expect(await run(bridge, { _tag: "reload" })).toEqual({
      outcome: "rejected",
      reason: "session-not-found",
    });
    recordHostedTabState(RUNTIME_TAB, tabState({ webContentsId: 42 }));
    expect(await run(bridge, { _tag: "reload" })).toEqual({
      outcome: "rejected",
      reason: "stale-generation",
    });
    expect(bridge.refresh).not.toHaveBeenCalled();
  });

  it("routes page verbs to the native bridge for the fenced guest", async () => {
    const bridge = makeBridge();
    recordHostedTabState(RUNTIME_TAB, tabState());
    expect(await run(bridge, { _tag: "back" })).toEqual({ outcome: "applied" });
    expect(await run(bridge, { _tag: "hardReload" })).toEqual({ outcome: "applied" });
    expect(await run(bridge, { _tag: "setAppearance", appearance: "dark" })).toEqual({
      outcome: "applied",
    });
    expect(await run(bridge, { _tag: "setAudioMuted", muted: true })).toEqual({
      outcome: "applied",
    });
    expect(bridge.goBack).toHaveBeenCalledWith(RUNTIME_TAB);
    expect(bridge.hardReload).toHaveBeenCalledWith(RUNTIME_TAB);
    expect(bridge.refresh).not.toHaveBeenCalled();
    expect(bridge.setColorScheme).toHaveBeenCalledWith(RUNTIME_TAB, "dark");
    expect(bridge.setAudioMuted).toHaveBeenCalledWith(RUNTIME_TAB, true);
  });

  it("names history moves that have nowhere to go and bridge failures", async () => {
    const bridge = makeBridge();
    recordHostedTabState(RUNTIME_TAB, tabState({ canGoBack: false }));
    expect(await run(bridge, { _tag: "back" })).toEqual({
      outcome: "rejected",
      reason: "not-applicable",
    });
    expect(await run(bridge, { _tag: "forward" })).toEqual({
      outcome: "rejected",
      reason: "not-applicable",
    });
    bridge.refresh.mockRejectedValueOnce(new Error("guest detached"));
    expect(await run(bridge, { _tag: "reload" })).toEqual({
      outcome: "rejected",
      reason: "failed",
    });
  });

  it("sets any ladder zoom target with one native call, however far it is", async () => {
    const bridge = makeBridge();
    recordHostedTabState(RUNTIME_TAB, tabState({ zoomFactor: 1.25 }));
    expect(await run(bridge, { _tag: "zoom", zoomFactor: 3 })).toEqual({ outcome: "applied" });
    expect(await run(bridge, { _tag: "zoom", zoomFactor: 0.25 })).toEqual({ outcome: "applied" });
    expect(bridge.setZoomFactor.mock.calls).toEqual([
      [RUNTIME_TAB, 3],
      [RUNTIME_TAB, 0.25],
    ]);
    bridge.setZoomFactor.mockRejectedValueOnce(new Error("guest detached"));
    expect(await run(bridge, { _tag: "zoom", zoomFactor: 2 })).toEqual({
      outcome: "rejected",
      reason: "failed",
    });
  });
});

describe("toEnginePageStatus", () => {
  const decode = Schema.decodeUnknownSync(BrowserEnginePageStatus);

  it("produces a report the server contract accepts", () => {
    const status = toEnginePageStatus(
      tabState({
        navStatus: { kind: "Loading", url: "http://localhost:5173/", title: "x".repeat(900) },
        zoomFactor: 1.2499999,
        colorScheme: "dark",
        audible: true,
        favicon: {
          dataUrl: "data:image/png;base64,AAAA",
          pageUrl: "http://localhost:5173/",
          capturedAt: 1,
        },
      }),
    );
    expect(decode(status)).toEqual(status);
    expect(status.zoomFactor).toBe(1.25);
    expect(status.favicon).toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      pageUrl: "http://localhost:5173/",
    });
  });

  it("drops an oversized favicon rather than failing the whole report", () => {
    const status = toEnginePageStatus(
      tabState({
        favicon: {
          dataUrl: `data:image/png;base64,${"A".repeat(9000)}`,
          pageUrl: "http://localhost:5173/",
          capturedAt: 1,
        },
      }),
    );
    expect(status.favicon).toBeNull();
    expect(decode(status)).toEqual(status);
  });
});
