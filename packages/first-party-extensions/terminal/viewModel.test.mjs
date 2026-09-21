import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  EMPTY_OUTPUT_BUFFER,
  EMPTY_OVERFLOW_STREAK,
  OVERFLOW_RESUBSCRIBE_MAX,
  OVERFLOW_RESUBSCRIBE_WINDOW_MS,
  TERMINAL_BUFFER_MAX_BYTES,
  addTerminalId,
  applyOutputEvent,
  describeSession,
  fallbackTerminalLabel,
  isResumableOutputClose,
  missingSessionRow,
  normalizeTerminalIds,
  noteOutputFrameForStreak,
  removeTerminalId,
  resolveActiveTerminalId,
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

NodeTest.describe("terminal view model — output overflow resubscribe policy", () => {
  const closedValue = (reason) => ({
    kind: "closed",
    terminalId: "term-1",
    streamEpoch: "epoch-1",
    reason,
  });

  NodeTest.it("bounds a sustained flood even though every cycle delivers a snapshot", () => {
    // The provider preserves the snapshot ahead of every closed:overflow,
    // so frames fed through the streak must not reset it — only the time
    // window can. Simulate snapshot→overflow cycles close together in time.
    let streak = EMPTY_OVERFLOW_STREAK;
    const outcomes = [];
    for (let cycle = 0; cycle < OVERFLOW_RESUBSCRIBE_MAX + 2; cycle += 1) {
      const now = 1_000 + cycle * 500;
      streak = noteOutputFrameForStreak(snapshotValue(), streak, now);
      streak = noteOutputFrameForStreak(closedValue("overflow"), streak, now);
      outcomes.push(isResumableOutputClose("overflow", streak.attempts));
    }
    NodeAssert.deepEqual(outcomes, [true, true, true, false, false]);
  });

  NodeTest.it("resets the streak after a quiet gap", () => {
    let streak = EMPTY_OVERFLOW_STREAK;
    for (let i = 0; i < OVERFLOW_RESUBSCRIBE_MAX; i += 1) {
      streak = noteOutputFrameForStreak(closedValue("overflow"), streak, i * 100);
    }
    NodeAssert.equal(streak.attempts, OVERFLOW_RESUBSCRIBE_MAX);
    NodeAssert.equal(isResumableOutputClose("overflow", streak.attempts), true);
    // A later isolated overflow counts as a fresh streak.
    streak = noteOutputFrameForStreak(
      closedValue("overflow"),
      streak,
      streak.lastAt + OVERFLOW_RESUBSCRIBE_WINDOW_MS + 1,
    );
    NodeAssert.equal(streak.attempts, 1);
    NodeAssert.equal(isResumableOutputClose("overflow", streak.attempts), true);
  });

  NodeTest.it("clears the streak on identity-changed and stays ended on terminal reasons", () => {
    let streak = EMPTY_OVERFLOW_STREAK;
    streak = noteOutputFrameForStreak(closedValue("overflow"), streak, 1_000);
    streak = noteOutputFrameForStreak(closedValue("overflow"), streak, 1_500);
    NodeAssert.equal(streak.attempts, 2);
    // A new epoch starts a fresh streak.
    streak = noteOutputFrameForStreak(closedValue("identity-changed"), streak, 2_000);
    NodeAssert.equal(streak, EMPTY_OVERFLOW_STREAK);
    streak = noteOutputFrameForStreak(closedValue("overflow"), streak, 2_500);
    NodeAssert.equal(streak.attempts, 1);
    // Terminal close reasons never resume and don't touch the streak.
    NodeAssert.equal(isResumableOutputClose("terminal-error", 0), false);
    NodeAssert.equal(isResumableOutputClose("terminal-closed", 0), false);
    NodeAssert.equal(
      noteOutputFrameForStreak(closedValue("terminal-error"), streak, 3_000),
      streak,
    );
    NodeAssert.equal(isResumableOutputClose("identity-changed", 99), true);
  });
});

/* ---------------- interactive panel controller ---------------- */

import {
  TerminalPanel,
  reconcileTerminalIds,
  serverTerminalIdsStrictSubsetOfClient,
  terminalIdListsEqual,
  workspaceLaunchFromRevision,
} from "./viewModel.ts";

const meta = (terminalId, extra = {}) => ({
  terminalId,
  status: "running",
  label: "",
  hasRunningSubprocess: false,
  exitCode: null,
  exitSignal: null,
  updatedAt: "2026-09-12T00:00:00Z",
  ...extra,
});
const launch = {
  cwd: "/workspace",
  worktreePath: null,
  env: { T3CODE_PROJECT_ROOT: "/workspace" },
};

/** Control stub: records calls; open/attach/restart can be held pending. */
function fakeControl(overrides = {}) {
  const calls = [];
  const gate = { open: null, attach: null, restart: null };
  const ops = {
    calls,
    gate,
    open(input) {
      calls.push(["open", input]);
      return gate.open ?? Promise.resolve(meta(input.terminalId));
    },
    attach(input) {
      calls.push(["attach", input]);
      return gate.attach ?? Promise.resolve(meta(input.terminalId));
    },
    write(input) {
      calls.push(["write", input]);
      return Promise.resolve({});
    },
    resize(input) {
      calls.push(["resize", input]);
      return Promise.resolve({});
    },
    clear(input) {
      calls.push(["clear", input]);
      return Promise.resolve({});
    },
    restart(input) {
      calls.push(["restart", input]);
      return gate.restart ?? Promise.resolve(meta(input.terminalId));
    },
    close(input) {
      calls.push(["close", input]);
      return Promise.resolve({});
    },
    ...overrides,
  };
  return ops;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
/** Manual scheduler: returns the queued callbacks so tests drive the exit tick. */
function manualScheduler() {
  const pending = [];
  return { pending, schedule: (cb) => pending.push(cb) };
}

NodeTest.describe("terminal panel — reconciliation + tabs", () => {
  NodeTest.it("keeps the lag rule and reconcile identical to native", () => {
    NodeAssert.equal(terminalIdListsEqual(["a", "b"], ["b", "a"]), true);
    NodeAssert.equal(terminalIdListsEqual(["a"], ["a", "b"]), false);
    NodeAssert.equal(serverTerminalIdsStrictSubsetOfClient(["a"], ["a", "b"]), true);
    NodeAssert.equal(serverTerminalIdsStrictSubsetOfClient([], ["a"]), true);
    NodeAssert.equal(serverTerminalIdsStrictSubsetOfClient(["a", "b"], ["a", "b"]), false);
    NodeAssert.equal(serverTerminalIdsStrictSubsetOfClient(["x"], ["a", "b"]), false);
    NodeAssert.deepEqual(reconcileTerminalIds(["a", "b"], ["a"]), ["a", "b"]);
    NodeAssert.deepEqual(reconcileTerminalIds(["a"], ["a", "b"]), ["a", "b"]);
    NodeAssert.deepEqual(reconcileTerminalIds(["a", "b"], ["x"]), ["x"]);
  });

  NodeTest.it("builds tabs from snapshot, upsert, remove and falls back selection", () => {
    const panel = new TerminalPanel({ control: fakeControl(), launch });
    panel.applySessionsEvent({
      kind: "snapshot",
      terminals: [meta("term-1", { label: "zsh" }), meta("term-2")],
    });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-2"]);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-1");
    NodeAssert.equal(panel.snapshot.tabs[0].label, "zsh");
    NodeAssert.equal(panel.snapshot.tabs[1].label, "Terminal 2");

    panel.applySessionsEvent({ kind: "upsert", terminal: meta("term-3") });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-2", "term-3"]);

    panel.activate("term-3");
    panel.applySessionsEvent({ kind: "remove", terminalId: "term-3" });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-2"]);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-1");
    panel.dispose();
  });

  NodeTest.it("keeps a client-opened id while the server list lags", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    const opening = panel.openTerminal();
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-2"]);
    // Lagging snapshot still only knows term-1 — term-2 must survive.
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-2"]);
    await opening;
    // Once the server catches up the ids stay ordered and stable.
    panel.applySessionsEvent({
      kind: "snapshot",
      terminals: [meta("term-1"), meta("term-2")],
    });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-2"]);
    panel.dispose();
  });

  NodeTest.it("allocates the lowest free term-N id via the shared helper", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1"), meta("term-3")] });
    await panel.openTerminal();
    NodeAssert.equal(control.calls[0][1].terminalId, "term-2");
    panel.dispose();
  });

  NodeTest.it("replaces stale restored ids when the server list is disjoint", () => {
    const panel = new TerminalPanel({
      control: fakeControl(),
      launch,
      restored: { terminalIds: ["term-8", "term-9"], activeTerminalId: "term-8" },
    });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-8", "term-9"]);
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1"]);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-1");
    panel.dispose();
  });

  NodeTest.it("refuses to allocate while the first list snapshot is still pending", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    // Stream still connecting: unseen server sessions could collide with a
    // freshly allocated id, so open waits for the snapshot.
    NodeAssert.equal(await panel.openTerminal(), null);
    NodeAssert.equal(control.calls.length, 0);
    NodeAssert.equal(panel.snapshot.panelError, "Session list is still connecting.");
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    await panel.openTerminal();
    NodeAssert.equal(control.calls[0][1].terminalId, "term-2");
    panel.dispose();
  });
});

NodeTest.describe("terminal panel — input, resize, lifecycle", () => {
  NodeTest.it("queues input while the terminal is starting and drains in order", async () => {
    const control = fakeControl();
    const gate = deferred();
    control.gate.open = gate.promise;
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [] });
    const opening = panel.openTerminal();
    const id = panel.snapshot.activeTerminalId;
    panel.sendInput(id, "echo one\r");
    panel.sendInput(id, "echo two\r");
    NodeAssert.equal(panel.snapshot.tabs[0].queuedInputCount, 2);
    NodeAssert.equal(control.calls.filter(([m]) => m === "write").length, 0);
    gate.resolve(meta(id));
    await opening;
    NodeAssert.deepEqual(
      control.calls.filter(([m]) => m === "write").map(([, i]) => i.data),
      ["echo one\r", "echo two\r"],
    );
    panel.dispose();
  });

  NodeTest.it("caps the starting-input queue instead of growing unbounded", async () => {
    const control = fakeControl();
    const gate = deferred();
    control.gate.open = gate.promise;
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [] });
    const opening = panel.openTerminal();
    const id = panel.snapshot.activeTerminalId;
    for (let i = 0; i < 200; i += 1) panel.sendInput(id, "x".repeat(1024));
    const tab = panel.snapshot.tabs[0];
    NodeAssert.ok(tab.queuedInputCount <= 128);
    NodeAssert.match(tab.error, /queue is full/);
    gate.resolve(meta(id));
    await opening;
    panel.dispose();
  });

  NodeTest.it("rejects oversized writes before any host call", () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    panel.sendInput("term-1", "x".repeat(65_537));
    NodeAssert.equal(control.calls.filter(([m]) => m === "write").length, 0);
    NodeAssert.match(panel.snapshot.tabs[0].error, /64 KiB/);
    panel.dispose();
  });

  NodeTest.it("resizes latest-wins while a resize is in flight", async () => {
    const control = fakeControl();
    const inFlight = deferred();
    let resizeCalls = 0;
    control.resize = (input) => {
      control.calls.push(["resize", input]);
      resizeCalls += 1;
      return resizeCalls === 1 ? inFlight.promise : Promise.resolve({});
    };
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    panel.resize("term-1", 80, 24);
    panel.resize("term-1", 100, 30);
    panel.resize("term-1", 120, 40); // latest wins over 100x30
    inFlight.resolve({});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const sent = control.calls.filter(([m]) => m === "resize").map(([, i]) => [i.cols, i.rows]);
    NodeAssert.deepEqual(sent, [
      [80, 24],
      [120, 40],
    ]);
    // A resize equal to the last sent value is a no-op.
    panel.resize("term-1", 120, 40);
    NodeAssert.equal(control.calls.filter(([m]) => m === "resize").length, 2);
    panel.dispose();
  });

  NodeTest.it("ignores out-of-bounds resize dimensions", () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    panel.resize("term-1", 0, 24);
    panel.resize("term-1", 80, 501);
    panel.resize("term-1", 1001, 24);
    panel.resize("term-1", 80.5, 24);
    NodeAssert.equal(control.calls.filter(([m]) => m === "resize").length, 0);
    panel.dispose();
  });

  NodeTest.it("close requires confirm, deletes history, and removes the tab", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    panel.requestAction("term-1", "close");
    NodeAssert.equal(panel.snapshot.tabs[0].confirmAction, "close");
    await panel.confirmAction("term-1");
    NodeAssert.deepEqual(control.calls, [["close", { terminalId: "term-1", deleteHistory: true }]]);
    NodeAssert.deepEqual(panel.snapshot.terminalIds, []);
    panel.dispose();
  });

  NodeTest.it("falls back to an exit write when close fails", async () => {
    const control = fakeControl({
      close(input) {
        control.calls.push(["close", input]);
        return Promise.reject(new Error("control unavailable"));
      },
    });
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    panel.requestAction("term-1", "close");
    await panel.confirmAction("term-1");
    NodeAssert.deepEqual(control.calls, [
      ["close", { terminalId: "term-1", deleteHistory: true }],
      ["write", { terminalId: "term-1", data: "exit\n" }],
    ]);
    NodeAssert.deepEqual(panel.snapshot.terminalIds, []);
    panel.dispose();
  });

  NodeTest.it("restart and clear go through confirm; cancel backs out", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    panel.applySessionsEvent({
      kind: "snapshot",
      terminals: [meta("term-1", { status: "exited" })],
    });
    panel.requestAction("term-1", "clear");
    panel.cancelAction("term-1");
    NodeAssert.equal(panel.snapshot.tabs[0].confirmAction, null);
    panel.requestAction("term-1", "clear");
    await panel.confirmAction("term-1");
    NodeAssert.deepEqual(control.calls, [["clear", { terminalId: "term-1" }]]);

    panel.requestAction("term-1", "restart");
    await panel.confirmAction("term-1");
    const restart = control.calls.find(([m]) => m === "restart");
    NodeAssert.equal(restart[1].terminalId, "term-1");
    NodeAssert.equal(restart[1].cwd, "/workspace");
    NodeAssert.ok(Number.isSafeInteger(restart[1].cols));
    NodeAssert.ok(Number.isSafeInteger(restart[1].rows));
    panel.dispose();
  });
});

NodeTest.describe("terminal panel — exit UX", () => {
  NodeTest.it("banners a live→exited transition then removes the tab on the tick", async () => {
    const control = fakeControl();
    const scheduler = manualScheduler();
    const panel = new TerminalPanel({ control, launch, schedule: scheduler.schedule });
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    panel.applySessionsEvent({
      kind: "upsert",
      terminal: meta("term-1", { status: "exited", exitCode: 3 }),
    });
    const tab = panel.snapshot.tabs[0];
    NodeAssert.equal(tab.exitBanner, "Process exited (code 3)");
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1"]);
    scheduler.pending.forEach((cb) => cb());
    NodeAssert.deepEqual(panel.snapshot.terminalIds, []);
    NodeAssert.equal(panel.snapshot.activeTerminalId, null);
    panel.dispose();
  });

  NodeTest.it("does not banner a session that arrives already exited", () => {
    const control = fakeControl();
    const scheduler = manualScheduler();
    const panel = new TerminalPanel({ control, launch, schedule: scheduler.schedule });
    panel.applySessionsEvent({
      kind: "snapshot",
      terminals: [meta("term-1", { status: "exited", exitCode: 0 })],
    });
    NodeAssert.equal(panel.snapshot.tabs[0].exitBanner, null);
    NodeAssert.equal(scheduler.pending.length, 0);
    panel.dispose();
  });

  NodeTest.it("marks the stream closed on a closed frame", () => {
    const panel = new TerminalPanel({ control: fakeControl(), launch });
    panel.applySessionsEvent({ kind: "closed", reason: "overflow" });
    NodeAssert.equal(panel.snapshot.stream, "closed");
    panel.dispose();
  });

  NodeTest.it("re-arms a disposed panel when a fresh list stream begins", () => {
    const panel = new TerminalPanel({ control: fakeControl(), launch });
    // React replays effect cleanup in dev: the panel's own useState object
    // survives while the cleanup's dispose() tombstones it. Frames arriving
    // before the next subscription are correctly swallowed...
    panel.dispose();
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    NodeAssert.equal(panel.snapshot.stream, "connecting");
    // ...but the replayed effect re-subscribes, and a fresh stream means the
    // view is alive again — the snapshot must land.
    panel.beginListStream();
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1")] });
    NodeAssert.equal(panel.snapshot.stream, "live");
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1"]);
    panel.dispose();
  });
});

NodeTest.describe("terminal panel — workspace launch", () => {
  NodeTest.it("derives cwd/worktreePath/workspaceRoot from the public revision", () => {
    NodeAssert.deepEqual(workspaceLaunchFromRevision('["/repo","/repo/.wt"]'), {
      cwd: "/repo/.wt",
      workspaceRoot: "/repo",
      worktreePath: "/repo/.wt",
    });
    NodeAssert.deepEqual(workspaceLaunchFromRevision('["/repo",null]'), {
      cwd: "/repo",
      workspaceRoot: "/repo",
      worktreePath: null,
    });
    NodeAssert.equal(workspaceLaunchFromRevision(undefined), null);
    NodeAssert.equal(workspaceLaunchFromRevision("not-json"), null);
    NodeAssert.equal(workspaceLaunchFromRevision('["",null]'), null);
  });

  NodeTest.it("attaches a tracked id with no live metadata via restartIfNotRunning", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({
      control,
      launch,
      restored: { terminalIds: ["term-9"], activeTerminalId: "term-9" },
    });
    // The session is listed but stopped — attach restarts it in place.
    panel.applySessionsEvent({
      kind: "snapshot",
      terminals: [meta("term-9", { status: "exited", exitCode: 0 })],
    });
    await panel.startSession("term-9");
    NodeAssert.deepEqual(control.calls[0], [
      "attach",
      {
        terminalId: "term-9",
        cwd: "/workspace",
        worktreePath: null,
        restartIfNotRunning: true,
        env: { T3CODE_PROJECT_ROOT: "/workspace" },
      },
    ]);
    panel.dispose();
  });

  NodeTest.it("reports panel-op failures on the status row", () => {
    const panel = new TerminalPanel({ control: fakeControl(), launch });
    panel.notePanelError("The host could not close this panel.");
    NodeAssert.equal(panel.snapshot.panelError, "The host could not close this panel.");
    panel.dispose();
  });
});

/* ---------------- t3.ui/* consumption ---------------- */

import {
  TERMINAL_FOCUS_WHEN,
  TERMINAL_GLOBAL_COMMANDS,
  TERMINAL_SURFACE_ID,
  TERMINAL_VIEW_COMMANDS,
  asTerminalAppearance,
  dispatchTerminalCommand,
  registerPanelCommands,
  terminalAppearanceVars,
  themeVarOverrides,
  watchTerminalAppearanceVars,
  watchThemeVars,
} from "./viewModel.ts";
import * as NodeFS from "node:fs";

const viewContext = { resource: { environmentId: "env-1", threadId: "thread-1" } };

/** invokeApi stub: records requests; registerCommands answers with `results`. */
function fakeKeybindingsClient(results, overrides = {}) {
  const calls = [];
  const resolved =
    results ??
    TERMINAL_VIEW_COMMANDS.map((command) => ({ commandId: command.id, status: "registered" }));
  return {
    calls,
    invokeApi(request) {
      calls.push(request);
      if (request.method === "registerCommands")
        return Promise.resolve({ commandSetToken: "cmdset-test", results: resolved });
      if (request.method === "unregisterCommands") return Promise.resolve({ unregistered: true });
      return Promise.reject(new Error(`unexpected method ${request.method}`));
    },
    ...overrides,
  };
}

NodeTest.describe("t3.ui/theme — token + appearance mapping", () => {
  const appearance = {
    theme: {
      background: "rgb(1, 2, 3)",
      foreground: "rgb(4, 5, 6)",
      cursor: "rgb(7, 8, 9)",
      selectionBackground: "rgb(10, 11, 12)",
    },
    font: { family: "Mono", size: 13, lineHeight: 1.4, ligatures: false },
    appearance: "dark",
  };

  NodeTest.it("republishes contract tokens chained on the advertised host var", () => {
    const vars = themeVarOverrides(
      { text: "#111", border: "#222", terminalBackground: "#000" },
      {
        text: "--app-theme-text",
        border: "--app-theme-border",
        terminalBackground: "--app-theme-terminal-background",
      },
    );
    NodeAssert.equal(vars["--t3-terminal-text"], "var(--app-theme-text, #111)");
    NodeAssert.equal(vars["--t3-terminal-border"], "var(--app-theme-border, #222)");
    NodeAssert.equal(
      vars["--t3-terminal-background"],
      "var(--app-theme-terminal-background, #000)",
    );
    // Roles the provider left unresolved are skipped, not overridden with a lie.
    NodeAssert.equal(vars["--t3-terminal-canvas"], undefined);
  });

  NodeTest.it("falls back to the resolved token when no css var is advertised", () => {
    const vars = themeVarOverrides({ textMuted: "#667085" }, {});
    NodeAssert.equal(vars["--t3-terminal-muted"], "#667085");
  });

  NodeTest.it("maps the terminal appearance payload onto output-pane vars", () => {
    NodeAssert.deepEqual(terminalAppearanceVars(appearance), {
      "--t3-terminal-background": "rgb(1, 2, 3)",
      "--t3-terminal-foreground": "rgb(4, 5, 6)",
      "--t3-terminal-selection": "rgb(10, 11, 12)",
      "--t3-terminal-color-scheme": "dark",
      "--t3-terminal-font-family": "Mono",
      "--t3-terminal-font-size": "13px",
      "--t3-terminal-line-height": "1.4",
      "--t3-terminal-ligatures": "none",
    });
  });

  NodeTest.it("skips optional appearance fields so var() fallbacks govern", () => {
    NodeAssert.deepEqual(
      terminalAppearanceVars({
        theme: { background: "#000", foreground: "#fff", cursor: "#fff" },
        font: {},
        appearance: "light",
      }),
      {
        "--t3-terminal-background": "#000",
        "--t3-terminal-foreground": "#fff",
        "--t3-terminal-color-scheme": "light",
      },
    );
  });

  NodeTest.it("narrows appearance frames honestly", () => {
    NodeAssert.equal(asTerminalAppearance(appearance), appearance);
    NodeAssert.equal(asTerminalAppearance(null), null);
    NodeAssert.equal(asTerminalAppearance({}), null);
    NodeAssert.equal(
      asTerminalAppearance({ theme: { background: "#000" }, font: {}, appearance: "dark" }),
      null,
    );
    NodeAssert.equal(
      asTerminalAppearance({
        theme: { background: "#000", foreground: "#fff", cursor: "#fff" },
        font: { size: "13" },
        appearance: "dark",
      }),
      null,
    );
    NodeAssert.equal(
      asTerminalAppearance({
        theme: { background: "#000", foreground: "#fff", cursor: "#fff" },
        font: {},
        appearance: "auto",
      }),
      null,
    );
  });
});

NodeTest.describe("t3.ui/keybindings — command descriptors", () => {
  const COMMAND_ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

  NodeTest.it("declares plugin-local ids valid for ext dispatch", () => {
    for (const command of [...TERMINAL_VIEW_COMMANDS, ...TERMINAL_GLOBAL_COMMANDS]) {
      NodeAssert.match(command.id, COMMAND_ID);
      NodeAssert.ok(command.title.length > 0);
    }
    NodeAssert.equal(TERMINAL_SURFACE_ID, "t3.terminal/view");
    NodeAssert.equal(TERMINAL_FOCUS_WHEN, "extension.t3.terminal/view.focus");
  });

  NodeTest.it("gates surface chords on the focused view; toggle is global like native", () => {
    const view = Object.fromEntries(TERMINAL_VIEW_COMMANDS.map((command) => [command.id, command]));
    NodeAssert.deepEqual(view.new, {
      id: "new",
      title: "New terminal",
      scope: "surface",
      defaultKey: "mod+n",
      when: TERMINAL_FOCUS_WHEN,
    });
    NodeAssert.deepEqual(view.close, {
      id: "close",
      title: "Close terminal",
      scope: "surface",
      defaultKey: "mod+w",
      when: TERMINAL_FOCUS_WHEN,
    });
    NodeAssert.equal(view.toggle.scope, "global");
    NodeAssert.equal(view.toggle.defaultKey, "mod+j");
    NodeAssert.equal(view.toggle.when, undefined);
    // Split chords stay unregistered — no split layout to dispatch them to.
    NodeAssert.ok(!TERMINAL_VIEW_COMMANDS.some((command) => command.id.startsWith("split")));
  });

  NodeTest.it("stages a legal installation-tier activation for cold open", () => {
    NodeAssert.deepEqual(
      TERMINAL_GLOBAL_COMMANDS.map((command) => command.id),
      ["toggle"],
    );
    const toggle = TERMINAL_GLOBAL_COMMANDS[0];
    NodeAssert.equal(toggle.scope, "global");
    NodeAssert.deepEqual(toggle.activation, {
      surfaceId: TERMINAL_SURFACE_ID,
      placement: "bottom-dock",
    });
  });
});

NodeTest.describe("t3.ui/keybindings — registration + dispatch", () => {
  NodeTest.it("maps command ids to panel-local actions", () => {
    const calls = [];
    const actions = {
      newTerminal: () => calls.push("new"),
      closeTerminal: () => calls.push("close"),
      toggleSurface: () => calls.push("toggle"),
    };
    NodeAssert.equal(dispatchTerminalCommand("toggle", actions), true);
    NodeAssert.equal(dispatchTerminalCommand("new", actions), true);
    NodeAssert.equal(dispatchTerminalCommand("close", actions), true);
    NodeAssert.equal(dispatchTerminalCommand("terminal.new", actions), false);
    NodeAssert.deepEqual(calls, ["toggle", "new", "close"]);
  });

  NodeTest.it("registers the view set, binds the token, dispatches registered ids", async () => {
    const client = fakeKeybindingsClient([
      {
        commandId: "toggle",
        status: "rejected",
        reason: "t3.ui/keybindings.global grant required",
      },
      { commandId: "new", status: "registered" },
      { commandId: "close", status: "registered" },
    ]);
    const bound = [];
    const dispatched = [];
    const registration = await registerPanelCommands({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      bindCommands: (token, handler) => {
        bound.push({ token, handler });
        return "binding-1";
      },
      onCommand: (commandId) => dispatched.push(commandId),
    });
    const register = client.calls.find((call) => call.method === "registerCommands");
    NodeAssert.equal(register.id, "t3.ui/keybindings");
    NodeAssert.deepEqual(
      register.input.commands.map((command) => command.id),
      ["toggle", "new", "close"],
    );
    NodeAssert.equal(bound[0].token, "cmdset-test");
    bound[0].handler({ commandId: "new", context: viewContext });
    bound[0].handler({ commandId: "toggle", context: viewContext });
    bound[0].handler({ commandId: "unknown", context: viewContext });
    NodeAssert.deepEqual(dispatched, ["new"]);
    registration.release();
    const unregister = client.calls.find((call) => call.method === "unregisterCommands");
    NodeAssert.equal(unregister.input.commandSetToken, "cmdset-test");
  });

  NodeTest.it("unwinds the registration when the view aborted mid-flight", async () => {
    const gate = deferred();
    const client = fakeKeybindingsClient();
    client.invokeApi = (request) => {
      client.calls.push(request);
      return request.method === "registerCommands"
        ? gate.promise.then(() => ({ commandSetToken: "cmdset-late", results: [] }))
        : Promise.resolve({ unregistered: true });
    };
    const controller = new AbortController();
    const promise = registerPanelCommands({
      client,
      context: viewContext,
      signal: controller.signal,
      bindCommands: () => "binding-1",
      onCommand: () => {},
    });
    controller.abort();
    gate.resolve();
    NodeAssert.equal(await promise, null);
    const unregister = client.calls.find((call) => call.method === "unregisterCommands");
    NodeAssert.equal(unregister.input.commandSetToken, "cmdset-late");
  });

  NodeTest.it("unwinds the registration when the host cannot bind commands", async () => {
    const client = fakeKeybindingsClient();
    await NodeAssert.rejects(
      registerPanelCommands({
        client,
        context: viewContext,
        signal: new AbortController().signal,
        bindCommands: () => {
          throw new Error("Command binding is unavailable");
        },
        onCommand: () => {},
      }),
      /Command binding is unavailable/,
    );
    const unregister = client.calls.find((call) => call.method === "unregisterCommands");
    NodeAssert.equal(unregister.input.commandSetToken, "cmdset-test");
  });
});

NodeTest.describe("t3.ui/theme — watch lifecycle (no stale overrides)", () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  /** Async iterable the test drives frame-by-frame. */
  function controllableStream() {
    const queue = [];
    let waiter;
    const pump = () => {
      if (!waiter || !queue.length) return;
      const item = queue.shift();
      const { resolve, reject } = waiter;
      waiter = undefined;
      if (item.error !== undefined) reject(item.error);
      else resolve(item);
    };
    return {
      iterable: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              const item = queue.shift();
              if (item !== undefined)
                return item.error !== undefined
                  ? Promise.reject(item.error)
                  : Promise.resolve(item);
              return new Promise((resolve, reject) => {
                waiter = { resolve, reject };
              });
            },
            return() {
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      },
      push: (frame) => (queue.push({ done: false, value: frame }), pump()),
      end: () => (queue.push({ done: true, value: undefined }), pump()),
      fail: (error) => (queue.push({ error }), pump()),
    };
  }

  function themeClient({ read, stream }) {
    return {
      invokeApi: (request) => {
        NodeAssert.equal(request.method, "getTokens");
        return read(request);
      },
      subscribeApi: (request) => {
        NodeAssert.equal(request.name, "subscribeState");
        return stream;
      },
    };
  }

  NodeTest.it("clears theme overrides when the state stream closes", async () => {
    const stream = controllableStream();
    const applied = [];
    const client = themeClient({
      read: () => Promise.resolve({ tokens: { text: "#111" }, cssVars: {} }),
      stream: stream.iterable,
    });
    const done = watchThemeVars({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    await tick();
    NodeAssert.deepEqual(applied.at(-1), themeVarOverrides({ text: "#111" }, {}));
    stream.push({ type: "closed", value: {} });
    await done;
    NodeAssert.equal(applied.at(-1), null);
  });

  NodeTest.it("clears theme overrides when the state stream errors", async () => {
    const stream = controllableStream();
    const applied = [];
    const client = themeClient({
      read: () => Promise.resolve({ tokens: { text: "#111" }, cssVars: {} }),
      stream: stream.iterable,
    });
    const done = watchThemeVars({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    await tick();
    stream.fail(new Error("provider gone"));
    await done;
    NodeAssert.equal(applied.at(-1), null);
  });

  NodeTest.it("clears theme overrides when a refresh read is denied", async () => {
    const stream = controllableStream();
    const applied = [];
    let call = 0;
    const client = themeClient({
      read: () => {
        call += 1;
        return call === 1
          ? Promise.resolve({ tokens: { text: "#111" }, cssVars: {} })
          : Promise.reject(new Error("grant revoked"));
      },
      stream: stream.iterable,
    });
    const done = watchThemeVars({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    await tick();
    NodeAssert.deepEqual(applied.at(-1), themeVarOverrides({ text: "#111" }, {}));
    stream.push({ type: "data", value: {} });
    await tick();
    NodeAssert.equal(applied.at(-1), null);
    stream.end();
    await done;
  });

  NodeTest.it("a late read response cannot restore stale overrides after stream loss", async () => {
    const stream = controllableStream();
    const read = deferred();
    const applied = [];
    const client = themeClient({ read: () => read.promise, stream: stream.iterable });
    const done = watchThemeVars({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    stream.push({ type: "closed", value: {} });
    await done;
    read.resolve({ tokens: { text: "#111" }, cssVars: {} });
    await tick();
    NodeAssert.ok(applied.length >= 2);
    NodeAssert.ok(applied.every((vars) => vars === null));
  });

  NodeTest.it("a failed refresh invalidates an older in-flight read", async () => {
    const stream = controllableStream();
    const stale = deferred();
    const applied = [];
    let call = 0;
    const client = themeClient({
      read: () => {
        call += 1;
        return call === 1 ? stale.promise : Promise.reject(new Error("denied"));
      },
      stream: stream.iterable,
    });
    const done = watchThemeVars({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    // Second read (stream frame) fails while the first is still in flight;
    // the older response must not resurrect stale tokens.
    stream.push({ type: "data", value: {} });
    await tick();
    NodeAssert.equal(applied.at(-1), null);
    stale.resolve({ tokens: { text: "#111" }, cssVars: {} });
    await tick();
    NodeAssert.ok(applied.every((vars) => vars === null));
    stream.end();
    await done;
  });

  NodeTest.it("clears appearance overrides on closed, error, and malformed frames", async () => {
    const appearance = {
      theme: { background: "#000", foreground: "#fff", cursor: "#fff" },
      font: {},
      appearance: "dark",
    };
    const applied = [];
    const stream = controllableStream();
    const client = { subscribeApi: () => stream.iterable };
    const done = watchTerminalAppearanceVars({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    stream.push({ type: "snapshot", value: appearance });
    await tick();
    NodeAssert.deepEqual(applied.at(-1), terminalAppearanceVars(appearance));
    stream.push({ type: "closed", value: {} });
    await tick();
    NodeAssert.equal(applied.at(-1), null);
    await done;
  });

  NodeTest.it("clears appearance overrides when the stream throws", async () => {
    const applied = [];
    const stream = controllableStream();
    const done = watchTerminalAppearanceVars({
      client: { subscribeApi: () => stream.iterable },
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    stream.push({
      type: "snapshot",
      value: {
        theme: { background: "#000", foreground: "#fff", cursor: "#fff" },
        font: {},
        appearance: "dark",
      },
    });
    await tick();
    stream.fail(new Error("stream lost"));
    await done;
    NodeAssert.equal(applied.at(-1), null);
  });

  NodeTest.it("clears appearance overrides on a malformed frame", async () => {
    const applied = [];
    const stream = controllableStream();
    const done = watchTerminalAppearanceVars({
      client: { subscribeApi: () => stream.iterable },
      context: viewContext,
      signal: new AbortController().signal,
      apply: (vars) => applied.push(vars),
    });
    stream.push({
      type: "snapshot",
      value: {
        theme: { background: "#000", foreground: "#fff", cursor: "#fff" },
        font: {},
        appearance: "dark",
      },
    });
    await tick();
    stream.push({ type: "data", value: { not: "an appearance" } });
    await tick();
    NodeAssert.equal(applied.at(-1), null);
    stream.end();
    await done;
  });
});

NodeTest.describe("package requirements — t3.ui/* adoption policy", () => {
  NodeTest.it("declares the consumed t3.ui/* contracts as mandatory requirements", async () => {
    // Invocation authority only exists for declared APIs, so these must stay
    // in `requires`; capability resolution fails closed (missing-api) on a
    // host without the providers rather than mounting a half-contracted panel.
    const manifest = JSON.parse(
      NodeFS.readFileSync(new URL("./.t3-extension/t3-extension.json", import.meta.url), "utf8"),
    );
    NodeAssert.deepEqual(
      manifest.requires.map((item) => item.id),
      [
        "t3.terminal/sessions",
        "t3.terminal/output",
        "t3.terminal/output-events",
        "t3.terminal/control",
        "t3.ui/theme",
        "t3.ui/keybindings",
        "t3.ui/panels",
      ],
    );
  });
});
