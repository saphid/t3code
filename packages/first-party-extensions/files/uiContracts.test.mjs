import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { DEFAULT_KEYBINDINGS, parseKeybindingShortcut } from "@t3tools/shared/keybindings";

import {
  fileOpenNotification,
  FILES_THEME_VARS,
  FILES_VIEW_COMMANDS,
  themeVarOverrides,
} from "./viewModel.ts";

NodeTest.describe("themeVarOverrides", () => {
  const cssVars = {
    text: "--app-theme-text",
    canvas: "--app-theme-canvas",
    mutedForeground: "--app-theme-muted-foreground",
    border: "--app-theme-border",
    muted: "--app-theme-muted",
    accentSurface: "--app-theme-accent-surface",
    messageAction: "--app-theme-message-action",
  };

  NodeTest.it("republishes contract tokens as panel-scoped vars", () => {
    NodeAssert.deepEqual(
      themeVarOverrides(
        {
          text: "#101828",
          canvas: "#ffffff",
          mutedForeground: "#98a2b3",
          border: "#eaecf0",
          muted: "#f2f4f7",
          accentSurface: "#e8eef7",
          messageAction: "#175cd3",
        },
        cssVars,
      ),
      {
        "--t3-files-text": "var(--app-theme-text, #101828)",
        "--t3-files-canvas": "var(--app-theme-canvas, #ffffff)",
        "--t3-files-muted-foreground": "var(--app-theme-muted-foreground, #98a2b3)",
        "--t3-files-border": "var(--app-theme-border, #eaecf0)",
        "--t3-files-muted": "var(--app-theme-muted, #f2f4f7)",
        "--t3-files-accent-surface": "var(--app-theme-accent-surface, #e8eef7)",
        "--t3-files-message-action": "var(--app-theme-message-action, #175cd3)",
      },
    );
  });

  NodeTest.it("skips roles the host did not resolve rather than overriding them", () => {
    NodeAssert.deepEqual(themeVarOverrides({ text: "#101828" }, cssVars), {
      "--t3-files-text": "var(--app-theme-text, #101828)",
    });
  });

  NodeTest.it("falls back to the resolved value when no css var is advertised", () => {
    NodeAssert.deepEqual(themeVarOverrides({ mutedForeground: "#98a2b3" }, {}), {
      "--t3-files-muted-foreground": "#98a2b3",
    });
  });

  NodeTest.it("ignores roles the contract does not publish to this panel", () => {
    const overrides = themeVarOverrides(
      { mutedForeground: "#98a2b3", terminalBackground: "#000000", chrome: "#111111" },
      { ...cssVars, terminalBackground: "--app-theme-terminal-background" },
    );
    NodeAssert.deepEqual(Object.keys(overrides), ["--t3-files-muted-foreground"]);
  });

  NodeTest.it("keeps FILES_THEME_VARS inside the panel's own var namespace", () => {
    for (const property of Object.values(FILES_THEME_VARS)) {
      NodeAssert.match(property, /^--t3-files-/);
    }
  });
});

NodeTest.describe("FILES_VIEW_COMMANDS", () => {
  const COMMAND_ID = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

  NodeTest.it("registers only surface-scope commands with valid ids and titles", () => {
    NodeAssert.ok(FILES_VIEW_COMMANDS.length > 0);
    const ids = new Set();
    for (const command of FILES_VIEW_COMMANDS) {
      NodeAssert.match(command.id, COMMAND_ID);
      NodeAssert.equal(command.scope, "surface");
      NodeAssert.ok(command.title.trim().length > 0);
      NodeAssert.equal("activation" in command, false);
      NodeAssert.ok(!ids.has(command.id));
      ids.add(command.id);
    }
  });

  NodeTest.it("default keys parse under the host shortcut grammar", () => {
    for (const command of FILES_VIEW_COMMANDS) {
      if (command.defaultKey === undefined) continue;
      NodeAssert.notEqual(parseKeybindingShortcut(command.defaultKey), null, command.id);
    }
  });

  NodeTest.it("default keys never collide with an unconditional native binding", () => {
    // Plugin defaults lose arbitration to every native rule, conditional or
    // not — registering a chord a native default claims unconditionally would
    // just create a permanent conflict entry. Conditional native claims (like
    // preview.refresh under previewFocus) are fine: the plugin default only
    // fills the miss while this panel is focused.
    const unconditional = new Set(
      DEFAULT_KEYBINDINGS.filter((rule) => rule.when === undefined).map((rule) => `${rule.key}`),
    );
    for (const command of FILES_VIEW_COMMANDS) {
      if (command.defaultKey === undefined) continue;
      NodeAssert.ok(
        !unconditional.has(command.defaultKey),
        `${command.id} defaults ${command.defaultKey} which a native rule already claims`,
      );
    }
  });

  NodeTest.it("default keys only claim their chord while this surface is focused", () => {
    // `extensionCommandForKeydown` returns the first registration whose
    // defaultKey matches — a `when`-less default would claim `mod+r`/`mod+f`
    // even while another extension's surface is focused, then fail surface
    // eligibility at dispatch and swallow the chord entirely.
    for (const command of FILES_VIEW_COMMANDS) {
      if (command.defaultKey === undefined) continue;
      NodeAssert.equal(
        command.when,
        "extension.t3.files/view.focus",
        `${command.id} needs the surface-focus clause so its default misses unfocused`,
      );
    }
  });
});

NodeTest.describe("fileOpenNotification", () => {
  NodeTest.it("toasts denied and unavailable failures only", () => {
    for (const status of ["idle", "resolving", "resolved"]) {
      const state =
        status === "resolved"
          ? { status, message: "opens in t3.files/view · side-panel" }
          : { status };
      NodeAssert.equal(fileOpenNotification(state, "thread-1"), null);
    }
  });

  NodeTest.it("anchors to the calling thread when the view has one", () => {
    const input = fileOpenNotification(
      { status: "denied", message: "Open is denied — missing grant" },
      "thread-1",
    );
    NodeAssert.deepEqual(input, {
      severity: "error",
      title: "Unable to open file",
      body: "Open is denied — missing grant",
      durationMs: 5_000,
      anchor: "thread",
      threadId: "thread-1",
    });
  });

  NodeTest.it("drops the thread anchor outside a thread context", () => {
    const input = fileOpenNotification(
      { status: "unavailable", message: "No provider" },
      undefined,
    );
    NodeAssert.equal(input?.severity, "error");
    NodeAssert.equal("anchor" in input, false);
    NodeAssert.equal("threadId" in input, false);
  });
});
