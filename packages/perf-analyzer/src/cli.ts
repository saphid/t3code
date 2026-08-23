// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone perf CLI; runs outside the Effect runtime.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { NETWORK_PROFILES, type NetworkProfileName, type Surface } from "./launch.ts";
import {
  newResultStamp,
  renderMarkdown,
  runScenario,
  writeResults,
  type FailedCombo,
  type ScenarioResult,
} from "./runner.ts";
import { exportOtlp } from "./otlpExport.ts";
import { scenarios } from "./scenarios.ts";
import { FIXTURE_SIZES, type FixtureSize } from "./seed.ts";
import { SUITES } from "./suites.ts";

const packageDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const HELP = `t3 perf analyzer

Usage: node packages/perf-analyzer/src/cli.ts [options]

Options:
  --suite <name>       Run a named suite (smoke, rendering, startup, network,
                       full); explicit flags below override suite defaults
  --scenario <names>   Comma-separated scenario names (default: all non-heavy)
  --surface <names>    web,desktop (default: both)
  --size <names>       small,medium,large,wide (default: small)
  --runs <n>           Measured runs per scenario (default: 5)
  --headless           Run the web browser headless (desktop is always headed)
  --heavy              Include heavy scenarios and the large size everywhere
  --label <name>       Tag results with a build/release label (for comparisons)
  --build <id>         Identify the build under test; dashboards plot builds on
                       the x-axis (default: the run's UTC timestamp to the
                       minute, since nightlies publish every few hours)
  --run-id <id>        Unique fleet execution id exported on every datapoint
  --network <profile>  good (direct), okay (80ms/2MBps), flaky (150ms jitter,
                       1MBps, connection reset every 10s); web surface only
  --otlp <url>         OTLP/HTTP collector base URL; POSTs gauge metrics to
                       <url>/v1/metrics once after the run
  --out <dir>          Results directory (default: packages/perf-analyzer/results)
  --list               List scenarios and exit

Environment:
  T3_PERF_SERVER_BIN   Path to a t3 server entry (e.g. an npm release's
                       dist/bin.mjs) to benchmark instead of the repo build
  T3_PERF_CHROME       Chromium executable to use instead of installed Chrome
  T3_PERF_OTLP_URL     Fallback for --otlp
`;

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: {
      suite: { type: "string" },
      scenario: { type: "string" },
      surface: { type: "string" },
      size: { type: "string" },
      runs: { type: "string" },
      headless: { type: "boolean", default: false },
      heavy: { type: "boolean", default: false },
      label: { type: "string" },
      build: { type: "string" },
      "run-id": { type: "string" },
      network: { type: "string" },
      otlp: { type: "string" },
      out: { type: "string" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.list) {
    for (const scenario of scenarios) {
      console.log(
        `${scenario.name}${scenario.heavy === true ? " (heavy)" : ""} [${scenario.surfaces.join(",")}] - ${scenario.description}`,
      );
    }
    console.log("\nSuites:");
    for (const [name, suite] of Object.entries(SUITES)) {
      console.log(`${name} - ${suite.description}`);
    }
    return 0;
  }

  const suite = values.suite !== undefined ? SUITES[values.suite] : undefined;
  if (values.suite !== undefined && suite === undefined) {
    throw new Error(`Unknown suite: ${values.suite}. Known: ${Object.keys(SUITES).join(", ")}`);
  }
  const suiteScenarios =
    suite !== undefined && suite.scenarios !== "all" ? suite.scenarios : undefined;
  const wantedNames =
    values.scenario?.split(",").map((name) => name.trim()) ??
    (suiteScenarios !== undefined ? [...suiteScenarios] : undefined);
  const surfaces = (values.surface?.split(",") ??
    suite?.surfaces ?? ["web", "desktop"]) as Array<Surface>;
  const sizes = (values.size?.split(",") ??
    suite?.sizes ??
    (values.heavy ? ["small", "large"] : ["small"])) as Array<FixtureSize>;
  const runs = values.runs !== undefined ? Number(values.runs) : (suite?.runs ?? 5);
  const outDir = values.out ?? NodePath.join(packageDir, "results");

  for (const size of sizes) {
    if (!(size in FIXTURE_SIZES)) throw new Error(`Unknown size: ${size}`);
  }
  const selected = scenarios.filter((scenario) => {
    if (wantedNames !== undefined) return wantedNames.includes(scenario.name);
    return values.heavy || scenario.heavy !== true;
  });
  if (wantedNames !== undefined) {
    for (const name of wantedNames) {
      if (!selected.some((scenario) => scenario.name === name)) {
        throw new Error(`Unknown scenario: ${name}. Use --list.`);
      }
    }
  }

  const networks = (
    values.network !== undefined ? [values.network] : (suite?.networks ?? ["good"])
  ) as Array<NetworkProfileName>;
  for (const network of networks) {
    if (!(network in NETWORK_PROFILES)) {
      throw new Error(`Unknown network profile: ${network}. Use good, okay, or flaky.`);
    }
  }
  const stamp = newResultStamp();
  // The stamp is the ISO timestamp with : and . dashed. Minute resolution,
  // not date: nightlies publish every few hours, so same-day runs are
  // distinct builds.
  const build =
    values.build ?? `${stamp.slice(0, 10)} ${stamp.slice(11, 13)}:${stamp.slice(14, 16)}`;
  const baseOptions = {
    runs,
    headless: values.headless,
    outDir,
    label: values.label,
    build,
    runId: values["run-id"],
  };
  const results: Array<ScenarioResult> = [];
  const failures: Array<FailedCombo> = [];
  for (const network of networks) {
    const options = { ...baseOptions, network };
    for (const scenario of selected) {
      for (const surface of surfaces) {
        if (!scenario.surfaces.includes(surface)) continue;
        // Network shaping only exists on the web surface; skip shaped desktop
        // combos instead of silently measuring them unshaped.
        if (surface === "desktop" && network !== "good") continue;
        for (const size of sizes) {
          if (!scenario.sizes.includes(size)) continue;
          console.log(`\n${scenario.name} / ${surface} / ${size} / net=${network}`);
          try {
            results.push(
              await runScenario(scenario, surface, size, options, (line) => console.log(line)),
            );
          } catch (error) {
            console.error(`FAILED ${scenario.name}/${surface}/${size}/${network}:`, error);
            failures.push({
              scenario: scenario.name,
              surface,
              size,
              error: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
            });
          }
          // Rewrite after every combo so a crash loses at most one scenario.
          if (results.length > 0 || failures.length > 0) {
            await writeResults(results, baseOptions, stamp, failures);
          }
        }
      }
    }
  }

  if (results.length === 0 && failures.length === 0) {
    console.log("Nothing matched the given filters.");
    return 1;
  }
  if (results.length > 0) console.log("\n" + renderMarkdown(results));
  const written = await writeResults(results, baseOptions, stamp, failures);
  console.log(`\nResults: ${written.jsonPath}`);
  const otlpUrl = values.otlp ?? process.env["T3_PERF_OTLP_URL"];
  if (otlpUrl !== undefined && otlpUrl !== "" && results.length > 0) {
    const exported = await exportOtlp(results, otlpUrl);
    console.log(
      exported.ok
        ? `OTLP: exported ${exported.metricCount} metrics to ${otlpUrl}`
        : `OTLP: export failed (${exported.error ?? `HTTP ${exported.status}`}); results are still on disk.`,
    );
  }
  if (failures.length > 0) {
    console.log(`${failures.length} combo(s) failed; see the failures array in the JSON.`);
    return 1;
  }
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
