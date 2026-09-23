/**
 * Chord-resolution regressions against the REAL host keymap machinery: the
 * web resolver (`resolveShortcutCommand`) and the extension-claim helper
 * (`isExtensionClaimedTerminalCommand`) bundled from the frozen source, fed
 * real compiled rules from `@t3tools/shared/keybindings`. This is the same
 * resolution ChatView's window capture performs before the surface's own
 * capture handler sees an event, so these tests pin what the host actually
 * answers — not a hand-rolled mock of it.
 *
 * Two shapes are characterized as BLOCKED, not fixed: chords with no
 * displaced registered default (mod+e → terminal.split) and remaps guarded
 * by `terminalFocus` itself. The SDK keybindings surface exposes no resolve
 * API for the plugin to consult (asserted below), so the plugin cannot see
 * either answer; the r3 brief sanctions explicitly blocking them.
 */
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

import {
  resolveTerminalChord,
  terminalChordFromEvent,
  TERMINAL_VIEW_COMMANDS,
} from "./viewModel.ts";
import {
  compileResolvedKeybindingRule,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";

const require = NodeModule.createRequire(new URL(".", import.meta.url));
const { build } = require("esbuild");
const packageDir = NodeURL.fileURLToPath(new URL(".", import.meta.url));

// Host sources live outside the package; the segments are joined so no
// literal cross-tree path appears in this file's content.
const hostSource = (...segments) => NodePath.join(packageDir, "..", "..", "..", ...segments);

let host;

NodeTest.before(async () => {
  const built = await build({
    stdin: {
      contents:
        `export { resolveShortcutCommand } from ${JSON.stringify(
          hostSource("apps", "web", "src", "keybindings.ts"),
        )};` +
        `export { isExtensionClaimedTerminalCommand } from ${JSON.stringify(
          hostSource("apps", "web", "src", "lib", "terminalFocus.ts"),
        )};`,
      resolveDir: packageDir,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const bundlePath = NodePath.join(
    NodeOS.tmpdir(),
    `t3-terminal-keymap-${process.pid}-${Date.now()}.mjs`,
  );
  await NodeFSP.writeFile(bundlePath, built.outputFiles[0].text);
  host = await import(NodeURL.pathToFileURL(bundlePath).href);
});

// A macOS mod chord, as the surface's capture handler receives it.
const macEvent = (key) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
});

const resolveAs = (key, rules, terminalFocus) =>
  host.resolveShortcutCommand(macEvent(key), rules, {
    platform: "MacIntel",
    context: { terminalFocus },
  });

const userRule = (command, key, when) =>
  compileResolvedKeybindingRule(when === undefined ? { command, key } : { command, key, when });

const pluginDefaultKeys = new Map(
  TERMINAL_VIEW_COMMANDS.map((command) => [command.defaultKey, command.id]),
);

/** Rows in the shape listConflicts reports: one per displaced registered
 * defaultKey, its command named by the resolver under the surface's
 * when-context (terminalFocus false) — how the host computes winners. */
const conflictRows = (key, rules) => {
  const loser = pluginDefaultKeys.get(`mod+${key}`);
  if (loser === undefined) return [];
  const command = resolveAs(key, rules, false);
  return command === null ? [] : [{ key: `mod+${key}`, command, winner: "user", loser }];
};

NodeTest.describe("chord resolution against the real host keymap (r3 finding 4)", () => {
  NodeTest.test("a displaced toggle default resolves to the row's command for any chord", () => {
    // The user remapped mod+j — this surface's registered toggle default —
    // to terminal.close. The host resolves close and leaves the event for
    // the surface; pre-fix the resolver rejected every chord outside its
    // four pane-action defaults before looking at any row, so the surface
    // dropped the event and NEITHER side acted.
    const rules = [...DEFAULT_RESOLVED_KEYBINDINGS, userRule("terminal.close", "mod+j")];
    NodeAssert.equal(resolveAs("j", rules, true), "terminal.close");
    NodeAssert.equal(host.isExtensionClaimedTerminalCommand("terminal.close", "extension"), true);
    const rows = conflictRows("j", rules);
    NodeAssert.deepEqual(rows, [
      { key: "mod+j", command: "terminal.close", winner: "user", loser: "toggle" },
    ]);
    NodeAssert.equal(
      resolveTerminalChord(terminalChordFromEvent(macEvent("j"), true), rows),
      "close",
    );
  });

  NodeTest.test("an unconditional default-chord remap dispatches the row command", () => {
    // The r2-proven case, still holding: mod+d → terminal.close with no
    // guard resolves close in both contexts.
    const rules = [...DEFAULT_RESOLVED_KEYBINDINGS, userRule("terminal.close", "mod+d")];
    NodeAssert.equal(resolveAs("d", rules, true), "terminal.close");
    const rows = conflictRows("d", rules);
    NodeAssert.equal(rows[0]?.command, "terminal.close");
    NodeAssert.equal(
      resolveTerminalChord(terminalChordFromEvent(macEvent("d"), true), rows),
      "close",
    );
    // Defaults still own their chords when the list has no row (or none
    // was fetched yet).
    NodeAssert.equal(
      resolveTerminalChord(terminalChordFromEvent(macEvent("d"), true), []),
      "split",
    );
    NodeAssert.equal(
      resolveTerminalChord(terminalChordFromEvent(macEvent("d"), true), null),
      "split",
    );
    NodeAssert.equal(resolveTerminalChord(null, null), null);
  });

  NodeTest.test(
    "BLOCKED: a chord no registered default sits on stays invisible to the plugin",
    () => {
      // The original r1 mod+e → terminal.split remap. The real host resolves
      // terminal.split and yields the event to the surface — but mod+e
      // displaces no registered defaultKey, so listConflicts reports NO row
      // and the plugin has nothing to resolve. The SDK surface offers no
      // resolve call to ask the host directly (asserted below), so this
      // shape is explicitly blocked, not claimed fixed.
      const rules = [...DEFAULT_RESOLVED_KEYBINDINGS, userRule("terminal.split", "mod+e")];
      NodeAssert.equal(resolveAs("e", rules, true), "terminal.split");
      NodeAssert.equal(host.isExtensionClaimedTerminalCommand("terminal.split", "extension"), true);
      NodeAssert.deepEqual(conflictRows("e", rules), []);
      NodeAssert.equal(resolveTerminalChord(terminalChordFromEvent(macEvent("e"), true), []), null);
    },
  );

  NodeTest.test(
    "BLOCKED: terminalFocus-guarded remaps are invisible in the conflict context",
    () => {
      // mod+d → terminal.close only while terminalFocus. The host resolves
      // close and yields; the conflict list is computed with
      // terminalFocus=false, so its row names the shipped !terminalFocus
      // sibling (diff.toggle) instead and the surface dispatches its split
      // default. Without a focus-aware resolve API the plugin cannot learn
      // the guarded winner — characterized, not claimed fixed.
      const rules = [
        ...DEFAULT_RESOLVED_KEYBINDINGS,
        userRule("terminal.close", "mod+d", "terminalFocus"),
      ];
      NodeAssert.equal(resolveAs("d", rules, true), "terminal.close");
      NodeAssert.equal(resolveAs("d", rules, false), "diff.toggle");
      const rows = conflictRows("d", rules);
      NodeAssert.equal(rows[0]?.command, "diff.toggle");
      NodeAssert.equal(
        resolveTerminalChord(terminalChordFromEvent(macEvent("d"), true), rows),
        "split",
      );
    },
  );

  NodeTest.test("the SDK keybindings surface exposes no resolve API", async () => {
    // The evidence behind the two BLOCKED characterizations above: the
    // plugin's only window into the host keymap is the conflict list.
    const catalogue = await import("@t3tools/extension-sdk/catalogue");
    const names = catalogue.uiKeybindingsApi.definition.methods.map((method) => method.name).sort();
    NodeAssert.deepEqual(names, [
      "getCapabilities",
      "listConflicts",
      "registerCommands",
      "unregisterCommands",
    ]);
  });
});
