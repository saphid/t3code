import { describe, expect, it, vi } from "vite-plus/test";
import type { DesktopPreviewRecordingArtifact } from "@t3tools/contracts";
import { createBrowserCaptureBridge, type BrowserCaptureBridgeDeps } from "./browserCaptureBridge";

const context = {
  client: "desktop",
  resource: {
    namespace: "test.browser",
    id: "view",
    environmentId: "env-a",
    projectId: "project-a",
    threadId: "thread-a",
  },
};
const session = { tabId: "tab-1", serverEpoch: "epoch-1" };
const runtimeTabId = JSON.stringify(["env-a", "thread-a", "epoch-1", "tab-1"]);
const artifactRef = "pending-0f1e2d3c-4b5a-4968-8776-655443322110";
const artifact: DesktopPreviewRecordingArtifact = {
  id: "recording-1",
  tabId: runtimeTabId,
  path: "/private/browser-artifacts/recording.webm",
  mimeType: "video/webm",
  sizeBytes: 12,
  createdAt: "2026-09-30T00:00:00.000Z",
};
const grants = [
  "t3.browser/sessions",
  "t3.browser/capture",
  "t3.browser/recording",
  "t3.browser/artifact-actions",
];

function harness(overrides: Partial<BrowserCaptureBridgeDeps> = {}, capabilities = grants) {
  let phase: "idle" | "starting" | "recording" | "stopping" = "idle";
  const listeners = new Set<() => void>();
  const publish = (next: typeof phase) => {
    phase = next;
    for (const listener of listeners) listener();
  };
  const preview = {
    capturePageImage: vi.fn(),
    pickElement: vi.fn(),
    cancelPickElement: vi.fn(),
    revealArtifact: vi.fn(async () => {}),
    copyArtifactToClipboard: vi.fn(async () => {}),
  };
  const recording = {
    start: vi.fn(async () => {
      publish("recording");
      return artifact.createdAt;
    }),
    stop: vi.fn(async () => {
      publish("idle");
      return artifact;
    }),
    stopForUpload: vi.fn(
      async (
        _tabId: string,
        upload: (saved: DesktopPreviewRecordingArtifact, blob: Blob) => Promise<string>,
      ) => {
        publish("stopping");
        publish("idle");
        const uploadedAttachmentId = await upload(
          artifact,
          new Blob([new Uint8Array(12)], { type: artifact.mimeType }),
        );
        return { ...artifact, uploadedAttachmentId };
      },
    ),
    find: vi.fn(() => (phase === "idle" ? null : runtimeTabId)),
    phase: vi.fn(() => phase),
    subscribe: vi.fn((callback: () => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }),
  };
  const uploadRecording = vi.fn(async () => artifactRef);
  const writeClipboardText = vi.fn(async () => {});
  const lifetime = new AbortController();
  const deps = {
    preview: () => preview,
    resolveThreadScope: () => ({ projectId: "project-a", authoritative: true }),
    serverEpoch: () => "epoch-1",
    presented: () => true,
    recording,
    uploadRecording,
    writeClipboardText,
    platform: () => "MacIntel",
    ...overrides,
  };
  const bind = createBrowserCaptureBridge("env-a", deps);
  const host = bind({
    grants: { capabilities, projectIds: ["project-a"] },
    lifetime: lifetime.signal,
  });
  return { host, bind, recording, uploadRecording, preview, writeClipboardText, lifetime, publish };
}

describe("browser recording capture", () => {
  it("starts the native scoped session, saves and uploads once, and exposes only an artifact ref", async () => {
    const fixture = harness();
    expect(await fixture.host.startRecording!({ context, session })).toEqual({
      ok: true,
      startedAt: artifact.createdAt,
    });
    expect(fixture.recording.start).toHaveBeenCalledWith(
      runtimeTabId,
      { environmentId: "env-a", threadId: "thread-a" },
      "tab-1",
    );
    const result = await fixture.host.stopRecording!({ context, session });
    expect(result).toEqual({
      ok: true,
      artifact: {
        artifactRef,
        mimeType: "video/webm",
        sizeBytes: 12,
        createdAt: artifact.createdAt,
        saved: true,
      },
    });
    expect(fixture.uploadRecording).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(artifact.path);
    expect(await fixture.host.revealArtifact!({ context, artifactRef })).toEqual({ ok: true });
    expect(await fixture.host.copyArtifactPath!({ context, artifactRef })).toEqual({ ok: true });
    expect(fixture.preview.revealArtifact).toHaveBeenCalledWith(artifact.path);
    expect(fixture.writeClipboardText).toHaveBeenCalledWith(artifact.path);
    expect(await fixture.host.copyArtifactToClipboard!({ context, artifactRef })).toMatchObject({
      ok: false,
      failure: { reason: "action-failed" },
    });
    expect(fixture.preview.copyArtifactToClipboard).not.toHaveBeenCalled();
  });

  it("denies recording without its own grant before touching native code", async () => {
    const fixture = harness(
      {},
      grants.filter((grant) => grant !== "t3.browser/recording"),
    );
    expect(await fixture.host.startRecording!({ context, session })).toMatchObject({
      ok: false,
      failure: { reason: "grant-denied", grant: "t3.browser/recording" },
    });
    expect(await fixture.host.stopRecording!({ context, session })).toMatchObject({
      ok: false,
      failure: { reason: "grant-denied" },
    });
    expect(fixture.recording.start).not.toHaveBeenCalled();
    expect(fixture.recording.stopForUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["desktop-required", { preview: () => null }],
    ["not-presented", { presented: () => false }],
    ["epoch-changed", { serverEpoch: () => "epoch-2" }],
    ["scope-invalid", { resolveThreadScope: () => ({ projectId: "other", authoritative: true }) }],
    ["host-unavailable", { resolveThreadScope: () => ({ projectId: null, authoritative: false }) }],
  ] as const)("refuses %s recording starts", async (reason, overrides) => {
    const fixture = harness(overrides);
    expect(await fixture.host.startRecording!({ context, session })).toMatchObject({
      ok: false,
      failure: { reason },
    });
    expect(fixture.recording.start).not.toHaveBeenCalled();
  });

  it("observes native recording phases and unsubscribes on client lifetime end", async () => {
    const fixture = harness();
    const states: unknown[] = [];
    fixture.host.subscribeRecording!({ context, session }, (state) => states.push(state));
    fixture.publish("starting");
    fixture.publish("recording");
    fixture.publish("stopping");
    fixture.publish("idle");
    expect(states).toEqual(
      ["idle", "starting", "recording", "stopping", "idle"].map((phase) => ({ ok: true, phase })),
    );
    fixture.lifetime.abort();
    fixture.publish("recording");
    expect(states).toHaveLength(5);
  });

  it("can stop after the page is hidden or its epoch changes", async () => {
    let shown = true;
    let epoch = "epoch-1";
    const fixture = harness({ presented: () => shown, serverEpoch: () => epoch });
    await fixture.host.startRecording!({ context, session });
    shown = false;
    epoch = "epoch-2";
    expect(await fixture.host.stopRecording!({ context, session })).toMatchObject({ ok: true });
    expect(fixture.recording.stopForUpload).toHaveBeenCalledWith(
      runtimeTabId,
      expect.any(Function),
    );
  });

  it("reports idle stops and cancels starts before native dispatch", async () => {
    const fixture = harness();
    expect(await fixture.host.stopRecording!({ context, session })).toEqual({
      ok: true,
      artifact: null,
    });
    expect(
      await fixture.host.startRecording!({ context, session, signal: AbortSignal.abort() }),
    ).toMatchObject({ ok: false, failure: { reason: "cancelled" } });
    expect(fixture.recording.start).not.toHaveBeenCalled();
  });

  it("stops the native recording when its installation is unloaded", async () => {
    const fixture = harness();
    await fixture.host.startRecording!({ context, session });
    fixture.lifetime.abort();
    expect(fixture.recording.stop).toHaveBeenCalledWith(runtimeTabId);
    expect(fixture.uploadRecording).not.toHaveBeenCalled();
  });

  it("does not let another installation act on a saved recording", async () => {
    const fixture = harness();
    await fixture.host.startRecording!({ context, session });
    await fixture.host.stopRecording!({ context, session });
    const other = fixture.bind({
      grants: { capabilities: grants, projectIds: ["project-a"] },
      lifetime: new AbortController().signal,
    });
    expect(await other.revealArtifact!({ context, artifactRef })).toMatchObject({
      ok: false,
      failure: { reason: "artifact-not-found" },
    });
  });

  it("sanitizes native failures rather than exposing local paths", async () => {
    const fixture = harness();
    fixture.recording.start.mockRejectedValue(new Error(artifact.path));
    const result = await fixture.host.startRecording!({ context, session });
    expect(result).toMatchObject({ ok: false, failure: { reason: "recording-failed" } });
    expect(JSON.stringify(result)).not.toContain(artifact.path);
  });

  it("reports failed transfers as upload failures without leaking the local artifact", async () => {
    const fixture = harness();
    await fixture.host.startRecording!({ context, session });
    fixture.uploadRecording.mockRejectedValue(new Error(artifact.path));
    const result = await fixture.host.stopRecording!({ context, session });
    expect(result).toMatchObject({ ok: false, failure: { reason: "upload-failed" } });
    expect(JSON.stringify(result)).not.toContain(artifact.path);
  });

  it("does not stop a new native recording after its own one already ended", async () => {
    const fixture = harness();
    await fixture.host.startRecording!({ context, session });
    fixture.publish("idle");
    fixture.publish("recording");
    fixture.lifetime.abort();
    expect(fixture.recording.stop).not.toHaveBeenCalled();
  });

  it("keeps recording upload independent of the artifact-actions grant", async () => {
    const fixture = harness(
      {},
      grants.filter((grant) => grant !== "t3.browser/artifact-actions"),
    );
    await fixture.host.startRecording!({ context, session });
    expect(await fixture.host.stopRecording!({ context, session })).toMatchObject({ ok: true });
    expect(await fixture.host.revealArtifact!({ context, artifactRef })).toMatchObject({
      ok: false,
      failure: { reason: "grant-denied", grant: "t3.browser/artifact-actions" },
    });
    expect(fixture.preview.revealArtifact).not.toHaveBeenCalled();
  });

  it("rejects unauthorized state subscriptions without observing native recordings", () => {
    const fixture = harness({}, ["t3.browser/sessions", "t3.browser/capture"]);
    const listener = vi.fn();
    fixture.host.subscribeRecording!({ context, session }, listener);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ reason: "grant-denied", grant: "t3.browser/recording" }),
      }),
    );
    expect(fixture.recording.subscribe).not.toHaveBeenCalled();
  });

  it("retains ownership of a new recording while an earlier recording finishes uploading", async () => {
    const fixture = harness();
    let completeUpload!: (value: string) => void;
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      uploadStarted = resolve;
    });
    fixture.uploadRecording.mockImplementation(() => {
      uploadStarted();
      return new Promise<string>((resolve) => {
        completeUpload = resolve;
      });
    });
    await fixture.host.startRecording!({ context, session });
    const stopped = fixture.host.stopRecording!({ context, session });
    await started;
    fixture.publish("idle");
    await fixture.host.startRecording!({ context, session });
    completeUpload(artifactRef);
    await stopped;
    fixture.publish("recording");
    fixture.lifetime.abort();
    expect(fixture.recording.stop).toHaveBeenCalledWith(runtimeTabId);
  });
});
