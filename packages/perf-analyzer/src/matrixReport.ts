// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - Standalone matrix table generator; runs outside the Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { ScenarioResult } from "./runner.ts";

/**
 * Renders the conditions matrix: every scenario x fixture size x network
 * profile, colored against the researched standards, with the targets stated
 * in the header. Input: a directory of perf-*.json files whose results carry
 * the optional `network` field ("good" when absent).
 */

interface Band {
  readonly good: number;
  readonly poor: number;
  readonly unit: string;
  readonly standard: string;
}

// Bands mirror report.ts (INP, RAIL/Android vitals, Nielsen, derived GPU).
const BANDS: Record<string, Band> = {
  startup: { good: 2000, poor: 5000, unit: "ms", standard: "RAIL repeat-load 2s / Android vitals 5s" },
  "slow-network-startup": { good: 2000, poor: 5000, unit: "ms", standard: "RAIL repeat-load 2s / Android vitals 5s" },
  "open-giant-thread": { good: 200, poor: 500, unit: "ms", standard: "Core Web Vitals INP 200ms/500ms" },
  "flaky-reconnect": { good: 1000, poor: 10000, unit: "ms", standard: "Nielsen 1s flow / 10s attention" },
  // Scroll wall time is fixed by design; its cost metric is rendering ms/s.
  "scroll-giant-thread": { good: 10, poor: 100, unit: "ms/s", standard: "derived from Apple idle guidance (no vendor standard)" },
};

const NETWORKS = ["good", "okay", "flaky"] as const;
const SIZES = ["small", "medium", "large"] as const;

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function cellValue(result: ScenarioResult): number {
  if (result.scenario === "scroll-giant-thread") {
    return median(result.runs.map((run) => (run.gpuProcessCpuMs ?? 0) / (run.wallMs / 1000)));
  }
  return median(result.runs.map((run) => run.wallMs));
}

function bandClass(scenario: string, value: number): string {
  const band = BANDS[scenario];
  if (band === undefined) return "";
  if (value <= band.good) return "good";
  if (value > band.poor) return "poor";
  return "warn";
}

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: { in: { type: "string" }, out: { type: "string" } },
  });
  const inDir = NodePath.resolve(values.in ?? "results-matrix");
  const outPath = NodePath.resolve(values.out ?? NodePath.join(inDir, "matrix.html"));

  const byKey = new Map<string, ScenarioResult>();
  for (const name of await NodeFSP.readdir(inDir)) {
    if (!/^perf-.*\.json$/.test(name)) continue;
    try {
      const parsed = JSON.parse(await NodeFSP.readFile(NodePath.join(inDir, name), "utf8")) as {
        results: Array<ScenarioResult>;
      };
      for (const result of parsed.results) {
        byKey.set(`${result.scenario}|${result.size}|${result.network ?? "good"}`, result);
      }
    } catch {
      console.warn(`Skipping unparseable ${name}`);
    }
  }
  if (byKey.size === 0) throw new Error(`No results found in ${inDir}`);

  const scenarioNames = [...new Set([...byKey.keys()].map((key) => key.split("|")[0] ?? ""))];
  const label = [...byKey.values()][0]?.label ?? "repo build";

  const rows: Array<string> = [];
  for (const scenario of scenarioNames) {
    const band = BANDS[scenario];
    for (const size of SIZES) {
      const cells = NETWORKS.map((network) => {
        const result = byKey.get(`${scenario}|${size}|${network}`);
        if (result === undefined) return `<td class="na">-</td>`;
        const value = cellValue(result);
        const cls = bandClass(scenario, value);
        const unit = band?.unit ?? "ms";
        return `<td class="${cls}">${Math.round(value).toLocaleString("en-US")} ${unit}</td>`;
      });
      if (cells.every((cell) => cell.includes(">-<"))) continue;
      rows.push(
        `<tr><td>${scenario}</td><td>${size}</td>${cells.join("")}<td class="target">good &le; ${band?.good.toLocaleString("en-US")} ${band?.unit} · poor &gt; ${band?.poor.toLocaleString("en-US")} ${band?.unit}</td></tr>`,
      );
    }
  }

  const standards = scenarioNames
    .map((scenario) => {
      const band = BANDS[scenario];
      return band === undefined
        ? ""
        : `<li><strong>${scenario}</strong>: good &le; ${band.good.toLocaleString("en-US")} ${band.unit}, poor &gt; ${band.poor.toLocaleString("en-US")} ${band.unit} (${band.standard})</li>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>T3 perf conditions matrix</title>
<style>
  :root { color-scheme: light dark; --good:#1a7f37; --warn:#9a6700; --poor:#c62828; --line:#8884; }
  @media (prefers-color-scheme: dark) { :root { --good:#4caf50; --warn:#e0a800; --poor:#ef5350; } }
  body { font-family: ui-monospace, Menlo, monospace; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; }
  h1 { font-size: 1.1rem; } p, li { font-size: 0.85rem; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: right; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  th { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.7rem; }
  td:first-child, td:nth-child(2) { text-align: left; }
  td.good { color: var(--good); font-weight: 600; }
  td.warn { color: var(--warn); font-weight: 600; }
  td.poor { color: var(--poor); font-weight: 700; }
  td.na { opacity: 0.4; text-align: center; }
  td.target { font-size: 0.7rem; opacity: 0.8; text-align: left; }
  .legend b.g { color: var(--good); } .legend b.w { color: var(--warn); } .legend b.p { color: var(--poor); }
</style></head><body>
<h1>Conditions matrix · ${label}</h1>
<p>Median wall time per scenario, fixture size, and network condition (scroll shows rendering cost in ms per second instead, since its wall time is fixed by design). Colors: <b class="g">good</b> meets the target, <b class="w">attention</b> is between target and the poor line, <b class="p">poor</b> crosses it.</p>
<ul>${standards}</ul>
<table>
<thead><tr><th>Scenario</th><th>Data size</th><th>Good network</th><th>Okay network (80ms, 2 MB/s)</th><th>Flaky (150ms jitter, 1 MB/s, reset per 10s)</th><th>Target</th></tr></thead>
<tbody>${rows.join("\n")}</tbody>
</table>
<p>Generated ${new Date().toISOString()} from ${inDir}. Standards and weights: see the main dashboard's "How priorities are scored" and docs/internals/perf-analyzer.md.</p>
</body></html>`;

  await NodeFSP.writeFile(outPath, html);
  console.log(`Matrix: ${outPath} (${rows.length} rows)`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
