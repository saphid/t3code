import type { LocalApi, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  BrowserLinkContextMenuShowError,
  BrowserLinkCopyError,
  BrowserLinkOpenInNewTabError,
  resolveBrowserLinkUrl,
  showBrowserLinkContextMenu,
} from "./linkContextMenu";

const { openBrowserMock, writeTextToClipboardMock } = vi.hoisted(() => ({
  openBrowserMock: vi.fn(),
  writeTextToClipboardMock: vi.fn(async () => true),
}));

vi.mock("~/previewStateStore", () => ({
  applyPreviewServerSnapshot: vi.fn(),
  rememberPreviewUrl: vi.fn(),
  isPreviewSupportedInRuntime: () => true,
}));

vi.mock("~/rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({ openBrowser: openBrowserMock }),
  },
}));

vi.mock("~/hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: writeTextToClipboardMock,
}));

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-2",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const localApiShowing = (choice: string | null) =>
  ({
    contextMenu: {
      show: vi.fn(async () => choice),
    },
  }) as unknown as LocalApi;

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("resolveBrowserLinkUrl", () => {
  it("accepts http and https links", () => {
    expect(resolveBrowserLinkUrl("http://localhost:5173/docs")).toBe("http://localhost:5173/docs");
    expect(resolveBrowserLinkUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
  });

  it("rejects non-http(s) protocols, empty targets, and non-strings", () => {
    expect(resolveBrowserLinkUrl("javascript:alert(1)")).toBeNull();
    expect(resolveBrowserLinkUrl("mailto:a@example.com")).toBeNull();
    expect(resolveBrowserLinkUrl("blob:https://example.com/uuid")).toBeNull();
    expect(resolveBrowserLinkUrl("not a url")).toBeNull();
    expect(resolveBrowserLinkUrl("")).toBeNull();
    expect(resolveBrowserLinkUrl(undefined)).toBeNull();
    expect(resolveBrowserLinkUrl(42)).toBeNull();
  });
});

describe("showBrowserLinkContextMenu", () => {
  it("opens the link in a new tab and focuses it when chosen", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));

    await showBrowserLinkContextMenu({
      url: "http://localhost:3000/next",
      threadRef,
      openPreview,
      localApi: localApiShowing("open-link-in-new-tab"),
    });

    expect(openPreview).toHaveBeenCalledExactlyOnceWith({
      environmentId: "local",
      input: { threadId: "thread-1", url: "http://localhost:3000/next" },
    });
    expect(openBrowserMock).toHaveBeenCalledExactlyOnceWith(threadRef, "tab-2");
    expect(writeTextToClipboardMock).not.toHaveBeenCalled();
  });

  it("copies the link address when chosen and never opens a tab", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));

    await showBrowserLinkContextMenu({
      url: "https://example.com/a?b=c",
      threadRef,
      openPreview,
      localApi: localApiShowing("copy-link-address"),
    });

    expect(writeTextToClipboardMock).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/a?b=c",
      "link address",
    );
    expect(openPreview).not.toHaveBeenCalled();
    expect(openBrowserMock).not.toHaveBeenCalled();
  });

  it("does nothing when the menu is dismissed", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "https://example.com/",
      threadRef,
      openPreview,
      localApi: localApiShowing(null),
    });

    expect(openPreview).not.toHaveBeenCalled();
    expect(writeTextToClipboardMock).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("preserves menu failures with link context and stops", async () => {
    const cause = new Error("menu unavailable");
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "http://localhost:3000/path?token=secret",
      threadRef,
      openPreview,
      localApi: {
        contextMenu: {
          show: vi.fn(async () => {
            throw cause;
          }),
        },
      } as unknown as LocalApi,
    });

    expect(openPreview).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    const error = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BrowserLinkContextMenuShowError);
    expect(error).toMatchObject({
      environmentId: "local",
      threadId: "thread-1",
      targetOrigin: "http://localhost:3000",
      cause,
    });
    expect(error.targetOrigin).not.toContain("secret");
  });

  it("preserves the complete open failure cause without throwing", async () => {
    const cause = Cause.combine(Cause.fail(new Error("preview unavailable")), Cause.die("defect"));
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "http://127.0.0.1:5173/",
      threadRef,
      openPreview: async () => AsyncResult.failure(cause),
      localApi: localApiShowing("open-link-in-new-tab"),
    });

    expect(reportError).toHaveBeenCalledOnce();
    const error = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BrowserLinkOpenInNewTabError);
    expect(error).toMatchObject({
      environmentId: "local",
      threadId: "thread-1",
      targetOrigin: "http://127.0.0.1:5173",
      cause,
    });
  });

  it("does not report when opening the new tab is interrupted", async () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "http://localhost:5173/",
      threadRef,
      openPreview: async () => AsyncResult.failure(Cause.interrupt()),
      localApi: localApiShowing("open-link-in-new-tab"),
    });

    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports clipboard failures with link context", async () => {
    const cause = new Error("clipboard denied");
    writeTextToClipboardMock.mockRejectedValueOnce(cause);
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "https://example.com/",
      threadRef,
      openPreview: vi.fn(async () => AsyncResult.success(snapshot)),
      localApi: localApiShowing("copy-link-address"),
    });

    expect(reportError).toHaveBeenCalledOnce();
    const error = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BrowserLinkCopyError);
    expect(error).toMatchObject({ targetOrigin: "https://example.com", cause });
  });
});
