import {
  THREAD_SUMMARY_MODEL,
  THREAD_SUMMARY_PROMPT_VERSION,
  type ThreadId,
  ThreadSummaryError,
  type ThreadSummaryTimeline,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";

const INCREMENTAL_BATCH_SIZE = 8;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TRANSCRIPT_CHARS = 120_000;
const isThreadSummaryError = Schema.is(ThreadSummaryError);

export function resolveThreadSummaryBatchSizes(
  completedTurns: number,
  coveredTurns: number,
): ReadonlyArray<number> {
  if (completedTurns <= coveredTurns) return [];
  if (coveredTurns === 0) return [completedTurns];
  return Array.from(
    { length: Math.floor((completedTurns - coveredTurns) / INCREMENTAL_BATCH_SIZE) },
    () => INCREMENTAL_BATCH_SIZE,
  );
}

interface CompletedTurnRow {
  readonly turn_id: string;
  readonly completed_at: string;
  readonly user_text: string | null;
  readonly assistant_text: string | null;
}

interface ThreadWorkspaceRow {
  readonly cwd: string;
}

interface StoredEntryRow {
  readonly entry_id: string;
  readonly from_turn: number;
  readonly to_turn: number;
  readonly from_completed_at: string;
  readonly to_completed_at: string;
  readonly summary: string;
  readonly prompt_version: typeof THREAD_SUMMARY_PROMPT_VERSION;
  readonly model: typeof THREAD_SUMMARY_MODEL;
}

function clip(text: string | null, maxChars = MAX_MESSAGE_CHARS): string {
  const value = text?.trim() ?? "";
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  const marker = "\n[truncated]";
  if (maxChars <= marker.length) return "[truncated]".slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length)}${marker}`;
}

function transcriptFor(turns: ReadonlyArray<CompletedTurnRow>, offset: number): string {
  const headers = turns.map(
    (turn, index) => `Turn ${offset + index + 1} (completed ${turn.completed_at})\nUser:\n`,
  );
  const fixedChars =
    headers.reduce((total, header) => total + header.length, 0) +
    turns.length * "\nAssistant:\n".length +
    Math.max(0, turns.length - 1) * 2;
  const contentCharsPerTurn = Math.max(
    0,
    Math.floor((MAX_TRANSCRIPT_CHARS - fixedChars) / Math.max(1, turns.length)),
  );

  return turns
    .map((turn, index) => {
      const user = turn.user_text?.trim() ?? "";
      const assistant = turn.assistant_text?.trim() ?? "";
      const initialShare = Math.floor(contentCharsPerTurn / 2);
      const userBudget = Math.min(
        MAX_MESSAGE_CHARS,
        Math.max(initialShare, contentCharsPerTurn - assistant.length),
      );
      const assistantBudget = Math.min(
        MAX_MESSAGE_CHARS,
        Math.max(initialShare, contentCharsPerTurn - Math.min(user.length, userBudget)),
      );
      return `${headers[index]}${clip(user, userBudget)}\nAssistant:\n${clip(assistant, assistantBudget)}`;
    })
    .join("\n\n");
}

export interface ThreadSummaryServiceShape {
  readonly getTimeline: (
    threadId: ThreadId,
  ) => Effect.Effect<ThreadSummaryTimeline, ThreadSummaryError>;
  readonly appendDueBatches: (threadId: ThreadId) => Effect.Effect<void, ThreadSummaryError>;
  readonly invalidate: (threadId: ThreadId) => Effect.Effect<void, ThreadSummaryError>;
}

export class ThreadSummaryService extends Context.Reference<ThreadSummaryServiceShape>(
  "t3/threadSummary/ThreadSummaryService",
  {
    defaultValue: () => ({
      getTimeline: (threadId) =>
        Effect.fail(
          new ThreadSummaryError({
            threadId,
            message: "Thread summary timelines are unavailable in this runtime.",
          }),
        ),
      appendDueBatches: () => Effect.void,
      invalidate: () => Effect.void,
    }),
  },
) {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const lockRegistry = yield* Semaphore.make(1);
  const threadLocks = new Map<string, Semaphore.Semaphore>();

  const lockFor = (threadId: ThreadId) =>
    lockRegistry.withPermits(1)(
      Effect.suspend(() => {
        const existing = threadLocks.get(threadId);
        if (existing) return Effect.succeed(existing);
        return Semaphore.make(1).pipe(
          Effect.tap((created) =>
            Effect.sync(() => {
              threadLocks.set(threadId, created);
            }),
          ),
        );
      }),
    );

  const withThreadLock = <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.flatMap(lockFor(threadId), (lock) => lock.withPermits(1)(effect));

  const readEntries = (threadId: ThreadId) => sql<StoredEntryRow>`
    SELECT entry_id, from_turn, to_turn, from_completed_at, to_completed_at,
           summary, prompt_version, model
    FROM thread_summary_timeline_entries
    WHERE thread_id = ${threadId}
      AND prompt_version = ${THREAD_SUMMARY_PROMPT_VERSION}
    ORDER BY from_turn ASC
  `;

  const getTimeline = Effect.fn("ThreadSummaryService.getTimeline")(function* (threadId: ThreadId) {
    const program = Effect.gen(function* () {
      const turns = yield* sql<CompletedTurnRow>`
        SELECT t.turn_id, t.completed_at,
               user_message.text AS user_text,
               (
                 SELECT group_concat(ordered_assistant.text, char(10))
                 FROM (
                   SELECT assistant_message.text
                   FROM projection_thread_messages assistant_message
                   WHERE assistant_message.thread_id = t.thread_id
                     AND assistant_message.turn_id = t.turn_id
                     AND assistant_message.role = 'assistant'
                   ORDER BY assistant_message.created_at ASC, assistant_message.message_id ASC
                 ) ordered_assistant
               ) AS assistant_text
        FROM projection_turns t
        LEFT JOIN projection_thread_messages user_message
          ON user_message.message_id = t.pending_message_id
        WHERE t.thread_id = ${threadId}
          AND t.state = 'completed'
          AND t.turn_id IS NOT NULL
          AND t.completed_at IS NOT NULL
        ORDER BY t.requested_at ASC, t.row_id ASC
      `;

      let entries = yield* readEntries(threadId);
      if (turns.length === 0) return { entries: [] };

      let coveredTurns = entries.at(-1)?.to_turn ?? 0;
      const batchSizes = resolveThreadSummaryBatchSizes(turns.length, coveredTurns);
      if (batchSizes.length === 0) {
        return {
          entries: entries.map((entry) => ({
            id: entry.entry_id,
            fromTurn: entry.from_turn,
            toTurn: entry.to_turn,
            fromCompletedAt: entry.from_completed_at,
            toCompletedAt: entry.to_completed_at,
            summary: entry.summary,
            promptVersion: entry.prompt_version,
            model: entry.model,
          })),
        } satisfies ThreadSummaryTimeline;
      }

      const workspace = yield* sql<ThreadWorkspaceRow>`
        SELECT COALESCE(NULLIF(t.worktree_path, ''), p.workspace_root) AS cwd
        FROM projection_threads t
        JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.thread_id = ${threadId} AND t.deleted_at IS NULL
        LIMIT 1
      `;
      if (!workspace[0]) {
        return yield* new ThreadSummaryError({
          threadId,
          message: "The thread workspace is unavailable.",
        });
      }

      const availableInstances = yield* instances.listInstances;
      const codex = availableInstances.find(
        (instance) =>
          instance.enabled &&
          instance.driverKind === "codex" &&
          instance.textGeneration.generateThreadSummary !== undefined,
      );
      if (!codex || !codex.textGeneration.generateThreadSummary) {
        return yield* new ThreadSummaryError({
          threadId,
          message: "A configured Codex provider is required for Luna summaries.",
        });
      }

      for (const batchSize of batchSizes) {
        const selectedTurns = turns.slice(coveredTurns, coveredTurns + batchSize);
        const first = selectedTurns[0];
        const last = selectedTurns.at(-1);
        if (!first || !last) continue;
        const generated = yield* codex.textGeneration.generateThreadSummary({
          cwd: workspace[0].cwd,
          transcript: transcriptFor(selectedTurns, coveredTurns),
          modelSelection: {
            instanceId: codex.instanceId,
            model: THREAD_SUMMARY_MODEL,
            options: [{ id: "reasoningEffort", value: "low" }],
          },
        });
        const fromTurn = coveredTurns + 1;
        const toTurn = coveredTurns + batchSize;
        const generatedAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          INSERT OR IGNORE INTO thread_summary_timeline_entries (
            entry_id, thread_id, from_turn, to_turn, from_completed_at,
            to_completed_at, summary, prompt_version, model, generated_at
          ) VALUES (
            ${`${threadId}:${fromTurn}-${toTurn}:${THREAD_SUMMARY_PROMPT_VERSION}`},
            ${threadId}, ${fromTurn}, ${toTurn}, ${first.completed_at},
            ${last.completed_at}, ${generated.summary.trim()},
            ${THREAD_SUMMARY_PROMPT_VERSION}, ${THREAD_SUMMARY_MODEL}, ${generatedAt}
          )
        `;
        coveredTurns = toTurn;
      }

      entries = yield* readEntries(threadId);
      return {
        entries: entries.map((entry) => ({
          id: entry.entry_id,
          fromTurn: entry.from_turn,
          toTurn: entry.to_turn,
          fromCompletedAt: entry.from_completed_at,
          toCompletedAt: entry.to_completed_at,
          summary: entry.summary,
          promptVersion: entry.prompt_version,
          model: entry.model,
        })),
      } satisfies ThreadSummaryTimeline;
    });

    return yield* withThreadLock(
      threadId,
      program.pipe(
        Effect.catch((cause) =>
          isThreadSummaryError(cause)
            ? Effect.fail(cause)
            : Effect.fail(
                new ThreadSummaryError({
                  threadId,
                  message: `Unable to load the thread summary timeline: ${String(cause)}`,
                }),
              ),
        ),
      ),
    );
  });

  const appendDueBatches = Effect.fn("ThreadSummaryService.appendDueBatches")(function* (
    threadId: ThreadId,
  ) {
    const existing = yield* readEntries(threadId).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadSummaryError({
            threadId,
            message: `Unable to inspect the thread summary timeline: ${String(cause)}`,
          }),
      ),
    );
    if (existing.length === 0) return;
    yield* getTimeline(threadId);
  });

  const invalidate = Effect.fn("ThreadSummaryService.invalidate")(function* (threadId: ThreadId) {
    yield* withThreadLock(
      threadId,
      sql`
        DELETE FROM thread_summary_timeline_entries WHERE thread_id = ${threadId}
      `.pipe(
        Effect.mapError(
          (cause) =>
            new ThreadSummaryError({
              threadId,
              message: `Unable to invalidate the thread summary timeline: ${String(cause)}`,
            }),
        ),
      ),
    );
  });

  return { getTimeline, appendDueBatches, invalidate } satisfies ThreadSummaryServiceShape;
});

export const layer = Layer.effect(ThreadSummaryService, make);
