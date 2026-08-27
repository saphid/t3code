// @effect-diagnostics nodeBuiltinImport:off - Static image boundary test; Docker itself is covered at release build time.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const packageRoot = NodePath.resolve(import.meta.dirname, "..");

describe("manifest image contract", () => {
  it("declares desktop support and dispatches Electron manifests through Xvfb", async () => {
    const dockerfile = await NodeFSP.readFile(
      NodePath.join(packageRoot, "docker/Dockerfile"),
      "utf8",
    );
    const entrypoint = await NodeFSP.readFile(
      NodePath.join(packageRoot, "docker/entrypoint.sh"),
      "utf8",
    );
    expect(dockerfile).toContain('LABEL codes.t3.perf.harness-contract="manifest-v2"');
    expect(dockerfile).toContain("libgtk-3-0");
    expect(dockerfile).toContain("xauth");
    expect(dockerfile).toContain("dumb-init");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/dumb-init", "--", "/entrypoint.sh"]');
    expect(entrypoint).toContain("desktopArtifact.ts");
    expect(entrypoint).toContain("xvfb-run");
    expect(entrypoint).toContain("T3_PERF_DESKTOP_BIN");
    expect(entrypoint).toContain(
      'node /harness/src/manifestAdapter.ts --manifest "$2" --out /results',
    );
    expect(entrypoint.indexOf("manifestAdapter.ts")).toBeLessThan(
      entrypoint.indexOf("args=(--surface web"),
    );
    expect(entrypoint).toContain('exec node /harness/src/cli.ts "${args[@]}" "$@"');
  });
});
