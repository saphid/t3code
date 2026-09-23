/**
 * Merge a designed default order with the user's saved order.
 *  - Ids in userOrder that exist in defaults come first, in user order.
 *  - A default id missing from userOrder is inserted after the nearest preceding
 *    default neighbour the user kept; with none, it goes to the end. New built-ins
 *    therefore land where the design put them, not at the top.
 *  - Ids in userOrder that are not in defaults are dropped from the result (they
 *    stay in the saved preference; callers never render them).
 */
export function mergeOrderedItems(
  defaultOrder: readonly string[],
  userOrder: readonly string[],
): string[] {
  const defaultIndex = new Map(defaultOrder.map((id, index) => [id, index]));
  const kept = userOrder.filter((id) => defaultIndex.has(id));
  const result = [...kept];
  // Next insertion index per anchor id, so several new built-ins anchored to
  // the same kept id land behind it in defaults order rather than reversing.
  const nextInsertionAt = new Map(kept.map((id, index) => [id, index + 1]));
  for (const [id, index] of defaultIndex) {
    if (nextInsertionAt.has(id)) continue;
    let anchor: string | undefined;
    let anchorIndex = -1;
    for (const keptId of kept) {
      const keptIndex = defaultIndex.get(keptId) ?? -1;
      if (keptIndex < index && keptIndex > anchorIndex) {
        anchor = keptId;
        anchorIndex = keptIndex;
      }
    }
    if (anchor === undefined) {
      result.push(id);
      continue;
    }
    const at = nextInsertionAt.get(anchor);
    if (at === undefined) {
      result.push(id);
      continue;
    }
    result.splice(at, 0, id);
    nextInsertionAt.set(anchor, at + 1);
  }
  return result;
}

/** Move `id` one step; returns the same array reference when nothing changes. */
export function moveOrderedItem(
  order: readonly string[],
  id: string,
  direction: "up" | "down",
): readonly string[] {
  const index = order.indexOf(id);
  if (index === -1) return order;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, id);
  return next;
}

/** True when both lists hold the same ids in the same order. Editors use it to disable Reset when the draft already matches the recommended order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
