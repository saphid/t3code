import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";
import type {
  ResolvedThemeArtifact,
  ResolvedThemeDefinition,
  ThemeColorValue,
} from "@t3tools/contracts";

import {
  THEME_COLOR_ROLES,
  getThemeColorsForMode,
  parseThemeFile,
  type ThemeColors,
  type ThemeDefinition,
} from "./theme.ts";
import { isVsCodeThemeFile, parseVsCodeThemeFile } from "./vscodeThemeImport.ts";
import {
  getOpenVsxThemeExtension,
  importOpenVsxThemeExtension,
  type OpenVsxThemeExtension,
} from "./openVsxThemes.ts";

export const MAX_THEME_SOURCE_BYTES = 256 * 1024;

function expandHex(value: string): string {
  const raw = value.slice(1);
  return raw.length === 3 || raw.length === 4
    ? [...raw].map((digit) => `${digit}${digit}`).join("")
    : raw;
}

function materializeColor(css: string): ThemeColorValue {
  const raw = expandHex(css);
  if (raw.length !== 6 && raw.length !== 8) {
    throw new Error(`Unsupported resolved theme color: ${css}`);
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

function materializeColors(colors: ThemeColors): Record<string, ThemeColorValue> {
  return Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => [role, materializeColor(colors[role])]),
  );
}

export function materializeThemeDefinition(
  theme: ThemeDefinition,
  source: "builtin" | "t3-file" | "vscode-file" | "open-vsx",
): ResolvedThemeDefinition {
  return {
    id: theme.id,
    label: theme.label,
    modes: (["light", "dark"] as const).flatMap((appearance) => {
      const colors = getThemeColorsForMode(theme, appearance);
      return colors ? [{ appearance, colors: materializeColors(colors) }] : [];
    }),
    provenance: { source },
  };
}

export function makeResolvedThemeArtifact(
  themes: ReadonlyArray<ResolvedThemeDefinition>,
): ResolvedThemeArtifact {
  const roleSchema = bytesToHex(sha256(new TextEncoder().encode(THEME_COLOR_ROLES.join("\n"))));
  return {
    artifactVersion: 1,
    engineVersion: "theme-palette-v1",
    roleManifest: [...THEME_COLOR_ROLES],
    roleSchema,
    themes: [...themes],
  };
}

export function compileThemeSource(contents: string): ResolvedThemeArtifact {
  if (new TextEncoder().encode(contents).byteLength > MAX_THEME_SOURCE_BYTES) {
    throw new Error("Theme files must be 256 KB or smaller.");
  }
  const value: unknown = JSON.parse(contents);
  const source = isVsCodeThemeFile(value) ? "vscode-file" : "t3-file";
  const theme = source === "vscode-file" ? parseVsCodeThemeFile(value) : parseThemeFile(value);
  return makeResolvedThemeArtifact([materializeThemeDefinition(theme, source)]);
}

export async function compileOpenVsxTheme(
  extensionId: string,
): Promise<{ extension: OpenVsxThemeExtension; artifact: ResolvedThemeArtifact }> {
  const extension = await getOpenVsxThemeExtension(extensionId);
  const themes = await importOpenVsxThemeExtension(extension);
  const resolved = themes.map((theme) => ({
    ...materializeThemeDefinition(theme, "open-vsx"),
    collection: {
      id: extension.collectionId,
      label: extension.name.slice(0, 48),
    },
    provenance: {
      source: "open-vsx" as const,
      publisher: extension.publisher,
      extensionId: extension.id,
      version: extension.version,
      license: extension.license,
    },
  }));
  return { extension, artifact: makeResolvedThemeArtifact(resolved) };
}
