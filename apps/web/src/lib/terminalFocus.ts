export type TerminalFocusOwner = "drawer" | "right-panel" | "extension";

export function getTerminalFocusOwner(): TerminalFocusOwner | null {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return null;
  if (!activeElement.isConnected) return null;
  const owner = activeElement.closest<HTMLElement>("[data-terminal-owner]")?.dataset.terminalOwner;
  if (owner === "drawer" || owner === "right-panel" || owner === "extension") return owner;
  return null;
}

export function isTerminalFocused(): boolean {
  return getTerminalFocusOwner() !== null;
}

/**
 * Commands that act on whichever terminal surface owns focus, rather than on
 * terminal chrome (the drawer toggle stays global no matter who is focused).
 */
const FOCUSED_TERMINAL_COMMANDS: ReadonlySet<string> = new Set([
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
]);

/**
 * An extension surface that declared terminal focus owns these commands while
 * its subtree is focused. The dispatcher leaves the event untouched so the
 * surface's own keymap can handle it, and never routes it to a native surface.
 */
export function isExtensionClaimedTerminalCommand(
  command: string,
  owner: TerminalFocusOwner | null,
): boolean {
  return owner === "extension" && FOCUSED_TERMINAL_COMMANDS.has(command);
}
