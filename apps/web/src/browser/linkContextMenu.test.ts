import type { LocalApi, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  BrowserLinkContextMenuError,
  resolveBrowserLinkUrl,
  showBrowserLinkContextMenu,
} from "./linkContextMenu";

const { openBrowserMock, recordVisitForThreadMock, writeTextToClipboardMock } = vi.hoisted(() => ({
  openBrowserMock: vi.fn(),
  recordVisitForThreadMock: vi.fn(),
  writeTextToClipboardMock: vi.fn(async () => true),
}));

vi.mock("~/browserHistoryStore", () => ({
  recordVisitForThread: recordVisitForThreadMock,
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

const position = { x: 120, y: 240 };

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-2",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-08-25T00:00:00.000Z",
};

const localApiMock = (choice: string | null) => {
  const show = vi.fn(async () => choice);
  const openExternal = vi.fn(async () => undefined);
  return {
    api: { contextMenu: { show }, shell: { openExternal } } as unknown as LocalApi,
    show,
    openExternal,
  };
};

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
  it("shows the app-wide link menu items at the click position", async () => {
    const { api, show } = localApiMock(null);

    await showBrowserLinkContextMenu({
      url: "https://example.com/",
      position,
      threadRef,
      openPreview: vi.fn(async () => AsyncResult.success(snapshot)),
      localApi: api,
    });

    expect(show).toHaveBeenCalledExactlyOnceWith(
      [
        { id: "open-in-preview", label: "Open in integrated browser" },
        { id: "open-external", label: "Open in system browser" },
        { id: "copy-link", label: "Copy Link" },
      ],
      position,
    );
  });

  it("opens the link in a new tab, records the visit, and focuses it", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const { api, openExternal } = localApiMock("open-in-preview");

    await showBrowserLinkContextMenu({
      url: "http://localhost:3000/next",
      position,
      threadRef,
      openPreview,
      localApi: api,
    });

    expect(openPreview).toHaveBeenCalledExactlyOnceWith({
      environmentId: "local",
      input: expect.objectContaining({
        threadId: "thread-1",
        url: "http://localhost:3000/next",
        // The configured browser default, so menu-opened tabs match tabs
        // opened from the + button.
        viewport: expect.anything(),
      }),
    });
    expect(recordVisitForThreadMock).toHaveBeenCalledExactlyOnceWith(
      threadRef,
      "http://localhost:3000/next",
    );
    expect(openBrowserMock).toHaveBeenCalledExactlyOnceWith(threadRef, "tab-2");
    expect(openExternal).not.toHaveBeenCalled();
    expect(writeTextToClipboardMock).not.toHaveBeenCalled();
  });

  it("opens the link in the system browser when chosen", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const { api, openExternal } = localApiMock("open-external");

    await showBrowserLinkContextMenu({
      url: "https://example.com/docs",
      position,
      threadRef,
      openPreview,
      localApi: api,
    });

    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://example.com/docs");
    expect(openPreview).not.toHaveBeenCalled();
    expect(writeTextToClipboardMock).not.toHaveBeenCalled();
  });

  it("copies the link when chosen and never opens a tab", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const { api, openExternal } = localApiMock("copy-link");

    await showBrowserLinkContextMenu({
      url: "https://example.com/a?b=c",
      position,
      threadRef,
      openPreview,
      localApi: api,
    });

    expect(writeTextToClipboardMock).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/a?b=c",
      "link",
    );
    expect(openPreview).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(openBrowserMock).not.toHaveBeenCalled();
  });

  it("does nothing when the menu is dismissed", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const { api, openExternal } = localApiMock(null);
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "https://example.com/",
      position,
      threadRef,
      openPreview,
      localApi: api,
    });

    expect(openPreview).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(writeTextToClipboardMock).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("preserves menu failures with link context and stops", async () => {
    const cause = new Error("menu unavailable");
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await showBrowserLinkContextMenu({
      url: "http://localhost:3000/path?token=secret",
      position,
      threadRef,
      openPreview,
      localApi: {
        contextMenu: {
          show: vi.fn(async () => {
            throw cause;
          }),
        },
        shell: { openExternal: vi.fn() },
      } as unknown as LocalApi,
    });

    expect(openPreview).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    const error = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BrowserLinkContextMenuError);
    expect(error).toMatchObject({
      operation: "show-link-context-menu",
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
    const { api } = localApiMock("open-in-preview");

    await showBrowserLinkContextMenu({
      url: "http://127.0.0.1:5173/",
      position,
      threadRef,
      openPreview: async () => AsyncResult.failure(cause),
      localApi: api,
    });

    expect(recordVisitForThreadMock).not.toHaveBeenCalled();
    expect(openBrowserMock).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    const error = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BrowserLinkContextMenuError);
    expect(error).toMatchObject({
      operation: "open-link-in-preview",
      targetOrigin: "http://127.0.0.1:5173",
      cause,
    });
  });

  it("does not report when opening the new tab is interrupted", async () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { api } = localApiMock("open-in-preview");

    await showBrowserLinkContextMenu({
      url: "http://localhost:5173/",
      position,
      threadRef,
      openPreview: async () => AsyncResult.failure(Cause.interrupt()),
      localApi: api,
    });

    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports clipboard failures with link context", async () => {
    const cause = new Error("clipboard denied");
    writeTextToClipboardMock.mockRejectedValueOnce(cause);
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { api } = localApiMock("copy-link");

    await showBrowserLinkContextMenu({
      url: "https://example.com/",
      position,
      threadRef,
      openPreview: vi.fn(async () => AsyncResult.success(snapshot)),
      localApi: api,
    });

    expect(reportError).toHaveBeenCalledOnce();
    const error = reportError.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(BrowserLinkContextMenuError);
    expect(error).toMatchObject({
      operation: "copy-link",
      targetOrigin: "https://example.com",
      cause,
    });
  });
});
