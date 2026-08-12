import { describe, expect, it } from "vite-plus/test";

import { compileThemeSource, MAX_THEME_SOURCE_BYTES } from "./themeArtifact.ts";

describe("portable theme artifacts", () => {
  it("compiles a VS Code theme into every shared semantic role", () => {
    const artifact = compileThemeSource(
      JSON.stringify({
        name: "Night Owl Test",
        type: "dark",
        colors: {
          "editor.background": "#101820",
          "editor.foreground": "#e5edf5",
          focusBorder: "#55aaff",
        },
      }),
    );

    expect(artifact.artifactVersion).toBe(1);
    expect(artifact.roleManifest).toHaveLength(57);
    expect(artifact.themes).toHaveLength(1);
    expect(artifact.themes[0]?.provenance.source).toBe("vscode-file");
    expect(Object.keys(artifact.themes[0]?.modes[0]?.colors ?? {})).toEqual(artifact.roleManifest);
    expect(artifact.themes[0]?.modes[0]?.colors.canvas?.colorSpace).toBe("srgb");
  });

  it("rejects source files above the shared conversion limit", () => {
    expect(() => compileThemeSource(" ".repeat(MAX_THEME_SOURCE_BYTES + 1))).toThrow(
      "256 KB or smaller",
    );
  });
});
