import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-08-29T00:00:00.000Z";
const threadId = ThreadId.make("thread-1");
const runningTurnId = TurnId.make("turn-running");

function makeReadModel(input: {
  readonly activeTurnId: TurnId | null;
  readonly latestTurn: OrchestrationThread["latestTurn"];
}): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [],
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-1"),
        title: "Remote turn",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: input.latestTurn,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [
          {
            id: MessageId.make("message-1"),
            role: "user",
            text: "Keep working",
            turnId: runningTurnId,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access",
          activeTurnId: input.activeTurnId,
          lastError: null,
          updatedAt: now,
        },
      },
    ],
    updatedAt: now,
  };
}

const runningTurn: OrchestrationThread["latestTurn"] = {
  turnId: runningTurnId,
  state: "running",
  requestedAt: now,
  startedAt: now,
  completedAt: null,
  assistantMessageId: null,
};

it.layer(NodeServices.layer)("turn interrupt decider", (it) => {
  it.effect("binds a missing turn id to the latest unsettled turn", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.interrupt",
          commandId: CommandId.make("interrupt-missing-turn"),
          threadId,
          createdAt: now,
        },
        readModel: makeReadModel({ activeTurnId: null, latestTurn: runningTurn }),
      });

      expect(Array.isArray(event)).toBe(false);
      expect(event).toMatchObject({
        type: "thread.turn-interrupt-requested",
        payload: { turnId: runningTurnId, targetSessionUpdatedAt: now },
      });
    }),
  );

  it.effect("replaces a stale requested turn id with the latest unsettled turn", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.interrupt",
          commandId: CommandId.make("interrupt-stale-turn"),
          threadId,
          turnId: TurnId.make("turn-stale"),
          createdAt: now,
        },
        readModel: makeReadModel({
          activeTurnId: TurnId.make("turn-stale"),
          latestTurn: runningTurn,
        }),
      });

      expect(Array.isArray(event)).toBe(false);
      expect(event).toMatchObject({
        type: "thread.turn-interrupt-requested",
        payload: { turnId: runningTurnId, targetSessionUpdatedAt: now },
      });
    }),
  );
});
