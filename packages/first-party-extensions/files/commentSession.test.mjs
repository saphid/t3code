import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";

import { useCommentBlockReason, useCommentDraft, useEditorSelection } from "./commentSession.ts";

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

NodeTest.describe("useCommentDraft", () => {
  let latest;
  function Probe(props) {
    const current = useCommentDraft(props.surface, props.selected);
    React.useEffect(() => {
      latest = current;
    });
    return null;
  }

  // Built per call — a reopened or re-synced file yields a fresh string with
  // the same bytes, which === still matches (value equality on primitives).
  const bigContents = (...extra) =>
    [...Array.from({ length: 80 }, (_, index) => `line ${index + 1}`), ...extra].join("\n");

  // r3 item 1 (review F-r2-1): open a draft on L40-42, then let the buffer
  // drift under it (typing or an external sync). The captured offsets are
  // dead at read — the form goes stale and submit has nothing live to ship,
  // so attachAnnotation can never receive offsets captured against
  // different bytes.
  NodeTest.it(
    "a draft whose buffer drifted goes stale instead of shipping stale offsets",
    async () => {
      let root;
      try {
        await act(async () => {
          root = create(
            e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", bigContents()) }),
          );
        });
        await act(async () => {
          latest.openDraft({ startLine: 40, endLine: 42 });
        });
        NodeAssert.equal(latest.draftStale, false);
        NodeAssert.equal(latest.draft?.path, "a.ts");
        NodeAssert.deepEqual(latest.draft?.range, { startLine: 40, endLine: 42 });
        NodeAssert.equal(latest.draft?.excerpt, "line 40\nline 41\nline 42");

        // The drift probe: appended lines leave 40-42 visually intact but the
        // pinned bytes no longer match the live buffer — the draft is stale.
        await act(async () => {
          root.update(
            e(Probe, {
              selected: "a.ts",
              surface: editableSurface("a.ts", bigContents("synced tail")),
            }),
          );
        });
        NodeAssert.equal(latest.draftStale, true);
        // Stale stays visible — the form keeps the user's text and names the
        // drift rather than vanishing.
        NodeAssert.equal(latest.draft?.path, "a.ts");

        // Cancel still works from the stale state.
        await act(async () => {
          latest.closeDraft();
        });
        NodeAssert.equal(latest.draft, null);
        NodeAssert.equal(latest.draftStale, false);
      } finally {
        if (root) await act(async () => root.unmount());
      }
    },
  );

  // r3 item 1, navigation probe: a draft dies with navigation the way a held
  // selection does — select() closes it, and the pin retires on a path
  // change so an away-and-back reopen on byte-identical contents cannot
  // re-arm it.
  NodeTest.it("a draft does not survive navigation away and back", async () => {
    let root;
    try {
      await act(async () => {
        root = create(
          e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", bigContents()) }),
        );
      });
      await act(async () => {
        latest.openDraft({ startLine: 40, endLine: 42 });
      });
      NodeAssert.notEqual(latest.draft, null);

      await act(async () => {
        root.update(
          e(Probe, { selected: "b.ts", surface: editableSurface("b.ts", ["other"].join("\n")) }),
        );
      });
      NodeAssert.equal(latest.draft, null);
      NodeAssert.equal(latest.draftStale, false);

      // Reopening a.ts re-reads it: fresh string, byte-identical contents.
      // Without the render-phase retire the value-equal contents pin would
      // re-arm the dead draft over a buffer that may have changed in between.
      await act(async () => {
        root.update(
          e(Probe, { selected: "a.ts", surface: editableSurface("a.ts", bigContents()) }),
        );
      });
      NodeAssert.equal(latest.draft, null);
      NodeAssert.equal(latest.draftStale, false);
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });
});

NodeTest.describe("useEditorSelection memoization", () => {
  let latest;
  let renders;
  function Probe(props) {
    const current = useEditorSelection(props.surface, props.selected);
    React.useEffect(() => {
      renders += 1;
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

NodeTest.describe("useCommentBlockReason", () => {
  const session = {
    context: {
      resource: {
        namespace: "t3.extensions",
        id: "t3.files",
        environmentId: "env",
        projectId: "project",
        threadId: "thread",
      },
      client: "web",
      workspaceRevision: "rev",
    },
    signal: new AbortController().signal,
    restoring: false,
    visible: true,
    onVisibility: () => () => {},
    restoreState: null,
    publish: () => true,
    save: () => true,
    invoke: () => Promise.reject(new Error("no capabilities")),
    onDispose: () => {},
  };
  let latest;
  function Probe(props) {
    const current = useCommentBlockReason(props.host, session, props.threadId);
    React.useEffect(() => {
      latest = current;
    });
    return null;
  }
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

  // r2 finding 4: a rejected capability probe must land as a named degraded
  // transport reason, not a "Checking…" state that outlives the probe.
  NodeTest.it("a rejected probe names the failure, never a permanent checking state", async () => {
    let failProbe;
    const host = {
      invokeApi(request) {
        NodeAssert.equal(request.method, "getCapabilities");
        // Held pending so the transient "Checking…" state is observable.
        return new Promise((_, reject) => {
          failProbe = () => reject(new Error("provider connection dropped"));
        });
      },
    };
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { host, threadId: "thread-a" }));
      });
      NodeAssert.equal(latest, "Checking comment support with the host…");
      await act(async () => {
        failProbe();
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      NodeAssert.notEqual(latest, "Checking comment support with the host…");
      NodeAssert.equal(latest, "provider connection dropped");
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });

  NodeTest.it("a non-Error rejection still names a reason", async () => {
    const host = { invokeApi: () => Promise.reject("raw string") };
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { host, threadId: "thread-a" }));
      });
      await settle();
      NodeAssert.equal(latest, "Comment support could not be checked with the host.");
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });

  NodeTest.it(
    "clears a ready client transport and forwards the host's unavailable detail",
    async () => {
      const ready = {
        invokeApi: () =>
          Promise.resolve({
            adapter: "host.messages",
            transport: "client",
            detail: null,
            operations: { attachAnnotation: true },
          }),
      };
      const down = {
        invokeApi: () =>
          Promise.resolve({
            adapter: "host.messages",
            transport: "unavailable",
            detail:
              "Composer draft state is client-local; no connected client hosts the composer provider.",
            operations: { attachAnnotation: false },
          }),
      };
      let root;
      try {
        await act(async () => {
          root = create(e(Probe, { host: ready, threadId: "thread-a" }));
        });
        await settle();
        NodeAssert.equal(latest, null);

        root.update(e(Probe, { host: down, threadId: "thread-a" }));
        await settle();
        NodeAssert.equal(
          latest,
          "Composer draft state is client-local; no connected client hosts the composer provider.",
        );
      } finally {
        if (root) await act(async () => root.unmount());
      }
    },
  );

  NodeTest.it("names a missing thread scope over a ready transport", async () => {
    const ready = {
      invokeApi: () =>
        Promise.resolve({
          adapter: "host.messages",
          transport: "client",
          detail: null,
          operations: { attachAnnotation: true },
        }),
    };
    let root;
    try {
      await act(async () => {
        root = create(e(Probe, { host: ready, threadId: undefined }));
      });
      await settle();
      NodeAssert.equal(
        latest,
        "This panel has no thread scope, so there is no draft to comment into.",
      );
    } finally {
      if (root) await act(async () => root.unmount());
    }
  });
});
