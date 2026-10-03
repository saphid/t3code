import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ContributionStatusSnapshot } from "./contributionStatus.ts";

const decodeSnapshot = Schema.decodeUnknownSync(ContributionStatusSnapshot);

const piThread = (items: ReadonlyArray<unknown>) => ({
  threadId: "thread-1",
  source: {
    kind: "provider-session",
    providerSessionId: "session-1",
    providerInstanceId: "pi",
    driver: "pi",
  },
  items,
});

describe("ContributionStatusSnapshot", () => {
  it("decodes a tone from a newer server as neutral instead of dropping the item", () => {
    const snapshot = decodeSnapshot({
      threads: [piThread([{ key: "build", text: "Building", tone: "celebrate" }])],
    });
    expect(snapshot.threads[0]?.items).toEqual([
      { key: "build", text: "Building", tone: "neutral" },
    ]);
  });

  it("drops entries an older client cannot decode and keeps the rest", () => {
    const snapshot = decodeSnapshot({
      threads: [
        {
          ...piThread([{ key: "a", text: "From a plugin" }]),
          source: { kind: "plugin", pluginId: "x" },
        },
        piThread([{ key: "a", text: "x".repeat(81) }]),
        piThread([{ key: "mode", text: "plan" }]),
      ],
    });
    expect(snapshot.threads.map((thread) => thread.items)).toEqual([
      [{ key: "mode", text: "plan" }],
    ]);
  });

  it("rejects a thread with more items than one source may set", () => {
    const items = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, text: "on" }));
    expect(decodeSnapshot({ threads: [piThread(items)] }).threads).toEqual([]);
  });
});
