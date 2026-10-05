import {
  BUILT_IN_THEME_IDS,
  type BuiltInThemeId,
  type ThemeAppearance,
  type ThemeDefinition,
} from "@t3tools/shared/themePalettes";
import { getThemeColorsForMode } from "./themePalette";

/** Each built-in theme's static scene, served from the app's public assets. */
const THEME_SCENES: Readonly<Record<BuiltInThemeId, string>> = {
  "t3-chat": "/backgrounds/t3-chat.webp",
  grove: "/backgrounds/grove.webp",
  ocean: "/backgrounds/ocean.webp",
  ember: "/backgrounds/ember.webp",
  iris: "/backgrounds/iris.webp",
};

/**
 * The scene for a theme, or null when it has none. Only built-in themes carry
 * one: the default look and custom themes stay flat.
 */
export function resolveThemeSceneUrl(themeId: string | null | undefined): string | null {
  const builtIn = BUILT_IN_THEME_IDS.find((id) => id === themeId);
  return builtIn ? THEME_SCENES[builtIn] : null;
}

/**
 * Paint (or clear) the scene behind the interface. The tints come from the
 * theme definition's solid colors, not the document, so they never read back
 * the translucent fills this mode itself produces.
 */
export function applyThemeBackground(
  url: string | null,
  definition: ThemeDefinition | null,
  appearance: ThemeAppearance,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const colors = definition
    ? (getThemeColorsForMode(definition, appearance) ?? definition.colors)
    : null;

  if (!url || !colors) {
    delete root.dataset.appBackdrop;
    root.style.removeProperty("--app-backdrop-image");
    root.style.removeProperty("--app-backdrop-tint");
    root.style.removeProperty("--app-backdrop-tint-sidebar");
    root.style.removeProperty("--app-backdrop-tint-toolbar");
    return;
  }

  root.dataset.appBackdrop = "on";
  root.style.setProperty("--app-backdrop-image", `url("${url}")`);
  root.style.setProperty("--app-backdrop-tint", colors.canvas);
  root.style.setProperty("--app-backdrop-tint-sidebar", colors.sidebar);
  root.style.setProperty("--app-backdrop-tint-toolbar", colors.toolbar);
}
