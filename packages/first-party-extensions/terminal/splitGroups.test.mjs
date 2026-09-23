// Split-group model: the TerminalPanel port of the native
// terminalUiStateStore partition — split adds a pane to the active group
// (cap 4, refused before a PTY spawns), splitVertical stamps the
// direction, close collapses the group, new lands in a singleton, and
// both restore shapes round-trip.

import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { MAX_TERMINALS_PER_GROUP, TerminalPanel, normalizeTerminalGroups } from "./viewModel.ts";

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

function fakeControl(overrides = {}) {
  const calls = [];
  const ops = {
    calls,
    open(input) {
      calls.push(["open", input]);
      return Promise.resolve(meta(input.terminalId));
    },
    attach(input) {
      calls.push(["attach", input]);
      return Promise.resolve(meta(input.terminalId));
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
      return Promise.resolve(meta(input.terminalId));
    },
    close(input) {
      calls.push(["close", input]);
      return Promise.resolve({});
    },
    ...overrides,
  };
  return ops;
}

const livePanel = (options = {}) => {
  const { terminals = [], control = fakeControl(), ...panelOptions } = options;
  const panel = new TerminalPanel({ control, launch, ...panelOptions });
  panel.applySessionsEvent({ kind: "snapshot", terminals });
  return { panel, control };
};

const groupOf = (panel, id) =>
  panel.snapshot.groups.find((group) => group.terminalIds.includes(id)) ?? null;
const activeGroup = (panel) =>
  panel.snapshot.groups.find((group) => group.id === panel.snapshot.activeGroupId) ?? null;

NodeTest.describe("normalizeTerminalGroups — native partition rule", () => {
  NodeTest.it("drops dead ids, dedupes, and orphans earn singleton groups", () => {
    const groups = normalizeTerminalGroups(
      [
        { id: "g-1", terminalIds: ["a", "b", "gone"], splitDirection: "vertical" },
        { id: "g-2", terminalIds: ["b", "c"] },
        { id: "", terminalIds: [] },
      ],
      ["a", "b", "c", "d"],
    );
    NodeAssert.deepEqual(groups, [
      { id: "g-1", terminalIds: ["a", "b"], splitDirection: "vertical" },
      { id: "g-2", terminalIds: ["c"] },
      { id: "group-d", terminalIds: ["d"] },
    ]);
  });

  NodeTest.it("colliding group ids get a uniquified suffix", () => {
    const groups = normalizeTerminalGroups(
      [
        { id: "same", terminalIds: ["a"] },
        { id: "same", terminalIds: ["b"] },
      ],
      ["a", "b"],
    );
    NodeAssert.deepEqual(
      groups.map((group) => group.id),
      ["same", "same-2"],
    );
  });
});

NodeTest.describe("terminal panel — split groups", () => {
  NodeTest.it("open lands in a singleton group; split inserts after the focused pane", async () => {
    const { panel } = livePanel();
    await panel.openTerminal();
    NodeAssert.deepEqual(
      panel.snapshot.groups.map((group) => [group.id, group.terminalIds]),
      [["group-term-1", ["term-1"]]],
    );
    NodeAssert.equal(panel.snapshot.activeGroupId, "group-term-1");

    await panel.splitTerminal("horizontal");
    const group = activeGroup(panel);
    NodeAssert.deepEqual(group.terminalIds, ["term-1", "term-2"]);
    NodeAssert.equal(group.splitDirection, "horizontal");
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-2");

    // Splitting from the first pane inserts right after it, not at the end.
    panel.activate("term-1");
    await panel.splitTerminal("horizontal");
    NodeAssert.deepEqual(activeGroup(panel).terminalIds, ["term-1", "term-3", "term-2"]);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-3");
    panel.dispose();
  });

  NodeTest.it(
    "splitVertical stamps the direction; a later horizontal split restores it",
    async () => {
      const { panel } = livePanel();
      await panel.openTerminal();
      await panel.splitTerminal("vertical");
      NodeAssert.equal(activeGroup(panel).splitDirection, "vertical");
      await panel.splitTerminal("horizontal");
      NodeAssert.equal(activeGroup(panel).splitDirection, "horizontal");
      panel.dispose();
    },
  );

  NodeTest.it("refuses the fifth split before any PTY spawns", async () => {
    const { panel, control } = livePanel();
    await panel.openTerminal();
    for (let i = 0; i < MAX_TERMINALS_PER_GROUP - 1; i += 1) {
      NodeAssert.notEqual(await panel.splitTerminal("horizontal"), null);
    }
    NodeAssert.equal(activeGroup(panel).terminalIds.length, MAX_TERMINALS_PER_GROUP);
    const opensBefore = control.calls.filter(([m]) => m === "open").length;
    NodeAssert.equal(await panel.splitTerminal("horizontal"), null);
    NodeAssert.equal(await panel.splitTerminal("vertical"), null);
    NodeAssert.equal(control.calls.filter(([m]) => m === "open").length, opensBefore);
    NodeAssert.equal(activeGroup(panel).terminalIds.length, MAX_TERMINALS_PER_GROUP);
    panel.dispose();
  });

  NodeTest.it("a split with no sessions degenerates to a plain open", async () => {
    const { panel } = livePanel();
    const id = await panel.splitTerminal("vertical");
    NodeAssert.equal(id, "term-1");
    NodeAssert.deepEqual(activeGroup(panel).terminalIds, ["term-1"]);
    panel.dispose();
  });

  NodeTest.it("split respects the stream gate like open", async () => {
    const control = fakeControl();
    const panel = new TerminalPanel({ control, launch });
    NodeAssert.equal(await panel.splitTerminal("horizontal"), null);
    NodeAssert.equal(control.calls.length, 0);
    NodeAssert.equal(panel.snapshot.panelError, "Session list is still connecting.");
    panel.dispose();
  });

  NodeTest.it("new opens its own group; closing a pane collapses the split group", async () => {
    const { panel } = livePanel();
    await panel.openTerminal();
    await panel.splitTerminal("horizontal"); // [term-1, term-2]
    await panel.openTerminal(); // term-3 lands in its own group
    NodeAssert.equal(panel.snapshot.groups.length, 2);
    NodeAssert.equal(activeGroup(panel).terminalIds.length, 1);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-3");

    // Focus pane 1 of the split group, then close it — pane 2 slides in.
    panel.activate("term-1");
    NodeAssert.equal(panel.snapshot.activeGroupId, groupOf(panel, "term-1").id);
    panel.requestAction("term-1", "close");
    await panel.confirmAction("term-1");
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-2", "term-3"]);
    const remaining = groupOf(panel, "term-2");
    NodeAssert.deepEqual(remaining.terminalIds, ["term-2"]);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-2");
    NodeAssert.equal(panel.snapshot.activeGroupId, remaining.id);
    panel.dispose();
  });

  NodeTest.it(
    "closing the focused pane activates the pane in its slot, not the first",
    async () => {
      const { panel } = livePanel();
      await panel.openTerminal();
      await panel.splitTerminal("horizontal"); // [t1, t2]
      await panel.splitTerminal("horizontal"); // [t1, t2, t3]
      await panel.openTerminal(); // t4 own group
      // Active is t4; go back to the split group and close the middle pane.
      panel.activate("term-2");
      panel.requestAction("term-2", "close");
      await panel.confirmAction("term-2");
      NodeAssert.equal(panel.snapshot.activeTerminalId, "term-3");
      panel.dispose();
    },
  );

  NodeTest.it("reconcile keeps group membership; departed sessions leave their group", async () => {
    const { panel } = livePanel();
    await panel.openTerminal();
    await panel.splitTerminal("vertical");
    panel.applySessionsEvent({ kind: "snapshot", terminals: [meta("term-1"), meta("term-9")] });
    NodeAssert.deepEqual(panel.snapshot.terminalIds, ["term-1", "term-9"]);
    const groups = panel.snapshot.groups;
    NodeAssert.equal(groups.length, 2);
    // term-9 was unassigned — a fresh singleton, not folded into term-1's group.
    NodeAssert.deepEqual(groupOf(panel, "term-9").terminalIds, ["term-9"]);
    panel.dispose();
  });

  NodeTest.it("a server upsert for a new id earns a singleton group", async () => {
    const { panel } = livePanel({ terminals: [meta("term-1")] });
    panel.applySessionsEvent({ kind: "upsert", terminal: meta("term-2") });
    NodeAssert.deepEqual(groupOf(panel, "term-2").terminalIds, ["term-2"]);
    panel.dispose();
  });

  NodeTest.it("input stays per-pane: sendInput writes only to the addressed terminal", async () => {
    const control = fakeControl();
    const { panel } = livePanel({ control });
    await panel.openTerminal();
    await panel.splitTerminal("horizontal");
    panel.sendInput("term-2", "pane-two\r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const writes = control.calls.filter(([m]) => m === "write").map(([, i]) => i);
    NodeAssert.deepEqual(writes, [{ terminalId: "term-2", data: "pane-two\r" }]);
    panel.dispose();
  });
});

NodeTest.describe("terminal panel — split-group restore", () => {
  NodeTest.it("old-shape records (no groups) restore as one singleton group per session", () => {
    const panel = new TerminalPanel({
      control: fakeControl(),
      launch,
      restored: { terminalIds: ["term-1", "term-2"], activeTerminalId: "term-2" },
    });
    NodeAssert.deepEqual(
      panel.snapshot.groups.map((group) => [group.id, group.terminalIds]),
      [
        ["group-term-1", ["term-1"]],
        ["group-term-2", ["term-2"]],
      ],
    );
    NodeAssert.equal(panel.snapshot.activeGroupId, "group-term-2");
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-2");
    panel.dispose();
  });

  NodeTest.it("new-shape records restore groups, direction, and the active group", () => {
    const panel = new TerminalPanel({
      control: fakeControl(),
      launch,
      restored: {
        terminalIds: ["term-1", "term-2", "term-3", "term-4"],
        activeTerminalId: "term-3",
        terminalGroups: [
          { id: "group-term-1", terminalIds: ["term-1", "term-2"] },
          { id: "group-term-3", terminalIds: ["term-3", "term-4"], splitDirection: "vertical" },
        ],
        activeTerminalGroupId: "group-term-3",
      },
    });
    NodeAssert.deepEqual(panel.snapshot.groups, [
      { id: "group-term-1", terminalIds: ["term-1", "term-2"], splitDirection: "horizontal" },
      { id: "group-term-3", terminalIds: ["term-3", "term-4"], splitDirection: "vertical" },
    ]);
    NodeAssert.equal(panel.snapshot.activeGroupId, "group-term-3");
    panel.dispose();
  });

  NodeTest.it("a 3-pane vertical restore survives a reconcile snapshot intact", () => {
    const restored = {
      terminalIds: ["term-1", "term-2", "term-3"],
      activeTerminalId: "term-2",
      terminalGroups: [
        {
          id: "group-term-1",
          terminalIds: ["term-1", "term-2", "term-3"],
          splitDirection: "vertical",
        },
      ],
      activeTerminalGroupId: "group-term-1",
    };
    const panel = new TerminalPanel({ control: fakeControl(), launch, restored });
    panel.applySessionsEvent({
      kind: "snapshot",
      terminals: [meta("term-1"), meta("term-2"), meta("term-3")],
    });
    NodeAssert.deepEqual(panel.snapshot.groups, [
      {
        id: "group-term-1",
        terminalIds: ["term-1", "term-2", "term-3"],
        splitDirection: "vertical",
      },
    ]);
    NodeAssert.equal(panel.snapshot.activeTerminalId, "term-2");
    NodeAssert.equal(panel.snapshot.activeGroupId, "group-term-1");
    panel.dispose();
  });

  NodeTest.it("a restored group id that no longer exists falls back to the active group", () => {
    const panel = new TerminalPanel({
      control: fakeControl(),
      launch,
      restored: {
        terminalIds: ["term-1", "term-2"],
        activeTerminalId: "term-2",
        terminalGroups: [
          { id: "group-term-1", terminalIds: ["term-1"] },
          { id: "group-term-2", terminalIds: ["term-2"] },
        ],
        activeTerminalGroupId: "group-gone",
      },
    });
    NodeAssert.equal(panel.snapshot.activeGroupId, "group-term-2");
    panel.dispose();
  });
});
