/**
 * The header's page menu and zoom indicator — the package counterparts of the
 * native `PreviewMoreMenu` (hard reload, appearance, zoom row) and
 * `ZoomIndicator`. Every value shown is the session's engine-reported state;
 * nothing is applied optimistically, so a rejected or unanswered verb leaves
 * the menu showing what the page really has.
 */
import type { BrowserSession } from "@t3tools/extension-sdk/catalogue";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  DEFAULT_ZOOM_FACTOR,
  ZOOM_LADDER,
  zoomPercent,
  type PageAppearance,
  type PageVerb,
} from "./pageControls.js";
import type { PanelFloating } from "./popover.js";

const muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
const border = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
const control = {
  font: "inherit",
  fontSize: 12,
  padding: "2px 8px",
  border,
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
} as const;

const APPEARANCE_OPTIONS: ReadonlyArray<{ value: PageAppearance; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Native parity: the pill hides 1.5 s after the last zoom change. */
const ZOOM_INDICATOR_MS = 1500;

/**
 * Transient "X%" pill over the page whenever the engine-reported factor
 * changes. The first reported value never flashes, and there is no animation
 * — the pill appears and disappears.
 */
export function ZoomIndicator(props: {
  zoomFactor: number | null;
  /** The page area; the pill sits inside its top-right corner. */
  anchor: HTMLElement | null;
  floating: PanelFloating;
}) {
  const { zoomFactor, anchor, floating } = props;
  const [shown, setShown] = useState<number | null>(null);
  const last = useRef(zoomFactor);
  useEffect(() => {
    if (zoomFactor === null || last.current === zoomFactor) {
      last.current = zoomFactor;
      return;
    }
    const first = last.current === null;
    last.current = zoomFactor;
    if (first) return;
    setShown(zoomFactor);
    const timer = setTimeout(() => setShown(null), ZOOM_INDICATOR_MS);
    return () => clearTimeout(timer);
  }, [zoomFactor]);
  if (shown === null) return null;
  const { Popover } = floating;
  return (
    <Popover
      anchor={anchor}
      side="inset"
      offset={12}
      role="status"
      aria-label="Page zoom"
      style={{
        ...floating.style,
        pointerEvents: "none",
        padding: "3px 10px",
        borderRadius: 999,
        border,
        fontSize: 12,
        fontWeight: 500,
        background: "var(--t3-browser-canvas, var(--background, #fff))",
      }}
    >
      {zoomPercent(shown)}
    </Popover>
  );
}

/**
 * "⋯" menu: Hard reload, Appearance, the zoom row (−, any ladder factor in
 * one call, +, reset), Mute, DevTools and native picture-in-picture, then
 * `children` (the profile group).
 * `blockReason` disables every page item and says why; `run` sends one verb.
 */
export function PageMenu(props: {
  session: BrowserSession | null;
  blockReason: string | null;
  run: (verb: PageVerb) => void;
  /** One ladder step from the last requested factor (shared with the chords). */
  zoomStep: (direction: "in" | "out") => void;
  floating: PanelFloating;
  /** Rendered under the page items while open; profile actions do not need a live page. */
  children?: ReactNode;
}) {
  const { session, blockReason, run, zoomStep, floating, children } = props;
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  // The host layer portals the menu out of `root`, so it is checked on its own.
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabled = blockReason !== null;
  const zoom = session?.zoomFactor ?? null;
  const audioMuted = session?.audioMuted ?? null;
  // Null until the engine reports it: the item stays disabled rather than guessing.
  const devToolsOpen = session?.devToolsOpen ?? null;
  const pictureInPicture = session?.pictureInPicture ?? null;
  const { Popover } = floating;

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        ref={setTrigger}
        type="button"
        aria-label="Page menu"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={session === null}
        onClick={() => setOpen((value) => !value)}
        style={control}
      >
        ⋯
      </button>
      {open && (
        <Popover
          anchor={trigger}
          elementRef={(element) => {
            menu.current = element;
          }}
          role="menu"
          aria-label="Page"
          data-t3-browser-popover=""
          style={{
            ...floating.style,
            minWidth: 220,
            display: "grid",
            gap: 8,
            padding: 8,
            border,
            borderRadius: 8,
            background: "var(--t3-browser-canvas, var(--background, #fff))",
            color: "var(--t3-browser-text, var(--foreground, #20252d))",
            fontSize: 12,
          }}
        >
          {blockReason && (
            <p role="note" style={{ margin: 0, color: muted }}>
              {blockReason}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              run({ method: "hardReload" });
              setOpen(false);
            }}
            style={{ ...control, textAlign: "left" }}
          >
            Hard reload
          </button>
          <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>Appearance</span>
            <select
              aria-label="Appearance"
              disabled={disabled}
              // Unreported appearance renders blank rather than a guessed default.
              value={session?.appearance ?? ""}
              onChange={(event) =>
                run({ method: "setAppearance", appearance: event.target.value as PageAppearance })
              }
              style={control}
            >
              {session?.appearance == null && <option value="">—</option>}
              {APPEARANCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ flex: 1 }}>Zoom</span>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={disabled}
              onClick={() => zoomStep("out")}
              style={control}
            >
              −
            </button>
            <select
              aria-label="Zoom level"
              disabled={disabled}
              value={zoom === null ? "" : String(zoom)}
              onChange={(event) => run({ method: "zoom", zoomFactor: Number(event.target.value) })}
              style={{ ...control, fontVariantNumeric: "tabular-nums" }}
            >
              {zoom === null && <option value="">—</option>}
              {ZOOM_LADDER.map((level) => (
                <option key={level} value={String(level)}>
                  {zoomPercent(level)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={disabled}
              onClick={() => zoomStep("in")}
              style={control}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Reset zoom"
              disabled={disabled || zoom === DEFAULT_ZOOM_FACTOR}
              onClick={() => run({ method: "zoom", zoomFactor: DEFAULT_ZOOM_FACTOR })}
              style={control}
            >
              ↺
            </button>
          </div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={audioMuted === true}
            disabled={disabled || audioMuted === null}
            onClick={() => run({ method: "setAudioMuted", muted: audioMuted !== true })}
            style={{ ...control, textAlign: "left" }}
          >
            {audioMuted ? "Unmute page" : "Mute page"}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={devToolsOpen === true}
            disabled={disabled || devToolsOpen === null}
            onClick={() => {
              run({ method: devToolsOpen ? "closeDevTools" : "openDevTools" });
              setOpen(false);
            }}
            style={{ ...control, textAlign: "left" }}
          >
            {devToolsOpen ? "Close DevTools" : "Open DevTools"}
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={pictureInPicture === true}
            // Unreported state stays disabled rather than guessing a direction.
            disabled={disabled || pictureInPicture === null}
            onClick={() => {
              run({ method: "setPictureInPicture", open: pictureInPicture !== true });
              setOpen(false);
            }}
            style={{ ...control, textAlign: "left" }}
          >
            {pictureInPicture ? "Close picture in picture" : "Pop out (picture in picture)"}
          </button>
          {children}
        </Popover>
      )}
    </div>
  );
}
