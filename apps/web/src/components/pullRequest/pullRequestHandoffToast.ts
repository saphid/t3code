import { toastManager } from "../ui/toast";

/** How a pull-request checkout handoff ended, as native's toast reports it. */
export type PullRequestHandoffOutcome =
  | { readonly kind: "thread-failed" }
  | { readonly kind: "checkout-failed"; readonly detail: string | null }
  | { readonly kind: "thread-move-failed"; readonly branch: string }
  /** Cancelled while a step was still running, so whether that step happened is unknown. */
  | { readonly kind: "stopped"; readonly stage: "thread" | "checkout" | "thread-move" }
  | {
      readonly kind: "ready";
      readonly mode: "worktree" | "local";
      /** Whether a task was written into the new thread's composer. */
      readonly withTask: boolean;
      readonly isOnPullRequestHead: boolean;
    };

/** A task written straight into the composer of a thread that is already open. */
export function showTaskAddedToComposerToast() {
  toastManager.add({
    type: "success",
    title: "Added to the composer",
    description: "The task is in the composer — read it over, then send.",
  });
}

/**
 * Native's checkout toast, shared by the pull-request panel and the extension handoff. Post it
 * before the thread opens: it is global, so it stays on screen when the new thread does, and it
 * carries no timeout of its own, since a loading toast never expires and an explicit one would
 * survive the update and pin the result on screen. Settle it once, with how the handoff ended.
 */
export function beginPullRequestCheckoutToast() {
  const toastId = toastManager.add({
    type: "loading",
    title: "Preparing the pull request checkout...",
  });
  return {
    settle: (outcome: PullRequestHandoffOutcome) =>
      toastManager.update(toastId, pullRequestHandoffToast(outcome)),
    /** For a handoff that stopped with nothing to report: no spinner is left behind. */
    close: () => toastManager.close(toastId),
  };
}

const STOPPED_STAGE = {
  thread: "opening a thread",
  checkout: "preparing the checkout",
  "thread-move": "moving the thread to the checkout",
} as const;

function pullRequestHandoffToast(outcome: PullRequestHandoffOutcome) {
  switch (outcome.kind) {
    case "thread-failed":
      return {
        type: "error",
        title: "Could not open a thread for the checkout",
        description: "Try again from the project, or open a thread first.",
      } as const;
    case "checkout-failed":
      // The server says what to do about it — that the branch is already checked out in the main
      // repository, say — and that sentence is the only way out of the failure.
      return {
        type: "error",
        title: "Could not prepare the pull request checkout",
        ...(outcome.detail ? { description: outcome.detail } : {}),
      } as const;
    case "thread-move-failed":
      return {
        type: "error",
        title: "Checked out, but the thread stayed where it was",
        description: `The checkout is ready on \`${outcome.branch}\`. Point a thread at it from the branch picker, then ask again.`,
      } as const;
    case "stopped":
      return {
        type: "warning",
        title: "Handoff stopped",
        description: `Stopped while ${STOPPED_STAGE[outcome.stage]}; it may still finish.`,
      } as const;
    case "ready":
      // The host could not confirm or apply the pull request's latest commits (unreadable head,
      // local work, divergence), so the thread may open behind the pull request. Said once, in
      // place of the success, because everything else about the handoff did happen.
      if (!outcome.isOnPullRequestHead)
        return {
          type: "warning",
          title: "Checked out, but the latest commits are unconfirmed",
          description:
            "The pull request's latest commits could not be confirmed or applied here, so this checkout may be behind the pull request.",
        } as const;
      if (outcome.withTask)
        return {
          type: "success",
          title: "Checkout ready",
          description: "The task is in the composer — read it over, then send.",
        } as const;
      return outcome.mode === "local"
        ? ({
            type: "success",
            title: "Checked out here",
            description:
              "This repository is on the pull request's branch, with a thread open on it.",
          } as const)
        : ({
            type: "success",
            title: "Checked out",
            description: "The pull request is in its own worktree, with a thread open on it.",
          } as const);
  }
}
