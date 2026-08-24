// @effect-diagnostics nodeBuiltinImport:off - Reads provisioned JSON as the public test seam.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";

interface Target {
  readonly expr?: string;
  readonly legendFormat?: string;
}

interface Dashboard {
  readonly time?: { readonly from?: string };
  readonly panels?: ReadonlyArray<{
    readonly description?: string;
    readonly targets?: ReadonlyArray<Target>;
  }>;
}

const dashboardDir = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../observability/grafana/dashboards",
);

function dashboard(name: string): Dashboard {
  return JSON.parse(NodeFS.readFileSync(NodePath.join(dashboardDir, name), "utf8")) as Dashboard;
}

function targets(name: string): ReadonlyArray<Target> {
  return dashboard(name).panels?.flatMap((panel) => panel.targets ?? []) ?? [];
}

function aggregationGroups(expression: string): ReadonlyArray<ReadonlySet<string>> {
  return [...expression.matchAll(/\bby\s*\(([^)]*)\)/g)].map(
    (match) => new Set((match[1] ?? "").split(",").map((label) => label.trim())),
  );
}

describe("Grafana performance dashboards", () => {
  it("keeps every selected test dimension in analytical aggregations and legends", () => {
    const expectedDimensions = new Set(["host", "scenario", "surface", "size", "network"]);
    const files = [
      "build-trends.json",
      "gpu-outliers.json",
      "network-conditions.json",
      "overview.json",
      "release-comparison.json",
      "resources.json",
    ];

    for (const file of files) {
      for (const target of targets(file)) {
        if (!target.expr?.includes("t3perf_")) continue;
        expect(target.expr, file).toContain('time_basis="release"');
        expect(target.expr, file).toContain('host=~"$host"');
        for (const group of aggregationGroups(target.expr)) {
          for (const dimension of expectedDimensions) {
            expect(group.has(dimension), `${file} drops ${dimension} in ${target.expr}`).toBe(true);
          }
        }
        for (const dimension of expectedDimensions) {
          expect(target.legendFormat, `${file} legend omits ${dimension}`).toContain(
            `{{${dimension}}}`,
          );
        }
      }
    }
  });

  it("describes and defaults the primary dashboards as seven-day release-time views", () => {
    for (const file of ["build-trends.json", "overview.json"]) {
      const value = dashboard(file);
      expect(value.time?.from, file).toBe("now-7d");
      for (const panel of value.panels ?? []) {
        expect(panel.description ?? "", file).not.toContain("run timestamp");
      }
    }
  });
});
