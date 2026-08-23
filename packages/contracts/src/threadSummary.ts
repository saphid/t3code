import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const THREAD_SUMMARY_PROMPT_VERSION = "ASDSTE100" as const;
export const THREAD_SUMMARY_MODEL = "gpt-5.6-luna" as const;

export const ThreadSummaryTimelineInput = Schema.Struct({
  threadId: ThreadId,
});
export type ThreadSummaryTimelineInput = typeof ThreadSummaryTimelineInput.Type;

export const ThreadSummaryTimelineEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  fromTurn: Schema.Int,
  toTurn: Schema.Int,
  fromCompletedAt: TrimmedNonEmptyString,
  toCompletedAt: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  promptVersion: Schema.Literal(THREAD_SUMMARY_PROMPT_VERSION),
  model: Schema.Literal(THREAD_SUMMARY_MODEL),
});
export type ThreadSummaryTimelineEntry = typeof ThreadSummaryTimelineEntry.Type;

export const ThreadSummaryTimeline = Schema.Struct({
  entries: Schema.Array(ThreadSummaryTimelineEntry),
});
export type ThreadSummaryTimeline = typeof ThreadSummaryTimeline.Type;

export class ThreadSummaryError extends Schema.TaggedErrorClass<ThreadSummaryError>()(
  "ThreadSummaryError",
  {
    threadId: ThreadId,
    message: TrimmedNonEmptyString,
  },
) {}
