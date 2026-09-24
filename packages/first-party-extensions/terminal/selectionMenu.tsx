import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { GhosttyTerminalSurface } from "./ghostty/surface.ts";
import { SELECTION_MULTI_CLICK_INTERVAL_MS } from "./ghostty/selection.ts";
import {
  TerminalSelectionMenuFlow,
  clampMenuToViewport,
  resolveSelectionActionPosition,
  type TerminalMenuAction,
  type TerminalMenuPoint,
  type TerminalMenuState,
} from "./selectionMenuModel.ts";

type MenuSurface = Pick<
  GhosttyTerminalSurface,
  | "focus"
  | "hasSelection"
  | "getSelection"
  | "getSelectionEndClientRect"
  | "pasteFromClipboard"
  | "write"
>;

interface ControllerDeps {
  readonly getMount: () => HTMLElement | null;
  readonly getSurface: () => MenuSurface | null;
  readonly reportError: (surface: MenuSurface, message: string) => void;
}

/**
 * DOM half of the selection popup and right-click menu: gesture tracking,
 * dismissal, and the Copy/Paste actions. Supersession lives in
 * `TerminalSelectionMenuFlow`; every async completion checks its request id.
 */
class TerminalSelectionMenuController {
  readonly flow: TerminalSelectionMenuFlow;
  private readonly deps: ControllerDeps;
  private menuElement: HTMLElement | null = null;
  private timer: number | null = null;
  private frame: number | null = null;
  private gestureActive = false;

  constructor(deps: ControllerDeps, onChange: (menu: TerminalMenuState | null) => void) {
    this.deps = deps;
    this.flow = new TerminalSelectionMenuFlow(onChange);
  }

  /** Ref callback for the rendered menu, used by the outside-click test. */
  readonly setMenuElement = (element: HTMLElement | null): void => {
    this.menuElement = element;
  };

  /** Surface option: a right-click the running app did not claim through mouse reporting. */
  readonly onContextMenu = (event: MouseEvent): void => {
    // Own the gesture before anything else: the browser's own menu has a
    // Paste entry that can never reach a canvas terminal.
    event.preventDefault();
    // A macOS Ctrl-click starts as a primary press; its release must not
    // reopen the selection popup over this menu.
    this.cancelPending();
    this.gestureActive = false;
    const surface = this.deps.getSurface();
    if (surface === null) return;
    this.flow.openContextMenu({
      selectionText: surface.hasSelection() ? surface.getSelection() : null,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  /** Surface option: an emptied selection cancels a still-current popup flow. */
  readonly onSelectionChange = (): void => {
    if (this.deps.getSurface()?.hasSelection()) return;
    if (!this.flow.shouldClearOnEmptySelection(this.pending)) return;
    this.cancelPending();
    this.flow.supersede();
  };

  readonly choose = async (requestId: number, action: TerminalMenuAction): Promise<void> => {
    const choice = this.flow.choose(requestId, action);
    const surface = this.deps.getSurface();
    if (choice === null || surface === null) return;
    const reportIfCurrent = (error: unknown, fallback: string) => {
      if (this.flow.isCurrent(requestId)) {
        this.deps.reportError(surface, error instanceof Error ? error.message : fallback);
      }
    };
    if (choice.action === "copy" && choice.clipboardText !== null) {
      try {
        await copyText(choice.clipboardText, surface);
      } catch (error) {
        reportIfCurrent(error, "Unable to copy terminal selection");
      }
    } else if (choice.action === "paste") {
      try {
        // The surface claims its paste token before the read starts, so a
        // paste shortcut fired during the read supersedes this one instead of
        // both reaching the shell.
        await surface.pasteFromClipboard(readClipboardText, () => this.flow.isCurrent(requestId));
      } catch (error) {
        reportIfCurrent(error, "Unable to read the clipboard");
        return;
      }
    }
    if (this.flow.isCurrent(requestId)) surface.focus();
  };

  install(mount: HTMLElement): () => void {
    const document = mount.ownerDocument;
    const view = document.defaultView!;
    const insideMenu = (event: Event) =>
      this.menuElement !== null && event.composedPath().includes(this.menuElement);

    // The surface stops propagation for presses it consumes (mouse reporting,
    // link activation, scrollbar), so only real selection gestures arrive.
    const onMountPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      this.cancelPending();
      this.gestureActive = event.button === 0 && !event.defaultPrevented;
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!insideMenu(event)) this.flow.dismiss();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0 || !this.gestureActive) return;
      this.gestureActive = false;
      const pointer = { x: event.clientX, y: event.clientY };
      // Double/triple-click selections get time to finish their sequence.
      this.schedule(pointer, event.detail >= 2 ? SELECTION_MULTI_CLICK_INTERVAL_MS : 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.flow.menu !== null) {
        this.flow.dismiss();
        // The menu never takes focus, so Escape arrives at the terminal: it
        // closes the menu there instead of reaching the shell.
        if (event.composedPath().includes(mount)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (!insideMenu(event)) this.cancelPending();
    };
    const dismiss = () => {
      this.cancelPending();
      this.gestureActive = false;
      this.flow.dismiss();
    };
    // The menu never takes focus, so focus leaving the pane means the user
    // moved on (Tab, another panel).
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (mount.contains(next) || this.menuElement?.contains(next)))
        return;
      dismiss();
    };
    // Only a scroll that moves the pane (an ancestor, or the page) strands the
    // anchor; unrelated scrollers such as a streaming chat must not dismiss.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target === document || (target instanceof Node && target.contains(mount))) dismiss();
    };

    mount.addEventListener("pointerdown", onMountPointerDown);
    // Canvas scrollback moves on wheel, which never fires a scroll event.
    mount.addEventListener("wheel", dismiss, { passive: true });
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    mount.addEventListener("focusout", onFocusOut);
    view.addEventListener("mouseup", onMouseUp);
    view.addEventListener("pointercancel", dismiss);
    view.addEventListener("blur", dismiss);
    view.addEventListener("resize", dismiss);
    return () => {
      mount.removeEventListener("pointerdown", onMountPointerDown);
      mount.removeEventListener("wheel", dismiss);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      mount.removeEventListener("focusout", onFocusOut);
      view.removeEventListener("mouseup", onMouseUp);
      view.removeEventListener("pointercancel", dismiss);
      view.removeEventListener("blur", dismiss);
      view.removeEventListener("resize", dismiss);
      this.cancelPending();
      this.gestureActive = false;
      this.flow.supersede();
    };
  }

  private get pending(): boolean {
    return this.timer !== null || this.frame !== null;
  }

  private schedule(pointer: TerminalMenuPoint, delay: number): void {
    this.cancelPending();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.frame = window.requestAnimationFrame(() => {
        this.frame = null;
        this.showSelectionPopup(pointer);
      });
    }, delay);
  }

  private showSelectionPopup(pointer: TerminalMenuPoint): void {
    const surface = this.deps.getSurface();
    const mount = this.deps.getMount();
    if (surface === null || mount === null) {
      this.flow.supersede();
      return;
    }
    const hasSelection = surface.hasSelection();
    this.flow.openSelectionPopup({
      selectionText: hasSelection ? surface.getSelection() : null,
      position: resolveSelectionActionPosition({
        bounds: mount.getBoundingClientRect(),
        selectionRect: hasSelection ? surface.getSelectionEndClientRect() : null,
        pointer,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    });
  }

  private cancelPending(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.timer = this.frame = null;
  }
}

/**
 * Writes the captured selection. The async clipboard covers a normal menu
 * click; where it is missing or denied, fall back to the surface's own copy
 * event path (focused input + `execCommand("copy")`), which writes the live
 * selection — so only when that is still the captured text.
 */
async function copyText(text: string, surface: MenuSurface): Promise<void> {
  let failure: unknown = new Error("Clipboard writes are unavailable in this browser.");
  const clipboard = navigator.clipboard;
  if (typeof clipboard?.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch (error) {
      failure = error;
    }
  }
  if (surface.hasSelection() && surface.getSelection() === text) {
    surface.focus();
    if (document.execCommand("copy")) return;
  }
  throw failure;
}

async function readClipboardText(): Promise<string> {
  const clipboard = navigator.clipboard;
  if (typeof clipboard?.readText !== "function") {
    throw new Error("Clipboard reads are unavailable in this browser.");
  }
  return clipboard.readText();
}

/**
 * Selection popup + right-click menu for one VT pane. Pass `onContextMenu`
 * and `onSelectionChange` into the surface options and render `menu` next to
 * the mount. Both callbacks are stable for the pane's lifetime.
 */
export function useTerminalSelectionMenu(options: {
  mountRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<MenuSurface | null>;
  reportError: (surface: MenuSurface, message: string) => void;
}): {
  onContextMenu: (event: MouseEvent) => void;
  onSelectionChange: () => void;
  menu: ReactNode;
} {
  const { mountRef, surfaceRef, reportError } = options;
  const [menu, setMenu] = useState<TerminalMenuState | null>(null);
  // Refs are stable, so the controller (and the callbacks the surface keeps)
  // lives for the pane's lifetime; `reportError` must be stable too.
  const [controller] = useState(
    () =>
      new TerminalSelectionMenuController(
        {
          getMount: () => mountRef.current,
          getSurface: () => surfaceRef.current,
          reportError,
        },
        setMenu,
      ),
  );

  useEffect(() => {
    const mount = mountRef.current;
    // Non-DOM renderers (react-test-renderer node mocks) have nothing to observe.
    if (mount === null || typeof mount.addEventListener !== "function") return;
    return controller.install(mount);
  }, [controller, mountRef]);

  return {
    onContextMenu: controller.onContextMenu,
    onSelectionChange: controller.onSelectionChange,
    menu:
      menu === null ? null : (
        <TerminalMenu
          key={menu.requestId}
          menu={menu}
          elementRef={controller.setMenuElement}
          onChoose={(action) => void controller.choose(menu.requestId, action)}
        />
      ),
  };
}

const MENU_STYLE = `
[data-t3-terminal-menu] button{display:flex;width:100%;align-items:center;min-height:26px;padding:4px 10px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:default}
[data-t3-terminal-menu] button:not(:disabled):hover,[data-t3-terminal-menu] button:not(:disabled):focus-visible{background:var(--t3-terminal-accent-surface,var(--accent,#e8eef7));outline:none}
[data-t3-terminal-menu] button:disabled{color:var(--t3-terminal-muted,var(--muted-foreground,#667085));opacity:.64}
`;

function TerminalMenu(props: {
  menu: TerminalMenuState;
  elementRef: (element: HTMLDivElement | null) => void;
  onChoose: (action: TerminalMenuAction) => void;
}) {
  const { menu, elementRef, onChoose } = props;
  const ref = useRef<HTMLDivElement | null>(null);

  // Clamp the measured menu into the viewport before paint. The second read
  // corrects for an ancestor that became the fixed containing block.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.style.left = `${menu.position.x}px`;
    element.style.top = `${menu.position.y}px`;
    const rect = element.getBoundingClientRect();
    const clamped = clampMenuToViewport({
      point: menu.position,
      size: rect,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    element.style.left = `${clamped.x - (rect.left - menu.position.x)}px`;
    element.style.top = `${clamped.y - (rect.top - menu.position.y)}px`;
  }, [menu]);

  return (
    <div
      ref={(element) => {
        ref.current = element;
        elementRef(element);
      }}
      role="menu"
      aria-label={menu.kind === "selection" ? "Selection actions" : "Terminal actions"}
      data-t3-terminal-menu={menu.kind}
      // Keep keyboard focus in the terminal while the menu is clicked.
      onMouseDown={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        left: menu.position.x,
        top: menu.position.y,
        zIndex: 10000,
        minWidth: 120,
        padding: 4,
        borderRadius: 6,
        border: "1px solid var(--t3-terminal-border, var(--border, #dfe3e8))",
        background: "var(--t3-terminal-canvas, var(--popover, var(--background, #fff)))",
        color: "var(--t3-terminal-text, var(--foreground, #20252d))",
        boxShadow: "0 4px 16px rgb(0 0 0 / 0.18)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: 13,
        lineHeight: "18px",
      }}
    >
      <style>{MENU_STYLE}</style>
      {menu.items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled === true}
          onClick={() => onChoose(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
