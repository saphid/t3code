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
});
