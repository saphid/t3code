import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";

import {
  defaultTerminalEditingCommand,
  isTerminalEditingCommand,
  TERMINAL_EDITING_INPUT,
  terminalEditingCommandForKey,
  terminalEditingCommands,
} from "./surfaceKeys.ts";
import { registerPanelCommands, TERMINAL_FOCUS_WHEN } from "./viewModel.ts";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";

const keydown = (key, modifiers = {}) => ({
  type: "keydown",
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

/** A descriptor `defaultKey` spelling ("meta+arrowleft") as the keydown it names. */
function chordEvent(spelling) {
  const tokens = spelling.split("+");
  const key = tokens.pop();
  const modifiers = Object.fromEntries(tokens.map((token) => [`${token}Key`, true]));
  return keydown(key === "backspace" ? "Backspace" : key.replace(/^arrow/, "Arrow"), modifiers);
}

const defaultsOf = (platform) =>
  Object.fromEntries(
    terminalEditingCommands(platform).map((command) => [
      command.id,
      command.defaultKey === undefined ? [] : [command.defaultKey].flat(),
    ]),
  );

NodeTest.describe("terminal editing commands — descriptors", () => {
  NodeTest.it("registers every editing intercept as a focused surface command", () => {
    for (const platform of [MAC, LINUX]) {
      const commands = terminalEditingCommands(platform);
      NodeAssert.deepEqual(
        commands.map((command) => command.id),
        ["clear", "wordBackward", "wordForward", "lineStart", "lineEnd", "deleteToLineStart"],
      );
      for (const command of commands) {
        NodeAssert.equal(command.scope, "surface");
        NodeAssert.equal(command.when, TERMINAL_FOCUS_WHEN);
        NodeAssert.ok(command.title.length > 0);
        NodeAssert.ok(isTerminalEditingCommand(command.id));
      }
    }
    NodeAssert.equal(isTerminalEditingCommand("toggle"), false);
    NodeAssert.equal(isTerminalEditingCommand("toString"), false);
  });

  NodeTest.it("mirrors the native drawer's defaults per platform", () => {
    NodeAssert.deepEqual(defaultsOf(MAC), {
      clear: ["ctrl+l", "meta+k"],
      wordBackward: ["alt+arrowleft"],
      wordForward: ["alt+arrowright"],
      lineStart: ["meta+arrowleft"],
      lineEnd: ["meta+arrowright"],
      deleteToLineStart: ["meta+backspace"],
    });
    // Native binds no line or delete intercept off macOS; the commands still
    // register (rebindable) with no default.
    NodeAssert.deepEqual(defaultsOf(LINUX), {
      clear: ["ctrl+l"],
      wordBackward: ["ctrl+arrowleft", "alt+arrowleft"],
      wordForward: ["ctrl+arrowright", "alt+arrowright"],
      lineStart: [],
      lineEnd: [],
      deleteToLineStart: [],
    });
  });

  NodeTest.it("declares defaults the host's shortcut parser accepts", () => {
    for (const platform of [MAC, LINUX]) {
      for (const keys of Object.values(defaultsOf(platform))) {
        for (const key of keys) NodeAssert.notEqual(parseKeybindingShortcut(key), null, key);
      }
    }
  });

  NodeTest.it("each declared default is exactly a chord the local fallback applies", () => {
    for (const platform of [MAC, LINUX]) {
      for (const [id, keys] of Object.entries(defaultsOf(platform))) {
        for (const key of keys) {
          NodeAssert.equal(defaultTerminalEditingCommand(chordEvent(key), platform), id, key);
        }
      }
    }
  });

  NodeTest.it("writes the same readline bytes the native intercepts send", () => {
    NodeAssert.deepEqual(TERMINAL_EDITING_INPUT, {
      clear: "\u000c",
      wordBackward: "\u001bb",
      wordForward: "\u001bf",
      lineStart: "\u0001",
      lineEnd: "\u0005",
      deleteToLineStart: "\u0015",
    });
  });
});

NodeTest.describe("terminal editing commands — native default matching", () => {
  NodeTest.it("matches only exact modifier sets, like the native intercepts", () => {
    const cases = [
      [MAC, keydown("l", { ctrlKey: true }), "clear"],
      [MAC, keydown("k", { metaKey: true }), "clear"],
      [MAC, keydown("K", { metaKey: true }), "clear"],
      [MAC, keydown("k", { metaKey: true, shiftKey: true }), null],
      [LINUX, keydown("k", { ctrlKey: true }), null],
      [LINUX, keydown("k", { metaKey: true }), null],
      [LINUX, keydown("l", { ctrlKey: true }), "clear"],
      [MAC, keydown("ArrowLeft", { altKey: true }), "wordBackward"],
      [MAC, keydown("ArrowLeft", { altKey: true, shiftKey: true }), null],
      [MAC, keydown("ArrowLeft", { ctrlKey: true }), null],
      [MAC, keydown("ArrowRight", { metaKey: true }), "lineEnd"],
      [LINUX, keydown("ArrowRight", { metaKey: true }), null],
      [LINUX, keydown("ArrowLeft", { ctrlKey: true }), "wordBackward"],
      [LINUX, keydown("ArrowRight", { altKey: true }), "wordForward"],
      [MAC, keydown("Backspace", { metaKey: true }), "deleteToLineStart"],
      [MAC, keydown("Backspace", { altKey: true }), null],
      [LINUX, keydown("Backspace", { ctrlKey: true }), null],
      [MAC, keydown("a"), null],
      [MAC, { ...keydown("l", { ctrlKey: true }), type: "keyup" }, null],
    ];
    for (const [platform, event, expected] of cases) {
      NodeAssert.equal(
        defaultTerminalEditingCommand(event, platform),
        expected,
        `${platform} ${JSON.stringify(event)}`,
      );
    }
  });
});

NodeTest.describe("terminal editing commands — local fallback precedence", () => {
  const resolver = (answer) => {
    const chords = [];
    return {
      chords,
      resolveTerminalFocusKey(chord) {
        chords.push(chord);
        return answer;
      },
    };
  };
  const own = (binding = "pending") => ({ pluginId: "t3.terminal", binding });
  const ctrlL = () => keydown("l", { ctrlKey: true });

  NodeTest.it("applies the default when no user or native rule claims the chord", () => {
    const keybindings = resolver(null);
    const event = ctrlL();
    NodeAssert.equal(terminalEditingCommandForKey(event, keybindings, own(), MAC), "clear");
    NodeAssert.deepEqual(keybindings.chords, [event]);
  });

  NodeTest.it("applies the editing command a user rule binds, on any chord", () => {
    // Ctrl+U is no default, but a user rule names clear: the fallback runs
    // clear instead of letting Ghostty send its own 0x15.
    const event = keydown("u", { ctrlKey: true });
    NodeAssert.equal(
      terminalEditingCommandForKey(event, resolver("ext.t3.terminal.clear"), own(), MAC),
      "clear",
    );
    NodeAssert.equal(
      terminalEditingCommandForKey(ctrlL(), resolver("ext.t3.terminal.wordBackward"), own(), MAC),
      "wordBackward",
    );
  });

  NodeTest.it("yields a chord claimed by anything else to the encoder", () => {
    for (const claim of [
      "sidebar.toggle",
      "ext.acme.tools.run",
      "ext.t3.terminal.toggle",
      "ext.t3.terminal.toString",
      "ext.t3.terminalx.clear",
    ]) {
      NodeAssert.equal(
        terminalEditingCommandForKey(ctrlL(), resolver(claim), own(), MAC),
        null,
        claim,
      );
    }
  });

  NodeTest.it(
    "holds default chords while the binding is pending on a host without the resolver",
    () => {
      const altLeft = keydown("ArrowLeft", { altKey: true });
      NodeAssert.equal(
        terminalEditingCommandForKey(altLeft, undefined, own("pending"), MAC),
        "hold",
      );
      NodeAssert.equal(
        terminalEditingCommandForKey(altLeft, undefined, own("unavailable"), MAC),
        "wordBackward",
      );
      NodeAssert.equal(
        terminalEditingCommandForKey(altLeft, undefined, own("bound"), MAC),
        "wordBackward",
      );
      NodeAssert.equal(
        terminalEditingCommandForKey(keydown("a"), undefined, own("pending"), MAC),
        null,
      );
    },
  );

  NodeTest.it("ignores keyups", () => {
    const keybindings = resolver("ext.t3.terminal.clear");
    NodeAssert.equal(
      terminalEditingCommandForKey({ ...ctrlL(), type: "keyup" }, keybindings, own(), MAC),
      null,
    );
    NodeAssert.deepEqual(keybindings.chords, []);
  });
});

NodeTest.describe("terminal editing commands — registration", () => {
  const viewContext = { resource: { environmentId: "env-1", threadId: "thread-1" } };

  NodeTest.it("registers the editing set and routes only its registered commands", async () => {
    const commands = terminalEditingCommands(MAC);
    const calls = [];
    const client = {
      invokeApi(request) {
        calls.push(request);
        if (request.method === "registerCommands")
          return Promise.resolve({
            commandSetToken: "cmdset-edit",
            results: commands.map((command) => ({
              commandId: command.id,
              status: command.id === "lineEnd" ? "rejected" : "registered",
            })),
          });
        return Promise.resolve({ unregistered: true });
      },
    };
    let bound = null;
    const dispatched = [];
    const registration = await registerPanelCommands({
      client,
      context: viewContext,
      signal: new AbortController().signal,
      commands,
      bindCommands: (token, handler) => {
        bound = { token, handler };
        return "binding-1";
      },
      onCommand: (commandId) => dispatched.push(commandId),
    });
    NodeAssert.equal(registration.commandSetToken, "cmdset-edit");
    NodeAssert.deepEqual(calls[0].input, { commands });
    NodeAssert.equal(bound.token, "cmdset-edit");
    bound.handler({ commandId: "clear", context: viewContext });
    bound.handler({ commandId: "lineEnd", context: viewContext });
    NodeAssert.deepEqual(dispatched, ["clear"]);
  });
});
