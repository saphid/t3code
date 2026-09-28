import { BROWSER_SURFACE_OVERLAY_ATTRIBUTE } from "@t3tools/extension-sdk/catalogue";

/**
 * Stacking for the panel's UI that floats over the composited page, from the
 * slot's `overlayZIndex`. The device chrome sits on the overlay layer.
 * Transient UI (the page menu, the zoom pill) goes to the host's floating
 * layer, above both, as native menus do; on hosts without one it renders in
 * place one layer above the device chrome.
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
