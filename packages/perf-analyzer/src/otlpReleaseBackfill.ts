// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - One-shot release-axis backfill.
import * as NodeFSP from "node:fs/promises";
import * as NodeUtil from "node:util";

import { exportOtlp } from "./otlpExport.ts";
import type { ScenarioResult } from "./runner.ts";

interface ManifestEntry {
  readonly path: string;
  readonly host: string;
  readonly version: string;
  readonly publishedAt: string;
}

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

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<ManifestEntry>;
  return (
    typeof entry.path === "string" &&
    typeof entry.host === "string" &&
    typeof entry.version === "string" &&
    typeof entry.publishedAt === "string"
  );
}

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: {
      manifest: { type: "string" },
      otlp: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const endpoint = values.otlp ?? "";
  if (values.manifest === undefined || (!values["dry-run"] && endpoint === "")) {
    console.error("Usage: otlpReleaseBackfill.ts --manifest <json> --otlp <url> [--dry-run]");
    return 1;
  }
  const manifestValue = JSON.parse(await NodeFSP.readFile(values.manifest, "utf8")) as unknown;
  if (!Array.isArray(manifestValue) || !manifestValue.every(isManifestEntry)) {
    throw new Error("manifest must be an array of {path,host,version,publishedAt}");
  }

  let files = 0;
  let results = 0;
  const failures: Array<string> = [];
  for (const entry of manifestValue) {
    try {
      const publishedAtMs = Date.parse(entry.publishedAt);
      if (Number.isNaN(publishedAtMs)) throw new Error("invalid publishedAt");
      const parsed = JSON.parse(await NodeFSP.readFile(entry.path, "utf8")) as {
        readonly results?: unknown;
      };
      if (!isScenarioResultArray(parsed.results) || parsed.results.length === 0) {
        throw new Error("no scenario results");
      }
      const normalized = parsed.results.map((result) => ({
        ...result,
        // The version identifies the tested release. The host remains a
        // separate datapoint attribute and is never embedded in this label.
        label: entry.version,
        build: entry.version,
      }));
      const timestamp = `${publishedAtMs}000000`;
      if (!values["dry-run"]) {
        const exported = await exportOtlp(
          normalized,
          endpoint,
          normalized.map(() => timestamp),
          normalized.map(() => entry.host),
          "release",
        );
        if (!exported.ok) throw new Error(exported.error ?? `HTTP ${exported.status}`);
      }
      files += 1;
      results += normalized.length;
    } catch (error) {
      failures.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const failure of failures) console.error(failure);
  console.log(
    JSON.stringify({ files, results, failures: failures.length, dryRun: values["dry-run"] }),
  );
  return failures.length === 0 ? 0 : 1;
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
