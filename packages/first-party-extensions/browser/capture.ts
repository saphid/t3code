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
  uiNotificationsApi,
  type BrowserCaptureArtifact,
  type BrowserCaptureFailureReason,
  type BrowserCaptureResult,
  type BrowserCaptureTarget,
  type BrowserSurfaceLeaseState,
} from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useRef, useState } from "react";

import type { BoundApi } from "./uiContracts.ts";

export interface CaptureSessionRef {
  readonly tabId: string;
  readonly serverEpoch: string;
}

/** Whether this panel shows the held page, as native gates its capture buttons. */
export type CapturePageView = "shown" | "hidden" | "failed";

/**
 * Whether the page is on screen here. Only a lease the host composites and
 * whose slot last presented visible counts — an active lease stays active
 * while its slot is clipped away or occluded.
 */
export function capturePageView(
  lease: { readonly state: BrowserSurfaceLeaseState } | null,
  presentedVisible: boolean,
  navigation: string | undefined,
): CapturePageView {
  if (lease?.state.kind !== "active" || !lease.state.presentation.supported || !presentedVisible)
    return "hidden";
  return navigation === "failed" ? "failed" : "shown";
}

/** Why capture cannot run, or null when it can. */
export function captureUnavailableReason(
  host: Pick<ClientHost, "browserCapture">,
  held: CaptureSessionRef | null,
  threadId: string | undefined,
  page: CapturePageView = "shown",
): string | null {
  if (threadId === undefined) return "This panel has no thread, so there is no chat to add to.";
  if (!host.browserCapture) return "This host cannot capture browser sessions.";
  if (!host.browserCapture.support.supported)
    return "Capturing needs the T3 Code desktop app, where the page renders.";
  if (held === null) return "Open a page to capture it.";
  if (page === "hidden") return "The page is not shown here yet — capture once it renders.";
  if (page === "failed") return "Page didn't load — capture unavailable until the page renders.";
  return null;
}

/**
 * Where a failed run stopped: `request` before any image existed (the host
 * refused, or the picker or engine threw), `image` when the pixels were lost
 * (the engine or picker kept no image, or the store refused it), `insert`
 * when the stored image could not be added to the draft.
 */
export type CaptureFailureStage = "request" | "image" | "insert";

export type CaptureToChatOutcome =
  | {
      readonly kind: "added";
      readonly artifact: BrowserCaptureArtifact;
      readonly inserted: boolean;
    }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly stage: CaptureFailureStage; readonly message: string };

const IMAGE_LOST_REASONS: ReadonlySet<BrowserCaptureFailureReason> = new Set([
  "capture-failed",
  "too-large",
  "upload-failed",
]);

/**
 * One capture-then-insert run. Every failure comes back as a named message;
 * an abort of `signal` at any stage, even after the image is stored, is a
 * silent cancel.
 */
export async function captureToChat(
  host: Pick<ClientHost, "browserCapture" | "invokeApi">,
  context: ViewContext,
  held: CaptureSessionRef,
  target: BrowserCaptureTarget,
  signal: AbortSignal,
): Promise<CaptureToChatOutcome> {
  const threadId = context.resource.threadId;
  if (!host.browserCapture || threadId === undefined)
    return {
      kind: "failed",
      stage: "request",
      message: "This host cannot capture browser sessions.",
    };
  let captured: BrowserCaptureResult;
  try {
    captured = await host.browserCapture.capture({ context, session: held, target, signal });
  } catch (error) {
    if (signal.aborted) return { kind: "cancelled" };
    return {
      kind: "failed",
      stage: "request",
      message: `Capture failed: ${error instanceof Error ? error.message : "the host threw"}`,
    };
  }
  // Cancel wins over whatever the host settled with: an upload that fails or
  // succeeds after Cancel annotation is still a silent cancel.
  if (signal.aborted) return { kind: "cancelled" };
  if (!captured.ok) {
    if (captured.failure.reason === "cancelled") return { kind: "cancelled" };
    const grant = captured.failure.grant ? ` (missing grant: ${captured.failure.grant})` : "";
    return {
      kind: "failed",
      stage: IMAGE_LOST_REASONS.has(captured.failure.reason) ? "image" : "request",
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
    if (signal.aborted) return { kind: "cancelled" };
    return {
      kind: "failed",
      stage: "insert",
      message: `Captured, but it could not be added to chat: ${
        error instanceof Error ? error.message : "the composer refused it"
      }`,
    };
  }
}

/**
 * Native toasts a pick only when it loses its image. A pick the host refused
 * (grant-denied, busy, not-presented) has no native toast, so it stays on the
 * status line; a dismissed or throwing picker arrives as `cancelled`.
 */
function isInlineOnlyFailure(target: BrowserCaptureTarget, stage: CaptureFailureStage): boolean {
  return target === "element" && stage === "request";
}

/** Status line text for an outcome; null clears the line. */
export function captureOutcomeMessage(
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
): string | null {
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

/** Native toasts use the toast manager's default lifetime. */
export const CAPTURE_TOAST_DURATION_MS = 5_000;

export interface CaptureToast {
  readonly severity: "success" | "error";
  readonly title: string;
  readonly body?: string;
  readonly durationMs: number;
}

/**
 * The toast native `PreviewView` raises for the same outcome, or null where
 * native stays silent. Titles are native's verbatim: a page capture toasts
 * "Screenshot saved" / "Unable to capture screenshot"; a pick toasts only when
 * it loses its image ("Could not capture the picked element"). Native's
 * success toast also offers Copy image / Copy path / Reveal, which need an
 * artifact clipboard and reveal contract that `t3.browser/capture` lacks.
 */
export function captureOutcomeToast(
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
): CaptureToast | null {
  switch (outcome.kind) {
    case "cancelled":
      return null;
    case "failed":
      if (isInlineOnlyFailure(target, outcome.stage)) return null;
      return {
        severity: "error",
        title:
          target === "page"
            ? "Unable to capture screenshot"
            : "Could not capture the picked element",
        body: outcome.message,
        durationMs: CAPTURE_TOAST_DURATION_MS,
      };
    case "added":
      if (target !== "page") return null;
      return {
        severity: "success",
        title: "Screenshot saved",
        durationMs: CAPTURE_TOAST_DURATION_MS,
      };
  }
}

/** How long notify may take to acknowledge before delivery counts as unknown. */
export const NOTIFY_ACK_TIMEOUT_MS = 5_000;

export interface CaptureReport {
  /** Status line text owed now: the message when no toast carries it. */
  readonly inline: string | null;
  /**
   * Resolves the status line text owed once notify settles: the message only
   * when the toast definitely did not land (notify rejected before its ack
   * deadline — provider unavailable, grant denied). An ack timeout may follow
   * a toast already on screen, so it resolves null rather than report twice.
   */
  readonly fallback: Promise<string | null>;
}

/** Reports an outcome without waiting on notify; see `CaptureReport`. */
export function reportCaptureOutcome(
  notifications: BoundApi<typeof uiNotificationsApi>,
  threadId: string,
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
  signal: AbortSignal,
  ackTimeoutMs = NOTIFY_ACK_TIMEOUT_MS,
): CaptureReport {
  const message = captureOutcomeMessage(target, outcome);
  const toast = captureOutcomeToast(target, outcome);
  if (toast === null) return { inline: message, fallback: Promise.resolve(null) };
  const ack = AbortSignal.timeout(ackTimeoutMs);
  const fallback = Promise.resolve()
    .then(() =>
      notifications.invoke(
        "notify",
        { ...toast, threadId, anchor: "thread" },
        AbortSignal.any([signal, ack]),
      ),
    )
    .then(
      () => null,
      () => (signal.aborted || ack.aborted ? null : message),
    );
  return { inline: null, fallback };
}

export type BrowserCaptureState =
  | { readonly kind: "idle" }
  | { readonly kind: "capturing"; readonly target: BrowserCaptureTarget }
  | { readonly kind: "done"; readonly message: string | null };

/**
 * One button press end to end. The run announces itself (`onState`
 * capturing) before the host is asked, so the panel can drop stale faults.
 * Capture state releases as soon as the run
 * ends (`onState` done); the toast goes out after, and its fallback line
 * lands only while `isCurrent()` says no newer run has started. Aborting
 * `cancel` dismisses an open picker, which settles as a silent cancel.
 */
export async function runBrowserCapture(
  host: Pick<ClientHost, "browserCapture" | "invokeApi">,
  session: Pick<ViewSession, "context" | "signal">,
  held: CaptureSessionRef,
  target: BrowserCaptureTarget,
  isCurrent: () => boolean,
  onState: (state: BrowserCaptureState) => void,
  ackTimeoutMs = NOTIFY_ACK_TIMEOUT_MS,
  cancel?: AbortSignal,
): Promise<void> {
  const context = session.context;
  const signal = cancel ? AbortSignal.any([session.signal, cancel]) : session.signal;
  onState({ kind: "capturing", target });
  const outcome = await captureToChat(host, context, held, target, signal);
  if (session.signal.aborted) return;
  const report = reportCaptureOutcome(
    bindApi(uiNotificationsApi, host, context),
    context.resource.threadId ?? "",
    target,
    outcome,
    session.signal,
    ackTimeoutMs,
  );
  onState({ kind: "done", message: report.inline });
  const message = await report.fallback;
  if (message !== null && isCurrent() && !session.signal.aborted)
    onState({ kind: "done", message });
}

/**
 * The header buttons' state and action. Pressing pick again while its picker
 * is open cancels it, like native's "Cancel annotation"; any other click
 * while one runs is ignored. `onStart` fires as each run begins.
 */
export function useBrowserCapture(
  host: ClientHost,
  session: ViewSession,
  held: CaptureSessionRef | null,
  page: CapturePageView = "shown",
  onStart?: () => void,
): {
  readonly blockReason: string | null;
  readonly state: BrowserCaptureState;
  readonly picking: boolean;
  readonly capture: (target: BrowserCaptureTarget) => void;
} {
  const [state, setState] = useState<BrowserCaptureState>({ kind: "idle" });
  const latestRun = useRef(0);
  const cancelRun = useRef<AbortController | null>(null);
  // threadId is read per render: a project-scoped surface can switch threads.
  const blockReason = captureUnavailableReason(host, held, session.context.resource.threadId, page);
  const picking = state.kind === "capturing" && state.target === "element";
  const capture = (target: BrowserCaptureTarget) => {
    if (picking && target === "element") {
      cancelRun.current?.abort();
      return;
    }
    if (blockReason !== null || held === null || state.kind === "capturing") return;
    const run = ++latestRun.current;
    const cancel = new AbortController();
    cancelRun.current = cancel;
    void runBrowserCapture(
      host,
      session,
      held,
      target,
      () => run === latestRun.current,
      (next) => {
        if (next.kind === "capturing") onStart?.();
        setState(next);
      },
      NOTIFY_ACK_TIMEOUT_MS,
      cancel.signal,
    );
  };
  return { blockReason, state, picking, capture };
}
