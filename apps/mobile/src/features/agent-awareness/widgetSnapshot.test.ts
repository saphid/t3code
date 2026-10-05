import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { connectedWidgetActivities, mergeWidgetActivities } from "./widgetSnapshot";

const environmentId = EnvironmentId.make("direct");
const projectId = ProjectId.make("project");
const now = "2026-09-06T12:00:00.000Z";
const timestamp = DateTime.makeUnsafe(now);
const thread: OrchestrationV2ThreadShell = {
  id: ThreadId.make("thread"),
  projectId,
  pullRequests: [],
  title: "Fix widget",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  providerInstanceId: ProviderInstanceId.make("codex"),
  activeProviderThreadId: null,
  lineage: {
    rootThreadId: ThreadId.make("thread"),
    parentThreadId: null,
    relationshipToParent: null,
  },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "mobile",
  latestRunId: null,
  activeRunId: null,
  status: "running",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: timestamp,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
};
function connected(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  status: EnvironmentShellState["status"] = "live",
) {
  return connectedWidgetActivities(
    new Map([
      [
        environmentId,
        {
          status,
          error: Option.none(),
          snapshot: Option.some({
            schemaVersion: 1,
            snapshotSequence: 1,
            archivedThreads: [],
            threads,
            projects: [
              {
                id: projectId,
                title: "T3",
                workspaceRoot: "/t3",
                repositoryIdentity: null,
                defaultModelSelection: null,
                scripts: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          }),
        },
      ],
    ]),
  );
}

describe("connected widget activity", () => {
  it("shows direct activity without a relay account, including approval and input transitions", () => {
    for (const [overrides, phase] of [
      [{}, "running"],
      [
        {
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("approval"),
            kind: "command",
            createdAt: timestamp,
          },
        },
        "waiting_for_approval",
      ],
      [
        {
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("input"),
            kind: "user_input",
            createdAt: timestamp,
          },
        },
        "waiting_for_input",
      ],
    ] as const) {
      expect(mergeWidgetActivities({}, connected([{ ...thread, ...overrides }]))).toMatchObject({
        activeCount: 1,
        activities: [{ threadTitle: "Fix widget", phase, deepLink: "/threads/direct/thread" }],
      });
    }
  });

  it("keeps failed direct activity visible without counting it as active", () => {
    const failed = {
      ...thread,
      status: "failed" as const,
    };
    expect(mergeWidgetActivities({}, connected([failed]))).toMatchObject({
      activeCount: 0,
      activities: [{ phase: "failed", status: "Agent failed", threadTitle: "Fix widget" }],
    });
    expect(mergeWidgetActivities({}, connected([{ ...failed, archivedAt: timestamp }]))).toEqual(
      {},
    );
  });

  it("clears completed, archived, and removed threads even when relay data still says running", () => {
    const relay = mergeWidgetActivities({}, connected([thread]));
    for (const threads of [
      [
        {
          ...thread,
          status: "completed" as const,
        },
      ],
      [{ ...thread, archivedAt: timestamp }],
      [],
    ]) {
      expect(mergeWidgetActivities(relay, connected(threads))).toEqual({});
    }
  });

  it("marks cached activity delayed and restores it on reconnect", () => {
    expect(mergeWidgetActivities({}, connected([thread], "cached"))).toMatchObject({
      activeCount: 0,
      activities: [{ phase: "stale", status: "Update delayed" }],
    });
    expect(mergeWidgetActivities({}, connected([thread]))).toMatchObject({
      activeCount: 1,
      activities: [{ phase: "running" }],
    });
    expect(mergeWidgetActivities({}, new Map())).toEqual({});
  });

  it("does not invent a combined count when relay rows are truncated", () => {
    const relay = mergeWidgetActivities({}, connected([thread]));
    const merged = mergeWidgetActivities({ ...relay, activeCount: 5 }, connected([thread]));
    expect(merged.activities).toHaveLength(1);
    expect(merged.activeCount).toBeNull();
  });

  it("preserves unknown activity when all five displayed relay rows are locally removed", () => {
    const row = mergeWidgetActivities({}, connected([thread])).activities![0]!;
    const relay = {
      activeCount: 6,
      updatedAt: now,
      activities: Array.from({ length: 5 }, (_, index) => ({
        ...row,
        threadId: `thread-${index}`,
      })),
    };
    expect(mergeWidgetActivities(relay, connected([]))).toMatchObject({
      activities: [],
      activeCount: null,
      updatedAt: now,
    });
    expect(mergeWidgetActivities({ ...relay, activeCount: 5 }, connected([]))).toEqual({});
  });

  it("deduplicates connected environments while retaining other relay environments", () => {
    const relay = mergeWidgetActivities({}, connected([thread]));
    const row = relay.activities![0]!;
    const merged = mergeWidgetActivities(
      { ...relay, activities: [row, { ...row, environmentId: "remote" }] },
      connected([
        {
          ...thread,
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("approval"),
            kind: "command",
            createdAt: timestamp,
          },
        },
      ]),
    );
    expect(merged.activeCount).toBe(2);
    expect(merged.activities).toEqual([
      { ...row, environmentId: "remote" },
      { ...row, phase: "waiting_for_approval", status: "Approval needed" },
    ]);
  });
});
