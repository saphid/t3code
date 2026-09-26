import {
  BrowserEnginePageStatus,
  type BrowserEngineCommand,
  type BrowserEngineHostStreamEvent,
  type DesktopPreviewTabState,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createEngineHostEventHandler,
  executeEngineCommand,
  forgetHostedTab,
  HANDLED_COMMANDS_LIMIT,
  nextEnginePageReport,
  recordHostedTabState,
  toEnginePageStatus,
  useBrowserEngineHostStore,
} from "./browserEngineHost";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

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
  devToolsOpen: false,
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
  openDevTools: vi.fn(async () => {}),
  closeDevTools: vi.fn(async () => {}),
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

describe("setDevToolsOpen", () => {
  it("opens and closes DevTools on the fenced guest only", async () => {
    const bridge = makeBridge();
    expect(await run(bridge, { _tag: "setDevToolsOpen", open: true })).toEqual({
      outcome: "rejected",
      reason: "session-not-found",
    });
    recordHostedTabState(RUNTIME_TAB, tabState());
    expect(await run(bridge, { _tag: "setDevToolsOpen", open: true }, "40")).toEqual({
      outcome: "rejected",
      reason: "stale-generation",
    });
    expect(bridge.openDevTools).not.toHaveBeenCalled();
    expect(await run(bridge, { _tag: "setDevToolsOpen", open: true })).toEqual({
      outcome: "applied",
    });
    expect(await run(bridge, { _tag: "setDevToolsOpen", open: false })).toEqual({
      outcome: "applied",
    });
    expect(bridge.openDevTools.mock.calls).toEqual([[RUNTIME_TAB]]);
    expect(bridge.closeDevTools.mock.calls).toEqual([[RUNTIME_TAB]]);
    bridge.closeDevTools.mockRejectedValueOnce(new Error("guest detached"));
    expect(await run(bridge, { _tag: "setDevToolsOpen", open: false })).toEqual({
      outcome: "rejected",
      reason: "failed",
    });
  });

  it("answers not-applicable when the desktop shell has no DevTools IPC", async () => {
    const { closeDevTools: _closeDevTools, ...olderShell } = makeBridge();
    recordHostedTabState(RUNTIME_TAB, tabState());
    expect(
      await executeEngineCommand(olderShell as ReturnType<typeof makeBridge>, RUNTIME_TAB, "41", {
        _tag: "setDevToolsOpen",
        open: false,
      }),
    ).toEqual({ outcome: "rejected", reason: "not-applicable" });
  });

  it("reports each DevTools flip once and stays quiet on repeats", () => {
    const decode = Schema.decodeUnknownSync(BrowserEnginePageStatus);
    const first = nextEnginePageReport(null, tabState());
    expect(first).not.toBeNull();
    // A repeated desktop event with nothing projected changed sends nothing.
    expect(nextEnginePageReport(first!.statusKey, tabState())).toBeNull();
    expect(
      nextEnginePageReport(first!.statusKey, tabState({ updatedAt: "2026-09-27T00:00:00.000Z" })),
    ).toBeNull();
    // DevTools opening alone is a new report the server contract accepts.
    const opened = nextEnginePageReport(first!.statusKey, tabState({ devToolsOpen: true }));
    expect(opened).not.toBeNull();
    expect(decode(opened!.status)).toMatchObject({ devToolsOpen: true });
    expect(nextEnginePageReport(opened!.statusKey, tabState({ devToolsOpen: true }))).toBeNull();
    // Closing reports again rather than being swallowed as a repeat.
    const closed = nextEnginePageReport(opened!.statusKey, tabState());
    expect(closed?.status.devToolsOpen).toBe(false);
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

describe("createEngineHostEventHandler", () => {
  const environmentId = EnvironmentId.make("env-host");
  const threadId = ThreadId.make("thread-host");
  const hostedTab = previewRuntimeTabId({ environmentId, threadId }, "epoch-1", "tab-1");
  const hostIdOf = () =>
    useBrowserEngineHostStore.getState().hostConnectionIdByEnvironment[environmentId];
  const command = (commandId: string): BrowserEngineHostStreamEvent => ({
    type: "command",
    commandId,
    target: { threadId, tabId: "tab-1", serverEpoch: "epoch-1" },
    engineGeneration: "41",
    command: { _tag: "reload" },
  });
  const setup = () => {
    const bridge = makeBridge();
    const sendResult = vi.fn();
    const onResult = createEngineHostEventHandler({ environmentId, bridge, sendResult });
    const deliver = (event: BrowserEngineHostStreamEvent) => onResult(AsyncResult.success(event));
    return { bridge, sendResult, onResult, deliver };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    forgetHostedTab(hostedTab);
    useBrowserEngineHostStore.getState().setHostConnectionId(environmentId, null);
  });

  it("tracks the registered host id and clears it when registration fails", () => {
    const { onResult, deliver } = setup();
    onResult(AsyncResult.initial(true));
    expect(hostIdOf()).toBeUndefined();
    deliver({ type: "registered", hostConnectionId: "host-1" });
    expect(hostIdOf()).toBe("host-1");
    onResult(AsyncResult.failure(Cause.fail("desktop-required")));
    expect(hostIdOf()).toBeUndefined();
  });

  it("runs a command on its fenced guest once and answers under the host id", async () => {
    const { bridge, sendResult, deliver } = setup();
    recordHostedTabState(hostedTab, tabState({ tabId: hostedTab }));
    // Nothing runs before the stream has registered this window.
    deliver(command("early"));
    await settle();
    expect(bridge.refresh).not.toHaveBeenCalled();

    deliver({ type: "registered", hostConnectionId: "host-1" });
    deliver(command("command-1"));
    deliver(command("command-1"));
    await settle();
    expect(bridge.refresh).toHaveBeenCalledTimes(1);
    expect(bridge.refresh).toHaveBeenCalledWith(hostedTab);
    expect(sendResult.mock.calls).toEqual([
      [{ hostConnectionId: "host-1", commandId: "command-1", result: { outcome: "applied" } }],
    ]);
  });

  it("forgets the oldest handled id once the replay window is full", async () => {
    const { bridge, deliver } = setup();
    recordHostedTabState(hostedTab, tabState({ tabId: hostedTab }));
    deliver({ type: "registered", hostConnectionId: "host-1" });
    for (let index = 0; index <= HANDLED_COMMANDS_LIMIT; index += 1) {
      deliver(command(`command-${index}`));
    }
    await settle();
    expect(bridge.refresh).toHaveBeenCalledTimes(HANDLED_COMMANDS_LIMIT + 1);
    // The newest ids are still guarded; the evicted oldest one is not.
    deliver(command(`command-${HANDLED_COMMANDS_LIMIT}`));
    deliver(command("command-0"));
    await settle();
    expect(bridge.refresh).toHaveBeenCalledTimes(HANDLED_COMMANDS_LIMIT + 2);
  });
});
