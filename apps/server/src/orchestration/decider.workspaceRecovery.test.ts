import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-workspace-recovery");
const MESSAGE_ID = MessageId.make("message-workspace-recovery");

function readModel(worktreePath = "/repo/worktrees/removed"): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-workspace-recovery"),
        title: "Recovery",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-sol",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feature/recovery",
        worktreePath,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        deletedAt: null,
        messages: [
          {
            id: MESSAGE_ID,
            role: "user",
            text: "continue",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("removed-worktree recovery decider", (it) => {
  it.effect("turns a valid recovery command into a durable requested activity", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.workspace.recovery.request",
          commandId: CommandId.make("cmd-workspace-recovery"),
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          strategy: "main-project",
          expectedBranch: "feature/recovery",
          expectedWorktreePath: "/repo/worktrees/removed",
          createdAt: NOW,
        },
        readModel: readModel(),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.activity-appended");
      if (events[0]?.type === "thread.activity-appended") {
        expect(events[0].payload.activity.kind).toBe("thread.workspace.recovery.requested");
        expect(events[0].payload.activity.payload).toMatchObject({
          messageId: MESSAGE_ID,
          expectedBranch: "feature/recovery",
          expectedWorktreePath: "/repo/worktrees/removed",
        });
      }
    }),
  );

  it.effect("rejects a recovery command after another client changed the workspace", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "thread.workspace.recovery.request",
            commandId: CommandId.make("cmd-stale-workspace-recovery"),
            threadId: THREAD_ID,
            messageId: MESSAGE_ID,
            strategy: "main-project",
            expectedBranch: "feature/recovery",
            expectedWorktreePath: "/repo/worktrees/removed",
            createdAt: NOW,
          },
          readModel: readModel("/repo/worktrees/new-location"),
        }),
      );
      expect(exit._tag).toBe("Failure");
    }),
  );

  it.effect("keeps branch and worktree updates together when expectations are stale", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-stale-workspace-relocation"),
          threadId: THREAD_ID,
          branch: "feature/other",
          expectedBranch: "feature/recovery",
          worktreePath: "/repo/worktrees/other",
          expectedWorktreePath: "/repo/worktrees/removed",
        },
        readModel: readModel("/repo/worktrees/new-location"),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.meta-updated");
      if (events[0]?.type === "thread.meta-updated") {
        expect(events[0].payload.branch).toBe("feature/recovery");
        expect(events[0].payload.worktreePath).toBe("/repo/worktrees/new-location");
      }
    }),
  );
});
