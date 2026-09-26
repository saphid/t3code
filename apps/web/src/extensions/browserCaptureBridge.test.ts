import { describe, it, expect, vi } from "vite-plus/test";
import type {
  DesktopPreviewPageImage,
  PreviewAnnotationSubmissionResult,
} from "@t3tools/contracts";
import { BROWSER_CAPTURE, BROWSER_SESSIONS } from "@t3tools/extension-sdk/catalogue";

import {
  createBrowserCaptureBridge,
  type BrowserCaptureBinding,
  type BrowserCaptureBridgeDeps,
} from "./browserCaptureBridge";

const context = {
  client: "desktop",
  resource: {
    namespace: "test.plugin",
    id: "view",
    environmentId: "env-a",
    projectId: "project-a",
    threadId: "thread-a",
  },
};
const session = { tabId: "tab-1", serverEpoch: "epoch-1" };
const ARTIFACT_REF = "pending-0f1e2d3c-4b5a-4968-8776-655443322110";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
// "iVBORw0KGgoHBw==" is PNG above, as the picker's data URL carries it.
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoHBw==";

function pick(overrides: Partial<PreviewAnnotationSubmissionResult["annotation"]> = {}) {
  return {
    submission: "attach",
    annotation: {
      id: "annotation-1",
      pageUrl: "http://localhost:5173/settings",
      pageTitle: "Settings",
      comment: "make this blue",
      elements: [
        {
          id: "el-1",
          rect: { x: 0, y: 0, width: 10, height: 10 },
          element: {
            pageUrl: "http://localhost:5173/settings",
            pageTitle: "Settings",
            tagName: "button",
            selector: "#save",
            htmlPreview: "<button id=save>Save</button>",
            componentName: "SaveButton",
            source: {
              functionName: null,
              fileName: "src/Save.tsx",
              lineNumber: 12,
              columnNumber: 4,
            },
            stack: [],
            styles: "color: red",
            pickedAt: "2026-09-26T00:00:00.000Z",
          },
        },
      ],
      regions: [],
      strokes: [],
      styleChanges: [],
      screenshot: {
        dataUrl: PNG_DATA_URL,
        width: 120,
        height: 40,
        cropRect: { x: 0, y: 0, width: 120, height: 40 },
      },
      createdAt: "2026-09-26T00:00:00.000Z",
      ...overrides,
    },
  } satisfies PreviewAnnotationSubmissionResult;
}

function harness(overrides: Partial<BrowserCaptureBridgeDeps> = {}) {
  const uploads: { environmentId: string; bytes: Uint8Array; type: string; name: string }[] = [];
  const preview = {
    capturePageImage: vi.fn(async (): Promise<DesktopPreviewPageImage> => ({
      mimeType: "image/png",
      data: PNG,
      width: 1280,
      height: 800,
      pageUrl: "http://localhost:5173/",
      pageTitle: "Home",
    })),
    pickElement: vi.fn(async (): Promise<PreviewAnnotationSubmissionResult | null> => pick()),
    cancelPickElement: vi.fn(async () => {}),
  };
  const deps: Partial<BrowserCaptureBridgeDeps> = {
    preview: () => preview,
    resolveThreadScope: () => ({ projectId: "project-a", authoritative: true }),
    serverEpoch: () => "epoch-1",
    presented: () => true,
    upload: async (environmentId, png, name) => {
      uploads.push({
        environmentId,
        bytes: new Uint8Array(await png.arrayBuffer()),
        type: png.type,
        name,
      });
      return ARTIFACT_REF;
    },
    ...overrides,
  };
  const lifetime = new AbortController();
  const bind = createBrowserCaptureBridge("env-a", deps);
  const host = (grants: Partial<BrowserCaptureBinding["grants"]> = {}) =>
    bind({
      grants: {
        capabilities: [BROWSER_SESSIONS, BROWSER_CAPTURE],
        projectIds: ["project-a"],
        ...grants,
      },
      lifetime: lifetime.signal,
    });
  return { host, preview, uploads, lifetime };
}

describe("browser capture bridge", () => {
  it("captures the page into the store and hands back only an artifactRef", async () => {
    const h = harness();
    const result = await h.host().capture({ context, session, target: "page" });
    expect(result).toEqual({
      ok: true,
      artifact: {
        artifactRef: ARTIFACT_REF,
        mimeType: "image/png",
        sizeBytes: PNG.byteLength,
        width: 1280,
        height: 800,
        target: "page",
        pageUrl: "http://localhost:5173/",
        pageTitle: "Home",
      },
    });
    // The desktop tab id is the runtime identity, never the public tabId alone.
    expect(h.preview.capturePageImage).toHaveBeenCalledWith(
      JSON.stringify(["env-a", "thread-a", "epoch-1", "tab-1"]),
    );
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({ environmentId: "env-a", type: "image/png" });
    expect([...h.uploads[0]!.bytes]).toEqual([...PNG]);
    expect(JSON.stringify(result)).not.toMatch(/base64|iVBORw/);
  });

  it("keeps a picked element's crop and summary, but not its data URL", async () => {
    const h = harness();
    const result = await h.host().capture({ context, session, target: "element" });
    if (!result.ok) throw new Error(result.failure.detail);
    expect(result.artifact).toMatchObject({
      artifactRef: ARTIFACT_REF,
      target: "element",
      width: 120,
      height: 40,
      pageUrl: "http://localhost:5173/settings",
      comment: "make this blue",
      elements: [
        {
          tagName: "button",
          selector: "#save",
          componentName: "SaveButton",
          source: { fileName: "src/Save.tsx", lineNumber: 12, columnNumber: 4 },
        },
      ],
    });
    expect([...h.uploads[0]!.bytes]).toEqual([...PNG]);
    expect(JSON.stringify(result)).not.toMatch(/base64|iVBORw|htmlPreview/);
  });

  it("names the missing grant and never touches the engine", async () => {
    const h = harness();
    const result = await h
      .host({ capabilities: [BROWSER_SESSIONS] })
      .capture({ context, session, target: "page" });
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: "grant-denied", grant: BROWSER_CAPTURE },
    });
    expect(h.preview.capturePageImage).not.toHaveBeenCalled();
  });

  it("reports desktop-required, not-presented, and epoch-changed by name", async () => {
    const web = harness({ preview: () => null });
    expect(web.host().support).toEqual({ supported: false, reason: "desktop-required" });
    expect(await web.host().capture({ context, session, target: "page" })).toMatchObject({
      failure: { reason: "desktop-required" },
    });
    const hidden = harness({ presented: () => false });
    expect(await hidden.host().capture({ context, session, target: "page" })).toMatchObject({
      failure: { reason: "not-presented" },
    });
    const moved = harness({ serverEpoch: () => "epoch-2" });
    expect(await moved.host().capture({ context, session, target: "page" })).toMatchObject({
      failure: { reason: "epoch-changed" },
    });
    const foreign = harness();
    expect(
      await foreign
        .host({ projectIds: ["project-b"] })
        .capture({ context, session, target: "page" }),
    ).toMatchObject({ failure: { reason: "scope-invalid" } });
  });

  it("treats a dismissed or crop-less pick as named outcomes, never a fake image", async () => {
    const dismissed = harness();
    dismissed.preview.pickElement.mockResolvedValueOnce(null);
    expect(await dismissed.host().capture({ context, session, target: "element" })).toMatchObject({
      failure: { reason: "cancelled" },
    });
    const cropless = harness();
    cropless.preview.pickElement.mockResolvedValueOnce(pick({ screenshot: null }));
    expect(await cropless.host().capture({ context, session, target: "element" })).toMatchObject({
      failure: { reason: "capture-failed" },
    });
    expect(dismissed.uploads).toHaveLength(0);
    expect(cropless.uploads).toHaveLength(0);
  });

  it("cancels the open picker when the caller aborts", async () => {
    const h = harness();
    let resolvePick: (value: PreviewAnnotationSubmissionResult | null) => void = () => {};
    h.preview.pickElement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePick = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = h.host().capture({
      context,
      session,
      target: "element",
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    expect(h.preview.cancelPickElement).toHaveBeenCalledOnce();
    resolvePick(null);
    expect(await pending).toMatchObject({ failure: { reason: "cancelled" } });
  });

  it("refuses a second capture of the same session while one runs", async () => {
    const h = harness();
    let release: () => void = () => {};
    h.preview.capturePageImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              mimeType: "image/png",
              data: PNG,
              width: 1,
              height: 1,
              pageUrl: null,
              pageTitle: null,
            });
        }),
    );
    const first = h.host().capture({ context, session, target: "page" });
    await Promise.resolve();
    expect(await h.host().capture({ context, session, target: "page" })).toMatchObject({
      failure: { reason: "busy" },
    });
    release();
    expect(await first).toMatchObject({ ok: true });
  });

  it("maps engine and store failures to named reasons", async () => {
    const engine = harness();
    engine.preview.capturePageImage.mockRejectedValueOnce(new Error("UnknownVizError"));
    expect(await engine.host().capture({ context, session, target: "page" })).toMatchObject({
      failure: { reason: "capture-failed", detail: "UnknownVizError" },
    });
    const store = harness({
      upload: async () => {
        throw new Error("Capture upload rejected (413).");
      },
    });
    expect(await store.host().capture({ context, session, target: "page" })).toMatchObject({
      failure: { reason: "upload-failed", detail: "Capture upload rejected (413)." },
    });
  });
});
