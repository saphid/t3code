import { BROWSER_SURFACE_OVERLAY_ATTRIBUTE } from "@t3tools/extension-sdk/catalogue";
import type { ClientFloatingLayer, FloatingPopoverProps } from "@t3tools/extension-sdk/environment";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FLOATING_VIEWPORT_MARGIN, placeFloating, type FloatingPlacement } from "./placement";

/** The native menu positioner's layer (`ui/menu.tsx`), above every presented surface. */
export const FLOATING_LAYER_Z_INDEX = 130;

function samePlacement(a: FloatingPlacement | null, b: FloatingPlacement): boolean {
  return a !== null && a.left === b.left && a.top === b.top && a.maxHeight === b.maxHeight;
}

function Popover({
  anchor,
  side = "bottom",
  align = "end",
  offset = 6,
  elementRef,
  style,
  children,
  ...attributes
}: FloatingPopoverProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);
  const elementRefLatest = useRef(elementRef);
  useLayoutEffect(() => {
    elementRefLatest.current = elementRef;
  }, [elementRef]);
  const attach = useCallback((node: HTMLDivElement | null) => {
    setElement(node);
    elementRefLatest.current?.(node);
  }, []);

  // Re-place whenever the anchor moves or resizes, the viewport resizes, or
  // the content changes (an expanded section can outgrow the cap).
  useLayoutEffect(() => {
    if (anchor === null || element === null) return;
    const view = anchor.ownerDocument.defaultView;
    if (view === null) return;
    const update = () => {
      const next = placeFloating({
        anchor: anchor.getBoundingClientRect(),
        content: {
          width: element.offsetWidth,
          // scrollHeight is the uncapped content; add the border back.
          height: element.scrollHeight + element.offsetHeight - element.clientHeight,
        },
        viewport: { width: view.innerWidth, height: view.innerHeight },
        side,
        align,
        offset,
      });
      setPlacement((current) => (samePlacement(current, next) ? current : next));
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(anchor);
    resize.observe(element);
    const mutation = new MutationObserver(update);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    view.addEventListener("resize", update);
    view.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
      view.removeEventListener("resize", update);
      view.removeEventListener("scroll", update, { capture: true });
    };
  }, [anchor, element, side, align, offset]);

  if (anchor === null) return null;
  return createPortal(
    <div
      {...attributes}
      {...{ [BROWSER_SURFACE_OVERLAY_ATTRIBUTE]: "" }}
      ref={attach}
      style={{
        ...style,
        position: "fixed",
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        // Hidden until measured, so the first frame never flashes misplaced.
        visibility: placement === null ? "hidden" : style?.visibility,
        zIndex: FLOATING_LAYER_Z_INDEX,
        maxHeight: placement?.maxHeight,
        maxWidth: `calc(100vw - ${2 * FLOATING_VIEWPORT_MARGIN}px)`,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>,
    anchor.ownerDocument.body,
  );
}

/** The web and desktop `ClientHost.floatingLayer`, shared by every installed client. */
export const hostFloatingLayer: ClientFloatingLayer = { version: 1, Popover };
