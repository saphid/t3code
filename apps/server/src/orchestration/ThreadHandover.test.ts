import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_TEXT_GENERATION_MODEL } from "@t3tools/contracts";

import { formatThreadForHandover, HANDOVER_MODEL_SELECTION } from "./ThreadHandover.ts";

describe("thread handover", () => {
  it("pins handover generation to Luna with high reasoning", () => {
    expect(HANDOVER_MODEL_SELECTION).toEqual({
      instanceId: "codex",
      model: DEFAULT_TEXT_GENERATION_MODEL,
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });

  it("formats thread metadata and both sides of the conversation", () => {
    const contents = formatThreadForHandover({
      title: "Continue the migration",
      branch: "feature/migrate",
      worktreePath: "/tmp/migrate",
      messages: [
        { role: "user", text: "Move the worker." },
        { role: "assistant", text: "The worker moved and tests passed." },
      ],
    } as unknown as Parameters<typeof formatThreadForHandover>[0]);

    expect(contents).toContain("Title: Continue the migration");
    expect(contents).toContain("Branch: feature/migrate");
    expect(contents).toContain("## User\n\nMove the worker.");
    expect(contents).toContain("## Assistant\n\nThe worker moved and tests passed.");
  });
});
