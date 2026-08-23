import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  THREAD_SUMMARY_MODEL,
  THREAD_SUMMARY_PROMPT_VERSION,
  ThreadSummaryTimeline,
} from "./threadSummary.ts";

const decodeThreadSummaryTimeline = Schema.decodeUnknownSync(ThreadSummaryTimeline);

describe("ThreadSummaryTimeline", () => {
  it("pins the generator model and prompt version on every entry", () => {
    const decoded = decodeThreadSummaryTimeline({
      entries: [
        {
          id: "thread:1-8:ASDSTE100",
          fromTurn: 1,
          toTurn: 8,
          fromCompletedAt: "2026-08-23T00:00:00.000Z",
          toCompletedAt: "2026-08-23T01:00:00.000Z",
          summary: "Implemented the requested slice.",
          promptVersion: "ASDSTE100",
          model: "gpt-5.6-luna",
        },
      ],
    });

    expect(decoded.entries[0]?.promptVersion).toBe(THREAD_SUMMARY_PROMPT_VERSION);
    expect(decoded.entries[0]?.model).toBe(THREAD_SUMMARY_MODEL);
  });
});
