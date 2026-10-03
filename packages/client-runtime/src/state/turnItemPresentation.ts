import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

const WORKSPACE_PREPARATION_INPUT = "Preparing workspace";

/** Workspace setup is client bookkeeping; preparation failures have their own error item. */
export function turnItemIsWorkspacePreparation(item: OrchestrationV2TurnItem): boolean {
  return item.type === "command_execution" && item.input === WORKSPACE_PREPARATION_INPUT;
}

type ApprovalRequestItem = Extract<OrchestrationV2TurnItem, { readonly type: "approval_request" }>;

/** "Approved by plugin …" or "Declined by plugin …" when a plugin answered the approval, else undefined. */
export function approvalResolutionLabel(item: OrchestrationV2TurnItem): string | undefined {
  if (item.type !== "approval_request" || item.resolvedBy === undefined) return undefined;
  const verb = item.resolvedBy.decision === "accept" ? "Approved" : "Declined";
  return `${verb} by plugin ${item.resolvedBy.pluginName || item.resolvedBy.pluginId}`;
}

/** The approval's prompt, then the answering plugin's reason when it gave one. */
export function approvalRequestDetail(item: ApprovalRequestItem): string | undefined {
  const parts = [item.prompt, item.resolvedBy?.reason].filter(
    (part): part is string => part !== undefined && part.trim() !== "",
  );
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** The answering plugin and its reason as one line for inspectors, else undefined. */
export function approvalResolutionDetail(item: OrchestrationV2TurnItem): string | undefined {
  const label = approvalResolutionLabel(item);
  const reason = item.type === "approval_request" ? item.resolvedBy?.reason?.trim() : undefined;
  return label === undefined || !reason ? label : `${label}: ${reason}`;
}
