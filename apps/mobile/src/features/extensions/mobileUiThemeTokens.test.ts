import { describe, expect, it } from "vite-plus/test";
import { THEME_COLOR_ROLES } from "@t3tools/shared/themePalettes";
import { getMobileThemeRuntimeVariables } from "../../lib/mobileThemeVariables";
import { mobileUiThemeTokens, mobileExtensionCssVars } from "./mobileUiThemeTokens";

describe("mobile pack theme tokens", () => {
  it("uses native platform colors and the full shared role set", () => {
    const variables = getMobileThemeRuntimeVariables("t3-code", "light", "android");
    const tokens = mobileUiThemeTokens("t3-code", "light", variables);
    expect(Object.keys(tokens).sort()).toEqual([...THEME_COLOR_ROLES].sort());
    expect(tokens.toolbar).toBe(variables["--color-header"]);
    expect(tokens.sidebar).toBe(variables["--color-drawer"]);
    expect(tokens.canvas).toBe(variables["--color-screen"]);
  });

  it("preserves live Material You palette changes instead of the static fallback", () => {
    const variables = getMobileThemeRuntimeVariables("material-you", "dark", "android");
    const first = mobileUiThemeTokens("material-you", "dark", {
      ...variables,
      "--color-screen": "#012345",
      "--color-primary": "#abcdef",
    });
    const second = mobileUiThemeTokens("material-you", "dark", {
      ...variables,
      "--color-screen": "#654321",
    });
    expect(first.canvas).toBe("#012345");
    expect(first.messageAction).toBe("#abcdef");
    expect(second.canvas).toBe("#654321");
  });
});

it("paints the SDK host fallback and contract variables from live native appearance", () => {
  const variables = getMobileThemeRuntimeVariables("t3-code", "light", "ios");
  const css = mobileExtensionCssVars("t3-code", "light", {
    ...variables,
    "--color-screen": "#123456",
    "--color-foreground": "#abcdef",
  });
  expect(css["--background"]).toBe("#123456");
  expect(css["--foreground"]).toBe("#abcdef");
  expect(css["--app-theme-canvas"]).toBe("#123456");
});
