import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";

import { useEditorSelection } from "./commentSession.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = TestRenderer;
const e = React.createElement;

// Built (not literal) so every call yields a distinct string identity, the
// way a fresh readSnapshot does — identical literals would intern.
const makeContents = () => ["alpha", "beta", "gamma"].join("\n");

const editableSurface = (path, contents) => ({
  path,
  open: { editable: true },
  contents,
  saveState: { kind: "saved" },
});

NodeTest.describe("useEditorSelection", () => {
  let latest;
  function Probe(props) {
    const current = useEditorSelection(props.surface, props.selected);
    React.useEffect(() => {
      latest = current;
    });
    return null;
  }

  // r2 finding 1: select L2–L3 in a.ts, open b.ts, reopen a.ts — the toolbar
  // must not re-offer the dead selection over whichever lines now sit at the
  // old offsets.
  NodeTest.it("a selection does not survive a file switch and back", async () => {
    let root;
    try {
      await act(async () => {
        root = create(
          e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", makeContents()) }),
        );
      });
      await act(async () => {
        latest.setSelection({ path: "a.ts", start: 6, end: 12 });
      });
      NodeAssert.deepEqual(latest.selectionRange, { startLine: 2, endLine: 3 });

      await act(async () => {
        root.update(
          e(Probe, {
            selected: "b.ts",
            surface: editableSurface("b.ts", ["other file"].join("\n")),
          }),
        );
      });
      NodeAssert.equal(latest.selectionRange, null);

      // Reopening a.ts re-reads it: fresh contents identity, so the stale
      // offsets from the first visit must not re-arm.
      await act(async () => {
        root.update(
          e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", makeContents()) }),
        );
      });
      NodeAssert.equal(latest.selectionRange, null);

      // The way back in is a real selection in the reopened buffer.
      await act(async () => {
        latest.setSelection({ path: "a.ts", start: 0, end: 5 });
      });
      NodeAssert.deepEqual(latest.selectionRange, { startLine: 1, endLine: 1 });
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });

  // r2 finding 1, same-path half: an external sync or reload replaces the
  // buffer under a held selection — the offsets are dead even though the
  // path still matches.
  NodeTest.it("a selection does not survive replaced contents on the same file", async () => {
    let root;
    try {
      await act(async () => {
        root = create(
          e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", makeContents()) }),
        );
      });
      await act(async () => {
        latest.setSelection({ path: "a.ts", start: 6, end: 12 });
      });
      NodeAssert.notEqual(latest.selectionRange, null);

      const replacement = ["alpha", "beta edited", "gamma"].join("\n");
      await act(async () => {
        root.update(e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", replacement) }));
      });
      NodeAssert.equal(latest.selectionRange, null);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });

  // Re-selecting the open file's row keeps the same buffer; the view clears
  // through clearSelection there (select() fires with unchanged deps).
  NodeTest.it("clearSelection drops a held selection on an unchanged buffer", async () => {
    let root;
    try {
      const contents = makeContents();
      const surface = editableSurface("a.ts", contents);
      await act(async () => {
        root = create(e(Probe, { selected: "a.ts", surface }));
      });
      await act(async () => {
        latest.setSelection({ path: "a.ts", start: 6, end: 12 });
      });
      NodeAssert.notEqual(latest.selectionRange, null);
      await act(async () => {
        latest.clearSelection();
      });
      NodeAssert.equal(latest.selectionRange, null);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });
});

NodeTest.describe("useEditorSelection memoization", () => {
  let latest;
  let renders;
  function Probe(props) {
    renders += 1;
    const current = useEditorSelection(props.surface, props.selected);
    React.useEffect(() => {
      latest = current;
    });
    return null;
  }

  // r2 finding 3: while a selection is held, unrelated re-renders (drag
  // mousemove, theme ticks, save-state flips) must not rescan the buffer —
  // selectionLineRange builds a fresh object per call, so a held reference
  // across renders is the observable proof the memo held.
  NodeTest.it("holds one line-range object across unrelated renders", async () => {
    renders = 0;
    const contents = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
    const surface = {
      path: "big.ts",
      open: { editable: true },
      contents,
      saveState: { kind: "saved" },
    };
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { selected: "big.ts", surface, bump: 0 }));
      });
      await act(async () => {
        latest.setSelection({ path: "big.ts", start: 90, end: 100 });
      });
      const held = latest.selectionRange;
      // Lines 1-9 are 7 chars ("line N\n"), line 10 on are 8: offset 90
      // sits on line 13, offset 99 on line 14.
      NodeAssert.deepEqual(held, { startLine: 13, endLine: 14 });

      // Same surface object, same selection — five unrelated re-renders.
      for (let bump = 1; bump <= 5; bump += 1) {
        await act(async () => {
          root.update(e(Probe, { selected: "big.ts", surface, bump }));
        });
        NodeAssert.ok(latest.selectionRange === held, `range identity broke at render ${bump}`);
      }
      NodeAssert.ok(renders > 5, "the probe actually re-rendered");

      // A real input change legitimately recomputes.
      await act(async () => {
        latest.setSelection({ path: "big.ts", start: 0, end: 8 });
      });
      NodeAssert.ok(latest.selectionRange !== held);
      NodeAssert.deepEqual(latest.selectionRange, { startLine: 1, endLine: 2 });
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });
});
