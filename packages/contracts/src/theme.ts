import * as Schema from "effect/Schema";

export const ThemeAppearance = Schema.Literals(["light", "dark"]);
export type ThemeAppearance = typeof ThemeAppearance.Type;

export const ThemeAppearancePolicy = Schema.Literals(["system", "light", "dark"]);
export type ThemeAppearancePolicy = typeof ThemeAppearancePolicy.Type;

export const ThemeColorValue = Schema.Struct({
  css: Schema.String,
  colorSpace: Schema.Literal("srgb"),
  red: Schema.Number,
  green: Schema.Number,
  blue: Schema.Number,
  alpha: Schema.Number,
});
export type ThemeColorValue = typeof ThemeColorValue.Type;

export const ResolvedThemePalette = Schema.Struct({
  appearance: ThemeAppearance,
  colors: Schema.Record(Schema.String, ThemeColorValue),
});
export type ResolvedThemePalette = typeof ResolvedThemePalette.Type;

export const ResolvedThemeCollection = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
});
export type ResolvedThemeCollection = typeof ResolvedThemeCollection.Type;

export const ResolvedThemeProvenance = Schema.Struct({
  source: Schema.Literals(["builtin", "t3-file", "vscode-file", "open-vsx"]),
  publisher: Schema.optionalKey(Schema.String),
  extensionId: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  license: Schema.optionalKey(Schema.String),
});
export type ResolvedThemeProvenance = typeof ResolvedThemeProvenance.Type;

export const ResolvedThemeDefinition = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  collection: Schema.optionalKey(ResolvedThemeCollection),
  modes: Schema.Array(ResolvedThemePalette),
  provenance: ResolvedThemeProvenance,
});
export type ResolvedThemeDefinition = typeof ResolvedThemeDefinition.Type;

export const ResolvedThemeArtifact = Schema.Struct({
  artifactVersion: Schema.Literal(1),
  engineVersion: Schema.String,
  roleManifest: Schema.Array(Schema.String),
  roleSchema: Schema.String,
  themes: Schema.Array(ResolvedThemeDefinition),
});
export type ResolvedThemeArtifact = typeof ResolvedThemeArtifact.Type;

export const ThemeSelection = Schema.Struct({
  appearance: ThemeAppearancePolicy,
  lightThemeId: Schema.String,
  darkThemeId: Schema.String,
});
export type ThemeSelection = typeof ThemeSelection.Type;

export const ThemeCompileInput = Schema.Struct({
  fileName: Schema.String,
  contents: Schema.String,
});
export type ThemeCompileInput = typeof ThemeCompileInput.Type;

export class ThemeCompileError extends Schema.TaggedErrorClass<ThemeCompileError>()(
  "ThemeCompileError",
  {
    message: Schema.String,
  },
) {}

export const OpenVsxThemeExtension = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  publisher: Schema.String,
  description: Schema.String,
  downloadCount: Schema.Number,
  iconUrl: Schema.NullOr(Schema.String),
  version: Schema.String,
  license: Schema.String,
});
export type OpenVsxThemeExtension = typeof OpenVsxThemeExtension.Type;

export const OpenVsxThemeSearchInput = Schema.Struct({ query: Schema.String });
export type OpenVsxThemeSearchInput = typeof OpenVsxThemeSearchInput.Type;

export const OpenVsxThemeInstallInput = Schema.Struct({ extensionId: Schema.String });
export type OpenVsxThemeInstallInput = typeof OpenVsxThemeInstallInput.Type;

export class OpenVsxThemeError extends Schema.TaggedErrorClass<OpenVsxThemeError>()(
  "OpenVsxThemeError",
  { message: Schema.String },
) {}
