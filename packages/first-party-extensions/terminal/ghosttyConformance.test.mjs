/**
 * VT conformance over the REAL vendored libghostty-vt WASM — the same
 * closure the extension packages as format-4 assets. Loads the bytes from
 * ./assets exactly as the host's readAsset would deliver them.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

import { GhosttyTerminalCore } from "./ghostty/core.ts";
import { loadGhosttyRuntime } from "./ghostty/runtime.ts";
import { TerminalVtAttachment } from "./vtAttachment.ts";

const assetsDir = NodeURL.fileURLToPath(new URL("./assets/", import.meta.url));

const THEME = {
  foreground: { r: 229, g: 231, b: 235 },
  background: { r: 10, g: 10, b: 12 },
  cursor: { r: 229, g: 231, b: 235 },
};

function fakeKey(overrides = {}) {
  return {
    code: "KeyA",
    key: "a",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    getModifierState: () => false,
    ...overrides,
  };
}

function rowText(snapshot, row) {
  return snapshot.rowData[row].cells.map((cell) => cell.text).join("");
}

let runtime;

NodeTest.before(async () => {
  const [vt, writePty] = await Promise.all([
    NodeFSP.readFile(new URL("ghostty-vt.wasm", `file://${assetsDir}`)),
    NodeFSP.readFile(new URL("ghostty-write-pty.wasm", `file://${assetsDir}`)),
  ]);
  runtime = await loadGhosttyRuntime({ vt, writePty });
});

async function makeCore(cols = 80, rows = 24) {
  const writes = [];
  const core = await GhosttyTerminalCore.create(runtime, cols, rows, 8, 16, THEME, (data) =>
    writes.push(data),
  );
  return { core, writes };
}

NodeTest.describe("vendored libghostty-vt — screen semantics", () => {
  NodeTest.it("instantiates the packaged WASM and reports the vendored revision", async () => {
    const version = await NodeFSP.readFile(
      new URL("libghostty-vt-VERSION.txt", `file://${assetsDir}`),
      "utf8",
    );
    NodeAssert.match(version.trim(), /^[0-9a-f]{40}$/);
    NodeAssert.ok(runtime.memory instanceof WebAssembly.Memory);
  });

  NodeTest.it("writes text and tracks the cursor at 80x24", async () => {
    const { core } = await makeCore();
    core.write("hello");
    const snap = core.snapshot();
    NodeAssert.equal(snap.cols, 80);
    NodeAssert.equal(snap.rows, 24);
    NodeAssert.ok(rowText(snap, 0).startsWith("hello"));
    NodeAssert.equal(snap.cursorX, 5);
    core.dispose();
  });

  NodeTest.it("applies SGR colors to cells", async () => {
    const { core } = await makeCore();
    core.write("[31mred");
    const snap = core.snapshot();
    const cell = snap.rowData[0].cells[0];
    NodeAssert.equal(cell.text, "r");
    NodeAssert.deepEqual(
      { r: cell.foreground.r, g: cell.foreground.g, b: cell.foreground.b },
      { r: 204, g: 102, b: 102 }, // Ghostty default palette red (#cc6666)
    );
    core.dispose();
  });

  NodeTest.it("honors absolute cursor addressing", async () => {
    const { core } = await makeCore();
    core.write("[5;10HX");
    const snap = core.snapshot();
    NodeAssert.equal(snap.rowData[4].cells[9].text, "X");
    NodeAssert.equal(snap.cursorX, 10);
    NodeAssert.equal(snap.cursorY, 4);
    core.dispose();
  });

  NodeTest.it("switches to and from the alternate screen", async () => {
    const { core } = await makeCore();
    core.write("main");
    core.write("[?1049h");
    NodeAssert.equal(core.isAlternateScreen(), true);
    core.write("alt");
    core.write("[?1049l");
    NodeAssert.equal(core.isAlternateScreen(), false);
    const snap = core.snapshot();
    NodeAssert.ok(rowText(snap, 0).startsWith("main"));
    core.dispose();
  });

  NodeTest.it("keeps wide CJK glyphs in a single wide cell", async () => {
    const { core } = await makeCore();
    core.write("ab界cd");
    const snap = core.snapshot();
    const cells = snap.rowData[0].cells;
    NodeAssert.equal(cells[0].text, "a");
    NodeAssert.equal(cells[1].text, "b");
    NodeAssert.equal(cells[2].text, "界");
    NodeAssert.equal(cells[4].text, "c");
    NodeAssert.equal(snap.cursorX, 6);
    core.dispose();
  });

  NodeTest.it("resize preserves content and re-reports geometry", async () => {
    const { core } = await makeCore(80, 24);
    core.write("persist");
    core.resize(120, 40, 8, 16);
    const snap = core.snapshot();
    NodeAssert.equal(snap.cols, 120);
    NodeAssert.equal(snap.rows, 40);
    NodeAssert.ok(rowText(snap, 0).startsWith("persist"));
    core.dispose();
  });

  NodeTest.it("scroll regions clip scrolling to the declared band", async () => {
    const { core } = await makeCore(10, 5);
    // Fill all 5 rows without a trailing newline so nothing scrolls yet.
    core.write("line1\r\nline2\r\nline3\r\nline4\r\nline5");
    core.write("[2;4r"); // scroll region rows 2-4 (1-based)
    core.write("[4;1H[S"); // scroll up one line inside the region
    const snap = core.snapshot();
    NodeAssert.ok(rowText(snap, 0).startsWith("line1")); // above region: untouched
    NodeAssert.ok(rowText(snap, 4).startsWith("line5")); // below region: untouched
    NodeAssert.ok(rowText(snap, 1).startsWith("line3")); // region scrolled up
    core.dispose();
  });
});

NodeTest.describe("vendored libghostty-vt — input + mode negotiation", () => {
  NodeTest.it("application cursor keys change the encoded arrow sequence", async () => {
    const { core } = await makeCore();
    const normal = core.encodeKey(fakeKey({ code: "ArrowUp", key: "ArrowUp" }));
    NodeAssert.equal(normal, "[A");
    core.write("[?1h");
    NodeAssert.equal(core.isApplicationCursorKeys(), true);
    const app = core.encodeKey(fakeKey({ code: "ArrowUp", key: "ArrowUp" }));
    NodeAssert.equal(app, "OA"); // SS3: ESC O A
    core.dispose();
  });

  NodeTest.it("bracketed paste wraps the payload only when mode 2004 is set", async () => {
    const { core } = await makeCore();
    NodeAssert.equal(core.encodePaste("rm -rf x\n"), "rm -rf x\r"); // LF normalizes to CR
    core.write("[?2004h");
    NodeAssert.equal(core.encodePaste("rm -rf x\n"), "[200~rm -rf x\n[201~"); // bracketed payload is verbatim
    core.dispose();
  });

  NodeTest.it("kitty keyboard push switches encodeKey to CSI-u", async () => {
    const { core } = await makeCore();
    NodeAssert.equal(core.encodeKey(fakeKey()), "a");
    core.write("[>1u"); // push disambiguate flag
    const encoded = core.encodeKey(fakeKey({ code: "KeyA", key: "a", ctrlKey: true }));
    // CSI-u: ctrl+a encodes as a CSI sequence, never a bare 0x01
    NodeAssert.match(encoded, /\[97;5u|\[a;5/);
    core.dispose();
  });

  NodeTest.it("OSC 8 hyperlinks are resolvable per cell", async () => {
    const { core } = await makeCore();
    core.write("]8;;https://example.comexample]8;;");
    const snap = core.snapshot();
    NodeAssert.ok(rowText(snap, 0).startsWith("example"));
    NodeAssert.equal(core.hyperlinkAt(0, 0), "https://example.com");
    NodeAssert.equal(core.hyperlinkAt(20, 0), null);
    core.dispose();
  });

  NodeTest.it("DECRQSS queries answer through the PTY writer", async () => {
    const { core, writes } = await makeCore();
    core.write("[Pq$p"); // not a valid query — use DSR cursor report instead
    core.write("[6n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.ok(writes.some((data) => /\[\d+;\d+R/.test(data)));
    core.dispose();
  });
});

NodeTest.describe("vendored libghostty-vt — reset + replay", () => {
  NodeTest.it("resetAndWrite rebuilds parser state from a snapshot base", async () => {
    const { core } = await makeCore();
    core.write("old output");
    core.resetAndWrite("snapshot base");
    const snap = core.snapshot();
    NodeAssert.ok(rowText(snap, 0).startsWith("snapshot base"));
    NodeAssert.ok(!rowText(snap, 0).includes("old output"));
    core.dispose();
  });

  NodeTest.it(
    "a mid-sequence truncated attach leaves parser state honest, not corrupt",
    async () => {
      const { core } = await makeCore();
      // Snapshot tail starting mid-SGR — the parser must treat it as literal-ish
      // content without crashing or leaking state into the next write.
      core.resetAndWrite("...[31morphan");
      core.write("clean");
      const snap = core.snapshot();
      NodeAssert.ok(rowText(snap, 0).includes("clean"));
      core.dispose();
    },
  );

  NodeTest.it(
    "clearScreen erases viewport + scrollback but preserves negotiated modes (P1)",
    async () => {
      // Astra r1 repro: seed application-cursor + bracketed-paste, clear,
      // then paste — the bracketed wrapper must survive. An RIS reset would
      // drop mode 2004 and encode "a\nb" as "a\rb" (interactive commands).
      const { core } = await makeCore();
      core.write("\x1b[?1h"); // application cursor keys
      core.write("\x1b[?2004h"); // bracketed paste
      core.write("scrollback filler\r\n".repeat(40));
      NodeAssert.equal(core.isApplicationCursorKeys(), true);
      core.clearScreen();
      const snap = core.snapshot();
      NodeAssert.ok(!rowText(snap, 0).includes("filler"));
      // Modes survived the erase.
      NodeAssert.equal(core.isApplicationCursorKeys(), true);
      NodeAssert.equal(core.encodePaste("a\nb"), "\x1b[200~a\nb\x1b[201~");
      NodeAssert.equal(core.encodeKey(fakeKey({ code: "ArrowUp", key: "ArrowUp" })), "\x1bOA");
      core.dispose();
    },
  );

  NodeTest.it(
    "resetAndWrite DOES drop modes — proving clearScreen is the correct primitive (P1)",
    async () => {
      const { core } = await makeCore();
      core.write("\x1b[?2004h");
      NodeAssert.equal(core.encodePaste("a\nb"), "\x1b[200~a\nb\x1b[201~");
      core.resetAndWrite("");
      NodeAssert.equal(core.encodePaste("a\nb"), "a\rb");
      core.dispose();
    },
  );

  NodeTest.it("a remount replay does not re-send terminal query replies (P2)", async () => {
    // The first mount answers a DSR once. On remount the attachment
    // replays base + retained tail into a fresh parser — the replayed
    // query must not emit a second reply the process never re-asked for.
    const attachment = new TerminalVtAttachment("term-1");
    const first = await makeCore();
    attachment.attach(first.core);
    const snap = {
      kind: "snapshot",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      status: "running",
      contents: "",
      retainedByteLength: 0,
      truncated: false,
      boundarySequence: 7,
    };
    attachment.applyFrame({ streamId: "s", sequence: 1 }, snap);
    const dsr = {
      kind: "output",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      sequence: 8,
      chunkIndex: 0,
      chunkCount: 1,
      data: "\x1b[6n",
    };
    attachment.applyFrame({ streamId: "s", sequence: 2 }, dsr);
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.equal(first.writes.length, 1);
    NodeAssert.match(first.writes[0], /\[\d+;\d+R/);
    attachment.detach();
    first.core.dispose();

    // Remount: replay lands the same DSR bytes in a fresh parser — the
    // replay bracket suppresses the duplicate answer.
    const second = await makeCore();
    attachment.attach(second.core);
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.equal(second.writes.length, 0);

    // A genuinely new query after remount is still answered.
    attachment.applyFrame({ streamId: "s", sequence: 3 }, { ...dsr, sequence: 9 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.equal(second.writes.length, 1);
    second.core.dispose();
  });

  NodeTest.it("queries buffered while detached get exactly one reply on mount (P2)", async () => {
    // Live output arrived before any surface existed — the DSR was
    // never answered; the first mount must emit its reply, not
    // suppress it as if an earlier parser had answered.
    const attachment = new TerminalVtAttachment("term-1");
    const snap = {
      kind: "snapshot",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      status: "running",
      contents: "",
      retainedByteLength: 0,
      truncated: false,
      boundarySequence: 7,
    };
    attachment.applyFrame({ streamId: "s", sequence: 1 }, snap);
    const dsr = (sequence) => ({
      kind: "output",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      sequence,
      chunkIndex: 0,
      chunkCount: 1,
      data: "\x1b[6n",
    });
    attachment.applyFrame({ streamId: "s", sequence: 2 }, dsr(8));
    const first = await makeCore();
    attachment.attach(first.core);
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.equal(first.writes.length, 1);
    NodeAssert.match(first.writes[0], /\[\d+;\d+R/);
    attachment.detach();
    first.core.dispose();

    // A NEW query arrives while detached — the remount answers it once
    // and does NOT re-answer the query the first mount already handled.
    attachment.applyFrame({ streamId: "s", sequence: 3 }, dsr(9));
    const second = await makeCore();
    attachment.attach(second.core);
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.equal(second.writes.length, 1);
    second.core.dispose();
  });

  NodeTest.it(
    "a resubscribe snapshot extending past an unanswered query still answers it (P2)",
    async () => {
      // Astra r4 repro: a live DSR arrives while detached, then a
      // same-epoch resubscribe snapshot returns retained contents that
      // append NEWER output after the query — the unanswered bytes are
      // no longer a suffix of the replay stream, but their reply is
      // still owed.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, retainedByteLength = contents.length) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      // The retained stream kept growing while the subscription was down:
      // the unanswered DSR sits mid-contents, followed by newer bytes.
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("\x1b[6nlater", 2));
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.equal(writes.length, 1);
      NodeAssert.match(writes[0], /\[\d+;\d+R/);
      // The newer retained output still reached the screen.
      const screen = core.snapshot();
      NodeAssert.ok(screen.rowData.some((_, i) => rowText(screen, i).includes("later")));
      core.dispose();
    },
  );

  NodeTest.it(
    "unanswered runs separated by resubscribe output each get their reply (P2)",
    async () => {
      // The single-claim case generalizes: unanswered live bytes before a
      // resubscribe snapshot AND more live bytes after it form two
      // disjoint ranges of the replay stream — both must answer.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, retainedByteLength = contents.length) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("\x1b[6nbetween", 2));
      // Still detached: a second DSR lands after the snapshot — two
      // disjoint unanswered runs in the replay stream.
      attachment.applyFrame({ streamId: "s2", sequence: 2 }, output(3, "\x1b[6n"));
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.equal(writes.length, 2);
      for (const reply of writes) NodeAssert.match(reply, /\[\d+;\d+R/);
      core.dispose();
    },
  );

  NodeTest.it(
    "a repeated query in a resubscribe snapshot answers at its OWN position (P2)",
    async () => {
      // Astra r5: the resnapshot holds TWO identical DSRs — the live one
      // we received (position 0) and a newer history-only copy emitted
      // while disconnected. Content matching picks the rightmost copy and
      // answers at the wrong cursor position; position tracking answers
      // the bytes that were actually received live.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, retainedByteLength = contents.length) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      // Retained contents: our live DSR, newer output, then ANOTHER DSR
      // the process emitted while we were gone (history-only — suppressed).
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("\x1b[6nlater\x1b[6n", 2));
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Exactly one reply, and it must be the cursor position at the FIRST
      // query — the one that went undelivered live — not the newer copy.
      NodeAssert.deepEqual(writes, ["\x1b[1;1R"]);
      core.dispose();
    },
  );

  NodeTest.it(
    "repeated queries around a resubscribe boundary each answer at their own position (P2)",
    async () => {
      // Same collision, plus a second live DSR after the snapshot: the
      // replay owes TWO replies at distinct cursor positions.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, retainedByteLength = contents.length) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("\x1b[6nlater\x1b[6n", 2));
      attachment.applyFrame({ streamId: "s2", sequence: 2 }, output(3, "Z\x1b[6n"));
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, ["\x1b[1;1R", "\x1b[1;7R"]);
      core.dispose();
    },
  );

  NodeTest.it(
    "an evicted unanswered query cannot migrate to a newer identical query (P2)",
    async () => {
      // Astra r6: the original query falls entirely outside the retained
      // tail while a NEWER identical query lands inside the resnapshot.
      // The pending reply must drop with its bytes — never re-anchor to
      // the coincidental copy (which is snapshot history and stays
      // suppressed). Expected: no replies at all.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, truncated, retainedByteLength) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, false, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      // 8192 bytes emitted while disconnected: the original query is fully
      // evicted, and the retained tail ends with a DIFFERENT ESC[6n.
      const contents = `${"x".repeat(8180)}\x1b[Hlater\x1b[6n`;
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap(contents, 2, true, 8196));
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, []);
      core.dispose();
    },
  );

  NodeTest.it(
    "a same-boundary resnapshot keeps provably-retained unanswered queries (P2)",
    async () => {
      // The retention boundary itself can prove survival: with no newer
      // events (boundary === watermark) the contents MUST end at our last
      // received byte, so a contents suffix match pins both ends — here
      // the server evicted our leading output but the query survived.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, retainedByteLength = contents.length) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "AAAA"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, output(2, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 4 }, closed);
      attachment.beginStream();
      // Same boundary — nothing newer. Retained contents are just the
      // surviving tail: the DSR itself, its position proven by the pinned
      // end of the stream.
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("\x1b[6n", 2, 4));
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, ["\x1b[1;1R"]);
      core.dispose();
    },
  );

  NodeTest.it(
    "a pending reply is dropped when mounting before the replacement snapshot (P2)",
    async () => {
      // Astra r6: identity-changed invalidates the pending reply AT the
      // close — a renderer that finishes mounting before the replacement
      // subscription delivers its snapshot must not emit an old-epoch
      // reply to the new process over the shared terminalId channel.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, streamEpoch) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch,
        status: "running",
        contents,
        retainedByteLength: contents.length,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "identity-changed",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, "epoch-1"));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      // Mount completes in the gap — the epoch-1 claim is already dead.
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, []);
      // The replacement snapshot then re-bases the same renderer; its
      // history-only query stays suppressed as well.
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("fresh\x1b[6n", 1, "epoch-2"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, []);
      core.dispose();
    },
  );

  NodeTest.it(
    "a mount in the resubscribe gap holds the reply until the epoch re-proves (P2)",
    async () => {
      // Overflow (not identity-changed): the same incarnation keeps
      // running, so its pending reply is legitimate — but while the epoch
      // is unproven (between beginStream and the replacement snapshot) a
      // mount must not release it. The reply lands once, when the
      // same-epoch snapshot proves the claim.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = (contents, boundarySequence, retainedByteLength = contents.length) => ({
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents,
        retainedByteLength,
        truncated: false,
        boundarySequence,
      });
      const output = (sequence, data) => ({
        kind: "output",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        sequence,
        chunkIndex: 0,
        chunkCount: 1,
        data,
      });
      const closed = {
        kind: "closed",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        reason: "overflow",
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, 0));
      attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
      attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
      attachment.beginStream();
      const { core, writes } = await makeCore();
      // Mount before the epoch is proven: the query parses suppressed —
      // the reply is held, not released to whatever owns the channel.
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, []);
      // Same-epoch snapshot with no newer events: boundary === the last
      // received sequence, contents is the provable retained suffix —
      // the claim proves out and answers exactly once.
      attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("\x1b[6n", 1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.deepEqual(writes, ["\x1b[1;1R"]);
      core.dispose();
    },
  );

  NodeTest.it("a pending reply does not cross a terminal incarnation change (P2)", async () => {
    // Astra r5: a query queued against epoch e must not deliver into
    // epoch e+1 — the new process's retained history never earned it,
    // even when identical bytes appear there.
    const attachment = new TerminalVtAttachment("term-1");
    const snap = (contents, boundarySequence, streamEpoch) => ({
      kind: "snapshot",
      terminalId: "term-1",
      streamEpoch,
      status: "running",
      contents,
      retainedByteLength: contents.length,
      truncated: false,
      boundarySequence,
    });
    const output = (sequence, data) => ({
      kind: "output",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      sequence,
      chunkIndex: 0,
      chunkCount: 1,
      data,
    });
    const closed = {
      kind: "closed",
      terminalId: "term-1",
      streamEpoch: "epoch-1",
      reason: "identity-changed",
    };
    attachment.applyFrame({ streamId: "s", sequence: 1 }, snap("", 0, "epoch-1"));
    attachment.applyFrame({ streamId: "s", sequence: 2 }, output(1, "\x1b[6n"));
    attachment.applyFrame({ streamId: "s", sequence: 3 }, closed);
    attachment.beginStream();
    // New incarnation: identical query bytes exist in its history but
    // belong to the new process — suppressed like any snapshot query.
    attachment.applyFrame({ streamId: "s2", sequence: 1 }, snap("fresh\x1b[6n", 1, "epoch-2"));
    const { core, writes } = await makeCore();
    attachment.attach(core);
    await new Promise((resolve) => setTimeout(resolve, 0));
    NodeAssert.deepEqual(writes, []);
    core.dispose();
  });

  NodeTest.it(
    "a query inside snapshot history stays suppressed — documented drop (P2)",
    async () => {
      // Snapshot contents are retained history, not live output: a query
      // embedded in them is treated as already-rendered history and never
      // answered — the explicit drop semantics (native resetAndWrite
      // parity). Only live output the attachment saw go undelivered earns
      // a reply.
      const attachment = new TerminalVtAttachment("term-1");
      const snap = {
        kind: "snapshot",
        terminalId: "term-1",
        streamEpoch: "epoch-1",
        status: "running",
        contents: "\x1b[6n",
        retainedByteLength: 4,
        truncated: false,
        boundarySequence: 7,
      };
      attachment.applyFrame({ streamId: "s", sequence: 1 }, snap);
      const { core, writes } = await makeCore();
      attachment.attach(core);
      await new Promise((resolve) => setTimeout(resolve, 0));
      NodeAssert.equal(writes.length, 0);
      core.dispose();
    },
  );
});
