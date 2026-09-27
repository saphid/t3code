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
  type BrowserCaptureArtifactActionRequest,
  type BrowserCaptureFailureReason,
  type BrowserCaptureHost,
  type BrowserCaptureResult,
  type BrowserCaptureTarget,
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
    return {
      kind: "failed",
      stage: "request",
      message: "This host cannot capture browser sessions.",
    };
  let captured: BrowserCaptureResult;
  try {
    captured = await host.browserCapture.capture({ context, session: held, target, signal });
  } catch (error) {
    return {
      kind: "failed",
      stage: "request",
      message: `Capture failed: ${error instanceof Error ? error.message : "the host threw"}`,
    };
  }
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
 * Native treats a picker that throws as a silent cancel and speaks up only
 * when a pick loses its image; a page capture reports every failure.
 */
function isSilentFailure(target: BrowserCaptureTarget, stage: CaptureFailureStage): boolean {
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
      return isSilentFailure(target, outcome.stage) ? null : outcome.message;
    case "added": {
      const what = outcome.artifact.target === "page" ? "Page screenshot" : "Element capture";
      return outcome.inserted ? `${what} added to chat.` : `${what} is already in chat.`;
    }
  }
}

/** Native toasts use the toast manager's default lifetime. */
export const CAPTURE_TOAST_DURATION_MS = 5_000;
/** How long a copy action reads "Copied!", like native. */
export const CAPTURE_COPIED_FLASH_MS = 2_000;

export type CaptureToastActionId = "copy-image" | "copy-path" | "reveal";

export interface CaptureToastAction {
  readonly id: CaptureToastActionId;
  readonly label: string;
  readonly variant?: "primary";
  readonly keepOpen: true;
}

export interface CaptureToast {
  readonly severity: "success" | "error";
  readonly title: string;
  readonly body?: string;
  readonly durationMs: number;
  readonly actions?: readonly CaptureToastAction[];
}

/**
 * Native's "Screenshot saved" actions this host can run, in native's order:
 * outline Copy path and Reveal, then the primary Copy image. Every click keeps
 * the toast open. Empty on a 1.0.0 host or a client without saved captures.
 */
export function captureToastActions(
  capture: Pick<
    BrowserCaptureHost,
    "artifactActions" | "copyArtifactToClipboard" | "copyArtifactPath" | "revealArtifact"
  > | null,
): readonly CaptureToastAction[] {
  const support = capture?.artifactActions;
  if (!capture || !support) return [];
  const actions: CaptureToastAction[] = [];
  if (support.copyPath.supported && capture.copyArtifactPath)
    actions.push({ id: "copy-path", label: "Copy path", keepOpen: true });
  if (support.reveal.supported && capture.revealArtifact)
    actions.push({ id: "reveal", label: support.revealLabel, keepOpen: true });
  if (support.copyImage.supported && capture.copyArtifactToClipboard)
    actions.push({ id: "copy-image", label: "Copy image", variant: "primary", keepOpen: true });
  return actions;
}

/**
 * The toast native `PreviewView` raises for the same outcome, or null where
 * native stays silent. Titles are native's verbatim: a page capture toasts
 * "Screenshot saved" / "Unable to capture screenshot"; a pick toasts only when
 * it loses its image ("Could not capture the picked element"). `actions`
 * ride only on "Screenshot saved", as in native.
 */
export function captureOutcomeToast(
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
  actions: readonly CaptureToastAction[] = [],
): CaptureToast | null {
  switch (outcome.kind) {
    case "cancelled":
      return null;
    case "failed":
      if (isSilentFailure(target, outcome.stage)) return null;
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
        ...(actions.length > 0 ? { actions } : {}),
      };
  }
}

type Notifications = BoundApi<typeof uiNotificationsApi>;

/**
 * Runs one clicked action the way native's toast does: a copy that lands
 * reads "Copied!" for 2 s on a restored "Screenshot saved"; a copy that fails
 * turns the toast into the error native shows; reveal reports nothing.
 */
export async function runCaptureToastAction(
  notifications: Notifications,
  capture: Pick<
    BrowserCaptureHost,
    "copyArtifactToClipboard" | "copyArtifactPath" | "revealArtifact"
  >,
  request: BrowserCaptureArtifactActionRequest,
  notificationId: string,
  actionId: string,
  signal: AbortSignal,
): Promise<void> {
  if (actionId === "reveal") {
    await capture.revealArtifact?.(request);
    return;
  }
  const copy =
    actionId === "copy-image"
      ? { run: capture.copyArtifactToClipboard, failTitle: "Unable to copy screenshot" }
      : actionId === "copy-path"
        ? { run: capture.copyArtifactPath, failTitle: "Unable to copy screenshot path" }
        : null;
  if (!copy?.run) return;
  const result = await copy.run(request);
  if (signal.aborted) return;
  await notifications.invoke(
    "update",
    result.ok
      ? {
          notificationId,
          severity: "success",
          title: "Screenshot saved",
          body: "",
          flashAction: { actionId, label: "Copied!", durationMs: CAPTURE_COPIED_FLASH_MS },
        }
      : {
          notificationId,
          severity: "error",
          title: copy.failTitle,
          body: result.failure.detail,
        },
    signal,
  );
}

/**
 * Serves a "Screenshot saved" toast's clicks until it closes. Each click runs
 * on its own, so a slow copy never swallows the next one.
 */
export async function serveCaptureToastActions(
  notifications: Notifications,
  capture: Pick<
    BrowserCaptureHost,
    "copyArtifactToClipboard" | "copyArtifactPath" | "revealArtifact"
  >,
  request: BrowserCaptureArtifactActionRequest,
  notificationId: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    let outcome;
    try {
      outcome = await notifications.invoke("awaitAction", { notificationId }, signal);
    } catch {
      return;
    }
    if (!("actionId" in outcome)) return;
    void runCaptureToastAction(
      notifications,
      capture,
      request,
      notificationId,
      outcome.actionId,
      signal,
    ).catch(() => {});
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

/** Where the "Screenshot saved" actions run, when the host offers any. */
export interface CaptureToastActionHost {
  readonly capture: Pick<
    BrowserCaptureHost,
    "artifactActions" | "copyArtifactToClipboard" | "copyArtifactPath" | "revealArtifact"
  >;
  readonly context: ViewContext;
}

/**
 * Reports an outcome without waiting on notify; see `CaptureReport`. With
 * `actionHost`, a "Screenshot saved" toast carries native's actions and is
 * served until it closes. A host too old for them still gets the plain toast.
 */
export function reportCaptureOutcome(
  notifications: Notifications,
  threadId: string,
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
  signal: AbortSignal,
  ackTimeoutMs = NOTIFY_ACK_TIMEOUT_MS,
  actionHost: CaptureToastActionHost | null = null,
): CaptureReport {
  const message = captureOutcomeMessage(target, outcome);
  const toast = captureOutcomeToast(
    target,
    outcome,
    captureToastActions(actionHost?.capture ?? null),
  );
  if (toast === null) return { inline: message, fallback: Promise.resolve(null) };
  const ack = AbortSignal.timeout(ackTimeoutMs);
  const notify = (input: CaptureToast) =>
    notifications.invoke(
      "notify",
      { ...input, threadId, anchor: "thread" },
      AbortSignal.any([signal, ack]),
    );
  const { actions, ...plain } = toast;
  const fallback = Promise.resolve()
    .then(() =>
      actions === undefined
        ? notify(toast)
        : notify(toast).then(
            ({ notificationId }) => {
              if (actionHost !== null && outcome.kind === "added")
                void serveCaptureToastActions(
                  notifications,
                  actionHost.capture,
                  { context: actionHost.context, artifactRef: outcome.artifact.artifactRef },
                  notificationId,
                  signal,
                );
            },
            // A 1.0.0 host rejects keepOpen actions; native's toast without
            // them still beats a status line.
            (error: unknown) => {
              if (signal.aborted || ack.aborted) throw error;
              return notify(plain);
            },
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
 * One button press end to end. Capture state releases as soon as the run
 * ends (`onState` done); the toast goes out after, and its fallback line
 * lands only while `isCurrent()` says no newer run has started.
 */
export async function runBrowserCapture(
  host: Pick<ClientHost, "browserCapture" | "invokeApi">,
  session: Pick<ViewSession, "context" | "signal">,
  held: CaptureSessionRef,
  target: BrowserCaptureTarget,
  isCurrent: () => boolean,
  onState: (state: BrowserCaptureState) => void,
  ackTimeoutMs = NOTIFY_ACK_TIMEOUT_MS,
): Promise<void> {
  const context = session.context;
  const outcome = await captureToChat(host, context, held, target, session.signal);
  if (session.signal.aborted) return;
  const report = reportCaptureOutcome(
    // ^1.0.0 keeps the plain toast on hosts that predate keepOpen actions.
    bindApi(uiNotificationsApi, host, context, "^1.0.0"),
    context.resource.threadId ?? "",
    target,
    outcome,
    session.signal,
    ackTimeoutMs,
    host.browserCapture ? { capture: host.browserCapture, context } : null,
  );
  onState({ kind: "done", message: report.inline });
  const message = await report.fallback;
  if (message !== null && isCurrent() && !session.signal.aborted)
    onState({ kind: "done", message });
}

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
  const latestRun = useRef(0);
  // threadId is read per render: a project-scoped surface can switch threads.
  const blockReason = captureUnavailableReason(host, held, session.context.resource.threadId);
  const capture = (target: BrowserCaptureTarget) => {
    if (blockReason !== null || held === null || state.kind === "capturing") return;
    const run = ++latestRun.current;
    setState({ kind: "capturing", target });
    void runBrowserCapture(host, session, held, target, () => run === latestRun.current, setState);
  };
  return { blockReason, state, capture };
}
