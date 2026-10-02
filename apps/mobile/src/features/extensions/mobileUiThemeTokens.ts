import {
  THEME_COLOR_ROLES,
  type ThemeColors,
  type ThemeColorRole,
} from "@t3tools/shared/themePalettes";
import {
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemeColors,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariable,
  type MobileThemeVariables,
} from "../../lib/mobileTheme";

const nativeRoles = {
  canvas: "--color-screen",
  chrome: "--color-sheet-solid",
  toolbar: "--color-header",
  toolbarForeground: "--color-header-foreground",
  toolbarBorder: "--color-header-border",
  toolbarControlHover: "--color-row-hover",
  surface: "--color-card",
  surfaceRaised: "--color-card-alt",
  text: "--color-foreground",
  textMuted: "--color-foreground-secondary",
  border: "--color-border",
  input: "--color-input-border",
  focus: "--color-focus",
  secondary: "--color-secondary",
  secondaryForeground: "--color-secondary-foreground",
  muted: "--color-subtle",
  mutedForeground: "--color-foreground-muted",
  placeholder: "--color-placeholder",
  secondaryLabel: "--color-foreground-tertiary",
  iconMuted: "--color-icon-muted",
  errorForeground: "--color-danger-foreground",
  errorSurface: "--color-danger",
  warningForeground: "--color-warning-foreground",
  warningSurface: "--color-warning",
  updateForeground: "--color-update-foreground",
  updateSurface: "--color-update",
  accentSurface: "--color-inline-skill-background",
  accentSurfaceForeground: "--color-inline-skill-foreground",
  messageSurface: "--color-user-bubble",
  messageForeground: "--color-user-bubble-foreground",
  messageAction: "--color-primary",
  messageActionForeground: "--color-primary-foreground",
  codeBackground: "--color-md-code-bg",
  codeForeground: "--color-md-code-text",
  sidebar: "--color-drawer",
  sidebarForeground: "--color-drawer-foreground",
  sidebarMutedForeground: "--color-drawer-foreground-muted",
  sidebarControlSurface: "--color-sidebar-search",
  sidebarRowHover: "--color-thread-hover",
  sidebarRowActive: "--color-thread-selected",
  sidebarBorder: "--color-drawer-border",
} as const satisfies Partial<Record<ThemeColorRole, MobileThemeVariable>>;

/** Preserve native platform/Material You overrides instead of resolving a second palette in the page. */
export function mobileUiThemeTokens(
  themeId: MobileThemeId,
  appearance: MobileThemeAppearance,
  variables: MobileThemeVariables,
): ThemeColors {
  const tokens = {
    ...getMobileThemeColors(
      themeId === "material-you" ? DEFAULT_MOBILE_THEME_ID : themeId,
      appearance,
    ),
  };
  for (const [role, variable] of Object.entries(nativeRoles))
    tokens[role as keyof typeof nativeRoles] = variables[variable];
  return tokens;
}

export const MOBILE_UI_THEME_CSS_VARS = Object.fromEntries(
  THEME_COLOR_ROLES.map((role) => [
    role,
    role === "terminalSelection"
      ? "--app-theme-terminal-selection-background"
      : `--app-theme-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
  ]),
);
/** Initial/live page paint uses the same native tokens as the client's theme provider. */
export function mobileExtensionCssVars(
  themeId: MobileThemeId,
  appearance: MobileThemeAppearance,
  variables: MobileThemeVariables,
) {
  const tokens = mobileUiThemeTokens(themeId, appearance, variables);
  const css = Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => [MOBILE_UI_THEME_CSS_VARS[role]!, tokens[role]]),
  );
  Object.assign(css, {
    "--background": tokens.canvas,
    "--foreground": tokens.text,
    "--muted-foreground": tokens.mutedForeground,
    "--border": tokens.border,
  });
  return css;
}
