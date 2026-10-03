import {
  EventId,
  MessageId,
  PLUGIN_CONTEXT_TOOL_NAME,
  PLUGIN_ENRICH_LIMITS,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import {
  buildBoundedThreadStreamSnapshot,
  decideThreadResume,
  isThreadReplayRawPayloadSafe,
  threadReplayEncodedBytes,
  THREAD_RESUME_MAX_RAW_PAYLOAD_BYTES,
  THREAD_RESUME_MAX_REPLAY_ENCODED_BYTES,
  THREAD_RESUME_MAX_REPLAY_EVENTS,
} from "./ThreadStream.ts";
import { THREAD_HISTORY_PAGE_POLICY } from "./threadHistoryPaging.ts";
import { projectDomainEventForWire } from "./WireProjection.ts";

const NOW = DateTime.makeUnsafe("2026-09-08T00:00:00.000Z");
const THREAD_ID = ThreadId.make("thread-stream-test");
const LARGE_PROJECTABLE_OUTPUT_BYTES = 10 * 1_048_576;
const LARGE_PROJECTABLE_RAW_PAYLOAD_BYTES = 10_486_214;
// The first projected replay measured 821 bytes; leave room for small envelope additions.
const MAX_PROJECTED_DYNAMIC_REPLAY_BYTES = 2_048;

function timelineProjection(itemCount: number): OrchestrationV2ThreadProjection {
  return projectionOf(
    Array.from({ length: itemCount }, (_, index) => {
      const id = TurnItemId.make(`item-${index}`);
      return {
        id,
        type: "command_execution",
        threadId: THREAD_ID,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: index + 1,
        status: "completed",
        title: `Command ${index}`,
        input: `command-${index}`,
        output: `output-${index}`,
        exitCode: 0,
        startedAt: NOW,
        completedAt: NOW,
        updatedAt: NOW,
      } satisfies OrchestrationV2TurnItem;
    }),
  );
}

function projectionOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): OrchestrationV2ThreadProjection {
  const visibleTurnItems: OrchestrationV2ProjectedTurnItem[] = items.map((item, index) => ({
    position: index,
    visibility: "local",
    sourceThreadId: THREAD_ID,
    sourceItemId: item.id,
    item,
  }));
  return {
    thread: {
      id: THREAD_ID,
      projectId: "project-stream-test",
      title: "Thread stream test",
      providerInstanceId: "codex",
      modelSelection: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: THREAD_ID,
      },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
    },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: visibleTurnItems.map((row) => row.item),
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems,
    updatedAt: NOW,
  } as unknown as OrchestrationV2ThreadProjection;
}

describe("decideThreadResume", () => {
  it("replays when the gap is zero", () => {
    expect(
      decideThreadResume({
        afterSequence: 10,
        highWater: 10,
        replayEventCount: 0,
        replayEncodedBytes: 0,
      }),
    ).toEqual({ mode: "replay", afterSequence: 10, throughSequence: 10 });
  });

  it("replays when the event count is within the bound", () => {
    expect(
      decideThreadResume({
        afterSequence: 10,
        highWater: 20_000,
        replayEventCount: THREAD_RESUME_MAX_REPLAY_EVENTS,
        replayEncodedBytes: THREAD_RESUME_MAX_REPLAY_ENCODED_BYTES,
      }),
    ).toEqual({
      mode: "replay",
      afterSequence: 10,
      throughSequence: 20_000,
    });
  });

  it("falls back to a snapshot when the event count exceeds the bound", () => {
    expect(
      decideThreadResume({
        afterSequence: 10,
        highWater: 20_000,
        replayEventCount: THREAD_RESUME_MAX_REPLAY_EVENTS + 1,
        replayEncodedBytes: 1,
      }),
    ).toEqual({ mode: "snapshot" });
  });

  it("falls back to a snapshot when encoded replay bytes exceed the bound", () => {
    expect(
      decideThreadResume({
        afterSequence: 10,
        highWater: 11,
        replayEventCount: 1,
        replayEncodedBytes: THREAD_RESUME_MAX_REPLAY_ENCODED_BYTES + 1,
      }),
    ).toEqual({ mode: "snapshot" });
  });

  it("rejects pathological raw payloads before decoding them", () => {
    expect(isThreadReplayRawPayloadSafe(THREAD_RESUME_MAX_RAW_PAYLOAD_BYTES)).toBe(true);
    expect(isThreadReplayRawPayloadSafe(THREAD_RESUME_MAX_RAW_PAYLOAD_BYTES + 1)).toBe(false);

    // Raw safety and projected transport size are deliberately separate. A
    // tiny projected replay is transport-safe even when its raw source is not.
    expect(
      decideThreadResume({
        afterSequence: 9,
        highWater: 10,
        replayEventCount: 1,
        replayEncodedBytes: 1,
      }),
    ).toEqual({ mode: "replay", afterSequence: 9, throughSequence: 10 });
  });

  it("falls back to a snapshot when the client cursor is ahead of the store", () => {
    expect(
      decideThreadResume({
        afterSequence: 50,
        highWater: 40,
        replayEventCount: 0,
        replayEncodedBytes: 0,
      }),
    ).toEqual({ mode: "snapshot" });
  });

  it("counts UTF-8 bytes across projected stream items", () => {
    expect(threadReplayEncodedBytes([{ value: "a" }, { value: "🦊" }])).toBe(
      Buffer.byteLength('{"value":"a"}', "utf8") + Buffer.byteLength('{"value":"🦊"}', "utf8"),
    );
  });

  it("builds socket fallback snapshots with a bounded timeline and history cursor", () => {
    const snapshot = buildBoundedThreadStreamSnapshot({
      snapshotSequence: 44,
      projection: timelineProjection(80),
    });

    expect(snapshot.kind).toBe("snapshot");
    expect(snapshot.snapshotSequence).toBe(44);
    expect(snapshot.projection.visibleTurnItems).toHaveLength(75);
    expect(snapshot.projection.turnItems).toHaveLength(75);
    expect(snapshot.historyCursor).not.toBeNull();
    expect(snapshot.hasMoreHistory).toBe(true);
    expect(snapshot.latestLocalTurnOrdinal).toBe(80);
    expect(snapshot.payloadBudgetExceeded).toBe(false);
  });

  it("keeps ten turns of the most plugin context a run can keep to a third of the budget", () => {
    const itemBase = (id: string, ordinal: number) => ({
      id: TurnItemId.make(id),
      threadId: THREAD_ID,
      runId: RunId.make(`run-${ordinal}`),
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      startedAt: NOW,
      completedAt: NOW,
      updatedAt: NOW,
    });
    const record = (turn: number, index: number, output: unknown) =>
      ({
        ...itemBase(`run-${turn}:plugin-context:installation-${index}`, turn * 10 + index + 1),
        type: "dynamic_tool",
        status: "completed",
        title: `Added context from Plugin ${index}`,
        toolName: PLUGIN_CONTEXT_TOOL_NAME,
        toolSource: {
          key: `plugin:acme.plugin-${index}`,
          name: `Plugin ${index}`,
          kind: "integration",
        },
        input: {
          plugin: {
            id: `acme.plugin-${index}`,
            name: `Plugin ${index}`,
            installationId: `installation-${index}`,
            generation: 1,
          },
        },
        output,
      }) satisfies OrchestrationV2TurnItem;
    // The context the run keeps fills its budget; every other record carries
    // the longest reason. Four plugin records and the overflow record.
    const contextText = "x".repeat(PLUGIN_ENRICH_LIMITS.maxRunContextBytes - 64);
    const reason = { reason: "r".repeat(300) };
    const items = Array.from({ length: 10 }, (_, turn) => [
      {
        ...itemBase(`prompt-${turn}`, turn * 10),
        type: "user_message",
        status: "completed",
        title: null,
        createdBy: "user",
        creationSource: "web",
        inputIntent: "turn_start",
        messageId: MessageId.make(`prompt-${turn}`),
        text: `Prompt ${turn}`,
        attachments: [],
      } satisfies OrchestrationV2TurnItem,
      record(turn, 0, { context: [{ title: "Notes", text: contextText }] }),
      ...[1, 2, 3, 4].map((index) => record(turn, index, reason)),
    ]).flat();
    expect(
      Buffer.byteLength(JSON.stringify(items[1]!.type === "dynamic_tool" && items[1]!.output)),
    ).toBeLessThanOrEqual(PLUGIN_ENRICH_LIMITS.maxRunContextBytes);

    const snapshot = buildBoundedThreadStreamSnapshot({
      snapshotSequence: 1,
      projection: projectionOf(items),
    });

    // Every record travels whole, both copies, and the snapshot stays in budget.
    expect(snapshot.projection.visibleTurnItems).toHaveLength(items.length);
    expect(
      snapshot.projection.turnItems.filter(
        (item) => item.type === "dynamic_tool" && item.output !== undefined,
      ),
    ).toHaveLength(50);
    expect(snapshot.payloadBudgetExceeded).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(snapshot.projection))).toBeLessThan(
      THREAD_HISTORY_PAGE_POLICY.maxEncodedBytes / 3,
    );
  });

  it("rejects a 10 MiB raw replay even when its projected form fits the wire budget", () => {
    const item = {
      id: TurnItemId.make("large-dynamic-tool"),
      type: "dynamic_tool",
      threadId: THREAD_ID,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed",
      title: "Large result",
      toolName: "mcp__test__large_result",
      input: { query: "small" },
      output: { text: "x".repeat(LARGE_PROJECTABLE_OUTPUT_BYTES) },
      startedAt: NOW,
      completedAt: NOW,
      updatedAt: NOW,
    } satisfies OrchestrationV2TurnItem;
    const event = {
      id: EventId.make("large-dynamic-tool-event"),
      type: "turn-item.updated" as const,
      threadId: THREAD_ID,
      occurredAt: NOW,
      payload: item,
    };
    const rawReplay = [{ kind: "event" as const, sequence: 10, event }];
    const projectedReplay = [
      {
        kind: "event" as const,
        sequence: 10,
        event: projectDomainEventForWire(event),
      },
    ];

    const rawPayloadBytes = Buffer.byteLength(JSON.stringify(event.payload), "utf8");
    expect(rawPayloadBytes).toBe(LARGE_PROJECTABLE_RAW_PAYLOAD_BYTES);
    expect(rawPayloadBytes).toBeGreaterThan(THREAD_RESUME_MAX_RAW_PAYLOAD_BYTES);
    expect(isThreadReplayRawPayloadSafe(rawPayloadBytes)).toBe(false);
    expect(threadReplayEncodedBytes(rawReplay)).toBeGreaterThan(
      THREAD_RESUME_MAX_REPLAY_ENCODED_BYTES,
    );
    const projectedBytes = threadReplayEncodedBytes(projectedReplay);
    expect(projectedBytes).toBeLessThanOrEqual(MAX_PROJECTED_DYNAMIC_REPLAY_BYTES);
    expect(
      decideThreadResume({
        afterSequence: 9,
        highWater: 10,
        replayEventCount: projectedReplay.length,
        replayEncodedBytes: projectedBytes,
      }),
    ).toEqual({ mode: "replay", afterSequence: 9, throughSequence: 10 });
  });
});
