import {
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  approvalRequestDetail,
  approvalResolutionLabel,
  turnItemIsWorkspacePreparation,
} from "./turnItemPresentation.ts";

function command(input: string): OrchestrationV2TurnItem {
  const now = DateTime.makeUnsafe("2026-08-03T00:00:00.000Z");
  return {
    id: TurnItemId.make("item-command"),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: "Workspace ready",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "command_execution",
    input,
    output: "Workspace preparation completed.",
    exitCode: 0,
  };
}

describe("turnItemIsWorkspacePreparation", () => {
  it("identifies the synthetic workspace preparation command", () => {
    expect(turnItemIsWorkspacePreparation(command("Preparing workspace"))).toBe(true);
    expect(turnItemIsWorkspacePreparation(command("prepare workspace"))).toBe(false);
  });
});

function approval(
  resolvedBy?: Extract<OrchestrationV2TurnItem, { type: "approval_request" }>["resolvedBy"],
): Extract<OrchestrationV2TurnItem, { type: "approval_request" }> {
  const now = DateTime.makeUnsafe("2026-10-04T00:00:00.000Z");
  return {
    id: TurnItemId.make("item-approval"),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 2,
    status: resolvedBy?.decision === "decline" ? "cancelled" : "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "approval_request",
    requestId: RuntimeRequestId.make("request-1"),
    requestKind: "command",
    prompt: "rm -rf build",
    ...(resolvedBy === undefined ? {} : { resolvedBy }),
  };
}

describe("approval resolution", () => {
  it("names the plugin that answered, and nothing for the user's answers", () => {
    const declined = approval({
      _tag: "plugin",
      pluginId: "acme.policy",
      pluginName: "Policy",
      decision: "decline",
      reason: "Deletes files.",
    });
    expect(approvalResolutionLabel(declined)).toBe("Declined by plugin Policy");
    expect(approvalRequestDetail(declined)).toBe("rm -rf build · Deletes files.");
    const approved = approval({
      _tag: "plugin",
      pluginId: "acme.policy",
      pluginName: "",
      decision: "accept",
    });
    expect(approvalResolutionLabel(approved)).toBe("Approved by plugin acme.policy");
    expect(approvalRequestDetail(approved)).toBe("rm -rf build");
    expect(approvalResolutionLabel(approval())).toBeUndefined();
    expect(approvalResolutionLabel(command("ls"))).toBeUndefined();
  });
});
