import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type AssetCreateUrlResult,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { readThreadPreviewState, resetPreviewStateForTests } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { openFileInPreview } from "./openFileInPreview";

// Same thread id in two environments; only A started the open.
const threadA = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("shared-thread"),
};
const threadB = { ...threadA, environmentId: EnvironmentId.make("environment-b") };

const snapshot: PreviewSessionSnapshot = {
  threadId: threadA.threadId,
  tabId: "tab-1",
  navStatus: { _tag: "Loading", url: "http://localhost:3773/a/index.html", title: "" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-04T00:00:00.000Z",
};

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function startOpen() {
  const asset = deferred<AtomCommandResult<AssetCreateUrlResult, never>>();
  const session = deferred<AtomCommandResult<PreviewSessionSnapshot, never>>();
  const requested = deferred<void>();
  const openPreview = vi.fn(() => (requested.resolve(), session.promise));
  let current = true;
  const result = openFileInPreview({
    threadRef: threadA,
    filePath: "/repo/index.html",
    workspaceRoot: "/repo",
    httpBaseUrl: "http://localhost:3773/",
    createAssetUrl: () => asset.promise,
    openPreview,
    isScopeCurrent: () => current,
  });
  return {
    result,
    openPreview,
    requested: requested.promise,
    leave: () => {
      current = false;
    },
    settleAsset: () =>
      asset.resolve(AsyncResult.success({ relativeUrl: "/a/index.html", expiresAt: 0 })),
    settleSession: () => session.resolve(AsyncResult.success(snapshot)),
  };
}

const browserSurfaces = (ref: typeof threadA) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces.filter(
    (surface) => surface.kind === "preview",
  );

beforeEach(() => {
  vi.stubGlobal("window", { desktopBridge: { preview: {} } });
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openFileInPreview scope", () => {
  it("opens a Browser surface in the thread that is still showing", async () => {
    const open = startOpen();
    open.settleAsset();
    await open.requested;
    open.settleSession();

    await expect(open.result).resolves.toMatchObject({ _tag: "Success" });
    expect(readThreadPreviewState(threadA).snapshot).toEqual(snapshot);
    expect(browserSurfaces(threadA).map((surface) => surface.id)).toEqual(["browser:tab-1"]);
  });

  it("never asks for a browser when the thread was left during asset creation", async () => {
    const open = startOpen();
    open.leave();
    open.settleAsset();

    const result = await open.result;

    expect(isAtomCommandInterrupted(result)).toBe(true);
    expect(open.openPreview).not.toHaveBeenCalled();
    expect(browserSurfaces(threadA)).toEqual([]);
    expect(browserSurfaces(threadB)).toEqual([]);
  });

  it("does not apply or select a browser that settles after the thread was left", async () => {
    const open = startOpen();
    open.settleAsset();
    await open.requested;
    open.leave();
    open.settleSession();

    const result = await open.result;

    expect(isAtomCommandInterrupted(result)).toBe(true);
    expect(readThreadPreviewState(threadA).snapshot).toBeNull();
    expect(readThreadPreviewState(threadA).recentlySeenUrls).toEqual([]);
    expect(browserSurfaces(threadA)).toEqual([]);
    expect(browserSurfaces(threadB)).toEqual([]);
  });
});
