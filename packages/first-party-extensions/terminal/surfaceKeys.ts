import type { UiKeybindingChord, UiKeybindingsHost } from "@t3tools/extension-sdk/catalogue";
import type { GlobalCommandDescriptor } from "@t3tools/extension-sdk/environment";
import { isMacPlatform } from "@t3tools/ghostty-terminal/platform";

import { TERMINAL_FOCUS_WHEN } from "./viewModel.ts";

export interface ShortcutEventLike extends UiKeybindingChord {
  type?: string;
}

/**
 * The Ghostty-level editing intercepts, as plugin-local command ids. Native
 * hard-codes these in the drawer's key handler; here they are
 * `t3.ui/keybindings` commands so user rules can rebind them.
 */
export type TerminalEditingCommandId =
  | "clear"
  | "wordBackward"
  | "wordForward"
  | "lineStart"
  | "lineEnd"
  | "deleteToLineStart";

/** The readline bytes each editing command writes to the PTY. */
export const TERMINAL_EDITING_INPUT: Readonly<Record<TerminalEditingCommandId, string>> = {
  clear: "\u000c",
  wordBackward: "\u001bb",
  wordForward: "\u001bf",
  lineStart: "\u0001",
  lineEnd: "\u0005",
  deleteToLineStart: "\u0015",
};

export function isTerminalEditingCommand(commandId: string): commandId is TerminalEditingCommandId {
  return Object.hasOwn(TERMINAL_EDITING_INPUT, commandId);
}

/**
 * Surface-scoped editing command set with the native drawer's defaults for
 * `platform`. Commands native only binds on macOS (line start/end, delete to
 * line start) still register elsewhere, just without a default, so a user
 * rule can bind them.
 */
export function terminalEditingCommands(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): readonly GlobalCommandDescriptor[] {
  const mac = isMacPlatform(platform);
  const command = (
    id: TerminalEditingCommandId,
    title: string,
    defaultKey: string | readonly string[] | null,
  ): GlobalCommandDescriptor => ({
    id,
    title,
    scope: "surface",
    ...(defaultKey === null ? {} : { defaultKey }),
    when: TERMINAL_FOCUS_WHEN,
  });
  return [
    command("clear", "Clear terminal screen", mac ? ["ctrl+l", "meta+k"] : "ctrl+l"),
    command(
      "wordBackward",
      "Move cursor back one word",
      mac ? "alt+arrowleft" : ["ctrl+arrowleft", "alt+arrowleft"],
    ),
    command(
      "wordForward",
      "Move cursor forward one word",
      mac ? "alt+arrowright" : ["ctrl+arrowright", "alt+arrowright"],
    ),
    command("lineStart", "Move cursor to line start", mac ? "meta+arrowleft" : null),
    command("lineEnd", "Move cursor to line end", mac ? "meta+arrowright" : null),
    command("deleteToLineStart", "Delete to line start", mac ? "meta+backspace" : null),
  ];
}

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "esc") return "escape";
  return normalized;
}

/**
 * The editing command a keydown triggers under the native default chords —
 * the exact matching the native drawer's intercepts apply.
 */
export function defaultTerminalEditingCommand(
  event: ShortcutEventLike,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): TerminalEditingCommandId | null {
  if (event.type !== undefined && event.type !== "keydown") return null;
  const mac = isMacPlatform(platform);
  const key = normalizeEventKey(event.key);
  const { metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event;

  if (key === "arrowleft" || key === "arrowright") {
    if (shift) return null;
    const left = key === "arrowleft";
    const word = left ? "wordBackward" : "wordForward";
    if (mac) {
      if (alt && !meta && !ctrl) return word;
      if (meta && !alt && !ctrl) return left ? "lineStart" : "lineEnd";
      return null;
    }
    if (ctrl && !meta && !alt) return word;
    if (alt && !meta && !ctrl) return word;
    return null;
  }
  if (key === "backspace") {
    return mac && meta && !ctrl && !alt && !shift ? "deleteToLineStart" : null;
  }
  if (key === "l" && ctrl && !meta && !alt && !shift) return "clear";
  if (mac && key === "k" && meta && !ctrl && !alt && !shift) return "clear";
  return null;
}

/**
 * The editing command the VT surface should apply locally for a keydown the
 * host did not dispatch. The host's capture dispatcher runs first and
 * consumes any chord it resolves to a registered command, so reaching here
 * means it could not (no binding yet, grant denied, no active thread). User
 * and native rules still outrank the defaults: when the host keymap claims
 * the chord for anything, the key is left to the encoder so typing is never
 * swallowed by a displaced default.
 */
export function terminalEditingCommandForKey(
  event: ShortcutEventLike,
  keybindings: Pick<UiKeybindingsHost, "resolveTerminalFocusKey"> | undefined,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): TerminalEditingCommandId | null {
  const command = defaultTerminalEditingCommand(event, platform);
  if (command === null) return null;
  if (keybindings !== undefined && keybindings.resolveTerminalFocusKey(event) !== null) {
    return null;
  }
  return command;
}
