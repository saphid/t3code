import { describe, expect, it } from "vite-plus/test";

import { createPendingHandoverStore } from "./pendingHandoverStore";

describe("createPendingHandoverStore", () => {
  it("keeps a generated handover recoverable by source thread", () => {
    const store = createPendingHandoverStore();
    store.save("environment:source", "handover");

    expect(store.get("environment:source")).toBe("handover");
    expect(store.get("environment:other")).toBeUndefined();
  });

  it("evicts the oldest abandoned handover", () => {
    const store = createPendingHandoverStore(2);
    store.save("thread:one", "one");
    store.save("thread:two", "two");
    store.save("thread:three", "three");

    expect(store.get("thread:one")).toBeUndefined();
    expect(store.get("thread:two")).toBe("two");
    expect(store.get("thread:three")).toBe("three");
    expect(store.size()).toBe(2);
  });

  it("refreshes an existing entry before eviction", () => {
    const store = createPendingHandoverStore(2);
    store.save("thread:one", "one");
    store.save("thread:two", "two");
    store.save("thread:one", "one updated");
    store.save("thread:three", "three");

    expect(store.get("thread:one")).toBe("one updated");
    expect(store.get("thread:two")).toBeUndefined();
  });
});
