import { describe, expect, it } from "vite-plus/test";

import { makeProviderReplayGate } from "./ProviderReplayGate.testkit.ts";

describe("ProviderReplayGate", () => {
  it("signals frame arrival before releasing the replay consumer", async () => {
    const gate = makeProviderReplayGate(["held-frame"]);
    const reached = gate.whenReached("held-frame");
    expect(reached).toBeDefined();
    expect(gate.whenReached("unknown-frame")).toBeUndefined();
    let arrived = false;
    void reached!.then(() => {
      arrived = true;
    });
    await Promise.resolve();
    expect(arrived).toBe(false);

    let emitted = false;
    const emitting = gate.beforeEmit("held-frame").then(() => {
      emitted = true;
    });
    await reached;
    expect(arrived).toBe(true);
    expect(emitted).toBe(false);
    await gate.whenReached("held-frame");
    expect(gate.release("held-frame")).toBe(true);
    await emitting;
    expect(emitted).toBe(true);
  });

  it("stops waiting when the replay consumer is interrupted", async () => {
    const label = "held-frame";
    const gate = makeProviderReplayGate([label]);
    const controller = new AbortController();
    const waiting = gate.beforeEmit(label, controller.signal);

    expect(gate.hasReached(label)).toBe(true);
    controller.abort();
    await waiting;
    expect(gate.release(label)).toBe(true);
  });
});
