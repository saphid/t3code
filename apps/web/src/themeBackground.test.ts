import { describe, expect, it } from "vite-plus/test";

import { BUILT_IN_THEME_IDS } from "@t3tools/shared/themePalettes";

import { resolveThemeSceneUrl } from "./themeBackground";

describe("resolveThemeSceneUrl", () => {
  it("gives every built-in theme its own scene", () => {
    const urls = BUILT_IN_THEME_IDS.map((id) => resolveThemeSceneUrl(id));
    for (const url of urls) expect(url).toMatch(/^\/backgrounds\/[a-z0-9-]+\.webp$/);
    expect(new Set(urls).size).toBe(BUILT_IN_THEME_IDS.length);
  });

  it("leaves the default look and custom themes without a scene", () => {
    expect(resolveThemeSceneUrl(undefined)).toBeNull();
    expect(resolveThemeSceneUrl(null)).toBeNull();
    expect(resolveThemeSceneUrl("my-custom-theme")).toBeNull();
  });
});
