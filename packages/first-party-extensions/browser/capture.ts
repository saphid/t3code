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
  type BrowserCaptureTarget,
} from "@t3tools/extension-sdk/catalogue";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useState } from "react";

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

export interface CaptureToast {
  readonly severity: "success" | "error";
  readonly title: string;
  readonly body?: string;
}

/**
 * The toast native `PreviewView` raises for the same outcome, or null where
 * native stays silent. Titles are native's verbatim: a page capture toasts
 * "Screenshot saved" / "Unable to capture screenshot"; a pick toasts only when
 * it loses its image ("Could not capture the picked element"), and a picked
 * element landing in chat or a cancel is silent.
 */
export function captureOutcomeToast(
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
): CaptureToast | null {
  switch (outcome.kind) {
    case "cancelled":
      return null;
    case "failed":
      return {
        severity: "error",
        title:
          target === "page"
            ? "Unable to capture screenshot"
            : "Could not capture the picked element",
        body: outcome.message,
      };
    case "added": {
      if (target !== "page") return null;
      const body = captureOutcomeMessage(outcome);
      return { severity: "success", title: "Screenshot saved", ...(body ? { body } : {}) };
    }
  }
}

/**
 * Toasts the outcome through `t3.ui/notify` and resolves the status-line text
 * still owed: null once the toast landed, the inline message when there is no
 * toast for it or notify is unavailable (ungranted, provider-less, rejected).
 */
export async function reportCaptureOutcome(
  notifications: BoundApi<typeof uiNotificationsApi>,
  threadId: string,
  target: BrowserCaptureTarget,
  outcome: CaptureToChatOutcome,
  signal: AbortSignal,
): Promise<string | null> {
  const message = captureOutcomeMessage(outcome);
  const toast = captureOutcomeToast(target, outcome);
  if (toast === null) return message;
  try {
    await notifications.invoke("notify", { ...toast, threadId, anchor: "thread" }, signal);
    return null;
  } catch {
    return message;
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
    const context = session.context;
    void captureToChat(host, context, held, target, session.signal)
      .then((outcome) =>
        reportCaptureOutcome(
          bindApi(uiNotificationsApi, host, context),
          context.resource.threadId ?? "",
          target,
          outcome,
          AbortSignal.any([session.signal, AbortSignal.timeout(5_000)]),
        ),
      )
      .then((message) => {
        if (!session.signal.aborted) setState({ kind: "done", message });
      });
  };
  return { blockReason, state, capture };
}
