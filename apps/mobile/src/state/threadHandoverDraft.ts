import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

/**
 * Stable receipt for importing one source thread's handover into its project
 * draft. The receipt is persisted with the draft, so retries remain idempotent
 * after navigation, module reload, or an app restart.
 */
export function threadHandoverDraftImportId(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): string {
  return `handover:${JSON.stringify([environmentId, threadId])}`;
}
