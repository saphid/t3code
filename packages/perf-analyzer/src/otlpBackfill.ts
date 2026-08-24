// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone backfill CLI; runs outside the Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { exportOtlp } from "./otlpExport.ts";
import type { ScenarioResult } from "./runner.ts";

const HELP = `t3 perf OTLP backfill

Usage: node packages/perf-analyzer/src/otlpBackfill.ts --in <dir> [--in <dir> ...] --otlp <url>

Reads every perf-*.json in each directory (the {results, failures} shape the
runner writes), concatenates the results, and exports them once as OTLP
gauges via <url>/v1/metrics. Corrupt or unrecognized files are skipped with
a warning. Files are read in name order, so when the same combo appears in
several files the newest stamp lands last and wins in the collector.

Options:
  --in <dir>    Results directory to read; repeatable
  --otlp <url>  OTLP/HTTP collector base URL (fallback: T3_PERF_OTLP_URL)
  --time <iso>  Timestamp every datapoint at this instant instead of each
                file's run stamp (e.g. a release's publish time, so a
                benchmarked-after-the-fact build lands at its place in
                build chronology)
`;

function isScenarioResultArray(value: unknown): value is Array<ScenarioResult> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { scenario?: unknown }).scenario === "string" &&
        Array.isArray((entry as { runs?: unknown }).runs),
    )
  );
}

async function readDirResults(dir: string): Promise<{
  files: number;
  results: Array<ScenarioResult>;
  timestamps: Array<string | undefined>;
}> {
  const names = (await NodeFSP.readdir(dir)).filter((name) => /^perf-.*\.json$/.test(name)).sort();
  const results: Array<ScenarioResult> = [];
  const timestamps: Array<string | undefined> = [];
  let files = 0;
  for (const name of names) {
    const path = NodePath.join(dir, name);
    try {
      const parsed = JSON.parse(await NodeFSP.readFile(path, "utf8")) as { results?: unknown };
      if (!isScenarioResultArray(parsed.results)) throw new Error("no results array");
      // The file stamp is the run time: it becomes the datapoint timestamp
      // (so history lands where it happened, not at export time) and, for
      // files written before results carried a build, the build id (minute
      // resolution, matching the CLI default).
      const stampMatch = /^perf-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
      const stampBuild =
        stampMatch === null ? undefined : `${stampMatch[1]} ${stampMatch[2]}:${stampMatch[3]}`;
      const stampMs =
        stampMatch === null
          ? Number.NaN
          : Date.parse(
              `${stampMatch[1]}T${stampMatch[2]}:${stampMatch[3]}:${stampMatch[4]}.${stampMatch[5]}Z`,
            );
      const stampUnixNano = Number.isNaN(stampMs) ? undefined : `${stampMs}000000`;
      for (const result of parsed.results) {
        results.push(
          result.build !== undefined || stampBuild === undefined
            ? result
            : { ...result, build: stampBuild },
        );
        timestamps.push(stampUnixNano);
      }
      files += 1;
    } catch (error) {
      console.warn(`Skipping ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { files, results, timestamps };
}

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: {
      in: { type: "string", multiple: true },
      otlp: { type: "string" },
      time: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const dirs = values.in ?? [];
  const otlpUrl = values.otlp ?? process.env["T3_PERF_OTLP_URL"];
  if (dirs.length === 0 || otlpUrl === undefined || otlpUrl === "") {
    console.log(HELP);
    return 1;
  }
  let forcedUnixNano: string | undefined;
  if (values.time !== undefined) {
    const ms = Date.parse(values.time);
    if (Number.isNaN(ms)) {
      console.error(`--time is not a parseable timestamp: ${values.time}`);
      return 1;
    }
    forcedUnixNano = `${ms}000000`;
  }

  const all: Array<ScenarioResult> = [];
  const allTimestamps: Array<string | undefined> = [];
  for (const dir of dirs) {
    try {
      const { files, results, timestamps } = await readDirResults(dir);
      console.log(`${dir}: ${files} file(s) read, ${results.length} result(s) exported`);
      all.push(...results);
      allTimestamps.push(...timestamps);
    } catch (error) {
      console.warn(
        `Skipping directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (all.length === 0) {
    console.log("Nothing to export.");
    return 1;
  }

  const exported = await exportOtlp(
    all,
    otlpUrl,
    forcedUnixNano === undefined ? allTimestamps : all.map(() => forcedUnixNano),
    undefined,
    forcedUnixNano === undefined ? "run" : "release",
  );
  if (!exported.ok) {
    console.log(`OTLP: export failed (${exported.error ?? `HTTP ${exported.status}`}).`);
    return 1;
  }
  console.log(
    `OTLP: exported ${exported.metricCount} metrics from ${all.length} results to ${otlpUrl}`,
  );
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
