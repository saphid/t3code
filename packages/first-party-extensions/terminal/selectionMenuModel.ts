/**
 * Pure model for the terminal's selection popup and right-click menu, ported
 * from the native terminal drawer (`terminalSelectionMenuItems`,
 * `terminalContextMenuItems`, and its request-id supersession). The DOM half
 * lives in `selectionMenu.tsx`.
 *
 * "Add to chat" is not offered: the only composer seam (`insertContext`)
 * files a review comment, not the native terminal-context chip, so every
 * builder here runs with `canAddToChat: false`.
 */

export type TerminalMenuAction = "add-to-chat" | "copy" | "paste";

export interface TerminalMenuItem<T extends TerminalMenuAction = TerminalMenuAction> {
  readonly id: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface TerminalMenuPoint {
  readonly x: number;
  readonly y: number;
}

/** Post-selection popup: available selection actions, always enabled. */
export function terminalSelectionMenuItems(options?: {
  canAddToChat?: boolean;
}): TerminalMenuItem<"add-to-chat" | "copy">[] {
  return [
    ...(options?.canAddToChat === false
      ? []
      : [{ id: "add-to-chat", label: "Add to chat" } as const]),
    { id: "copy", label: "Copy" },
  ];
}

/**
 * Right-click menu: the selection actions (disabled until a selection exists)
 * plus Paste. Paste is always offered — the browser's own menu can only paste
 * into an editable element, so a canvas terminal never gets a usable entry.
 */
export function terminalContextMenuItems(options: {
  hasSelection: boolean;
  canAddToChat?: boolean;
}): TerminalMenuItem[] {
  const { hasSelection, canAddToChat = true } = options;
  return [
    ...terminalSelectionMenuItems({ canAddToChat }).map((item) => ({
      ...item,
      disabled: !hasSelection,
    })),
    { id: "paste", label: "Paste" },
  ];
}

/** Popup anchor: the release pointer, else the selection end, kept inside the pane. */
export function resolveSelectionActionPosition(options: {
  bounds: { left: number; top: number; width: number; height: number };
  selectionRect: { right: number; bottom: number } | null;
  pointer: TerminalMenuPoint | null;
  viewport: { width: number; height: number };
}): TerminalMenuPoint {
  const { bounds, selectionRect, pointer, viewport } = options;
  const preferred = pointer ?? {
    x: selectionRect?.right ?? bounds.left + bounds.width - 140,
    y: selectionRect ? selectionRect.bottom + 4 : bounds.top + 12,
  };
  return {
    x: Math.max(
      8,
      Math.min(Math.max(bounds.left, preferred.x), bounds.left + bounds.width, viewport.width - 8),
    ),
    y: Math.max(
      8,
      Math.min(Math.max(bounds.top, preferred.y), bounds.top + bounds.height, viewport.height - 8),
    ),
  };
}

/** Keeps a measured menu fully inside the viewport, `margin` px from each edge. */
export function clampMenuToViewport(options: {
  point: TerminalMenuPoint;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
}): TerminalMenuPoint {
  const { point, size, viewport, margin = 4 } = options;
  return {
    x: Math.min(Math.max(margin, point.x), Math.max(margin, viewport.width - size.width - margin)),
    y: Math.min(
      Math.max(margin, point.y),
      Math.max(margin, viewport.height - size.height - margin),
    ),
  };
}

export interface TerminalMenuState {
  readonly requestId: number;
  readonly kind: "selection" | "context";
  readonly items: readonly TerminalMenuItem[];
  readonly position: TerminalMenuPoint;
  /** Selection captured when the menu opened; Copy writes this, like native. */
  readonly clipboardText: string | null;
}

export interface TerminalMenuChoice {
  readonly action: TerminalMenuAction;
  readonly requestId: number;
  readonly clipboardText: string | null;
}

/**
 * Monotonic request-id supersession, as in the native drawer. Every flow
 * (popup or right-click) carries the id current when it opened; any async
 * completion checks `isCurrent` and goes silent — no error message, no focus
 * steal — once a newer flow has started.
 */
export class TerminalSelectionMenuFlow {
  private requestId = 0;
  private open: TerminalMenuState | null = null;
  private readonly onChange: (menu: TerminalMenuState | null) => void;

  constructor(onChange: (menu: TerminalMenuState | null) => void = () => {}) {
    this.onChange = onChange;
  }

  get menu(): TerminalMenuState | null {
    return this.open;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.requestId;
  }

  /** A right-click supersedes a pending or open popup and any in-flight action. */
  openContextMenu(input: {
    selectionText: string | null;
    position: TerminalMenuPoint;
  }): TerminalMenuState {
    const selectionText = nonEmpty(input.selectionText);
    return this.show({
      requestId: ++this.requestId,
      kind: "context",
      items: terminalContextMenuItems({
        hasSelection: selectionText !== null,
        canAddToChat: false,
      }),
      position: input.position,
      clipboardText: selectionText,
    });
  }

  /**
   * Opens the post-selection popup. A current popup stays as is (a repeated
   * selection-end must not reopen it); an empty selection opens nothing.
   */
  openSelectionPopup(input: {
    selectionText: string | null;
    position: TerminalMenuPoint;
  }): TerminalMenuState | null {
    if (this.ownsOpenMenu("selection")) return this.open;
    const selectionText = nonEmpty(input.selectionText);
    if (selectionText === null) {
      this.supersede();
      return null;
    }
    return this.show({
      requestId: ++this.requestId,
      kind: "selection",
      items: terminalSelectionMenuItems({ canAddToChat: false }),
      position: input.position,
      clipboardText: selectionText,
    });
  }

  /**
   * Resolves a click on an item of the menu opened as `requestId`. A stale
   * menu, a disabled item, or a missing selection resolves to null. The menu
   * closes but the id stays current, so the action it starts can still report
   * and return focus unless a newer flow supersedes it.
   */
  choose(requestId: number, action: TerminalMenuAction): TerminalMenuChoice | null {
    const menu = this.open;
    if (menu === null || menu.requestId !== requestId || !this.isCurrent(requestId)) return null;
    const item = menu.items.find((candidate) => candidate.id === action);
    this.close();
    if (!item || item.disabled === true) return null;
    if (action !== "paste" && menu.clipboardText === null) return null;
    return { action, requestId, clipboardText: menu.clipboardText };
  }

  /**
   * Passive cancellation (Escape, outside click, scroll, blur): closes the
   * open menu. It only invalidates the id when the menu it closes is current,
   * so it can never cancel a newer flow's in-flight action.
   */
  dismiss(): void {
    if (this.open === null) return;
    if (this.isCurrent(this.open.requestId)) this.requestId += 1;
    this.close();
  }

  /** Active cancellation: invalidates every flow, open or in flight. */
  supersede(): void {
    this.requestId += 1;
    this.close();
  }

  /**
   * An emptied selection may only cancel a selection flow that is still
   * current — a pending popup timer, or the open popup. A right-click menu
   * keeps the text it captured.
   */
  shouldClearOnEmptySelection(actionPending: boolean): boolean {
    return actionPending || this.ownsOpenMenu("selection");
  }

  private ownsOpenMenu(kind: TerminalMenuState["kind"]): boolean {
    return this.open?.kind === kind && this.isCurrent(this.open.requestId);
  }

  private show(menu: TerminalMenuState): TerminalMenuState {
    this.open = menu;
    this.onChange(menu);
    return menu;
  }

  private close(): void {
    if (this.open === null) return;
    this.open = null;
    this.onChange(null);
  }
}

function nonEmpty(text: string | null): string | null {
  if (text === null) return null;
  // Native gates on the trimmed text but copies the raw selection.
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "").length > 0 ? text : null;
}
