import { ApprovalRequestId, EventId } from "@t3tools/contracts";

export interface PendingRequestState {
  readonly pendingApprovalRequestIds: ReadonlyArray<ApprovalRequestId>;
  readonly resolvedApprovalRequestIds: ReadonlyArray<ApprovalRequestId>;
  readonly pendingUserInputRequestIds: ReadonlyArray<ApprovalRequestId>;
  readonly userInputRequestStates: ReadonlyArray<UserInputRequestState>;
}

export interface RequestActivity {
  readonly id?: string;
  readonly activityId?: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt?: string;
}

export interface UserInputRequestState {
  readonly requestId: ApprovalRequestId;
  readonly activityId: EventId;
  readonly state: "requested" | "resolved";
  readonly createdAt: string;
}

export function compareBinaryText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareRequestActivityOrder(
  left: { readonly createdAt: string; readonly activityId: string },
  right: { readonly createdAt: string; readonly activityId: string },
): number {
  return (
    compareBinaryText(left.createdAt, right.createdAt) ||
    compareBinaryText(left.activityId, right.activityId)
  );
}

export function extractActivityRequestId(payload: unknown): ApprovalRequestId | null {
  if (typeof payload !== "object" || payload === null) return null;
  const requestId = (payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : null;
}

function activityDetail(activity: RequestActivity): string | null {
  if (typeof activity.payload !== "object" || activity.payload === null) return null;
  const detail = (activity.payload as Record<string, unknown>).detail;
  return typeof detail === "string" ? detail.toLowerCase() : null;
}

export function closesStaleApproval(activity: RequestActivity): boolean {
  if (activity.kind !== "provider.approval.respond.failed") return false;
  const detail = activityDetail(activity);
  return (
    detail !== null &&
    (detail.includes("stale pending approval request") ||
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request"))
  );
}

export function closesStaleUserInput(activity: RequestActivity): boolean {
  if (activity.kind !== "provider.user-input.respond.failed") return false;
  const detail = activityDetail(activity);
  return (
    detail !== null &&
    (detail.includes("stale pending user-input request") ||
      detail.includes("unknown pending user-input request") ||
      detail.includes("unknown pending user input request") ||
      detail.includes("unknown pending codex user input request"))
  );
}

export function applyPendingRequestActivity(
  state: PendingRequestState,
  activity: RequestActivity,
  approvalRequestIdFallback?: unknown,
): PendingRequestState {
  const payloadRequestId = extractActivityRequestId(activity.payload);
  const requestId =
    payloadRequestId ??
    ((activity.kind === "approval.requested" ||
      activity.kind === "approval.resolved" ||
      activity.kind === "provider.approval.respond.failed") &&
    typeof approvalRequestIdFallback === "string"
      ? ApprovalRequestId.make(approvalRequestIdFallback)
      : null);
  if (requestId === null) return state;

  const pendingApprovalRequestIds = new Set(state.pendingApprovalRequestIds);
  const resolvedApprovalRequestIds = new Set(state.resolvedApprovalRequestIds);
  let userInputRequestStates = [...state.userInputRequestStates];

  if (activity.kind === "approval.requested") {
    if (!resolvedApprovalRequestIds.has(requestId)) pendingApprovalRequestIds.add(requestId);
  } else if (activity.kind === "approval.resolved") {
    pendingApprovalRequestIds.delete(requestId);
    resolvedApprovalRequestIds.add(requestId);
  } else if (closesStaleApproval(activity) && pendingApprovalRequestIds.delete(requestId)) {
    resolvedApprovalRequestIds.add(requestId);
  } else {
    const nextUserInputState: UserInputRequestState["state"] | null =
      activity.kind === "user-input.requested"
        ? "requested"
        : activity.kind === "user-input.resolved" || closesStaleUserInput(activity)
          ? "resolved"
          : null;
    const rawActivityId = activity.id ?? activity.activityId;
    if (
      nextUserInputState !== null &&
      rawActivityId !== undefined &&
      activity.createdAt !== undefined
    ) {
      const activityId = EventId.make(rawActivityId);
      const existing = userInputRequestStates.find((entry) => entry.requestId === requestId);
      const isLater =
        existing === undefined ||
        activity.createdAt > existing.createdAt ||
        (activity.createdAt === existing.createdAt &&
          compareBinaryText(activityId, existing.activityId) >= 0);
      if (isLater) {
        userInputRequestStates = [
          ...userInputRequestStates.filter((entry) => entry.requestId !== requestId),
          {
            requestId,
            activityId,
            state: nextUserInputState,
            createdAt: activity.createdAt,
          },
        ].toSorted(compareRequestActivityOrder);
      }
    }
  }

  const pendingUserInputRequestIds = userInputRequestStates
    .filter((entry) => entry.state === "requested")
    .map((entry) => entry.requestId);

  return {
    pendingApprovalRequestIds: [...pendingApprovalRequestIds],
    resolvedApprovalRequestIds: [...resolvedApprovalRequestIds],
    pendingUserInputRequestIds,
    userInputRequestStates,
  };
}

export function derivePendingRequestState(
  activities: ReadonlyArray<RequestActivity>,
  initial: PendingRequestState = {
    pendingApprovalRequestIds: [],
    resolvedApprovalRequestIds: [],
    pendingUserInputRequestIds: [],
    userInputRequestStates: [],
  },
): PendingRequestState {
  return activities.reduce(
    (state, activity) => applyPendingRequestActivity(state, activity),
    initial,
  );
}
