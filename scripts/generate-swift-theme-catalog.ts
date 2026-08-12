import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ResolvedThemeArtifact, ThemeColorValue } from "@t3tools/contracts";

import {
  THEME_COLOR_ROLES,
  getBuiltInThemeDefinitions,
  getStandardThemeColors,
  getThemeColorsForMode,
} from "../packages/shared/src/theme.ts";

const check = process.argv.includes("--check");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "apps/swift-ios/Resources/theme-catalog-v1.json");

function expandHex(value: string): string {
  const raw = value.slice(1);
  if (raw.length === 3 || raw.length === 4) {
    return [...raw].map((digit) => `${digit}${digit}`).join("");
  }
  return raw;
}

function materializeColor(css: string): ThemeColorValue {
  const raw = expandHex(css);
  if (raw.length !== 6 && raw.length !== 8) {
    throw new Error(`Theme generator cannot materialize ${css}.`);
  }
  return {
    css,
    colorSpace: "srgb",
    red: Number.parseInt(raw.slice(0, 2), 16) / 255,
    green: Number.parseInt(raw.slice(2, 4), 16) / 255,
    blue: Number.parseInt(raw.slice(4, 6), 16) / 255,
    alpha: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1,
  };
}

function materializeColors(colors: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => [role, materializeColor(colors[role])]),
  );
}

const standardTheme = {
  id: "t3-code",
  label: "T3 Code",
  modes: (["light", "dark"] as const).map((appearance) => ({
    appearance,
    colors: materializeColors(getStandardThemeColors(appearance)),
  })),
  provenance: { source: "builtin" as const },
};

const themes = getBuiltInThemeDefinitions().map((theme) => ({
  id: theme.id,
  label: theme.label,
  modes: (["light", "dark"] as const).flatMap((appearance) => {
    const colors = getThemeColorsForMode(theme, appearance);
    return colors ? [{ appearance, colors: materializeColors(colors) }] : [];
  }),
  provenance: { source: "builtin" as const },
}));

const roleSchema = createHash("sha256").update(THEME_COLOR_ROLES.join("\n")).digest("hex");
const artifact: ResolvedThemeArtifact = {
  artifactVersion: 1,
  engineVersion: "theme-palette-v1",
  roleManifest: [...THEME_COLOR_ROLES],
  roleSchema,
  themes: [standardTheme, ...themes],
};
const contents = `${JSON.stringify(artifact, null, 2)}\n`;

if (check) {
  const current = await readFile(output, "utf8").catch(() => undefined);
  if (current !== contents) {
    throw new Error(
      "Swift theme catalog is stale. Run `node scripts/generate-swift-theme-catalog.ts`.",
    );
  }
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, contents);
}
