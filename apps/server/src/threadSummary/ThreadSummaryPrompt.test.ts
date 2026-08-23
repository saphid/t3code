import { THREAD_SUMMARY_PROMPT_VERSION } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadSummaryPrompt } from "./ThreadSummaryPrompt.ts";

describe("ASDSTE100", () => {
  it("is a checked-in structured prompt that forbids conversation output", () => {
    const built = buildThreadSummaryPrompt("Turn 1\nUser: build it\nAssistant: done");

    expect(built.prompt).toContain(`Prompt version: ${THREAD_SUMMARY_PROMPT_VERSION}`);
    expect(built.prompt).toContain("do not emit chat messages");
    expect(built.outputSchema.fields).toHaveProperty("summary");
  });
});
