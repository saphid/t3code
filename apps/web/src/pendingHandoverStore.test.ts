import { describe, expect, it } from "vite-plus/test";

import type { DraftId } from "./composerDraftStore";
import { createPendingHandoverStore } from "./pendingHandoverStore";

describe("createPendingHandoverStore", () => {
  it("keeps a generated handover recoverable by source thread", () => {
    const store = createPendingHandoverStore();
    store.save("environment:source", { handover: "handover" });

    expect(store.get("environment:source")).toEqual({ handover: "handover" });
    expect(store.get("environment:other")).toBeUndefined();
  });

  it("evicts the oldest abandoned handover", () => {
    const store = createPendingHandoverStore(2);
    store.save("thread:one", { handover: "one" });
    store.save("thread:two", { handover: "two" });
    store.save("thread:three", { handover: "three" });

    expect(store.get("thread:one")).toBeUndefined();
    expect(store.get("thread:two")).toEqual({ handover: "two" });
    expect(store.get("thread:three")).toEqual({ handover: "three" });
    expect(store.size()).toBe(2);
  });

  it("refreshes an existing entry before eviction", () => {
    const store = createPendingHandoverStore(2);
    store.save("thread:one", { handover: "one" });
    store.save("thread:two", { handover: "two" });
    store.save("thread:one", {
      handover: "one updated",
      draftId: "draft-one" as DraftId,
    });
    store.save("thread:three", { handover: "three" });

    expect(store.get("thread:one")).toEqual({
      handover: "one updated",
      draftId: "draft-one",
    });
    expect(store.get("thread:two")).toBeUndefined();
  });
});
