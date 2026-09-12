import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  EMPTY_OUTPUT_BUFFER,
  TERMINAL_BUFFER_MAX_BYTES,
  addTerminalId,
  applyOutputEvent,
  describeSession,
  fallbackTerminalLabel,
  missingSessionRow,
  normalizeTerminalIds,
  removeTerminalId,
  resolveActiveTerminalId,
  tailByBytes,
} from "./viewModel.ts";

const frame = (sequence, streamId = "stream-1") => ({ streamId, sequence });
const outputValue = (sequence, data, extra = {}) => ({
  kind: "output",
  terminalId: "term-1",
  streamEpoch: "epoch-1",
  sequence,
  chunkIndex: 0,
  chunkCount: 1,
  data,
  ...extra,
});
const snapshotValue = (overrides = {}) => ({
  kind: "snapshot",
  terminalId: "term-1",
  streamEpoch: "epoch-1",
  status: "running",
  contents: "$ echo hi\nhi\n",
  retainedByteLength: 12,
  truncated: false,
  boundarySequence: 0,
  ...overrides,
});
const liveBuffer = (contents = "") => ({
  ...EMPTY_OUTPUT_BUFFER,
  contents,
  retainedBytes: new TextEncoder().encode(contents).byteLength,
  status: "live",
  statusText: "Watching live output.",
  epoch: "epoch-1",
});

NodeTest.describe("terminal view model — session list", () => {
  NodeTest.it("normalizes, dedupes, and bounds ids", () => {
    NodeAssert.deepEqual(normalizeTerminalIds([" term-1 ", "term-1", "", "term-2"]), [
      "term-1",
      "term-2",
    ]);
    NodeAssert.deepEqual(normalizeTerminalIds(["x".repeat(129)]), []);
  });

  NodeTest.it("adds and removes ids without mutation", () => {
    const ids = ["term-1"];
    NodeAssert.deepEqual(addTerminalId(ids, "term-2"), ["term-1", "term-2"]);
    NodeAssert.deepEqual(addTerminalId(ids, "term-1"), ["term-1"]);
    NodeAssert.deepEqual(addTerminalId(ids, "  "), ["term-1"]);
    NodeAssert.deepEqual(removeTerminalId(["term-1", "term-2"], "term-1"), ["term-2"]);
    NodeAssert.deepEqual(ids, ["term-1"]);
  });

  NodeTest.it("resolves the active id or falls back to the first", () => {
    NodeAssert.equal(resolveActiveTerminalId([], null), null);
    NodeAssert.equal(resolveActiveTerminalId(["term-1"], null), "term-1");
    NodeAssert.equal(resolveActiveTerminalId(["term-1", "term-2"], "term-2"), "term-2");
    NodeAssert.equal(resolveActiveTerminalId(["term-1", "term-2"], "term-9"), "term-1");
  });

  NodeTest.it("describes inspect results and keeps absent sessions visible", () => {
    NodeAssert.equal(describeSession(null), null);
    NodeAssert.deepEqual(
      describeSession({
        terminalId: "term-1",
        status: "running",
        label: "zsh",
        hasRunningSubprocess: true,
        exitCode: null,
        exitSignal: null,
        updatedAt: "2026-09-12T00:00:00Z",
      }),
      {
        terminalId: "term-1",
        label: "zsh",
        status: "running",
        hasRunningSubprocess: true,
        exitCode: null,
        updatedAt: "2026-09-12T00:00:00Z",
      },
    );
    const missing = missingSessionRow("term-3");
    NodeAssert.equal(missing.status, "closed");
    NodeAssert.equal(missing.label, "Terminal 3");
    NodeAssert.equal(fallbackTerminalLabel("scratch"), "Terminal");
  });
});

NodeTest.describe("terminal view model — output stream", () => {
  NodeTest.it("seeds from the snapshot frame and reports truncation", () => {
    const { buffer } = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue());
    NodeAssert.equal(buffer.contents, "$ echo hi\nhi\n");
    NodeAssert.equal(buffer.status, "live");
    NodeAssert.equal(buffer.epoch, "epoch-1");

    const truncated = applyOutputEvent(
      EMPTY_OUTPUT_BUFFER,
      frame(1),
      snapshotValue({ truncated: true }),
    ).buffer;
    NodeAssert.equal(truncated.truncated, true);
    NodeAssert.match(truncated.statusText, /omitted/);
  });

  NodeTest.it("appends a single-chunk output group", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const { buffer } = applyOutputEvent(seeded, frame(2), outputValue(1, "more output\n"));
    NodeAssert.equal(buffer.contents, "$ echo hi\nhi\nmore output\n");
    NodeAssert.equal(buffer.status, "live");
  });

  NodeTest.it("buffers a multi-chunk group until it completes", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const first = applyOutputEvent(
      seeded,
      frame(2),
      outputValue(7, "part-1-", { chunkIndex: 0, chunkCount: 2 }),
    );
    NodeAssert.equal(first.buffer.contents, "$ echo hi\nhi\n");
    NodeAssert.ok(first.pending);
    const second = applyOutputEvent(
      first.buffer,
      frame(3),
      outputValue(7, "part-2\n", { chunkIndex: 1, chunkCount: 2 }),
      first.pending,
    );
    NodeAssert.equal(second.buffer.contents, "$ echo hi\nhi\npart-1-part-2\n");
    NodeAssert.equal(second.pending, null);
  });

  NodeTest.it("fails closed on a discontinuous chunk group", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const result = applyOutputEvent(
      seeded,
      frame(2),
      outputValue(7, "tail", { chunkIndex: 1, chunkCount: 2 }),
    );
    NodeAssert.equal(result.buffer.status, "error");
    NodeAssert.match(result.buffer.statusText, /discontinuous/);
    NodeAssert.equal(result.buffer.ended, true);
  });

  NodeTest.it("fails on transport sequence gaps and post-lifecycle output", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const gap = applyOutputEvent(seeded, frame(9), outputValue(1, "x"));
    NodeAssert.equal(gap.buffer.status, "error");
    const afterEnd = applyOutputEvent(gap.buffer, frame(10), outputValue(2, "y"));
    NodeAssert.equal(afterEnd.buffer.status, "error");
    NodeAssert.match(afterEnd.buffer.statusText, /lifecycle ended/);
  });

  NodeTest.it("rejects output from a different stream epoch", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const result = applyOutputEvent(
      seeded,
      frame(2),
      outputValue(1, "x", { streamEpoch: "epoch-2" }),
    );
    NodeAssert.equal(result.buffer.status, "error");
    NodeAssert.match(result.buffer.statusText, /incarnation/);
  });

  NodeTest.it("reset clears contents and stays live", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const appended = applyOutputEvent(seeded, frame(2), outputValue(1, "x")).buffer;
    const { buffer } = applyOutputEvent(appended, frame(3), {
      kind: "reset",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      sequence: 8,
      reason: "history-cleared",
    });
    NodeAssert.equal(buffer.contents, "");
    NodeAssert.equal(buffer.status, "live");
    NodeAssert.equal(buffer.ended, false);
  });

  NodeTest.it("exit and closed frames end the buffer", () => {
    const seeded = applyOutputEvent(EMPTY_OUTPUT_BUFFER, frame(1), snapshotValue()).buffer;
    const exited = applyOutputEvent(seeded, frame(2), {
      kind: "exit",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      sequence: 5,
      exitCode: 0,
      exitSignal: null,
    }).buffer;
    NodeAssert.equal(exited.status, "exited");
    NodeAssert.equal(exited.exitCode, 0);
    NodeAssert.equal(exited.ended, true);

    const closed = applyOutputEvent(seeded, frame(2), {
      kind: "closed",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      reason: "overflow",
    }).buffer;
    NodeAssert.equal(closed.status, "closed");
    NodeAssert.equal(closed.contents, "");
    NodeAssert.match(closed.statusText, /overflow/);
  });

  NodeTest.it("an exited snapshot ends the buffer immediately", () => {
    const { buffer } = applyOutputEvent(
      EMPTY_OUTPUT_BUFFER,
      frame(1),
      snapshotValue({ status: "exited" }),
    );
    NodeAssert.equal(buffer.status, "exited");
    NodeAssert.equal(buffer.ended, true);
  });

  NodeTest.it("caps retained output at the buffer byte limit without splitting code points", () => {
    const big = "x".repeat(TERMINAL_BUFFER_MAX_BYTES) + "é".repeat(4);
    const { buffer } = applyOutputEvent(
      EMPTY_OUTPUT_BUFFER,
      frame(1),
      snapshotValue({ contents: big }),
    );
    const encoded = new TextEncoder().encode(buffer.contents);
    NodeAssert.ok(encoded.byteLength <= TERMINAL_BUFFER_MAX_BYTES);
    NodeAssert.ok(buffer.contents.endsWith("éééé"));
    NodeAssert.ok(!buffer.contents.includes("\uFFFD"));
  });

  NodeTest.it("appends across the cap and keeps a UTF-8-safe tail", () => {
    const nearFull = "y".repeat(TERMINAL_BUFFER_MAX_BYTES - 4);
    const seeded = applyOutputEvent(
      EMPTY_OUTPUT_BUFFER,
      frame(1),
      snapshotValue({ contents: nearFull }),
    ).buffer;
    const { buffer } = applyOutputEvent(seeded, frame(2), outputValue(1, "😀tail"));
    NodeAssert.ok(
      new TextEncoder().encode(buffer.contents).byteLength <= TERMINAL_BUFFER_MAX_BYTES,
    );
    NodeAssert.ok(buffer.contents.endsWith("😀tail"));
  });
});
