import { describe, expect, it } from "vite-plus/test";

import { mergeOrderedItems, moveOrderedItem, sameOrder } from "./orderedItems";

describe("mergeOrderedItems", () => {
  it("returns the defaults for an empty user order", () => {
    expect(mergeOrderedItems(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("honours a full reorder of the defaults", () => {
    expect(mergeOrderedItems(["a", "b", "c", "d"], ["d", "c", "b", "a"])).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
  });

  it("drops unknown ids from the result", () => {
    expect(mergeOrderedItems(["a", "b"], ["x", "b", "y", "a"])).toEqual(["b", "a"]);
  });

  it("inserts a new default after the nearest kept preceding neighbour", () => {
    expect(mergeOrderedItems(["a", "b", "c", "d"], ["d", "a"])).toEqual(["d", "a", "b", "c"]);
    expect(mergeOrderedItems(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "d", "a", "b"]);
  });

  it("appends new defaults to the end when no preceding neighbour was kept", () => {
    expect(mergeOrderedItems(["a", "b", "c"], ["c"])).toEqual(["c", "a", "b"]);
    expect(mergeOrderedItems(["a", "b"], ["z"])).toEqual(["a", "b"]);
  });
});

describe("moveOrderedItem", () => {
  it("moves an item one step", () => {
    expect(moveOrderedItem(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveOrderedItem(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("returns the same reference at the ends or for a missing id", () => {
    const order = ["a", "b", "c"];
    expect(moveOrderedItem(order, "a", "up")).toBe(order);
    expect(moveOrderedItem(order, "c", "down")).toBe(order);
    expect(moveOrderedItem(order, "z", "up")).toBe(order);
  });
});

describe("sameOrder", () => {
  it("treats a reorder as a difference", () => {
    expect(sameOrder(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
    expect(sameOrder(["a", "b", "c"], ["c", "a", "b"])).toBe(false);
    expect(sameOrder(["a", "b"], ["a", "c"])).toBe(false);
    expect(sameOrder([], [])).toBe(true);
  });
});
