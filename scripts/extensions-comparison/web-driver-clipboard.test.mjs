import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeVM from "node:vm";
import { waitForClipboardMarker } from "./web-driver-readiness.mjs";

function harness(readText) {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const timers = new Map();
  const observe = NodeVM.runInNewContext(`(${waitForClipboardMarker.toString()})`, {
    navigator: { clipboard: { readText } },
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    observe: () =>
      observe({ marker: "T3PTY-unique-選択-🌈", sentinel: "sentinel", timeoutMs: 100 }),
    frames,
    timers,
    frame: async () => {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback();
      await NodeTimersPromises.setImmediate();
    },
    deadline: () => {
      now = 100;
      for (const callback of timers.values()) callback();
    },
  };
}
const marker = "T3PTY-unique-選択-🌈";
NodeTest.test(
  "an awaited false clipboard match stays pending until an exact marker is actually read",
  async () => {
    const values = ["sentinel", "prefix-" + marker + "-suffix", marker + "\r\n"];
    const h = harness(async () => values.shift());
    let settled = false;
    const pending = h.observe().then((value) => {
      settled = true;
      return value;
    });
    await NodeTimersPromises.setImmediate();
    NodeAssert.equal(settled, false);
    NodeAssert.equal(h.frames.size, 1);
    await h.frame();
    NodeAssert.equal(settled, false);
    await h.frame();
    const result = await pending;
    NodeAssert.equal(result.matched, true);
    NodeAssert.equal(result.clipboardReads, 3);
    NodeAssert.equal(h.frames.size, 0);
    NodeAssert.equal(h.timers.size, 0);
  },
);
NodeTest.test("deadline rejects and cancels a scheduled animation frame", async () => {
  const h = harness(async () => "sentinel");
  const pending = h.observe();
  const failure = NodeAssert.rejects(pending, /deadline/);
  await NodeTimersPromises.setImmediate();
  NodeAssert.equal(h.frames.size, 1);
  h.deadline();
  await failure;
  NodeAssert.equal(h.frames.size, 0);
  NodeAssert.equal(h.timers.size, 0);
});
NodeTest.test(
  "deadline also bounds a hung clipboard read and ignores late completion",
  async () => {
    let complete;
    const h = harness(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = h.observe();
    const failure = NodeAssert.rejects(pending, /deadline/);
    h.deadline();
    await failure;
    complete(marker);
    await NodeTimersPromises.setImmediate();
    NodeAssert.equal(h.frames.size, 0);
    NodeAssert.equal(h.timers.size, 0);
  },
);
NodeTest.test("clipboard permission failures reject and clear the deadline", async () => {
  const h = harness(async () => {
    throw new Error("clipboard permission denied");
  });
  await NodeAssert.rejects(h.observe(), /permission denied/);
  NodeAssert.equal(h.frames.size, 0);
  NodeAssert.equal(h.timers.size, 0);
});
