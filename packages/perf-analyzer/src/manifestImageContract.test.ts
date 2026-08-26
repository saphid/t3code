// @effect-diagnostics nodeBuiltinImport:off - Static image boundary test; Docker itself is covered at release build time.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const packageRoot = NodePath.resolve(import.meta.dirname, "..");

describe("manifest-v1 image contract", () => {
  it("declares the inspected image label and dispatches manifest mode away from the legacy CLI", async () => {
    const dockerfile = await NodeFSP.readFile(
      NodePath.join(packageRoot, "docker/Dockerfile"),
      "utf8",
    );
    const entrypoint = await NodeFSP.readFile(
      NodePath.join(packageRoot, "docker/entrypoint.sh"),
      "utf8",
    );
    expect(dockerfile).toContain('LABEL codes.t3.perf.harness-contract="manifest-v1"');
    expect(entrypoint).toContain(
      'exec node /harness/src/manifestAdapter.ts --manifest "$2" --out /results',
    );
    expect(entrypoint.indexOf("manifestAdapter.ts")).toBeLessThan(
      entrypoint.indexOf("args=(--surface web"),
    );
    expect(entrypoint).toContain('exec node /harness/src/cli.ts "${args[@]}" "$@"');
  });
});
