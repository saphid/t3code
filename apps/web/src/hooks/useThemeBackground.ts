import { resolveThemeBackgroundUrl } from "../themeBackground";
import { getThemeDefinition, resolveThemeHalf } from "../themePalette";
import { useClientSettings } from "./useSettings";
import { useTheme } from "./useTheme";

/**
 * The scene choice for the scene pickers, whether the active theme has a
 * scene of its own (for Theme scene), and whether any scene is showing.
 */
export function useThemeBackground() {
  const choice = useClientSettings((settings) => settings.themeBackground);
  const { theme, resolvedTheme, themeHalves } = useTheme();
  const themeId =
    getThemeDefinition(resolveThemeHalf(theme, themeHalves, resolvedTheme))?.id ?? null;
  return {
    choice,
    themeHasScene: resolveThemeBackgroundUrl("auto", themeId) !== null,
    sceneShowing: resolveThemeBackgroundUrl(choice, themeId) !== null,
  };
}
