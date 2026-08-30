import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  readThreadPreviewState: vi.fn(),
}));

vi.mock("~/previewStateStore", () => ({
  applyPreviewServerSnapshot: vi.fn(),
  readThreadPreviewState: mocks.readThreadPreviewState,
  reconcilePreviewServerSessions: vi.fn(),
  updatePreviewServerSnapshot: vi.fn(),
}));

vi.mock("./previewBridge", () => ({
  previewBridge: {
    automation: {
      evaluate: vi.fn(),
      status: vi.fn(),
    },
  },
}));

import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";

import { PreviewAutomationTargetUnavailableError } from "./previewAutomationErrors";
import { navigateWithReadiness, waitForNavigationReadiness } from "./previewNavigationReadiness";

const threadRef = {
  environmentId: EnvironmentId.make("environment-2"),
  threadId: ThreadId.make("thread-1"),
};
const tabId = "tab_1";
const runtimeTabId = previewRuntimeTabId(threadRef, "epoch-1", tabId);

const previewState = (navStatus: { readonly _tag: string; readonly url?: string }) => ({
  serverEpoch: "epoch-1",
  sessions: {
    [tabId]: { tabId, navStatus },
  },
});

describe("waitForNavigationReadiness", () => {
  it("rejects a replaced runtime target even when readiness polling is disabled", async () => {
    const staleRuntimeTabId = previewRuntimeTabId(threadRef, "epoch-1", tabId);
    mocks.readThreadPreviewState.mockReturnValue({
      serverEpoch: "epoch-2",
      sessions: {
        [tabId]: { tabId },
      },
    });

    await expect(
      waitForNavigationReadiness(
        threadRef,
        "request-1",
        tabId,
        staleRuntimeTabId,
        "navigate",
        "none",
        100,
        "https://example.com/",
      ),
    ).rejects.toBeInstanceOf(PreviewAutomationTargetUnavailableError);
  });

  it("accepts a loaded requested page when navigation settles at the deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.readThreadPreviewState
        .mockReturnValueOnce(previewState({ _tag: "Loading", url: "https://example.com/" }))
        .mockReturnValue(previewState({ _tag: "Success", url: "https://example.com/" }));
      const { previewBridge } = await import("./previewBridge");
      vi.mocked(previewBridge!.automation.status).mockResolvedValue({
        available: true,
        visible: true,
        tabId,
        url: "https://example.com/",
        title: "Example",
        loading: false,
      });

      const completion = navigateWithReadiness(
        threadRef,
        "request-boundary",
        tabId,
        runtimeTabId,
        "navigate",
        "load",
        100,
        "https://example.com/",
        () => new Promise<void>(() => {}),
      );
      await vi.advanceTimersByTimeAsync(100);

      await expect(completion).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reuse a stale success for a request that never started", async () => {
    vi.useFakeTimers();
    try {
      const staleSuccess = previewState({ _tag: "Success", url: "https://example.com/" });
      mocks.readThreadPreviewState.mockReturnValue(staleSuccess);
      const { previewBridge } = await import("./previewBridge");
      vi.mocked(previewBridge!.automation.status).mockResolvedValue({
        available: true,
        visible: true,
        tabId,
        url: "https://example.com/",
        title: "Example",
        loading: false,
      });

      const completion = navigateWithReadiness(
        threadRef,
        "request-not-started",
        tabId,
        runtimeTabId,
        "navigate",
        "load",
        100,
        "https://example.com/",
        () => new Promise<void>(() => {}),
      );
      const assertion = expect(completion).rejects.toMatchObject({
        _tag: "PreviewAutomationNavigationTimeoutError",
      });
      await vi.advanceTimersByTimeAsync(100);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an incomplete load as a typed timeout at the deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.readThreadPreviewState.mockReturnValue(
        previewState({ _tag: "Loading", url: "https://example.com/" }),
      );
      const { previewBridge } = await import("./previewBridge");
      vi.mocked(previewBridge!.automation.status).mockResolvedValue({
        available: true,
        visible: true,
        tabId,
        url: "https://example.com/",
        title: "Example",
        loading: true,
      });

      const completion = navigateWithReadiness(
        threadRef,
        "request-incomplete",
        tabId,
        runtimeTabId,
        "navigate",
        "load",
        100,
        "https://example.com/",
        () => new Promise<void>(() => {}),
      );
      const assertion = expect(completion).rejects.toMatchObject({
        _tag: "PreviewAutomationNavigationTimeoutError",
        requestId: "request-incomplete",
      });
      await vi.advanceTimersByTimeAsync(100);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not accept a superseding page from URL-independent readiness", async () => {
    vi.useFakeTimers();
    try {
      mocks.readThreadPreviewState.mockReturnValue(
        previewState({ _tag: "Success", url: "https://other.example/" }),
      );
      const { previewBridge } = await import("./previewBridge");
      vi.mocked(previewBridge!.automation.status).mockResolvedValue({
        available: true,
        visible: true,
        tabId,
        url: "https://other.example/",
        title: "Other",
        loading: false,
      });

      const completion = navigateWithReadiness(
        threadRef,
        "request-superseded",
        tabId,
        runtimeTabId,
        "navigate",
        "load",
        100,
        "https://example.com/",
        () => new Promise<void>(() => {}),
      );
      const assertion = expect(completion).rejects.toMatchObject({
        _tag: "PreviewAutomationNavigationTimeoutError",
      });
      await vi.advanceTimersByTimeAsync(100);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a server-reported load failure", async () => {
    mocks.readThreadPreviewState.mockReturnValue({
      serverEpoch: "epoch-1",
      sessions: {
        [tabId]: {
          tabId,
          navStatus: {
            _tag: "LoadFailed",
            url: "https://example.com/",
            title: "",
            code: -105,
            description: "Name not resolved",
          },
        },
      },
    });

    await expect(
      navigateWithReadiness(
        threadRef,
        "request-failed",
        tabId,
        runtimeTabId,
        "navigate",
        "load",
        100,
        "https://example.com/",
        async () => undefined,
      ),
    ).rejects.toMatchObject({
      _tag: "PreviewAutomationOperationError",
      requestId: "request-failed",
    });
  });
});
