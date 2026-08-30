import {
  type PreviewAutomationNavigateInput,
  type PreviewAutomationRequest,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { isCurrentPreviewRuntimeTab } from "~/browser/previewRuntimeTabId";
import { readThreadPreviewState } from "~/previewStateStore";

import { previewBridge } from "./previewBridge";
import {
  PreviewAutomationNavigationTimeoutError,
  PreviewAutomationOperationError,
  PreviewAutomationTargetUnavailableError,
} from "./previewAutomationErrors";

const sameNavigationUrl = (actual: string | null, expected: string): boolean => {
  if (actual === null) return false;
  try {
    return new URL(actual).href === new URL(expected).href;
  } catch {
    return actual === expected;
  }
};

const navigationFailure = (
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  operation: PreviewAutomationRequest["operation"],
  cause: unknown,
) =>
  new PreviewAutomationOperationError({
    requestId,
    operation,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    tabId,
    cause,
  });

async function navigationIsReady(
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  runtimeTabId: string,
  operation: PreviewAutomationRequest["operation"],
  readiness: Exclude<PreviewAutomationNavigateInput["readiness"], "none" | undefined>,
  expectedUrl: string | undefined,
  previousSnapshot: PreviewSessionSnapshot | undefined,
): Promise<boolean> {
  const state = assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, {
    operation,
    requestId,
  });
  const snapshot = state.sessions[tabId];
  const navStatus = snapshot?.navStatus;
  if (navStatus?._tag === "LoadFailed") {
    throw navigationFailure(threadRef, requestId, tabId, operation, navStatus);
  }
  if (
    previousSnapshot !== undefined &&
    (snapshot === previousSnapshot || navStatus?._tag !== "Success")
  )
    return false;
  const status = await previewBridge!.automation.status(runtimeTabId);
  if (
    !status.available ||
    (expectedUrl !== undefined && !sameNavigationUrl(status.url, expectedUrl))
  )
    return false;
  if (readiness === "load") return !status.loading;
  const readyState = await previewBridge!.automation.evaluate(runtimeTabId, {
    expression: "document.readyState",
  });
  return readyState === "interactive" || readyState === "complete";
}

export function assertPreviewRuntimeCurrent(
  threadRef: ScopedThreadRef,
  tabId: string,
  runtimeTabId: string,
  request: Pick<PreviewAutomationRequest, "operation" | "requestId">,
) {
  const state = readThreadPreviewState(threadRef);
  if (
    state.sessions[tabId] &&
    isCurrentPreviewRuntimeTab(threadRef, state.serverEpoch, tabId, runtimeTabId)
  ) {
    return state;
  }
  throw new PreviewAutomationTargetUnavailableError({
    requestId: request.requestId,
    operation: request.operation,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    tabId,
    bridgeAvailable: Boolean(previewBridge),
  });
}

export async function waitForNavigationReadiness(
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  runtimeTabId: string,
  operation: PreviewAutomationRequest["operation"],
  readiness: PreviewAutomationNavigateInput["readiness"],
  timeoutMs: number,
  expectedUrl?: string,
  previousSnapshot?: PreviewSessionSnapshot,
): Promise<void> {
  const targetReadiness = readiness ?? "load";
  if (!previewBridge) return;
  assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, { operation, requestId });
  if (targetReadiness === "none") return;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (
      await navigationIsReady(
        threadRef,
        requestId,
        tabId,
        runtimeTabId,
        operation,
        targetReadiness,
        expectedUrl,
        previousSnapshot,
      )
    )
      return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, Math.min(50, remainingMs)));
  }
  throw new PreviewAutomationNavigationTimeoutError({
    requestId,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    tabId,
    readiness: targetReadiness,
    timeoutMs,
  });
}

export async function navigateWithReadiness(
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  runtimeTabId: string,
  operation: PreviewAutomationRequest["operation"],
  readiness: PreviewAutomationNavigateInput["readiness"],
  timeoutMs: number,
  expectedUrl: string,
  navigate: () => Promise<void>,
): Promise<void> {
  if ((readiness ?? "load") === "none") {
    await navigate();
    assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, { operation, requestId });
    return;
  }
  const previousSnapshot = assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, {
    operation,
    requestId,
  }).sessions[tabId];
  const deadline = Date.now() + timeoutMs;
  const navigationOutcome: {
    current: "pending" | "succeeded" | "failed";
  } = { current: "pending" };
  let navigationFailureCause: unknown;
  const navigation = navigate().then(
    () => {
      navigationOutcome.current = "succeeded";
    },
    (cause: unknown) => {
      navigationOutcome.current = "failed";
      navigationFailureCause = cause;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    navigation,
    new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer !== undefined) globalThis.clearTimeout(timer);
  if (navigationOutcome.current === "failed") throw navigationFailureCause;

  const remainingMs = Math.max(0, deadline - Date.now());
  await waitForNavigationReadiness(
    threadRef,
    requestId,
    tabId,
    runtimeTabId,
    operation,
    readiness,
    remainingMs,
    expectedUrl,
    navigationOutcome.current === "pending" ? previousSnapshot : undefined,
  );
}
