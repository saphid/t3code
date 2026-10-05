import { describe, expect, it, vi } from "vite-plus/test";
import { countTimelineMessagesBelow } from "./MessagesTimeline.logic";

describe("countTimelineMessagesBelow", () => {
  const state = {
    scroll: 0,
    scrollLength: 400,
    positionAtIndex: (index: number) => index * 100,
  };

  it("counts only indexed messages that have not started above the composer", () => {
    // Rows 1 and 3 are tool activity, not messages. Row 2 starts at 200, above
    // the composer edge at 250, so its hidden end does not count.
    expect(countTimelineMessagesBelow([0, 2, 4, 5], state, 150)).toBe(2);
    expect(countTimelineMessagesBelow([0, 2, 4, 5], { ...state, scroll: 50 }, 150)).toBe(2);
    // A taller composer hides row 2 entirely.
    expect(countTimelineMessagesBelow([0, 2, 4, 5], state, 250)).toBe(3);
  });

  it("decreases while scrolling down and increases when scrolling back up", () => {
    const indices = [0, 1, 2, 3, 4, 5];
    expect(countTimelineMessagesBelow(indices, state, 100)).toBe(3);
    expect(countTimelineMessagesBelow(indices, { ...state, scroll: 200 }, 100)).toBe(1);
    expect(countTimelineMessagesBelow(indices, { ...state, scroll: 300 }, 100)).toBe(0);
    expect(countTimelineMessagesBelow(indices, state, 100)).toBe(3);
  });

  it("updates for appended messages, streaming growth, and viewport or composer resizing", () => {
    expect(countTimelineMessagesBelow([0, 1, 2], state, 100)).toBe(0);
    expect(countTimelineMessagesBelow([0, 1, 2, 3], state, 100)).toBe(1);
    // Earlier rows growing push later rows below the fold.
    expect(
      countTimelineMessagesBelow(
        [0, 1, 2, 3],
        { ...state, positionAtIndex: (index: number) => index * 150 },
        100,
      ),
    ).toBe(2);
    expect(countTimelineMessagesBelow([0, 1, 2], { ...state, scrollLength: 250 }, 100)).toBe(1);
    expect(countTimelineMessagesBelow([0, 1, 2], state, 250)).toBe(1);
  });

  it("measures from below the list header", () => {
    const indices = [0, 1, 2, 3];
    expect(countTimelineMessagesBelow(indices, state, 110, 24)).toBe(1);
    expect(countTimelineMessagesBelow(indices, { ...state, scroll: 35 }, 110, 24)).toBe(0);
  });

  it("does not count blank end space or an empty timeline", () => {
    expect(countTimelineMessagesBelow([0, 1], { ...state, scroll: 500 }, 100)).toBe(0);
    expect(countTimelineMessagesBelow([], state, 100)).toBe(0);
  });

  it("waits for valid measurements", () => {
    expect(countTimelineMessagesBelow([0], undefined, 100)).toBe(0);
    expect(countTimelineMessagesBelow([0], {}, 100)).toBe(0);
    expect(countTimelineMessagesBelow([0], { ...state, positionAtIndex: () => NaN }, 100)).toBe(0);
    expect(
      countTimelineMessagesBelow([0], { ...state, positionAtIndex: () => undefined }, 100),
    ).toBe(0);
  });

  it("treats less than a pixel of a message as not started", () => {
    const indices = [0, 1, 2, 3];
    expect(countTimelineMessagesBelow(indices, { ...state, scroll: 0.5 }, 100)).toBe(1);
    expect(countTimelineMessagesBelow(indices, { ...state, scroll: 2 }, 100)).toBe(0);
  });

  it("uses logarithmic cached position reads for long histories", () => {
    const indices = Array.from({ length: 10_000 }, (_, index) => index);
    const positionAtIndex = vi.fn(state.positionAtIndex);
    expect(countTimelineMessagesBelow(indices, { ...state, positionAtIndex }, 100)).toBe(9997);
    expect(positionAtIndex.mock.calls.length).toBeLessThanOrEqual(14);
  });
});
