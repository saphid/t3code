import type { PreviewViewportSetting } from "@t3tools/contracts";

import type { BrowserSurfaceContentPresentation } from "~/browser/browserSurfaceStore";
import {
  resolveFittedBrowserViewport,
  type BrowserViewportResizeDirection,
} from "~/browser/browserViewportLayout";
import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "~/previewMiniPlayerStore";

export const PREVIEW_MINI_PLAYER_EDGE_GAP = 12;
// The mini-player shell straddles this webview at 47 and 49; dialogs begin at 50.
export const PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX = 48;
// A fresh player is the largest box at the source aspect ratio that fits here.
const PREVIEW_MINI_PLAYER_DEFAULT_BOX = { width: 320, height: 320 } as const;
const PREVIEW_MINI_PLAYER_MIN_SIZE = { width: 240, height: 150 } as const;

export interface PreviewMiniPlayerFrame extends PreviewMiniPlayerPosition, PreviewMiniPlayerSize {}

/**
 * The rendered size of what the floating player mirrors: the device viewport
 * when one is set, otherwise the size the webview had when it was floated
 * (`fittedSourceContent`), which the hosted webview keeps as its CSS viewport.
 */
export function resolvePreviewMiniPlayerSourceSize(
  viewport: PreviewViewportSetting,
  fittedSourceContent: BrowserSurfaceContentPresentation | null,
  zoomFactor: number,
): PreviewMiniPlayerSize {
  const normalizedZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const fitted = resolveFittedBrowserViewport(viewport, fittedSourceContent, normalizedZoomFactor);
  return {
    width: fitted.width * normalizedZoomFactor,
    height: fitted.height * normalizedZoomFactor,
  };
}

const availableArea = (
  container: PreviewMiniPlayerSize,
  bottomInset: number,
): PreviewMiniPlayerSize => ({
  width: container.width - PREVIEW_MINI_PLAYER_EDGE_GAP * 2,
  height: container.height - Math.max(0, bottomInset) - PREVIEW_MINI_PLAYER_EDGE_GAP * 2,
});

/**
 * Width is the player's only free dimension; height always follows the source
 * aspect ratio so the webview fills the box without letterboxing. An explicit
 * `aspect` wins over the source's — it is what the webview is actually
 * painting, and the derived source can disagree with that. Width still caps
 * at the source's own size (the guest keeps its CSS viewport, so a wider box
 * would only upscale), and a tight container wins over the minimum.
 */
function fitPreviewMiniPlayerWidth(
  desiredWidth: number,
  source: PreviewMiniPlayerSize,
  max: PreviewMiniPlayerSize,
  aspect?: number,
): PreviewMiniPlayerSize {
  const aspectRatio = aspect ?? source.width / source.height;
  const width = Math.min(
    Math.max(
      desiredWidth,
      PREVIEW_MINI_PLAYER_MIN_SIZE.width,
      PREVIEW_MINI_PLAYER_MIN_SIZE.height * aspectRatio,
    ),
    source.width,
    Math.max(1, max.width),
    Math.max(1, max.height * aspectRatio),
  );
  return { width: Math.round(width), height: Math.round(width / aspectRatio) };
}

function defaultPreviewMiniPlayerWidth(source: PreviewMiniPlayerSize, aspect?: number): number {
  const aspectRatio = aspect ?? source.width / source.height;
  return Math.min(
    PREVIEW_MINI_PLAYER_DEFAULT_BOX.width,
    PREVIEW_MINI_PLAYER_DEFAULT_BOX.height * aspectRatio,
  );
}

export function clampPreviewMiniPlayerPosition(
  position: PreviewMiniPlayerPosition,
  container: PreviewMiniPlayerSize,
  player: PreviewMiniPlayerSize,
  bottomInset = 0,
): PreviewMiniPlayerPosition {
  const reservedBottomSpace = Math.max(0, bottomInset);
  const maxX = Math.max(
    PREVIEW_MINI_PLAYER_EDGE_GAP,
    container.width - player.width - PREVIEW_MINI_PLAYER_EDGE_GAP,
  );
  const maxY = Math.max(
    PREVIEW_MINI_PLAYER_EDGE_GAP,
    container.height - reservedBottomSpace - player.height - PREVIEW_MINI_PLAYER_EDGE_GAP,
  );
  return {
    x: Math.min(Math.max(position.x, PREVIEW_MINI_PLAYER_EDGE_GAP), maxX),
    y: Math.min(Math.max(position.y, PREVIEW_MINI_PLAYER_EDGE_GAP), maxY),
  };
}

/**
 * Resolves the on-screen frame from the stored width and position. Clamping
 * happens here on every layout pass instead of being written back to the
 * store, so a temporarily narrow container never destroys the user's chosen
 * width. A player without a position sits in the top-right corner.
 */
export function resolvePreviewMiniPlayerFrame(input: {
  readonly width: number | null;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly source: PreviewMiniPlayerSize;
  readonly container: PreviewMiniPlayerSize;
  readonly bottomInset?: number;
  /** The aspect the webview is actually painting; beats the source's. */
  readonly aspect?: number | undefined;
}): PreviewMiniPlayerFrame {
  const { width, position, source, container, bottomInset = 0, aspect } = input;
  const size = fitPreviewMiniPlayerWidth(
    width ?? defaultPreviewMiniPlayerWidth(source, aspect),
    source,
    availableArea(container, bottomInset),
    aspect,
  );
  const anchored = position ?? {
    x: container.width - PREVIEW_MINI_PLAYER_EDGE_GAP - size.width,
    y: PREVIEW_MINI_PLAYER_EDGE_GAP,
  };
  return { ...clampPreviewMiniPlayerPosition(anchored, container, size, bottomInset), ...size };
}

/**
 * Resizes from any edge or corner while holding the aspect ratio. The edge
 * opposite the dragged one stays anchored, so growth stops at the container
 * on that axis and the pointer keeps tracking the grabbed edge. On a plain edge
 * drag the perpendicular axis may use the whole container, and the player
 * shifts as needed to stay inside.
 */
export function resizePreviewMiniPlayer(input: {
  readonly start: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection;
  readonly delta: PreviewMiniPlayerPosition;
  readonly source: PreviewMiniPlayerSize;
  readonly container: PreviewMiniPlayerSize;
  readonly bottomInset?: number;
  /** The aspect the webview is actually painting; beats the source's. */
  readonly aspect?: number | undefined;
}): PreviewMiniPlayerFrame {
  const { start, direction, delta, source, container, bottomInset = 0, aspect } = input;
  const east = direction.includes("east");
  const west = direction.includes("west");
  const north = direction.includes("north");
  const south = direction.includes("south");
  const available = availableArea(container, bottomInset);
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const max = {
    width: west
      ? right - PREVIEW_MINI_PLAYER_EDGE_GAP
      : east
        ? container.width - PREVIEW_MINI_PLAYER_EDGE_GAP - start.x
        : available.width,
    height: north
      ? bottom - PREVIEW_MINI_PLAYER_EDGE_GAP
      : south
        ? container.height - Math.max(0, bottomInset) - PREVIEW_MINI_PLAYER_EDGE_GAP - start.y
        : available.height,
  };
  const desiredWidth = start.width + (east ? delta.x : west ? -delta.x : 0);
  const desiredHeight = start.height + (south ? delta.y : north ? -delta.y : 0);
  const horizontal = east || west;
  const vertical = north || south;
  const widthLeads =
    horizontal && !vertical
      ? true
      : vertical && !horizontal
        ? false
        : Math.abs(desiredWidth - start.width) / start.width >=
          Math.abs(desiredHeight - start.height) / start.height;
  const size = fitPreviewMiniPlayerWidth(
    widthLeads ? desiredWidth : desiredHeight * (aspect ?? source.width / source.height),
    source,
    max,
    aspect,
  );
  const position = clampPreviewMiniPlayerPosition(
    { x: west ? right - size.width : start.x, y: north ? bottom - size.height : start.y },
    container,
    size,
    bottomInset,
  );
  return { ...position, ...size };
}
