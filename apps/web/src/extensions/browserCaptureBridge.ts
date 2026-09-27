/**
 * Host bridge for `t3.browser/capture@1.1.0`. `installedController` invokes the
 * returned factory once per installed client, so each
 * `ClientHost.browserCapture` checks that installation's grants and lifetime.
 *
 * Capture runs where the engine renders: the desktop preview bridge
 * rasterizes the page, or runs the in-page picker and keeps its crop. The PNG
 * goes straight to the environment's attachment store; the plugin only ever
 * receives the pending attachment id as its artifactRef.
 *
 * A page capture is also saved in the desktop's preview artifact directory,
 * like the built-in browser's screenshots. The 1.1.0 artifact actions (copy
 * image, copy path, reveal) act on that file through the same desktop bridge
 * calls the built-in "Screenshot saved" toast uses. Each installation only
 * reaches the files its own captures saved on this client.
 */
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type DesktopPreviewBridge,
  type EnvironmentId,
  type PreviewAnnotationPayload,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  BROWSER_CAPTURE,
  BROWSER_CAPTURE_REQUIRED_GRANTS,
  BROWSER_CAPTURE_VERSION,
  type BrowserCaptureArtifact,
  type BrowserCaptureArtifactActionFailureReason,
  type BrowserCaptureArtifactActionRequest,
  type BrowserCaptureArtifactActionResult,
  type BrowserCaptureFailureReason,
  type BrowserCaptureHost,
  type BrowserCapturePickedElement,
  type BrowserCaptureResult,
} from "@t3tools/extension-sdk/catalogue";
import { validateContext } from "@t3tools/extension-sdk/contracts";

import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { uploadBrowserCapture } from "~/browser/browserCaptureArtifacts";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { revealInFileExplorerLabel } from "~/components/preview/fileExplorerLabel";
import { previewBridge } from "~/components/preview/previewBridge";
import { dataUrlToFile } from "~/lib/imageCompression";
import { readThreadPreviewState } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentShell } from "~/state/shell";
import { environmentThreadShells } from "~/state/threads";

export interface BrowserCaptureBinding {
  /** The installation's grant set — the authority every capture checks. */
  readonly grants: {
    readonly capabilities: readonly string[];
    readonly projectIds: readonly string[];
  };
  /** Aborting cancels any open picker the installation started. */
  readonly lifetime: AbortSignal;
}

/** Seams the tests substitute; production defaults hit the real stores. */
export interface BrowserCaptureBridgeDeps {
  readonly preview: () => Pick<
    DesktopPreviewBridge,
    | "capturePageImage"
    | "pickElement"
    | "cancelPickElement"
    | "revealArtifact"
    | "copyArtifactToClipboard"
  > | null;
  readonly writeClipboardText: (text: string) => Promise<void>;
  readonly platform: () => string;
  /** Thread → project, trusted only from a live shell (see the surface bridge). */
  readonly resolveThreadScope: (threadRef: ScopedThreadRef) => {
    readonly projectId: string | null;
    readonly authoritative: boolean;
  };
  readonly serverEpoch: (threadRef: ScopedThreadRef) => string | null;
  /**
   * Whether some slot on this client shows the runtime tab, so the engine has
   * its pixels. A claimed slot that is clipped away or occluded does not count.
   */
  readonly presented: (runtimeTabId: string) => boolean;
  readonly upload: (environmentId: EnvironmentId, png: Blob, name: string) => Promise<string>;
}

const PICKED_ELEMENTS_MAX = 16;
/** Saved page captures each installation can still act on; the oldest drops first. */
const SAVED_CAPTURES_MAX = 32;
const clamp = (value: string, max: number) => (value.length <= max ? value : value.slice(0, max));
const clampOrNull = (value: string | null | undefined, max: number) =>
  value ? clamp(value, max) : null;

const fail = (
  reason: BrowserCaptureFailureReason,
  detail: string,
  grant?: string,
): BrowserCaptureResult => ({
  ok: false,
  failure: { reason, detail, ...(grant === undefined ? {} : { grant }) },
});

function pickedElements(annotation: PreviewAnnotationPayload): BrowserCapturePickedElement[] {
  return annotation.elements.slice(0, PICKED_ELEMENTS_MAX).map(({ element }) => ({
    tagName: clamp(element.tagName, 64),
    selector: clampOrNull(element.selector, 1024),
    componentName: clampOrNull(element.componentName, 128),
    source: element.source?.fileName
      ? {
          fileName: clamp(element.source.fileName, 512),
          lineNumber: element.source.lineNumber,
          columnNumber: element.source.columnNumber,
        }
      : null,
  }));
}

const actionFail = (
  reason: BrowserCaptureArtifactActionFailureReason,
  detail: string,
  grant?: string,
): BrowserCaptureArtifactActionResult => ({
  ok: false,
  failure: { reason, detail, ...(grant === undefined ? {} : { grant }) },
});

const captureName = (target: string, millis: number) =>
  `browser-${target}-${millis.toString(36)}.png`;

export function createBrowserCaptureBridge(
  environmentId: string,
  overrides: Partial<BrowserCaptureBridgeDeps> = {},
): (binding: BrowserCaptureBinding) => BrowserCaptureHost {
  const deps: BrowserCaptureBridgeDeps = {
    preview: () => previewBridge,
    resolveThreadScope: (threadRef) => {
      const shell = appAtomRegistry.get(environmentShell.stateValueAtom(threadRef.environmentId));
      if (shell.status !== "live") return { projectId: null, authoritative: false };
      return {
        projectId:
          appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef))?.projectId ??
          null,
        authoritative: true,
      };
    },
    serverEpoch: (threadRef) => readThreadPreviewState(threadRef).serverEpoch,
    presented: (runtimeTabId) =>
      useBrowserSurfaceStore.getState().byTabId[runtimeTabId]?.visible === true,
    upload: uploadBrowserCapture,
    writeClipboardText: async (text) => {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(text);
    },
    platform: () => navigator.platform,
    ...overrides,
  };
  // One capture per runtime tab across every installation: the picker is modal
  // inside the page, and two rasterizations of one guest would race its compositor.
  const inFlight = new Set<string>();

  return (binding) => {
    const support = deps.preview()
      ? ({ supported: true } as const)
      : ({ supported: false, reason: "desktop-required" } as const);
    /**
     * artifactRef → the saved file and the project it was captured in, for
     * this installation's page captures only.
     */
    const saved = new Map<string, { readonly path: string; readonly projectId: string }>();

    /** Authorizes one artifact action and resolves the file it acts on. */
    const savedCapture = (
      request: BrowserCaptureArtifactActionRequest,
    ): { readonly path: string } | { readonly failure: BrowserCaptureArtifactActionResult } => {
      if (binding.lifetime.aborted)
        return {
          failure: actionFail(
            "host-unavailable",
            "the installation's client lifetime has already ended.",
          ),
        };
      for (const grant of BROWSER_CAPTURE_REQUIRED_GRANTS)
        if (!binding.grants.capabilities.includes(grant))
          return {
            failure: actionFail(
              "grant-denied",
              `${BROWSER_CAPTURE} requires the ${grant} installation grant.`,
              grant,
            ),
          };
      let resource;
      try {
        resource = validateContext(request.context).resource;
      } catch (error) {
        return {
          failure: actionFail(
            "scope-invalid",
            error instanceof Error ? error.message : "Invalid view context.",
          ),
        };
      }
      if (
        resource.environmentId !== environmentId ||
        !resource.projectId ||
        !binding.grants.projectIds.includes(resource.projectId)
      )
        return {
          failure: actionFail(
            "scope-invalid",
            `${BROWSER_CAPTURE} artifact actions require a context in this environment and a granted project.`,
          ),
        };
      if (!deps.preview())
        return {
          failure: actionFail(
            "desktop-required",
            "Saved captures live in the T3 Code desktop app; this client has none.",
          ),
        };
      const entry = typeof request.artifactRef === "string" && saved.get(request.artifactRef);
      // Another project's capture reads as unknown, even with both granted.
      if (!entry || entry.projectId !== resource.projectId)
        return {
          failure: actionFail(
            "artifact-not-found",
            "No page capture this installation saved in this project on this client has that artifactRef.",
          ),
        };
      return { path: entry.path };
    };

    /**
     * Desktop errors name the absolute artifact path, so the plugin gets only
     * `failedDetail`; the raw error stays in this client's console.
     */
    const runAction = async (
      request: BrowserCaptureArtifactActionRequest,
      failedDetail: string,
      action: (path: string) => Promise<void>,
    ): Promise<BrowserCaptureArtifactActionResult> => {
      const resolved = savedCapture(request);
      if ("failure" in resolved) return resolved.failure;
      try {
        await action(resolved.path);
        return { ok: true };
      } catch (error) {
        console.warn("Browser capture artifact action failed.", error);
        return actionFail("action-failed", failedDetail);
      }
    };

    return {
      id: BROWSER_CAPTURE,
      version: BROWSER_CAPTURE_VERSION,
      support,
      artifactActions: {
        copyImage: support,
        copyPath: support,
        reveal: support,
        revealLabel: revealInFileExplorerLabel(deps.platform()),
      },
      copyArtifactToClipboard: (request) =>
        runAction(request, "The saved screenshot could not be copied to the clipboard.", (path) =>
          deps.preview()!.copyArtifactToClipboard(path),
        ),
      copyArtifactPath: (request) =>
        runAction(
          request,
          "The saved screenshot's path could not be copied to the clipboard.",
          deps.writeClipboardText,
        ),
      revealArtifact: (request) =>
        runAction(request, "The saved screenshot could not be shown in the file manager.", (path) =>
          deps.preview()!.revealArtifact(path),
        ),
      async capture(request): Promise<BrowserCaptureResult> {
        if (binding.lifetime.aborted)
          return fail("host-unavailable", "the installation's client lifetime has already ended.");
        for (const grant of BROWSER_CAPTURE_REQUIRED_GRANTS)
          if (!binding.grants.capabilities.includes(grant))
            return fail(
              "grant-denied",
              `${BROWSER_CAPTURE} requires the ${grant} installation grant.`,
              grant,
            );
        let context;
        try {
          context = validateContext(request.context);
        } catch (error) {
          return fail(
            "scope-invalid",
            error instanceof Error ? error.message : "Invalid view context.",
          );
        }
        const resource = context.resource;
        if (resource.environmentId !== environmentId || !resource.threadId || !resource.projectId)
          return fail(
            "scope-invalid",
            `${BROWSER_CAPTURE} requires a thread-scoped context in this environment and a granted project.`,
          );
        const threadRef = {
          environmentId: resource.environmentId,
          threadId: resource.threadId,
        } as ScopedThreadRef;
        const threadScope = deps.resolveThreadScope(threadRef);
        if (!threadScope.authoritative)
          return fail(
            "host-unavailable",
            `${BROWSER_CAPTURE} cannot verify the thread's project until this environment's data is live; retry once synchronization completes.`,
          );
        if (
          threadScope.projectId === null ||
          threadScope.projectId !== resource.projectId ||
          !binding.grants.projectIds.includes(threadScope.projectId)
        )
          return fail(
            "scope-invalid",
            `${BROWSER_CAPTURE} requires a thread inside a granted project; the supplied project does not own this thread.`,
          );
        const tabId = request.session?.tabId;
        const serverEpoch = request.session?.serverEpoch;
        if (
          typeof tabId !== "string" ||
          !tabId ||
          tabId.length > 128 ||
          typeof serverEpoch !== "string" ||
          !serverEpoch ||
          serverEpoch.length > 128
        )
          return fail(
            "session-invalid",
            "session identity must come from t3.browser/sessions (tabId + serverEpoch).",
          );
        if (request.target !== "page" && request.target !== "element")
          return fail("session-invalid", 'target must be "page" or "element".');
        const syncedEpoch = deps.serverEpoch(threadRef);
        if (syncedEpoch !== null && syncedEpoch !== serverEpoch)
          return fail(
            "epoch-changed",
            "the synced server epoch has moved past this session's epoch; re-list sessions and capture again.",
          );
        const preview = deps.preview();
        if (!preview)
          return fail(
            "desktop-required",
            "This client has no browser engine; capture from the T3 Code desktop app.",
          );
        const runtimeTabId = previewRuntimeTabId(threadRef, serverEpoch, tabId);
        if (!deps.presented(runtimeTabId))
          return fail(
            "not-presented",
            "The session is not shown on this client; present it before capturing.",
          );
        if (request.signal?.aborted) return fail("cancelled", "The capture was cancelled.");
        if (inFlight.has(runtimeTabId))
          return fail("busy", "Another capture of this session is still running.");

        inFlight.add(runtimeTabId);
        const cancelPick = () => void preview.cancelPickElement(runtimeTabId).catch(() => {});
        const detach = () => {
          request.signal?.removeEventListener("abort", cancelPick);
          binding.lifetime.removeEventListener("abort", cancelPick);
        };
        try {
          let png: Blob;
          let savedPath: string | null = null;
          let partial: Omit<BrowserCaptureArtifact, "artifactRef" | "sizeBytes">;
          if (request.target === "page") {
            let image;
            try {
              image = await preview.capturePageImage(runtimeTabId);
            } catch (error) {
              return fail(
                "capture-failed",
                error instanceof Error ? error.message : "The page could not be captured.",
              );
            }
            // Rasterizing cannot be interrupted, but an abort that lands
            // meanwhile still cancels before anything is stored.
            if (request.signal?.aborted || binding.lifetime.aborted)
              return fail("cancelled", "The capture was cancelled.");
            png = new Blob([new Uint8Array(image.data)], { type: "image/png" });
            savedPath = image.path;
            partial = {
              mimeType: "image/png",
              width: image.width,
              height: image.height,
              target: "page",
              pageUrl: clampOrNull(image.pageUrl, 2048),
              pageTitle: clampOrNull(image.pageTitle, 512),
            };
          } else {
            request.signal?.addEventListener("abort", cancelPick, { once: true });
            binding.lifetime.addEventListener("abort", cancelPick, { once: true });
            let picked;
            try {
              picked = await preview.pickElement(runtimeTabId);
            } catch (error) {
              // Native treats a picker that throws as a dismissal: no image
              // was ever taken, so capture-failed stays reserved for a lost crop.
              return fail(
                "cancelled",
                error instanceof Error ? error.message : "The element picker closed.",
              );
            } finally {
              detach();
            }
            if (!picked || request.signal?.aborted || binding.lifetime.aborted)
              return fail("cancelled", "The element pick was dismissed.");
            const { annotation } = picked;
            const screenshot = annotation.screenshot;
            if (!screenshot || picked.screenshotFailed)
              return fail("capture-failed", "The picker kept no crop of the selection.");
            try {
              // Electron hands the crop to the renderer as a data URL; it is
              // decoded here and never leaves this client in that form.
              png = dataUrlToFile(screenshot.dataUrl, "crop.png", "image/png");
            } catch {
              return fail("capture-failed", "The picker's crop could not be decoded.");
            }
            partial = {
              mimeType: "image/png",
              width: Math.max(1, Math.round(screenshot.width)),
              height: Math.max(1, Math.round(screenshot.height)),
              target: "element",
              pageUrl: clampOrNull(annotation.pageUrl, 2048),
              pageTitle: clampOrNull(annotation.pageTitle, 512),
              comment: clamp(annotation.comment, 4000),
              elements: pickedElements(annotation),
            };
          }
          if (png.size === 0) return fail("capture-failed", "The capture is empty.");
          if (png.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)
            return fail("too-large", "The capture exceeds the image attachment limit.");
          let artifactRef: string;
          try {
            artifactRef = await deps.upload(
              threadRef.environmentId,
              png,
              captureName(request.target, Date.now()),
            );
          } catch (error) {
            return fail(
              "upload-failed",
              error instanceof Error ? error.message : "The capture could not be stored.",
            );
          }
          if (savedPath !== null) {
            saved.set(artifactRef, { path: savedPath, projectId: resource.projectId });
            for (const oldest of saved.keys()) {
              if (saved.size <= SAVED_CAPTURES_MAX) break;
              saved.delete(oldest);
            }
          }
          return {
            ok: true,
            artifact: {
              ...partial,
              artifactRef,
              sizeBytes: png.size,
              saved: savedPath !== null,
            },
          };
        } finally {
          detach();
          inFlight.delete(runtimeTabId);
        }
      },
    };
  };
}
