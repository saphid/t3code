/**
 * Capture to chat. The header's capture buttons screenshot the held session
 * (`page`) or run the in-page element picker (`element`) through the host's
 * `t3.browser/capture` capability, then attach the stored image to this
 * thread's draft with `t3.composer/context` `insertImage`. Only the
 * artifactRef moves between the two; the image bytes stay in the
 * environment's attachment store.
 */
import {
  composerContextApi,
  type BrowserCaptureArtifact,
  type BrowserCaptureTarget,
} from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useState } from "react";

export interface CaptureSessionRef {
  readonly tabId: string;
  readonly serverEpoch: string;
}

/** Why capture cannot run, or null when it can. */
export function captureUnavailableReason(
  host: Pick<ClientHost, "browserCapture">,
  held: CaptureSessionRef | null,
  threadId: string | undefined,
): string | null {
  if (threadId === undefined) return "This panel has no thread, so there is no chat to add to.";
  if (!host.browserCapture) return "This host cannot capture browser sessions.";
  if (!host.browserCapture.support.supported)
    return "Capturing needs the T3 Code desktop app, where the page renders.";
  if (held === null) return "Open a page to capture it.";
  return null;
}

const PICK_UNAVAILABLE_REASON = "Page didn't load — pick unavailable until the page renders";

/**
 * The annotate button, worded as native's PreviewChromeRow. A failed page
 * disables it like native (an overlay covers the page, so nothing could be
 * picked) and its tooltip then gives the reason — the one disabled control
 * that stays hoverable.
 */
export function annotationControl(input: {
  readonly blockReason: string | null;
  readonly capturing: BrowserCaptureTarget | null;
  readonly pageFailed: boolean;
}): {
  readonly disabled: boolean;
  readonly picking: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly hoverWhileDisabled: boolean;
} {
  const picking = input.capturing === "element";
  const disabled = input.blockReason !== null || input.capturing !== null || input.pageFailed;
  return {
    disabled,
    picking,
    ariaLabel: picking ? "Cancel annotation" : "Annotate preview",
    tooltip:
      disabled && input.pageFailed
        ? PICK_UNAVAILABLE_REASON
        : picking
          ? "Cancel annotation (Esc)"
          : "Annotate elements, regions, and drawings",
    hoverWhileDisabled: input.pageFailed,
  };
}

export type CaptureToChatOutcome =
  | {
      readonly kind: "added";
      readonly artifact: BrowserCaptureArtifact;
      readonly inserted: boolean;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

/** One capture-then-insert run. Every failure comes back as a named message. */
export async function captureToChat(
  host: Pick<ClientHost, "browserCapture" | "invokeApi">,
  context: ViewContext,
  held: CaptureSessionRef,
  target: BrowserCaptureTarget,
  signal: AbortSignal,
): Promise<CaptureToChatOutcome> {
  const threadId = context.resource.threadId;
  if (!host.browserCapture || threadId === undefined)
    return { kind: "failed", message: "This host cannot capture browser sessions." };
  const captured = await host.browserCapture.capture({ context, session: held, target, signal });
  if (!captured.ok) {
    if (captured.failure.reason === "cancelled") return { kind: "cancelled" };
    const grant = captured.failure.grant ? ` (missing grant: ${captured.failure.grant})` : "";
    return {
      kind: "failed",
      message: `Capture failed — ${captured.failure.reason}${grant}: ${captured.failure.detail}`,
    };
  }
  try {
    const result = await bindApi(composerContextApi, host, context).invoke(
      "insertImage",
      { threadId, artifactRef: captured.artifact.artifactRef },
      signal,
    );
    return { kind: "added", artifact: captured.artifact, inserted: result.inserted };
  } catch (error) {
    return {
      kind: "failed",
      message: `Captured, but it could not be added to chat: ${
        error instanceof Error ? error.message : "the composer refused it"
      }`,
    };
  }
}

/** Status line text for an outcome; null clears the line. */
export function captureOutcomeMessage(outcome: CaptureToChatOutcome): string | null {
  switch (outcome.kind) {
    case "cancelled":
      return null;
    case "failed":
      return outcome.message;
    case "added": {
      const what = outcome.artifact.target === "page" ? "Page screenshot" : "Element capture";
      return outcome.inserted ? `${what} added to chat.` : `${what} is already in chat.`;
    }
  }
}

export type BrowserCaptureState =
  | { readonly kind: "idle" }
  | { readonly kind: "capturing"; readonly target: BrowserCaptureTarget }
  | { readonly kind: "done"; readonly message: string | null };

/** The header buttons' state and action. A click while one runs is ignored. */
export function useBrowserCapture(
  host: ClientHost,
  session: ViewSession,
  held: CaptureSessionRef | null,
): {
  readonly blockReason: string | null;
  readonly state: BrowserCaptureState;
  readonly capture: (target: BrowserCaptureTarget) => void;
} {
  const [state, setState] = useState<BrowserCaptureState>({ kind: "idle" });
  // threadId is read per render: a project-scoped surface can switch threads.
  const blockReason = captureUnavailableReason(host, held, session.context.resource.threadId);
  const capture = (target: BrowserCaptureTarget) => {
    if (blockReason !== null || held === null || state.kind === "capturing") return;
    setState({ kind: "capturing", target });
    void captureToChat(host, session.context, held, target, session.signal).then((outcome) => {
      if (!session.signal.aborted)
        setState({ kind: "done", message: captureOutcomeMessage(outcome) });
    });
  };
  return { blockReason, state, capture };
}
