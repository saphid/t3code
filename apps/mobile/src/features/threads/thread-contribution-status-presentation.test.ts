import {
  type ContributionStatusEntry,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadContributionStatusChips } from "./thread-contribution-status-presentation";

const entry = (
  session: string,
  items: ContributionStatusEntry["items"],
  driver = "pi",
): ContributionStatusEntry => ({
  threadId: ThreadId.make("thread-1"),
  source: {
    kind: "provider-session",
    providerSessionId: ProviderSessionId.make(session),
    providerInstanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
  },
  items,
});

describe("threadContributionStatusChips", () => {
  it("shows nothing for a thread without statuses", () => {
    expect(threadContributionStatusChips([])).toEqual([]);
  });

  it("keys chips by source and item key, in the server's order", () => {
    const chips = threadContributionStatusChips([
      entry("session-a", [
        { key: "mode", text: "● plan" },
        { key: "tokens", text: "12k", tone: "warning", tooltip: "Context is filling up" },
      ]),
      entry("session-b", [{ key: "mode", text: "● plan" }], "codex"),
    ]);

    expect(chips.map((chip) => [chip.text, chip.leadsSource, chip.tone, chip.tooltip])).toEqual([
      ["● plan", true, "neutral", null],
      ["12k", false, "warning", "Context is filling up"],
      ["● plan", true, "neutral", null],
    ]);
    // The same item key under two sources must stay two distinct rows.
    expect(new Set(chips.map((chip) => chip.id)).size).toBe(3);
  });

  it("re-keys a chip when another provider session takes the thread over", () => {
    const [before] = threadContributionStatusChips([entry("old", [{ key: "mode", text: "x" }])]);
    const [after] = threadContributionStatusChips([entry("new", [{ key: "mode", text: "x" }])]);

    expect(after?.id).not.toBe(before?.id);
  });

  it("attributes the status to its producer without claiming freshness", () => {
    const [pi] = threadContributionStatusChips([entry("s", [{ key: "mode", text: "● startup" }])]);
    const [codex] = threadContributionStatusChips([
      entry("s", [{ key: "mode", text: "busy" }], "codex"),
    ]);

    expect(pi?.accessibilityLabel).toBe("Pi status: ● startup");
    expect(pi?.help).toBe("Set by a Pi extension. It can lag a session change.");
    expect(codex?.help).toBe("Set by Codex. It can lag a session change.");
  });
});
