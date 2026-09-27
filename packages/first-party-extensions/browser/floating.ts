import { BROWSER_SURFACE_OVERLAY_ATTRIBUTE } from "@t3tools/extension-sdk/catalogue";

/**
 * Stacking for the panel's UI that floats over the composited page, from the
 * slot's `overlayZIndex`. The device chrome sits on the overlay layer, and
 * transient UI (the page menu, the zoom pill) one above it, so an open menu
 * is never under the device toolbar, the way native menus portal above both.
 */
export function floatingLayers(overlayZIndex: number) {
  return { deviceChrome: overlayZIndex, transient: overlayZIndex + 1 } as const;
}

/**
 * Spread onto every element that floats over the page: the slot's occlusion
 * probe then keeps the page presented beneath it, as native does under its
 * own menus.
 */
export const floatingOverPage = { [BROWSER_SURFACE_OVERLAY_ATTRIBUTE]: "" } as const;
