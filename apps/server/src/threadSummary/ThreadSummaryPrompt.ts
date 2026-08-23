import * as Schema from "effect/Schema";

import { THREAD_SUMMARY_PROMPT_VERSION } from "@t3tools/contracts";

export const ThreadSummaryOutput = Schema.Struct({
  summary: Schema.String,
});

/**
 * Issue #90 supplied the ASDSTE100 identifier but no external prompt body.
 * This checked-in definition is therefore the canonical ASDSTE100 prompt.
 */
export function buildThreadSummaryPrompt(transcript: string): {
  readonly prompt: string;
  readonly outputSchema: typeof ThreadSummaryOutput;
} {
  return {
    prompt: `Prompt version: ${THREAD_SUMMARY_PROMPT_VERSION}

Summarize the supplied completed coding-agent turns as one concise timeline entry.
- State the user's goal, the material work completed, important decisions, and unresolved blockers.
- Preserve technical names that another agent needs to continue the work.
- Do not invent results, completion claims, dates, or actions.
- Do not address the user and do not emit chat messages, tool calls, or markdown headings.
- Return only the requested structured object.

Completed turns:
${transcript}`,
    outputSchema: ThreadSummaryOutput,
  };
}
