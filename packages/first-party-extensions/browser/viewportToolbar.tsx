import type { BrowserSessionViewport } from "@t3tools/extension-sdk/catalogue";
import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  DEVICE_TOOLBAR_HEIGHT,
  DEVICE_VIEWPORT_RAIL,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  PREVIEW_VIEWPORT_PRESETS,
  deviceViewportLayout,
  freeformFromSetting,
  presetViewport,
  rotateViewport,
  VIEWPORT_RAIL_KEY_COMMIT_DELAY_MS,
  createRailGestures,
  deviceViewportArea,
  railKeyDelta,
  resizeViewportBy,
  resizeViewportFromRail,
  validFreeformSize,
  viewportSettingKey,
  type FixedViewport,
  type ViewportFrameLayout,
  type RailPreview,
  type ViewportRailDirection,
} from "./viewport.js";

const muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
const border = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
const chromeButton = {
  font: "inherit",
  fontSize: 12,
  lineHeight: 1,
  padding: "3px 6px",
  border,
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
} as const;
const numberInput = {
  font: "inherit",
  fontSize: 12,
  width: 52,
  padding: "2px 4px",
  border,
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
} as const;

/**
 * Measures an element with a `ResizeObserver` — the slot area's live size
 * feeds the responsive toggle default and the frame overlay geometry. Null
 * until the first observation, the same "not measured yet" state native
 * `panelRect` starts from. Takes the element itself (held in state by a
 * callback ref) so an element that mounts after the view is still observed.
 */
export function useElementSize(
  element: HTMLElement | null,
): { readonly width: number; readonly height: number } | null {
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null,
  );
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize((current) =>
        current !== null && current.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * The device toolbar, overlaying the top strip of the slot area (the height
 * the host's engine view already reserves, `DEVICE_TOOLBAR_HEIGHT`). Native
 * `BrowserDeviceToolbar` semantics: a Responsive/preset picker, freeform
 * width × height inputs, rotate, and close back to fill. Every change is a
 * `sessions.resize` through `onCommit`; nothing applies optimistically, so a
 * rejected commit leaves the toolbar showing the session's last setting.
 */
export function BrowserViewportToolbar(props: {
  readonly setting: FixedViewport;
  readonly pending: boolean;
  readonly onCommit: (next: BrowserSessionViewport) => void;
}) {
  const { setting, pending, onCommit } = props;
  // An in-progress edit is keyed to the setting it was typed against: a
  // resize landing from anywhere — this view's receipt, the events stream,
  // another client — retires the edit instead of showing it against a
  // setting it no longer describes.
  const [edit, setEdit] = useState<{
    readonly key: string;
    readonly width: string;
    readonly height: string;
  } | null>(null);
  const committedKey = viewportSettingKey(setting);
  const customSize =
    edit !== null && edit.key === committedKey ? { width: edit.width, height: edit.height } : null;

  const presentedSize = customSize ?? {
    width: String(setting.width),
    height: String(setting.height),
  };
  const customWidth = Number(presentedSize.width);
  const customHeight = Number(presentedSize.height);
  const customValid = validFreeformSize(customWidth, customHeight);
  const selectedValue =
    setting._tag === "preset" &&
    PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === setting.presetId)
      ? setting.presetId
      : "responsive";

  const applyCustomSize = () => {
    if (!customValid || (customWidth === setting.width && customHeight === setting.height)) {
      setEdit(null);
      return;
    }
    onCommit({ _tag: "freeform", width: customWidth, height: customHeight });
  };

  // Toolbar actions keep focus where it is. A clicked button takes no focus
  // on macOS, so the press would blur the edited field out of the toolbar,
  // commit the edit, and disable the button before its click landed.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  const selectViewport = (value: string) => {
    if (value === "responsive") {
      // Already freeform: the size is the user's to edit, nothing to switch.
      if (setting._tag === "freeform") return;
      onCommit(freeformFromSetting(setting));
      return;
    }
    const preset = presetViewport(value);
    if (preset) onCommit(preset);
  };

  return (
    <div
      role="toolbar"
      aria-label="Browser device toolbar"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: DEVICE_TOOLBAR_HEIGHT,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 6px",
        boxSizing: "border-box",
        background: "var(--t3-browser-canvas, var(--background, #fff))",
        borderBottom: border,
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
      // Commit a finished freeform edit when focus leaves the whole toolbar,
      // like native's relatedTarget check — tabbing between fields is not a
      // finished edit.
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        applyCustomSize();
      }}
    >
      <select
        aria-label="Browser device preset"
        value={selectedValue}
        disabled={pending}
        onChange={(event) => selectViewport(event.target.value)}
        style={{ ...chromeButton, padding: "2px 4px" }}
      >
        <option value="responsive">Responsive</option>
        {PREVIEW_VIEWPORT_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {`${preset.label} — ${preset.detail}`}
          </option>
        ))}
      </select>
      <form
        style={{ display: "flex", alignItems: "center", gap: 4, margin: 0 }}
        aria-label="Viewport dimensions"
        onSubmit={(event) => {
          event.preventDefault();
          applyCustomSize();
        }}
        // Two number fields and no submit button block implicit submission,
        // so Enter commits here, as native's onSubmit intends.
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          applyCustomSize();
        }}
      >
        <input
          type="number"
          inputMode="numeric"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.width}
          disabled={pending}
          onFocus={() =>
            setEdit((current) =>
              current && current.key === committedKey
                ? current
                : {
                    key: committedKey,
                    width: String(setting.width),
                    height: String(setting.height),
                  },
            )
          }
          onChange={(event) =>
            setEdit((current) => ({
              key: committedKey,
              width: event.target.value,
              height:
                current && current.key === committedKey ? current.height : String(setting.height),
            }))
          }
          aria-label="Viewport width"
          aria-invalid={!customValid}
          style={numberInput}
        />
        <span aria-hidden style={{ color: muted, fontSize: 11 }}>
          ×
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={PREVIEW_VIEWPORT_MIN_DIMENSION}
          max={PREVIEW_VIEWPORT_MAX_DIMENSION}
          value={presentedSize.height}
          disabled={pending}
          onFocus={() =>
            setEdit((current) =>
              current && current.key === committedKey
                ? current
                : {
                    key: committedKey,
                    width: String(setting.width),
                    height: String(setting.height),
                  },
            )
          }
          onChange={(event) =>
            setEdit((current) => ({
              key: committedKey,
              width:
                current && current.key === committedKey ? current.width : String(setting.width),
              height: event.target.value,
            }))
          }
          aria-label="Viewport height"
          aria-invalid={!customValid}
          style={numberInput}
        />
      </form>
      <button
        type="button"
        aria-label="Rotate viewport"
        disabled={pending}
        onMouseDown={keepFocus}
        onClick={() =>
          onCommit(
            rotateViewport(
              setting,
              customValid ? { width: customWidth, height: customHeight } : null,
            ),
          )
        }
        style={chromeButton}
      >
        ⟳
      </button>
      <button
        type="button"
        aria-label="Close device toolbar"
        disabled={pending}
        onMouseDown={keepFocus}
        onClick={() => {
          setEdit(null);
          onCommit({ _tag: "fill" });
        }}
        style={{ ...chromeButton, marginLeft: "auto" }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * The visible device frame, painted from the same layout math the host's
 * engine view uses inside the presented slot rect, so the ring and the fit
 * percentage coincide with the composited page. `pointer-events: none`
 * keeps the overlay out of the slot's center-point occlusion probe and lets
 * pointer input fall through to the engine.
 */
export function ViewportDeviceFrame(props: {
  readonly slot: { readonly width: number; readonly height: number } | null;
  readonly setting: FixedViewport;
  readonly fallbackSlot: { readonly width: number; readonly height: number };
  readonly zoomFactor: number;
}): ReactNode {
  const { slot, setting, fallbackSlot, zoomFactor } = props;
  const layout: ViewportFrameLayout = deviceViewportLayout(
    slot ?? fallbackSlot,
    setting,
    zoomFactor,
  );
  const percent = Math.round(layout.scale * 100);
  return (
    <>
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: layout.x,
          top: layout.y,
          width: layout.width,
          height: layout.height,
          border,
          borderRadius: 6,
          boxShadow: "0 1px 4px rgba(15, 23, 42, 0.18)",
          pointerEvents: "none",
          zIndex: 40,
          boxSizing: "border-box",
        }}
      />
      {layout.scale < 1 ? (
        <div
          aria-label={`Viewport scaled to ${percent}%`}
          style={{
            position: "absolute",
            left: layout.x + layout.width - 4,
            top: layout.y + layout.height + 6,
            transform: "translateX(-100%)",
            padding: "1px 6px",
            fontSize: 11,
            color: muted,
            background: "var(--t3-browser-canvas, var(--background, #fff))",
            border,
            borderRadius: 999,
            pointerEvents: "none",
            zIndex: 40,
          }}
        >
          {percent}%
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Resize rails

/**
 * Native `useBrowserViewportResize` for the plugin: rails preview the size
 * locally (frame, toolbar, size badge) and commit freeform sizes through
 * `commit`, which must settle once the serialized queue has applied or
 * rejected the resize. A drag commits as it moves, coalesced so at most one
 * resize is in flight; arrow keys commit once they settle for 150 ms. The
 * preview clears when the last commit settles, so the chrome then shows the
 * committed setting — a rejected resize rolls back by never landing. A
 * setting that lands from elsewhere mid-gesture ends the gesture, and a
 * cancelled pointer restores the size the drag started from.
 */
export function useViewportRails(options: {
  readonly setting: FixedViewport | null;
  /** The held tab; a change retires any gesture begun on another. */
  readonly target: string | null;
  readonly slot: { readonly width: number; readonly height: number };
  readonly zoomFactor: number;
  readonly commit: (next: BrowserSessionViewport, target: string) => Promise<boolean>;
}) {
  const { setting, target, slot, zoomFactor, commit } = options;
  const [preview, setPreview] = useState<RailPreview | null>(null);
  const [gestures] = useState(() => createRailGestures(setPreview));
  useEffect(() => gestures.bindCommit(commit), [gestures, commit]);
  const committedKey = setting === null ? null : viewportSettingKey(setting);

  useEffect(() => gestures.observe(target, committedKey), [gestures, target, committedKey]);
  useEffect(() => () => gestures.dispose(), [gestures]);

  const displayed: FixedViewport | null =
    setting === null
      ? null
      : preview === null
        ? setting
        : { _tag: "freeform", width: preview.width, height: preview.height };

  const onPointerDown = (
    direction: ViewportRailDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (displayed === null || setting === null || target === null) return;
    event.preventDefault();
    event.stopPropagation();
    // A new drag starts from what is on screen, so cancelling it restores
    // the previous gesture's size rather than that gesture's start.
    const gesture = gestures.begin(target, displayed, false);
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { width: displayed.width, height: displayed.height };
    // Captured once, like native's dragZoomFactor: the grabbed edge tracks
    // the pointer against the layout the drag started in.
    const area = deviceViewportArea(slot);
    const renderScale = zoomFactor * deviceViewportLayout(slot, start, zoomFactor).scale;
    let latest = start;
    let moved = false;
    gestures.input(gesture, { ...start, direction });
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // The window listeners below keep the drag working without capture.
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const next = resizeViewportFromRail(
        start,
        { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY },
        area,
        renderScale,
        direction,
      );
      // Pointer events arrive at most once per frame; an unchanged size
      // neither re-renders nor commits.
      if (next.width === latest.width && next.height === latest.height) return;
      latest = next;
      moved = true;
      gestures.input(gesture, { ...next, direction });
      gestures.push(gesture, { _tag: "freeform", ...next });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      gesture.cleanup = null;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        // Already released on pointerup.
      }
    };
    function finish(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      // Native commits nothing for a drag with no net change; this one
      // already committed on the way, so put the start setting (and its
      // preset identity) back.
      if (moved && latest.width === start.width && latest.height === start.height) {
        gestures.push(gesture, gesture.start);
      }
      gestures.settle();
    }
    function cancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      // Native drops a cancelled drag; sizes already committed are put back
      // through the same queue, behind anything in flight.
      // An unmoved drag changed nothing and leaves any earlier gesture's
      // queued size alone.
      if (moved) gestures.push(gesture, gesture.start);
      gestures.settle();
    }
    gesture.cleanup = cleanup;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const onKeyDown = (
    direction: ViewportRailDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (displayed === null || setting === null || target === null) return;
    const delta = railKeyDelta(direction, event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizeViewportBy(displayed, delta, direction);
    if (next.width === displayed.width && next.height === displayed.height) return;
    const gesture = gestures.begin(target, displayed, true);
    gestures.input(gesture, { ...next, direction });
    gesture.keyTimer = setTimeout(() => {
      gesture.keyTimer = null;
      gestures.push(gesture, { _tag: "freeform", ...next });
      gestures.settle();
    }, VIEWPORT_RAIL_KEY_COMMIT_DELAY_MS);
  };

  return { displayed, preview, onPointerDown, onKeyDown, cancel: gestures.abort };
}

const RAILS: readonly {
  readonly direction: ViewportRailDirection;
  readonly label: string;
  readonly kind: "vertical" | "horizontal" | "corner";
  readonly cursor: CSSProperties["cursor"];
}[] = [
  { direction: "west", label: "left edge", kind: "vertical", cursor: "ew-resize" },
  { direction: "east", label: "right edge", kind: "vertical", cursor: "ew-resize" },
  { direction: "south", label: "bottom edge", kind: "horizontal", cursor: "ns-resize" },
  { direction: "southwest", label: "bottom-left corner", kind: "corner", cursor: "nesw-resize" },
  { direction: "southeast", label: "bottom-right corner", kind: "corner", cursor: "nwse-resize" },
];

const railBox = (
  direction: ViewportRailDirection,
  layout: ViewportFrameLayout,
): { left: number; top: number; width: number; height: number } => {
  const rail = DEVICE_VIEWPORT_RAIL;
  const right = layout.x + layout.width;
  const bottom = layout.y + layout.height;
  switch (direction) {
    case "west":
      return { left: layout.x - rail, top: layout.y, width: rail, height: layout.height };
    case "east":
      return { left: right, top: layout.y, width: rail, height: layout.height };
    case "south":
      return { left: layout.x, top: bottom, width: layout.width, height: rail };
    case "southwest":
      return { left: layout.x - rail, top: bottom, width: rail, height: rail };
    case "southeast":
      return { left: right, top: bottom, width: rail, height: rail };
  }
};

const grip = (kind: "vertical" | "horizontal" | "corner", active: boolean): CSSProperties => ({
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: kind === "corner" ? "translate(-50%, -50%) rotate(-45deg)" : "translate(-50%, -50%)",
  width: kind === "vertical" ? 3 : kind === "horizontal" ? 24 : 10,
  height: kind === "vertical" ? 24 : kind === "horizontal" ? 3 : 1,
  borderLeft: kind === "vertical" ? "1px solid currentColor" : undefined,
  borderRight: kind === "vertical" ? "1px solid currentColor" : undefined,
  borderTop: kind === "horizontal" || kind === "corner" ? "1px solid currentColor" : undefined,
  borderBottom: kind === "horizontal" ? "1px solid currentColor" : undefined,
  boxSizing: "border-box",
  color: active ? "var(--t3-browser-foreground, var(--foreground, #101828))" : muted,
  pointerEvents: "none",
});

/**
 * Native `BrowserViewportResizeHandles`: 10 px rails on the left, right and
 * bottom edges plus the two bottom corners, in the gutter the host's engine
 * view reserves around the frame, and a W × H badge while a gesture is live.
 * Each rail is a focusable button that also resizes with the arrow keys.
 */
export function ViewportResizeRails(props: {
  readonly layout: ViewportFrameLayout;
  readonly preview: RailPreview | null;
  readonly onPointerDown: (
    direction: ViewportRailDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onKeyDown: (
    direction: ViewportRailDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void;
}): ReactNode {
  const { layout, preview, onPointerDown, onKeyDown } = props;
  return (
    <>
      {RAILS.map((rail) => (
        <button
          key={rail.direction}
          type="button"
          aria-label={`Resize browser viewport from ${rail.label}. Use arrow keys to resize.`}
          onPointerDown={(event) => onPointerDown(rail.direction, event)}
          onKeyDown={(event) => onKeyDown(rail.direction, event)}
          style={{
            position: "absolute",
            ...railBox(rail.direction, layout),
            zIndex: rail.kind === "corner" ? 42 : 41,
            padding: 0,
            border: 0,
            background: "transparent",
            cursor: rail.cursor,
            touchAction: "none",
          }}
        >
          <span aria-hidden style={grip(rail.kind, preview?.direction === rail.direction)} />
        </button>
      ))}
      {preview ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: layout.x + layout.width / 2,
            top: layout.y + 10,
            transform: "translateX(-50%)",
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            border,
            borderRadius: 6,
            background: "var(--t3-browser-canvas, var(--background, #fff))",
            boxShadow: "0 1px 4px rgba(15, 23, 42, 0.18)",
            pointerEvents: "none",
            zIndex: 43,
          }}
        >
          {preview.width} × {preview.height}
        </div>
      ) : null}
    </>
  );
}
