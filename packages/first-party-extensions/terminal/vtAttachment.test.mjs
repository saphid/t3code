import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { TerminalVtAttachment, pumpTerminalOutput } from "./vtAttachment.ts";
import { OVERFLOW_RESUBSCRIBE_MAX } from "./viewModel.ts";

const EPOCH = "epoch-1";

function sink() {
  const calls = [];
  return {
    calls,
    resetAndWrite(data) {
      calls.push(["resetAndWrite", data]);
    },
    write(data) {
      calls.push(["write", data]);
    },
  };
}

function frame(sequence, value, streamId = "stream-1") {
  return { streamId, sequence, value };
}

function snapshot(overrides = {}) {
  return {
    kind: "snapshot",
    terminalId: "term-1",
    streamEpoch: EPOCH,
    status: "running",
    contents: "prompt$ ",
    retainedByteLength: 8,
    truncated: false,
    boundarySequence: 7,
    ...overrides,
  };
}

function output(sequence, data, chunkIndex = 0, chunkCount = 1, streamEpoch = EPOCH) {
  return {
    kind: "output",
    terminalId: "term-1",
    streamEpoch,
    sequence,
    chunkIndex,
    chunkCount,
    data,
  };
}

async function* iterate(frames) {
  for (const f of frames) yield f;
}

NodeTest.describe("TerminalVtAttachment — snapshot + attach", () => {
  NodeTest.it("a complete snapshot seeds the parser and reports live", () => {
    const vt = new TerminalVtAttachment("term-1");
    const s = sink();
    vt.attach(s);
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    NodeAssert.equal(vt.state.status, "live");
    NodeAssert.equal(vt.state.degraded, false);
    NodeAssert.deepEqual(s.calls, [["resetAndWrite", "prompt$ "]]);
  });

  NodeTest.it("a truncated snapshot is live but degraded — parity is unclaimed", () => {
    const vt = new TerminalVtAttachment("term-1");
    const s = sink();
    vt.attach(s);
    vt.beginStream();
    const snap = snapshot({ truncated: true, contents: "tail-only" });
    vt.applyFrame(frame(1, snap), snap);
    NodeAssert.equal(vt.state.status, "live");
    NodeAssert.equal(vt.state.degraded, true);
    NodeAssert.match(vt.state.statusText, /truncated/);
  });

  NodeTest.it("reassembles chunked output before it reaches the parser", () => {
    const vt = new TerminalVtAttachment("term-1");
    const s = sink();
    vt.attach(s);
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    vt.applyFrame(frame(2, output(10, "hello ", 0, 3)), output(10, "hello ", 0, 3));
    vt.applyFrame(frame(3, output(10, "wor", 1, 3)), output(10, "wor", 1, 3));
    NodeAssert.equal(s.calls.filter(([m]) => m === "write").length, 0);
    vt.applyFrame(frame(4, output(10, "ld", 2, 3)), output(10, "ld", 2, 3));
    NodeAssert.deepEqual(s.calls.at(-1), ["write", "hello world"]);
  });

  NodeTest.it("buffers output while no surface is attached, then replays base + live", () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    vt.applyFrame(frame(2, output(10, "live-1")), output(10, "live-1"));
    vt.applyFrame(frame(3, output(11, "live-2")), output(11, "live-2"));
    const s = sink();
    vt.attach(s);
    NodeAssert.deepEqual(s.calls, [
      ["resetAndWrite", "prompt$ "],
      ["write", "live-1"],
      ["write", "live-2"],
    ]);
  });

  NodeTest.it("reset re-bases the parser and clears the degraded flag", () => {
    const vt = new TerminalVtAttachment("term-1");
    const s = sink();
    vt.attach(s);
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot({ truncated: true })), snapshot({ truncated: true }));
    NodeAssert.equal(vt.state.degraded, true);
    const reset = {
      kind: "reset",
      terminalId: "term-1",
      streamEpoch: EPOCH,
      sequence: 20,
      reason: "history-cleared",
    };
    vt.applyFrame(frame(2, reset), reset);
    NodeAssert.equal(vt.state.degraded, false);
    NodeAssert.equal(vt.state.status, "live");
    NodeAssert.deepEqual(s.calls.at(-1), ["resetAndWrite", ""]);
  });

  NodeTest.it("exit records the code and ends the stream", () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    const exit = {
      kind: "exit",
      terminalId: "term-1",
      streamEpoch: EPOCH,
      sequence: 9,
      exitCode: 3,
      exitSignal: null,
    };
    vt.applyFrame(frame(2, exit), exit);
    NodeAssert.equal(vt.state.status, "exited");
    NodeAssert.equal(vt.state.exitCode, 3);
    NodeAssert.equal(vt.state.ended, true);
    // Late frames after an ended stream are ignored.
    vt.applyFrame(frame(3, output(10, "zombie")), output(10, "zombie"));
    NodeAssert.equal(vt.state.status, "exited");
  });
});

NodeTest.describe("TerminalVtAttachment — failure paths", () => {
  NodeTest.it("a discontinuous stream sequence fails the attachment", () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    vt.applyFrame(frame(5, output(10, "gap")), output(10, "gap"));
    NodeAssert.equal(vt.state.status, "error");
    NodeAssert.match(vt.state.statusText, /discontinuous/);
  });

  NodeTest.it("an incarnation change mid-stream fails rather than mixing bytes", () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    vt.applyFrame(frame(2, output(10, "x", 0, 1, "epoch-2")), output(10, "x", 0, 1, "epoch-2"));
    NodeAssert.equal(vt.state.status, "error");
    NodeAssert.match(vt.state.statusText, /incarnation/);
  });

  NodeTest.it("an exit with an incomplete chunk group is an error, not a clean exit", () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    vt.applyFrame(frame(2, output(10, "partial", 0, 2)), output(10, "partial", 0, 2));
    const exit = {
      kind: "exit",
      terminalId: "term-1",
      streamEpoch: EPOCH,
      sequence: 11,
      exitCode: 0,
      exitSignal: null,
    };
    vt.applyFrame(frame(3, exit), exit);
    NodeAssert.equal(vt.state.status, "error");
    NodeAssert.match(vt.state.statusText, /incomplete/);
  });

  NodeTest.it("an out-of-contract chunk is rejected", () => {
    const vt = new TerminalVtAttachment("term-1");
    const s = sink();
    vt.attach(s);
    vt.beginStream();
    vt.applyFrame(frame(1, snapshot()), snapshot());
    const bad = output(10, "x".repeat(8193));
    vt.applyFrame(frame(2, bad), bad);
    NodeAssert.equal(vt.state.status, "error");
    NodeAssert.equal(s.calls.filter(([m]) => m === "write").length, 0);
  });
});

NodeTest.describe("pumpTerminalOutput — recovery", () => {
  NodeTest.it(
    "identity-changed resubscribes and re-bases the parser on the new snapshot",
    async () => {
      const vt = new TerminalVtAttachment("term-1");
      const s = sink();
      vt.attach(s);
      const streams = [
        [
          frame(1, snapshot({ contents: "old" })),
          frame(2, {
            kind: "closed",
            terminalId: "term-1",
            streamEpoch: EPOCH,
            reason: "identity-changed",
          }),
        ],
        [frame(1, snapshot({ contents: "new", streamEpoch: "epoch-2" }), "stream-2")],
      ];
      let subscribes = 0;
      const ac = new AbortController();
      await pumpTerminalOutput({
        subscribe: () => {
          subscribes += 1;
          return iterate(streams[subscribes - 1] ?? []);
        },
        attachment: vt,
        signal: ac.signal,
      });
      NodeAssert.equal(subscribes, 2);
      NodeAssert.equal(vt.state.status, "live");
      NodeAssert.deepEqual(s.calls.at(-1), ["resetAndWrite", "new"]);
    },
  );

  NodeTest.it("overflow closes resubscribe up to the streak bound, then stop", async () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    const closedOverflow = {
      kind: "closed",
      terminalId: "term-1",
      streamEpoch: EPOCH,
      reason: "overflow",
    };
    let subscribes = 0;
    let now = 0;
    const ac = new AbortController();
    await pumpTerminalOutput({
      subscribe: () => {
        subscribes += 1;
        now += 10;
        return iterate([frame(1, snapshot()), frame(2, closedOverflow)]);
      },
      attachment: vt,
      signal: ac.signal,
      now: () => now,
      sleep: () => Promise.resolve(),
    });
    // 1 initial + OVERFLOW_RESUBSCRIBE_MAX resubscribes, then the pump gives up.
    NodeAssert.equal(subscribes, OVERFLOW_RESUBSCRIBE_MAX + 1);
    NodeAssert.equal(vt.state.ended, true);
    NodeAssert.equal(vt.state.status, "closed");
  });

  NodeTest.it("a terminal-closed close ends the pump without resubscribing", async () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    let subscribes = 0;
    const ac = new AbortController();
    await pumpTerminalOutput({
      subscribe: () => {
        subscribes += 1;
        return iterate([
          frame(1, snapshot()),
          frame(2, {
            kind: "closed",
            terminalId: "term-1",
            streamEpoch: EPOCH,
            reason: "terminal-closed",
          }),
        ]);
      },
      attachment: vt,
      signal: ac.signal,
    });
    NodeAssert.equal(subscribes, 1);
    NodeAssert.equal(vt.state.status, "closed");
  });

  NodeTest.it("a transport error surfaces as error, not a silent hang", async () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    const ac = new AbortController();
    await pumpTerminalOutput({
      subscribe: async function* () {
        for await (const never of []) yield never;
        throw new Error("WebSocket dropped");
      },
      attachment: vt,
      signal: ac.signal,
    });
    NodeAssert.equal(vt.state.status, "error");
    NodeAssert.match(vt.state.statusText, /WebSocket dropped/);
  });

  NodeTest.it("abortion stops the pump quietly", async () => {
    const vt = new TerminalVtAttachment("term-1");
    vt.attach(sink());
    const ac = new AbortController();
    ac.abort();
    await pumpTerminalOutput({
      subscribe: () => iterate([]),
      attachment: vt,
      signal: ac.signal,
    });
    NodeAssert.notEqual(vt.state.status, "error");
  });
});
