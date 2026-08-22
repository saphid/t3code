// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off - Standalone report generator; runs outside the Effect runtime and reads benchmark JSON from disk.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import type { WindowMetrics } from "./metrics.ts";
import type { ScenarioResult } from "./runner.ts";
import type { SampleSummary } from "./stats.ts";

/**
 * Renders results/perf-*.json into one self-contained HTML dashboard:
 * a ranked "highest priority to fix" list computed from transparent
 * heuristics, then a card per (scenario, surface, size) with medians,
 * confidence intervals, per-run variance strips, and surface/size
 * comparisons. No network access, inline CSS/JS only.
 *
 *   node packages/perf-analyzer/src/report.ts [--out results/report.html]
 */

const packageDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const HELP = `t3 perf report generator

Usage: node packages/perf-analyzer/src/report.ts [options]

Reads every perf-*.json in packages/perf-analyzer/results and writes one
self-contained HTML report. The newest file containing a
(scenario, surface, size) combo is treated as current; older files with the
same combo become history for trend and regression comparison.

Options:
  --in <dir>     Results directory to read (default: packages/perf-analyzer/results)
  --out <file>   Output path (default: <in dir>/report.html)
  --help         Show this help
`;

// ---------------------------------------------------------------------------
// Loading and grouping
// ---------------------------------------------------------------------------

interface ResultFile {
  readonly file: string;
  readonly results: ReadonlyArray<ScenarioResult>;
}

interface Combo {
  /** Release/build tag carried by the result, or null for the local repo build. */
  readonly label: string | null;
  readonly scenario: string;
  readonly surface: string;
  readonly size: string;
  readonly current: ScenarioResult;
  readonly currentFile: string;
  /** Older results for the same combo, newest first. */
  readonly history: ReadonlyArray<{ readonly file: string; readonly result: ScenarioResult }>;
}

/** Optional release tag on newer result files; absent means the local repo build. */
function resultLabel(result: ScenarioResult): string | null {
  const label = (result as unknown as Record<string, unknown>)["label"];
  return typeof label === "string" ? label : null;
}

/** Optional per-run field on newer result files: CPU ms of the GPU process. */
function runGpuProcessCpuMs(run: WindowMetrics): number | null {
  const value = (run as unknown as Record<string, unknown>)["gpuProcessCpuMs"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Optional per-run field on newer result files: which GPU probe produced the numbers. */
function runGpuBackend(run: WindowMetrics): string | null {
  const value = (run as unknown as Record<string, unknown>)["gpuBackend"];
  return typeof value === "string" ? value : null;
}

function medianOf(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Median GPU-process CPU ms across the runs that reported it, or null. */
function gpuProcessCpuMedian(result: ScenarioResult): number | null {
  const values = result.runs
    .map(runGpuProcessCpuMs)
    .filter((value): value is number => value !== null);
  return medianOf(values);
}

/** The metric is worth a column only when some run actually measured it. */
function hasGpuProcessCpu(result: ScenarioResult): boolean {
  return result.runs.some((run) => {
    const value = runGpuProcessCpuMs(run);
    return value !== null && value >= 0.05;
  });
}

const GPU_BACKEND_TAGS: Record<string, string> = {
  none: "gpu: software (cpu)",
  "drm-fdinfo": "gpu: drm",
  "nvidia-smi": "gpu: nvidia estimate",
};

/** Muted card tag for non-default GPU probes; null for agx or old files. */
function gpuBackendTag(result: ScenarioResult): string | null {
  const backend = result.runs.map(runGpuBackend).find((value) => value !== null) ?? null;
  if (backend === null || backend === "agx") return null;
  return GPU_BACKEND_TAGS[backend] ?? `gpu: ${backend}`;
}

function looksLikeScenarioResult(value: unknown): value is ScenarioResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["scenario"] === "string" &&
    typeof record["surface"] === "string" &&
    typeof record["size"] === "string" &&
    Array.isArray(record["runs"]) &&
    typeof record["summary"] === "object" &&
    record["summary"] !== null
  );
}

async function loadResultFiles(resultsDir: string): Promise<Array<ResultFile>> {
  let names: Array<string>;
  try {
    names = await NodeFSP.readdir(resultsDir);
  } catch {
    console.warn(`No results directory at ${resultsDir}.`);
    return [];
  }
  // Timestamps in the filenames are ISO-derived, so a name sort is a time sort.
  const jsonNames = names.filter((name) => /^perf-.*\.json$/.test(name)).sort().reverse();
  const files: Array<ResultFile> = [];
  for (const name of jsonNames) {
    const fullPath = NodePath.join(resultsDir, name);
    try {
      const raw = await NodeFSP.readFile(fullPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const results =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)["results"]
          : undefined;
      if (!Array.isArray(results) || !results.every(looksLikeScenarioResult)) {
        console.warn(`Skipping ${name}: not a { results: ScenarioResult[] } file.`);
        continue;
      }
      files.push({ file: name, results });
    } catch (error) {
      console.warn(`Skipping ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return files;
}

function groupCombos(files: ReadonlyArray<ResultFile>): Array<Combo> {
  const byKey = new Map<
    string,
    {
      current: ScenarioResult;
      currentFile: string;
      history: Array<{ file: string; result: ScenarioResult }>;
    }
  >();
  // Files arrive newest first, so the first sighting of a combo is current.
  for (const file of files) {
    for (const result of file.results) {
      const key = `${resultLabel(result) ?? "repo"} ${result.scenario} ${result.surface} ${result.size}`;
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, { current: result, currentFile: file.file, history: [] });
      } else {
        existing.history.push({ file: file.file, result });
      }
    }
  }
  const combos: Array<Combo> = [];
  for (const entry of byKey.values()) {
    combos.push({
      label: resultLabel(entry.current),
      scenario: entry.current.scenario,
      surface: entry.current.surface,
      size: entry.current.size,
      current: entry.current,
      currentFile: entry.currentFile,
      history: entry.history,
    });
  }
  combos.sort(
    (a, b) =>
      a.scenario.localeCompare(b.scenario) ||
      a.surface.localeCompare(b.surface) ||
      a.size.localeCompare(b.size) ||
      (a.label ?? "").localeCompare(b.label ?? ""),
  );
  return combos;
}

// ---------------------------------------------------------------------------
// Plain-language labels and formatting
// ---------------------------------------------------------------------------

const SCENARIO_LABELS: Record<string, string> = {
  startup: "Cold start to the thread list",
  "open-giant-thread": "Open the giant thread",
  "scroll-giant-thread": "Scroll the giant thread",
  "slow-network-startup": "Cold start on a slow network",
  "flaky-reconnect": "Recover from dropped connections",
};

function scenarioLabel(name: string): string {
  return SCENARIO_LABELS[name] ?? name;
}

function comboLabel(combo: {
  scenario: string;
  surface: string;
  size: string;
  label?: string | null;
}): string {
  const base = `${scenarioLabel(combo.scenario)} · ${combo.surface} · ${combo.size} fixture`;
  return combo.label === undefined || combo.label === null ? base : `${base} · ${combo.label}`;
}

/** Scenarios that scroll for a fixed duration; their wall time is by design. */
function hasFixedDuration(scenario: string): boolean {
  return (
    scenario.includes("scroll") ||
    scenario.includes("streaming-turn") ||
    scenario.includes("terminal-output") ||
    scenario.includes("preview-pip")
  );
}

function isStartupLike(scenario: string): boolean {
  return scenario.includes("startup");
}

function fmtNum(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function fmtCi(summary: SampleSummary): string {
  return `${fmtNum(summary.ci95[0])} to ${fmtNum(summary.ci95[1])}`;
}

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** "2026-08-21T00-04-08-764Z" out of a results filename, made readable. */
function fileStamp(file: string): string {
  const match = /^perf-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(file);
  if (match === null) return file;
  return `${match[1]} ${match[2]}:${match[3]} UTC`;
}

// ---------------------------------------------------------------------------
// Priority heuristics
// ---------------------------------------------------------------------------

// The priority model is evidence-based: each metric is banded at the 75th
// percentile across its runs (the report displays medians), scored
// good = 0 / attention = 1 / poor = 3, and multiplied by a weight. Every
// finding cites the standard its band comes from. Bands, weights, and the
// two override rules all live in this section and nowhere else, so a later
// re-weighting pass only touches these tables.

type Severity = "critical" | "serious";

type Band = "good" | "attention" | "poor";

const BAND_SCORE: Record<Band, number> = { good: 0, attention: 1, poor: 3 };

interface BandDef {
  /** p75 at or below this is good. */
  readonly goodMax: number;
  /** p75 at or below this is attention; above it is poor. */
  readonly attentionMax: number;
  /** One-line citation shown on every finding this band produces. */
  readonly cite: string;
}

const BANDS = {
  coldStart: {
    goodMax: 2000,
    attentionMax: 5000,
    cite: "Standard: RAIL repeat-load 2 s / Android vitals cold start 5 s",
  },
  interaction: {
    goodMax: 200,
    attentionMax: 500,
    cite: "Standard: INP good <=200 ms / poor >500 ms (Core Web Vitals, web.dev)",
  },
  reconnect: {
    goodMax: 1000,
    attentionMax: 10000,
    cite: "Standard: Nielsen response-time limits, 1 s flow / 10 s attention",
  },
  // Server benches (PLANS.md 11-15): snapshot-query-*, search-threads-*, and
  // orchestration-snapshot-* results with surface "server". Derived: a
  // snapshot read or type-ahead search is one server-side slice of an
  // interaction that must fit the INP 200 ms budget end to end.
  serverQuery: {
    goodMax: 50,
    attentionMax: 200,
    cite: "Standard: derived band, no vendor standard (server share of the INP 200 ms interaction budget)",
  },
  // Server benches (PLANS.md 11): turn-dispatch-* results with surface
  // "server". Derived: a dispatched turn's command-to-terminal-receipt spans
  // provider send, ingestion, projection, and checkpointing, and should
  // settle within Nielsen's 1 s flow limit with headroom for the client hop.
  serverDispatch: {
    goodMax: 500,
    attentionMax: 1000,
    cite: "Standard: derived band, no vendor standard (dispatch-to-receipt inside the Nielsen 1 s flow limit)",
  },
  // Server bench (PLANS.md 13): projection-throughput and
  // projection-cursor-lag results with surface "server". Derived: the engine
  // replays any projection backlog at boot before serving snapshots, so a
  // full ~10k-event replay (and the read-model staleness sampled during it)
  // should fit inside the cold-start budget.
  serverProjection: {
    goodMax: 2000,
    attentionMax: 5000,
    cite: "Standard: derived band, no vendor standard (backlog replay inside the RAIL 2 s / Android vitals 5 s cold-start budget)",
  },
  // Server bench (PLANS.md 14): attachment-upload-* results with surface
  // "server". Derived: a 10 MiB inline image rides one thread.turn.start
  // (the contract caps one WS frame's data URL at 14 M chars), so the store
  // write and the dispatch-to-receipt leg should settle within Nielsen's 1 s
  // flow limit, and the signed-URL read-back is one server slice of the same
  // budget.
  serverAttachment: {
    goodMax: 500,
    attentionMax: 1000,
    cite: "Standard: derived band, no vendor standard (10 MiB upload turn inside the Nielsen 1 s flow limit)",
  },
  // settings-navigation wall time. Derived: the scenario's wall covers 9
  // route transitions (settings open, 7 section switches, return to the
  // thread list), so the INP interaction band applies per transition and the
  // scenario bands at 9x: good <= 9 x 200 ms, poor > 9 x 500 ms.
  settingsWalk: {
    goodMax: 1800,
    attentionMax: 4500,
    cite: "Standard: derived, 9x INP good <=200 ms / poor >500 ms per transition (Core Web Vitals, web.dev)",
  },
  // many-projects-sidebar (PLANS.md 6): wall time is the wide-fixture cold
  // start to a rendered sidebar (freshEnv + measureFromLaunch), banded as a
  // cold start because the mount dominates. The sidebar thread list and the
  // project scope menu are plain non-virtualized .maps in Sidebar.tsx, so
  // this mount scales with project and thread counts. The in-run scope
  // switches land as t3perf.project-scope pageMeasures and judge against the
  // interaction band.
  manyProjectsMount: {
    goodMax: 2000,
    attentionMax: 5000,
    cite: "Standard: RAIL repeat-load 2 s / Android vitals cold start 5 s",
  },
  // open-large-diff (PLANS.md 3): opening the giant thread's seeded 40-file /
  // ~4.8k-changed-line checkpoint diff to the first painted hunk is one
  // interaction, so the default interaction wall band already applies; the
  // t3perf.diff-open pageMeasure (click to first hunk) judges against the
  // same band.
  openLargeDiff: {
    goodMax: 200,
    attentionMax: 500,
    cite: "Standard: INP good <=200 ms / poor >500 ms (Core Web Vitals, web.dev)",
  },
  keypress: {
    goodMax: 50,
    attentionMax: 100,
    cite: "Standard: editor-class input latency; RAIL 50 ms input-processing budget",
  },
  // sidebar-scroll-and-reorder (PLANS.md 8): the scroll half is judged by the
  // gpuRate and droppedShare bands (the name contains "scroll", so wall time
  // is exempt by design). The pinned-row drop settle will land as the
  // t3perf.pin-drop-settle pageMeasure and band as one interaction; the drag
  // half is blocked until fixture threads are event-backed (the decider
  // rejects thread.pin.reorder against projection-only rows).
  pinDropSettle: {
    goodMax: 200,
    attentionMax: 500,
    cite: "Standard: INP good <=200 ms / poor >500 ms (Core Web Vitals, web.dev)",
  },
  // streaming-turn-append (PLANS.md 2): a real assistant turn streams deltas
  // into the auto-scrolling timeline for a fixed 10 s window, so wall time is
  // exempt (hasFixedDuration) and the run is judged on droppedShare and
  // gpuRate, exactly the bands PLANS.md names ("dropped frames <= 5%, GPU
  // within scroll bands").
  droppedShare: {
    goodMax: 0.05,
    attentionMax: 0.5,
    cite: "Standard: Android vitals rendering (slow/frozen frames)",
  },
  blocking: {
    goodMax: 200,
    attentionMax: 600,
    cite: "Standard: Lighthouse Total Blocking Time bands, 200/600 ms",
  },
  gpuRate: {
    goodMax: 10,
    attentionMax: 100,
    cite: "Standard: derived band, no vendor standard (Apple energy guidance + 60 Hz frame budget)",
  },
  // terminal-output-burst (PLANS.md 4): ~10k lines stream into the Ghostty
  // canvas for a fixed ~10 s window after Enter, so wall time is exempt
  // (hasFixedDuration) and the run is judged on droppedShare and the GPU
  // scroll bands (gpuRate, applied to both true GPU time and GPU-process
  // CPU), exactly what PLANS.md names ("dropped frames plus GPU scroll
  // bands"). This entry mirrors gpuRate so the derivation is recorded next
  // to the other per-scenario bands; the generic gpuRate and droppedShare
  // findings do the judging.
  terminalBurst: {
    goodMax: 10,
    attentionMax: 100,
    cite: "Standard: derived band, no vendor standard (GPU scroll bands: Apple energy guidance + 60 Hz frame budget)",
  },
  // preview-pip-frames (PLANS.md 9): the desktop picture-in-picture window
  // streams 12 fps capturePage JPEG frames while the main window renders,
  // over a fixed 10 s window, so wall time is exempt (hasFixedDuration) and
  // the run is judged on droppedShare and the GPU scroll bands (gpuRate, on
  // both true GPU time and GPU-process CPU), exactly what PLANS.md names
  // ("Band: GPU scroll bands"). This entry mirrors gpuRate so the derivation
  // is recorded next to the other per-scenario bands; the generic gpuRate
  // and droppedShare findings do the judging.
  previewPipStream: {
    goodMax: 10,
    attentionMax: 100,
    cite: "Standard: derived band, no vendor standard (GPU scroll bands: Apple energy guidance + 60 Hz frame budget)",
  },
  // environment-switch (PLANS.md 10): the run's wall covers two warm sidebar
  // scope switches between the two connected environments (to the second and
  // back), so the generic interaction wall band applies and each direction
  // also lands as a t3perf.env-switch pageMeasure judged against the same
  // 200/500 ms INP budget. Connection establishment happens at pairing time,
  // inside prepare() and outside the metrics window, by design; a cold switch
  // that still has to establish (or re-establish) the second environment's
  // connection is a reconnect-shaped wait and belongs to the 1000/10000 ms
  // reconnect band (Nielsen response-time limits) instead. This entry mirrors
  // the interaction band so the derivation is recorded next to the other
  // per-scenario bands; the generic interaction finding does the judging.
  environmentSwitch: {
    goodMax: 200,
    attentionMax: 500,
    cite: "Standard: INP good <=200 ms / poor >500 ms (Core Web Vitals, web.dev); cold switch incl. connection establishment: Nielsen 1 s / 10 s",
  },
  heapRatio: {
    goodMax: 1.25,
    attentionMax: 2,
    cite: "Standard: trend-based, no published standard (large vs small fixture ratio)",
  },
} as const satisfies Record<string, BandDef>;

const WEIGHTS = {
  interactionWall: 0.25,
  droppedFrames: 0.15,
  coldStartWall: 0.1,
  reconnectWall: 0.1,
  blocking: 0.05,
  gpu: 0.1,
  gpuCpu: 0.1,
  heap: 0.05,
} as const;

function bandOf(value: number, def: BandDef): Band {
  if (value <= def.goodMax) return "good";
  if (value <= def.attentionMax) return "attention";
  return "poor";
}

function percentile75(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.75 * sorted.length) - 1)] ?? null;
}

interface PriorityItem {
  readonly severity: Severity;
  readonly score: number;
  /** 0 holds user-facing poors and promoted resource poors; 1 is the rest. */
  readonly tier: number;
  readonly combo: string;
  readonly number: string;
  readonly numberLabel: string;
  /** "good" never appears here; "regression" marks release findings. */
  readonly band: string;
  readonly reason: string;
  readonly standard: string;
}

/** Relative change label: "+34%" up to 3x, then "4.2x". Null when the base is too small to divide by. */
function changeLabel(current: number, previous: number): { text: string; ratio: number } | null {
  if (!(previous > 1) || !Number.isFinite(current)) return null;
  const ratio = current / previous;
  const text =
    ratio >= 3
      ? `${ratio.toFixed(1)}x`
      : `${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(0)}%`;
  return { text, ratio };
}

/**
 * Bands are judged on the current build of each (scenario, surface, size):
 * the repo build when present, otherwise the newest release label.
 */
function currentBuildCombos(combos: ReadonlyArray<Combo>): Array<Combo> {
  const byKey = new Map<string, Combo>();
  for (const combo of combos) {
    const key = `${combo.scenario} ${combo.surface} ${combo.size}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, combo);
      continue;
    }
    if (existing.label === null) continue;
    if (combo.label === null || compareReleaseLabels(combo.label, existing.label) > 0) {
      byKey.set(key, combo);
    }
  }
  return [...byKey.values()];
}

interface Finding {
  readonly band: Band;
  readonly weight: number;
  readonly userFacing: boolean;
  /** Override 2: sustained GPU cost at poor joins the user-facing top tier. */
  readonly promotedAtPoor: boolean;
  readonly combo: { scenario: string; surface: string; size: string; label?: string | null };
  readonly number: string;
  readonly numberLabel: string;
  readonly reason: string;
  readonly standard: string;
}

function computePriorities(combos: ReadonlyArray<Combo>): Array<PriorityItem> {
  const items: Array<PriorityItem> = [];
  const add = (finding: Finding) => {
    if (finding.band === "good") return;
    const poor = finding.band === "poor";
    items.push({
      severity: poor ? "critical" : "serious",
      score: finding.weight * BAND_SCORE[finding.band],
      tier: poor && (finding.userFacing || finding.promotedAtPoor) ? 0 : 1,
      combo: comboLabel(finding.combo),
      number: finding.number,
      numberLabel: finding.numberLabel,
      band: finding.band,
      reason: finding.reason,
      standard: finding.standard,
    });
  };

  const current = currentBuildCombos(combos);
  for (const combo of current) {
    const runs = combo.current.runs;

    // Wall time, banded by what the scenario means to the user. Scroll
    // scenarios have fixed wall time by design, so their user impact is
    // judged on frames and GPU instead.
    if (!hasFixedDuration(combo.scenario)) {
      const isReconnect = combo.scenario.includes("reconnect");
      const startup = isStartupLike(combo.scenario);
      const def = isReconnect ? BANDS.reconnect : startup ? BANDS.coldStart : BANDS.interaction;
      const weight = isReconnect
        ? WEIGHTS.reconnectWall
        : startup
          ? WEIGHTS.coldStartWall
          : WEIGHTS.interactionWall;
      const kind = isReconnect ? "reconnect recovery" : startup ? "cold start" : "interaction";
      const walls = runs.map((run) => run.wallMs);
      const p75 = percentile75(walls);
      const med = medianOf(walls);
      if (p75 !== null && med !== null) {
        add({
          band: bandOf(p75, def),
          weight,
          userFacing: true,
          promotedAtPoor: false,
          combo,
          number: fmtNum(med),
          numberLabel: `ms median ${kind} wall time`,
          reason: `p75 wall time is ${fmtNum(p75)} ms against the ${kind} band of good at most ${fmtNum(def.goodMax)} ms, poor over ${fmtNum(def.attentionMax)} ms.${isReconnect ? " Wall time includes about 1 s of pre-drop setup (thread list wait)." : ""}`,
          standard: def.cite,
        });
      }
    }

    // Dropped frames, as an estimated share of a 60 Hz frame budget.
    const shares = runs
      .map((run) =>
        run.renderer !== null && run.renderer.droppedFrames !== null && run.wallMs > 0
          ? run.renderer.droppedFrames / Math.max(1, (run.wallMs / 1000) * 60)
          : null,
      )
      .filter((value): value is number => value !== null);
    const shareP75 = percentile75(shares);
    const shareMed = medianOf(shares);
    if (shareP75 !== null && shareMed !== null) {
      add({
        band: bandOf(shareP75, BANDS.droppedShare),
        weight: WEIGHTS.droppedFrames,
        userFacing: true,
        promotedAtPoor: false,
        combo,
        number: `${fmtNum(shareMed * 100, 1)}%`,
        numberLabel: "of frames dropped (median, 60 Hz estimate)",
        reason: `p75 dropped-frame share is ${fmtNum(shareP75 * 100, 1)}% against a band of attention over 5%, poor over 50%.`,
        standard: BANDS.droppedShare.cite,
      });
    }

    // Script plus layout blocking time.
    const blocking = runs
      .map((run) =>
        run.renderer === null
          ? null
          : run.renderer.scriptDurationMs + run.renderer.layoutDurationMs,
      )
      .filter((value): value is number => value !== null);
    const blockingP75 = percentile75(blocking);
    const blockingMed = medianOf(blocking);
    if (blockingP75 !== null && blockingMed !== null) {
      add({
        band: bandOf(blockingP75, BANDS.blocking),
        weight: WEIGHTS.blocking,
        userFacing: false,
        promotedAtPoor: false,
        combo,
        number: fmtNum(blockingMed),
        numberLabel: "ms script plus layout (median)",
        reason: `p75 script plus layout is ${fmtNum(blockingP75)} ms against a band of good at most 200 ms, poor over 600 ms.`,
        standard: BANDS.blocking.cite,
      });
    }

    // Sustained GPU per wall second.
    const gpuRates = runs.map((run) => run.appGpuMsPerSecond);
    const gpuP75 = percentile75(gpuRates);
    const gpuMed = medianOf(gpuRates);
    if (gpuP75 !== null && gpuMed !== null) {
      add({
        band: bandOf(gpuP75, BANDS.gpuRate),
        weight: WEIGHTS.gpu,
        userFacing: false,
        promotedAtPoor: true,
        combo,
        number: fmtNum(gpuMed, 1),
        numberLabel: "GPU-ms per second (median)",
        reason: `p75 GPU time is ${fmtNum(gpuP75, 1)} ms per wall second against a derived band of good at most 10, poor over 100.`,
        standard: BANDS.gpuRate.cite,
      });
    }

    // GPU-process CPU per wall second (software rendering on Linux). Same
    // bands and the same top-tier promotion as GPU.
    const gpuCpuRates = runs
      .map((run) => {
        const value = runGpuProcessCpuMs(run);
        return value === null || run.wallMs <= 0 ? null : value / (run.wallMs / 1000);
      })
      .filter((value): value is number => value !== null);
    const gpuCpuP75 = percentile75(gpuCpuRates);
    const gpuCpuMed = medianOf(gpuCpuRates);
    if (gpuCpuP75 !== null && gpuCpuMed !== null) {
      add({
        band: bandOf(gpuCpuP75, BANDS.gpuRate),
        weight: WEIGHTS.gpuCpu,
        userFacing: false,
        promotedAtPoor: true,
        combo,
        number: fmtNum(gpuCpuMed, 1),
        numberLabel: "GPU-process CPU ms per second (median)",
        reason: `p75 GPU-process CPU is ${fmtNum(gpuCpuP75, 1)} ms per wall second against a derived band of good at most 10, poor over 100.`,
        standard: BANDS.gpuRate.cite,
      });
    }
  }

  // JS heap has no absolute standard; flag only the small-to-large trend.
  const heapPairs = new Map<string, Map<string, Combo>>();
  for (const combo of current) {
    const key = `${combo.scenario} ${combo.surface} ${combo.label ?? "repo"}`;
    const sizes = heapPairs.get(key) ?? new Map<string, Combo>();
    sizes.set(combo.size, combo);
    heapPairs.set(key, sizes);
  }
  for (const sizes of heapPairs.values()) {
    const small = sizes.get("small");
    const large = sizes.get("large");
    if (small === undefined || large === undefined) continue;
    const heaps = (combo: Combo) =>
      combo.current.runs
        .map((run) => run.renderer?.jsHeapUsedBytes ?? null)
        .filter((value): value is number => value !== null);
    const smallP75 = percentile75(heaps(small));
    const largeP75 = percentile75(heaps(large));
    const smallMed = medianOf(heaps(small));
    const largeMed = medianOf(heaps(large));
    if (smallP75 === null || largeP75 === null || smallMed === null || largeMed === null) continue;
    if (smallP75 <= 0) continue;
    const ratio = largeP75 / smallP75;
    add({
      band: bandOf(ratio, BANDS.heapRatio),
      weight: WEIGHTS.heap,
      userFacing: false,
      promotedAtPoor: false,
      combo: large,
      number: `${fmtNum(ratio, 2)}x`,
      numberLabel: "JS heap, large vs small fixture (p75)",
      reason: `p75 heap grows from ${fmtNum(smallMed / 1e6, 1)} to ${fmtNum(largeMed / 1e6, 1)} MB (medians shown) against a band of attention over 1.25x, poor over 2x.`,
      standard: BANDS.heapRatio.cite,
    });
  }

  // Release regressions keep feeding the list: any charted metric more than
  // 20% above the stable baseline (the dotted points on the release charts),
  // ranked by the same weight as the metric that regressed.
  for (const chart of releaseCharts(combos)) {
    const baselineWord = chart.baselineIsStable ? "stable" : chart.baselineLabel;
    for (const series of chart.series) {
      const weight = regressionWeight(series.metric, chart.scenario);
      const userFacing = series.metric.plain === "wall time";
      const promoted = series.metric.plain.startsWith("GPU");
      for (const point of series.points) {
        if (!point.regressed) continue;
        const tick = chart.axis[point.axisIndex];
        if (tick === undefined) continue;
        const change = changeLabel(point.value, series.baseValue);
        if (change === null) continue;
        const doubled = point.percent > 200;
        items.push({
          severity: doubled ? "critical" : "serious",
          score: weight * (doubled ? 3 : 1),
          tier: doubled && (userFacing || promoted) ? 0 : 1,
          combo: comboLabel({
            scenario: chart.scenario,
            surface: chart.surface,
            size: chart.size,
            label: tick.label,
          }),
          number: change.text,
          numberLabel: `worse median ${series.metric.plain} than ${baselineWord}`,
          band: "regression",
          reason: `In ${tick.label}, median ${series.metric.plain} is ${change.text} vs ${chart.baselineLabel} (${fmtNum(point.value, series.metric.digits)} vs ${fmtNum(series.baseValue, series.metric.digits)} ${series.metric.unit}).`,
          standard:
            "Standard: internal regression gate, more than 20% worse than the stable baseline",
        });
      }
    }
  }

  // Override 1 lives in the tier: user-facing poors (and promoted GPU poors)
  // sort ahead of every resource-only finding regardless of score.
  items.sort((a, b) => a.tier - b.tier || b.score - a.score);
  return items.slice(0, 6);
}

/** A regressed metric ranks by the same weight its band uses. */
function regressionWeight(metric: ReleaseMetricDef, scenario: string): number {
  switch (metric.plain) {
    case "wall time":
      return scenario.includes("reconnect")
        ? WEIGHTS.reconnectWall
        : isStartupLike(scenario)
          ? WEIGHTS.coldStartWall
          : WEIGHTS.interactionWall;
    case "GPU per second":
      return WEIGHTS.gpu;
    case "GPU process CPU":
      return WEIGHTS.gpuCpu;
    case "script time":
      return WEIGHTS.blocking;
    default:
      return WEIGHTS.heap;
  }
}

interface ScalingMetric {
  readonly name: string;
  readonly unit: string;
  readonly small: number;
  readonly large: number;
  readonly ratio: number | null;
}

function scalingMetrics(small: Combo, large: Combo): Array<ScalingMetric> {
  const s = small.current.summary;
  const l = large.current.summary;
  const entry = (
    name: string,
    unit: string,
    a: number | null | undefined,
    b: number | null | undefined,
  ): ScalingMetric | null => {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return { name, unit, small: a, large: b, ratio: a > 1 ? b / a : null };
  };
  const metrics = [
    hasFixedDuration(small.scenario)
      ? null
      : entry("Wall time", "ms", s.wallMs.median, l.wallMs.median),
    entry("GPU per second", "GPU-ms/s", s.appGpuMsPerSecond.median, l.appGpuMsPerSecond.median),
    entry("Script time", "ms", s.scriptDurationMs?.median, l.scriptDurationMs?.median),
    entry("Layout passes", "layouts", s.layoutCount?.median, l.layoutCount?.median),
  ];
  return metrics.filter((metric): metric is ScalingMetric => metric !== null);
}

// ---------------------------------------------------------------------------
// Release comparison (labeled results)
// ---------------------------------------------------------------------------

/** Sortable key for nightly-style labels: the dotted digits after "nightly.". */
function nightlyKey(label: string): string | null {
  const match = /nightly\.(\d+(?:\.\d+)*)/.exec(label);
  if (match === null || match[1] === undefined) return null;
  return match[1]
    .split(".")
    .map((segment) => segment.padStart(16, "0"))
    .join(".");
}

/** Stable releases first (the baseline), then nightlies in date order. */
function compareReleaseLabels(a: string, b: string): number {
  const stableA = a.includes("stable") ? 0 : 1;
  const stableB = b.includes("stable") ? 0 : 1;
  if (stableA !== stableB) return stableA - stableB;
  const keyA = nightlyKey(a);
  const keyB = nightlyKey(b);
  if (keyA !== null && keyB !== null && keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a.localeCompare(b);
}

/** Short x-axis tick for a release label: "stable" or the nightly's "MM-DD". */
function shortReleaseTick(label: string): string {
  if (label.includes("stable")) return "stable";
  const match = /nightly\.\d{4}(\d{2})(\d{2})/.exec(label);
  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    return `${match[1]}-${match[2]}`;
  }
  return label.length > 12 ? label.slice(0, 12) : label;
}

interface ReleaseMetricDef {
  readonly name: string;
  /** Lower-case phrasing for priority reasons. */
  readonly plain: string;
  readonly unit: string;
  readonly digits: number;
  /** Fixed categorical slot; the color follows the metric, never the chart. */
  readonly slot: number;
  readonly get: (result: ScenarioResult) => number | null;
  /** Wall time on fixed-duration scroll scenarios is test design, not cost. */
  readonly regressionExempt?: (scenario: string) => boolean;
}

const RELEASE_METRICS: ReadonlyArray<ReleaseMetricDef> = [
  {
    name: "Wall time",
    plain: "wall time",
    unit: "ms",
    digits: 0,
    slot: 1,
    get: (result) => result.summary.wallMs.median,
    regressionExempt: hasFixedDuration,
  },
  {
    name: "GPU per second",
    plain: "GPU per second",
    unit: "GPU-ms/s",
    digits: 1,
    slot: 2,
    get: (result) => result.summary.appGpuMsPerSecond.median,
  },
  {
    name: "GPU proc CPU",
    plain: "GPU process CPU",
    unit: "ms",
    digits: 1,
    slot: 3,
    get: gpuProcessCpuMedian,
  },
  {
    name: "Script time",
    plain: "script time",
    unit: "ms",
    digits: 1,
    slot: 4,
    get: (result) => result.summary.scriptDurationMs?.median ?? null,
  },
  {
    name: "JS heap",
    plain: "JS heap",
    unit: "MB",
    digits: 1,
    slot: 5,
    get: (result) =>
      result.summary.jsHeapUsedBytes === null ? null : result.summary.jsHeapUsedBytes.median / 1e6,
  },
];

interface ReleasePoint {
  readonly axisIndex: number;
  readonly value: number;
  /** Percent of the baseline value; 100 means unchanged, higher is worse. */
  readonly percent: number;
  /** More than 20% above the baseline: dotted on the chart, fed to priorities. */
  readonly regressed: boolean;
}

interface ReleaseSeries {
  readonly metric: ReleaseMetricDef;
  readonly baseValue: number;
  /** Sparse by axisIndex; a missing axis index renders as a gap in the line. */
  readonly points: ReadonlyArray<ReleasePoint>;
}

interface ReleaseChart {
  readonly scenario: string;
  readonly surface: string;
  readonly size: string;
  /** Shared x axis across all charts: every label in the set, stable first. */
  readonly axis: ReadonlyArray<{ readonly label: string; readonly short: string }>;
  readonly baselineLabel: string;
  readonly baselineIsStable: boolean;
  /** Axis labels with no result for this scenario at all (failed or skipped). */
  readonly missing: ReadonlyArray<string>;
  readonly series: ReadonlyArray<ReleaseSeries>;
}

/**
 * One chart model per (scenario, surface, size) spanning two or more release
 * labels. Series are medians normalized to the baseline release (stable when
 * present, otherwise the earliest release with data). Only returned when two
 * or more distinct labels exist overall; repo results never appear here.
 */
function releaseCharts(combos: ReadonlyArray<Combo>): Array<ReleaseChart> {
  const labeled = combos.filter((combo) => combo.label !== null);
  const allLabels = [...new Set(labeled.map((combo) => combo.label ?? ""))].sort(
    compareReleaseLabels,
  );
  if (allLabels.length < 2) return [];
  const axis = allLabels.map((label) => ({ label, short: shortReleaseTick(label) }));
  const byKey = new Map<string, Map<string, Combo>>();
  for (const combo of labeled) {
    const key = `${combo.scenario} ${combo.surface} ${combo.size}`;
    const byLabel = byKey.get(key) ?? new Map<string, Combo>();
    byLabel.set(combo.label ?? "", combo);
    byKey.set(key, byLabel);
  }
  const charts: Array<ReleaseChart> = [];
  for (const byLabel of byKey.values()) {
    if (byLabel.size < 2) continue;
    const anyCombo = [...byLabel.values()][0];
    if (anyCombo === undefined) continue;
    const presentTicks = axis.filter((tick) => byLabel.has(tick.label));
    const baselineTick =
      presentTicks.find((tick) => tick.label.includes("stable")) ?? presentTicks[0];
    if (baselineTick === undefined) continue;
    const baselineCombo = byLabel.get(baselineTick.label);
    if (baselineCombo === undefined) continue;
    const series: Array<ReleaseSeries> = [];
    for (const metric of RELEASE_METRICS) {
      const baseValue = metric.get(baselineCombo.current);
      // No nonsense ratios: skip a metric whose baseline is missing or tiny
      // (for example GPU ms/s stays zero where sampling is a no-op).
      if (baseValue === null || baseValue < 1) continue;
      const exempt = metric.regressionExempt?.(anyCombo.scenario) === true;
      const points: Array<ReleasePoint> = [];
      axis.forEach((tick, axisIndex) => {
        const combo = byLabel.get(tick.label);
        if (combo === undefined) return;
        const value = metric.get(combo.current);
        if (value === null) return;
        const percent = (value / baseValue) * 100;
        points.push({
          axisIndex,
          value,
          percent,
          regressed: !exempt && tick.label !== baselineTick.label && percent > 120,
        });
      });
      if (points.length === 0) continue;
      series.push({ metric, baseValue, points });
    }
    if (series.length === 0) continue;
    charts.push({
      scenario: anyCombo.scenario,
      surface: anyCombo.surface,
      size: anyCombo.size,
      axis,
      baselineLabel: baselineTick.label,
      baselineIsStable: baselineTick.label.includes("stable"),
      missing: axis.filter((tick) => !byLabel.has(tick.label)).map((tick) => tick.short),
      series,
    });
  }
  charts.sort(
    (a, b) =>
      a.scenario.localeCompare(b.scenario) ||
      a.surface.localeCompare(b.surface) ||
      a.size.localeCompare(b.size),
  );
  return charts;
}

// Chart geometry: a fixed viewBox that scales with the card width.
const CHART_W = 460;
const CHART_LEFT = 44;
const CHART_RIGHT_PAD = 92;
const CHART_TOP = 12;
const CHART_PLOT_H = 140;
const CHART_H = CHART_TOP + CHART_PLOT_H + 26;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Smallest step from a fixed menu that yields at most ~5 gridlines. */
function nicePercentStep(range: number): number {
  for (const step of [10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000]) {
    if (range / step <= 5) return step;
  }
  return 10000;
}

function releaseChartSvg(chart: ReleaseChart): string {
  const plotW = CHART_W - CHART_LEFT - CHART_RIGHT_PAD;
  const n = chart.axis.length;
  const x = (index: number) =>
    n === 1 ? CHART_LEFT + plotW / 2 : CHART_LEFT + (index * plotW) / (n - 1);
  const percents = chart.series.flatMap((series) => series.points.map((point) => point.percent));
  const rawLo = Math.min(100, ...percents);
  const rawHi = Math.max(100, ...percents);
  const step = nicePercentStep(Math.max(rawHi - rawLo, 20));
  const lo = Math.floor(rawLo / step) * step;
  const hiCandidate = Math.ceil(rawHi / step) * step;
  const hi = hiCandidate === lo ? lo + step : hiCandidate;
  const y = (percent: number) => CHART_TOP + ((hi - percent) / (hi - lo)) * CHART_PLOT_H;
  const parts: Array<string> = [];

  for (let tick = lo; tick <= hi; tick += step) {
    const tickY = round1(y(tick));
    parts.push(
      `<line class="${tick === 100 ? "base-line" : "grid-line"}" x1="${CHART_LEFT}" y1="${tickY}" x2="${CHART_LEFT + plotW}" y2="${tickY}"/>`,
      `<text class="tick-num" x="${CHART_LEFT - 6}" y="${round1(tickY + 3)}" text-anchor="end">${tick}%</text>`,
    );
  }
  chart.axis.forEach((tick, index) => {
    parts.push(
      `<text x="${round1(x(index))}" y="${CHART_TOP + CHART_PLOT_H + 15}" text-anchor="middle">${esc(tick.short)}</text>`,
    );
  });

  const endLabels: Array<{ x: number; y: number; text: string }> = [];
  for (const series of chart.series) {
    const present = new Set(series.points.map((point) => point.axisIndex));
    let path = "";
    let previousIndex: number | null = null;
    for (const point of series.points) {
      const px = round1(x(point.axisIndex));
      const py = round1(y(point.percent));
      path +=
        previousIndex !== null && point.axisIndex === previousIndex + 1
          ? `L${px} ${py}`
          : `M${px} ${py}`;
      previousIndex = point.axisIndex;
    }
    parts.push(`<path class="ln s${series.metric.slot}" d="${path}"/>`);
    for (const point of series.points) {
      const isolated = !present.has(point.axisIndex - 1) && !present.has(point.axisIndex + 1);
      if (point.regressed || isolated) {
        parts.push(
          `<circle class="pt s${series.metric.slot}" cx="${round1(x(point.axisIndex))}" cy="${round1(y(point.percent))}" r="${point.regressed ? 4.5 : 3}"/>`,
        );
      }
    }
    const last = series.points[series.points.length - 1];
    if (last !== undefined) {
      endLabels.push({ x: x(last.axisIndex), y: y(last.percent), text: series.metric.name });
    }
  }

  // Direct labels at the right edge; when two would collide the legend
  // carries the identity instead of stacked, detached text.
  endLabels.sort((a, b) => a.y - b.y);
  let lastLabelY = Number.NEGATIVE_INFINITY;
  for (const label of endLabels) {
    const labelY = Math.max(CHART_TOP + 4, Math.min(label.y, CHART_TOP + CHART_PLOT_H - 2));
    if (labelY - lastLabelY < 11) continue;
    lastLabelY = labelY;
    parts.push(
      `<text class="end-label" x="${round1(label.x + 7)}" y="${round1(labelY + 3)}">${esc(label.text)}</text>`,
    );
  }

  // Hover columns: one tooltip per release listing every metric at that x.
  const slotW = n > 1 ? plotW / (n - 1) : plotW;
  chart.axis.forEach((tick, index) => {
    const lines = [tick.label];
    for (const series of chart.series) {
      const point = series.points.find((entry) => entry.axisIndex === index);
      lines.push(
        point === undefined
          ? `${series.metric.name}: no data`
          : `${series.metric.name}: ${fmtNum(point.value, series.metric.digits)} ${series.metric.unit} (${Math.round(point.percent)}%)`,
      );
    }
    const left = Math.max(CHART_LEFT, x(index) - slotW / 2);
    const right = Math.min(CHART_LEFT + plotW, x(index) + slotW / 2);
    parts.push(
      `<rect class="hover-col" tabindex="0" x="${round1(left)}" y="${CHART_TOP}" width="${round1(right - left)}" height="${CHART_PLOT_H}" data-tip="${esc(lines.join("\n"))}"/>`,
    );
  });

  return `<svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${esc(scenarioLabel(chart.scenario))} across releases, percent of ${esc(chart.baselineLabel)}">${parts.join("")}</svg>`;
}

function releaseChartCard(chart: ReleaseChart): string {
  const legend = chart.series
    .map(
      (series) =>
        `<span class="key"><span class="key-line k${series.metric.slot}"></span>${esc(series.metric.name)}</span>`,
    )
    .join("");
  const subtitle = chart.baselineIsStable
    ? `Medians as a percent of ${chart.baselineLabel}. 100% means unchanged; higher is worse.`
    : `No stable result for this scenario, so the baseline is the earliest release on file (${chart.baselineLabel}). 100% means unchanged; higher is worse.`;
  const note =
    chart.missing.length === 0
      ? ""
      : `<p class="chart-note">No result for ${chart.missing.map((short) => esc(short)).join(", ")}; the lines show a gap there.</p>`;
  const head = `<tr><th>Metric</th>${chart.axis.map((tick) => `<th>${esc(tick.short)}</th>`).join("")}</tr>`;
  const rows = chart.series
    .map((series) => {
      const cells = chart.axis
        .map((tick, index) => {
          const point = series.points.find((entry) => entry.axisIndex === index);
          return `<td>${point === undefined ? "n/a" : esc(fmtNum(point.value, series.metric.digits))}</td>`;
        })
        .join("");
      return `<tr><td>${esc(series.metric.name)} (${esc(series.metric.unit)})</td>${cells}</tr>`;
    })
    .join("");
  return `<article class="card">
<h3>${esc(scenarioLabel(chart.scenario))} · ${esc(chart.surface)} · ${esc(chart.size)} fixture</h3>
<p class="chart-sub">${esc(subtitle)}</p>
<div class="legend">${legend}</div>
${releaseChartSvg(chart)}
${note}
<details class="runs-table"><summary>Absolute values</summary><table><thead>${head}</thead><tbody>${rows}</tbody></table></details>
</article>`;
}

function releaseComparison(combos: ReadonlyArray<Combo>): string {
  const charts = releaseCharts(combos);
  if (charts.length === 0) return "";
  return `<section aria-labelledby="cmp-release-h">
  <h2 id="cmp-release-h">Release comparison</h2>
  <p class="section-note">Trends across releases, stable first as the baseline. Lower is better for every metric. A dot marks a point more than 20% above the baseline.</p>
  <div class="grid grid-wide">${charts.map((chart) => releaseChartCard(chart)).join("\n")}</div>
</section>`;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function statTile(label: string, value: string, sub?: string): string {
  return `<div class="stat"><dt>${esc(label)}</dt><dd>${esc(value)}${
    sub === undefined ? "" : `<span class="stat-sub">${esc(sub)}</span>`
  }</dd></div>`;
}

function runRow(run: WindowMetrics, index: number, includeGpuCpu: boolean): string {
  const r = run.renderer;
  const gpuCpu = runGpuProcessCpuMs(run);
  const cells = [
    String(index + 1),
    fmtNum(run.wallMs),
    fmtNum(run.appGpuMsPerSecond, 1),
    ...(includeGpuCpu ? [gpuCpu === null ? "n/a" : fmtNum(gpuCpu, 1)] : []),
    r === null ? "n/a" : fmtNum(r.scriptDurationMs, 1),
    r === null ? "n/a" : fmtNum(r.layoutDurationMs, 1),
    r === null ? "n/a" : fmtNum(r.layoutCount),
    r === null ? "n/a" : fmtNum(r.jsHeapUsedBytes / 1e6, 1),
    r === null || r.droppedFrames === null ? "n/a" : fmtNum(r.droppedFrames),
  ];
  return `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`;
}

function runStrip(combo: Combo): string {
  const runs = combo.current.runs;
  const max = Math.max(...runs.map((run) => run.wallMs), 1);
  const bars = runs
    .map((run, index) => {
      const height = Math.max(4, Math.round((run.wallMs / max) * 100));
      const tip = `Run ${index + 1}: wall ${fmtNum(run.wallMs)} ms, GPU ${fmtNum(run.appGpuMsPerSecond, 1)} ms/s`;
      return `<span class="run-hit" tabindex="0" data-tip="${esc(tip)}"><span class="run-bar bar-${esc(combo.surface)}" style="height:${height}%"></span></span>`;
    })
    .join("");
  return `<div class="runstrip"><div class="runstrip-bars">${bars}</div><span class="runstrip-caption">Wall time per run, ${runs.length} run${runs.length === 1 ? "" : "s"}</span></div>`;
}

function trendLine(combo: Combo): string {
  const previous = combo.history[0];
  if (previous === undefined) return "";
  const parts: Array<string> = [];
  const wall = hasFixedDuration(combo.scenario)
    ? null
    : changeLabel(combo.current.summary.wallMs.median, previous.result.summary.wallMs.median);
  if (wall !== null) {
    const worse = wall.ratio > 1.02;
    const better = wall.ratio < 0.98;
    const cls = worse ? "delta-bad" : better ? "delta-good" : "delta-flat";
    const arrow = worse ? "▲" : better ? "▼" : "●";
    const word = worse ? "slower" : better ? "faster" : "about the same";
    parts.push(
      `<span class="delta ${cls}">${arrow} wall ${worse || better ? `${esc(wall.text)} ` : ""}${word}</span>`,
    );
  }
  const gpu = changeLabel(
    combo.current.summary.appGpuMsPerSecond.median,
    previous.result.summary.appGpuMsPerSecond.median,
  );
  if (gpu !== null) {
    const worse = gpu.ratio > 1.02;
    const better = gpu.ratio < 0.98;
    const cls = worse ? "delta-bad" : better ? "delta-good" : "delta-flat";
    const arrow = worse ? "▲" : better ? "▼" : "●";
    const word = worse ? "higher" : better ? "lower" : "about the same";
    parts.push(
      `<span class="delta ${cls}">${arrow} GPU ${worse || better ? `${esc(gpu.text)} ` : ""}${word}</span>`,
    );
  }
  if (parts.length === 0) return "";
  return `<p class="trend">Vs previous run file: ${parts.join(" ")}</p>`;
}

function comboCard(combo: Combo): string {
  const summary = combo.current.summary;
  const showGpuCpu = hasGpuProcessCpu(combo.current);
  const gpuCpuMedian = gpuProcessCpuMedian(combo.current);
  const stats = [
    statTile("Wall time", `${fmtNum(summary.wallMs.median)} ms`, `95% CI ${fmtCi(summary.wallMs)}`),
    statTile("GPU per second", `${fmtNum(summary.appGpuMsPerSecond.median, 1)} ms/s`),
    ...(showGpuCpu && gpuCpuMedian !== null
      ? [statTile("GPU proc CPU", `${fmtNum(gpuCpuMedian, 1)} ms`)]
      : []),
    statTile(
      "Script time",
      summary.scriptDurationMs === null ? "n/a" : `${fmtNum(summary.scriptDurationMs.median, 1)} ms`,
    ),
    statTile(
      "Layout time",
      summary.layoutDurationMs === null ? "n/a" : `${fmtNum(summary.layoutDurationMs.median, 1)} ms`,
    ),
    statTile("Layout passes", summary.layoutCount === null ? "n/a" : fmtNum(summary.layoutCount.median)),
    statTile(
      "JS heap",
      summary.jsHeapUsedBytes === null ? "n/a" : `${fmtNum(summary.jsHeapUsedBytes.median / 1e6, 1)} MB`,
    ),
    statTile(
      "Dropped frames",
      summary.droppedFrames === null ? "n/a" : fmtNum(summary.droppedFrames.median),
    ),
  ].join("");
  const tableHead = `<tr><th>Run</th><th>Wall ms</th><th>GPU ms/s</th>${showGpuCpu ? "<th>GPU CPU ms</th>" : ""}<th>Script ms</th><th>Layout ms</th><th>Layouts</th><th>Heap MB</th><th>Dropped</th></tr>`;
  const tableRows = combo.current.runs.map((run, index) => runRow(run, index, showGpuCpu)).join("");
  const backendTag = gpuBackendTag(combo.current);
  return `<article class="card">
<header class="card-head">
  <div>
    <h3>${esc(scenarioLabel(combo.scenario))}</h3>
    <p class="card-sub">${esc(combo.scenario)} · ${esc(combo.size)} fixture${combo.label === null ? "" : ` · ${esc(combo.label)}`}</p>
    ${backendTag === null ? "" : `<span class="tag">${esc(backendTag)}</span>`}
  </div>
  <span class="key"><span class="key-line key-${esc(combo.surface)}"></span>${esc(combo.surface)}</span>
</header>
<dl class="stats">${stats}</dl>
${runStrip(combo)}
${trendLine(combo)}
<details class="runs-table"><summary>Per-run table</summary><table><thead>${tableHead}</thead><tbody>${tableRows}</tbody></table></details>
<p class="card-meta">Measured ${esc(fileStamp(combo.currentFile))} · ${combo.history.length} older run file${combo.history.length === 1 ? "" : "s"} on record</p>
</article>`;
}

function pairChart(title: string, unit: string, web: number, desktop: number): string {
  const max = Math.max(web, desktop, 1);
  const row = (surface: string, value: number) => {
    const width = Math.max(1, Math.round((value / max) * 100));
    return `<div class="pair-row"><span class="pair-label">${esc(surface)}</span><span class="pair-track"><span class="pair-bar bar-${esc(surface)}" style="width:${width}%"></span></span><span class="pair-value">${esc(fmtNum(value, unit === "ms" ? 0 : 1))}</span></div>`;
  };
  return `<div class="pair"><h4>${esc(title)} (${esc(unit)})</h4>${row("web", web)}${row("desktop", desktop)}</div>`;
}

function surfaceComparison(combos: ReadonlyArray<Combo>): string {
  const byKey = new Map<string, Map<string, Combo>>();
  for (const combo of combos) {
    if (combo.label !== null) continue;
    const key = `${combo.scenario} ${combo.size}`;
    const surfaces = byKey.get(key) ?? new Map<string, Combo>();
    surfaces.set(combo.surface, combo);
    byKey.set(key, surfaces);
  }
  const cards: Array<string> = [];
  for (const surfaces of byKey.values()) {
    const web = surfaces.get("web");
    const desktop = surfaces.get("desktop");
    if (web === undefined || desktop === undefined) continue;
    cards.push(`<article class="card">
<h3>${esc(scenarioLabel(web.scenario))} · ${esc(web.size)} fixture</h3>
${pairChart("Median wall time", "ms", web.current.summary.wallMs.median, desktop.current.summary.wallMs.median)}
${pairChart("Median GPU per second", "GPU-ms/s", web.current.summary.appGpuMsPerSecond.median, desktop.current.summary.appGpuMsPerSecond.median)}
</article>`);
  }
  if (cards.length === 0) {
    return `<p class="empty">No scenario has results for both surfaces yet.</p>`;
  }
  const legend = `<div class="legend"><span class="key"><span class="key-line key-web"></span>web</span><span class="key"><span class="key-line key-desktop"></span>desktop</span></div>`;
  return `${legend}<div class="grid">${cards.join("\n")}</div>`;
}

function sizeComparison(combos: ReadonlyArray<Combo>): string {
  const byKey = new Map<string, Map<string, Combo>>();
  for (const combo of combos) {
    if (combo.label !== null) continue;
    const key = `${combo.scenario} ${combo.surface}`;
    const sizes = byKey.get(key) ?? new Map<string, Combo>();
    sizes.set(combo.size, combo);
    byKey.set(key, sizes);
  }
  const cards: Array<string> = [];
  for (const sizes of byKey.values()) {
    const small = sizes.get("small");
    const large = sizes.get("large");
    if (small === undefined || large === undefined) continue;
    const rows = scalingMetrics(small, large)
      .map((metric) => {
        const ratioText = metric.ratio === null ? "n/a" : `${metric.ratio.toFixed(1)}x`;
        const flagged = metric.ratio !== null && metric.ratio > 3;
        return `<tr${flagged ? ' class="scale-flag"' : ""}><td>${esc(metric.name)}</td><td>${esc(fmtNum(metric.small, 1))}</td><td>${esc(fmtNum(metric.large, 1))}</td><td>${esc(ratioText)}${flagged ? ' <span class="chip chip-serious"><span class="chip-dot"></span>scales badly</span>' : ""}</td></tr>`;
      })
      .join("");
    cards.push(`<article class="card">
<h3>${esc(scenarioLabel(small.scenario))} · ${esc(small.surface)}</h3>
<table class="scale-table"><thead><tr><th>Metric</th><th>Small</th><th>Large</th><th>Large / small</th></tr></thead><tbody>${rows}</tbody></table>
</article>`);
  }
  if (cards.length === 0) {
    return `<p class="empty">No scenario has results for both fixture sizes yet. Run the suite with --heavy to add the large size.</p>`;
  }
  return `<div class="grid">${cards.join("\n")}</div>`;
}

function priorityList(priorities: ReadonlyArray<PriorityItem>): string {
  if (priorities.length === 0) {
    return `<p class="empty">Nothing exceeded the priority thresholds. All measured behaviors are inside budget.</p>`;
  }
  const items = priorities
    .map(
      (item, index) => `<li class="prio">
<span class="prio-rank">${index + 1}</span>
<div class="prio-body">
  <div class="prio-top"><span class="chip chip-${item.severity}"><span class="chip-dot"></span>${item.severity}</span><span class="prio-combo">${esc(item.combo)}</span></div>
  <p class="prio-metric">${esc(item.number)} <span class="prio-metric-label">${esc(item.numberLabel)} · ${esc(item.band === "regression" ? "regression" : `${item.band} band`)}</span></p>
  <p class="prio-reason">${esc(item.reason)}</p>
  <p class="prio-why">${esc(item.standard)}</p>
</div>
</li>`,
    )
    .join("\n");
  return `<ol class="prio-list">${items}</ol>`;
}

const STYLE = `
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --baseline: #c3c2b7;
  --border: rgba(11, 11, 11, 0.10);
  --web: #2a78d6;
  --desktop: #eb6834;
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --series-4: #eda100;
  --series-5: #e87ba4;
  --good: #0ca30c;
  --warning: #fab219;
  --serious: #ec835a;
  --critical: #d03b3b;
  --delta-good: #006300;
  --delta-bad: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255, 255, 255, 0.10);
    --web: #3987e5;
    --desktop: #d95926;
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
    --series-4: #c98500;
    --series-5: #d55181;
    --delta-good: #0ca30c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d;
  --surface: #1a1a19;
  --ink: #ffffff;
  --ink-2: #c3c2b7;
  --muted: #898781;
  --grid: #2c2c2a;
  --baseline: #383835;
  --border: rgba(255, 255, 255, 0.10);
  --web: #3987e5;
  --desktop: #d95926;
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
  --series-4: #c98500;
  --series-5: #d55181;
  --delta-good: #0ca30c;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 20px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 36px 0 12px; }
h3 { font-size: 14px; margin: 0; }
h4 { font-size: 12px; font-weight: 600; color: var(--ink-2); margin: 12px 0 6px; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.meta { color: var(--ink-2); margin: 0; }
#theme-toggle {
  background: var(--surface); color: var(--ink-2);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer;
}
#theme-toggle:hover { color: var(--ink); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.card-sub { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
.card-meta { color: var(--muted); font-size: 11px; margin: 10px 0 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px 12px; margin: 14px 0 0; }
.stat dt { font-size: 11px; color: var(--ink-2); }
.stat dd { margin: 0; font-size: 15px; font-weight: 600; }
.stat-sub { display: block; font-size: 10px; font-weight: 400; color: var(--muted); }
.runstrip { margin-top: 14px; }
.runstrip-bars {
  display: flex; align-items: flex-end; gap: 2px;
  height: 44px; border-bottom: 1px solid var(--baseline); padding: 0 2px;
}
.run-hit {
  display: flex; align-items: flex-end; justify-content: center;
  width: 14px; height: 100%; cursor: default;
}
.run-hit:hover .run-bar, .run-hit:focus-visible .run-bar { filter: brightness(1.15); }
.run-hit:focus-visible { outline: 1px solid var(--muted); outline-offset: 1px; }
.run-bar { width: 6px; border-radius: 3px 3px 0 0; }
.runstrip-caption { font-size: 11px; color: var(--muted); }
.bar-web { background: var(--web); }
.bar-desktop { background: var(--desktop); }
.key { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.key-line { width: 14px; height: 2px; border-radius: 1px; display: inline-block; }
.key-web { background: var(--web); }
.key-desktop { background: var(--desktop); }
.legend { display: flex; gap: 16px; margin: 0 0 10px; }
.trend { font-size: 12px; margin: 10px 0 0; color: var(--ink-2); }
.delta { margin-right: 10px; }
.delta-bad { color: var(--delta-bad); }
.delta-good { color: var(--delta-good); }
.delta-flat { color: var(--muted); }
.runs-table { margin-top: 12px; font-size: 12px; }
.runs-table summary { cursor: pointer; color: var(--ink-2); }
table { border-collapse: collapse; width: 100%; margin-top: 8px; font-variant-numeric: tabular-nums; }
th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 500; }
th, td { padding: 3px 8px 3px 0; border-bottom: 1px solid var(--grid); }
.prio-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.prio {
  display: flex; gap: 14px; align-items: flex-start;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px;
}
.prio-rank { font-size: 18px; font-weight: 700; color: var(--muted); min-width: 20px; text-align: center; }
.prio-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.prio-combo { font-size: 12px; color: var(--ink-2); }
.prio-metric { font-size: 24px; font-weight: 600; margin: 6px 0 2px; }
.prio-metric-label { font-size: 12px; font-weight: 400; color: var(--ink-2); }
.prio-reason { margin: 0; }
.prio-why { margin: 4px 0 0; font-size: 12px; color: var(--ink-2); }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; color: var(--ink-2);
  border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
}
.chip-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.chip-critical .chip-dot { background: var(--critical); }
.chip-serious .chip-dot { background: var(--serious); }
.chip-warning .chip-dot { background: var(--warning); }
.pair { margin-top: 4px; }
.pair-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.pair-label { width: 56px; font-size: 12px; color: var(--ink-2); }
.pair-track { flex: 1; display: block; }
.pair-bar { display: block; height: 14px; border-radius: 0 4px 4px 0; min-width: 2px; }
.pair-value { font-size: 12px; font-variant-numeric: tabular-nums; min-width: 48px; text-align: right; }
.scale-table td, .scale-table th { font-size: 12px; }
.section-note { font-size: 12px; color: var(--ink-2); margin: 0 0 10px; }
.grid-wide { grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
.chart { width: 100%; height: auto; display: block; margin-top: 4px; }
.chart text { font: 10px system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--muted); }
.chart .tick-num { font-variant-numeric: tabular-nums; }
.chart .end-label { fill: var(--ink-2); }
.chart .grid-line { stroke: var(--grid); stroke-width: 1; }
.chart .base-line { stroke: var(--baseline); stroke-width: 1; }
.chart .ln { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.chart .pt { stroke: var(--surface); stroke-width: 2; }
.chart .ln.s1 { stroke: var(--series-1); }
.chart .ln.s2 { stroke: var(--series-2); }
.chart .ln.s3 { stroke: var(--series-3); }
.chart .ln.s4 { stroke: var(--series-4); }
.chart .ln.s5 { stroke: var(--series-5); }
.chart .pt.s1 { fill: var(--series-1); }
.chart .pt.s2 { fill: var(--series-2); }
.chart .pt.s3 { fill: var(--series-3); }
.chart .pt.s4 { fill: var(--series-4); }
.chart .pt.s5 { fill: var(--series-5); }
.chart .hover-col { fill: transparent; outline: none; }
.chart .hover-col:hover, .chart .hover-col:focus-visible { fill: var(--grid); fill-opacity: 0.4; }
.key-line.k1 { background: var(--series-1); }
.key-line.k2 { background: var(--series-2); }
.key-line.k3 { background: var(--series-3); }
.key-line.k4 { background: var(--series-4); }
.key-line.k5 { background: var(--series-5); }
.chart-sub { font-size: 12px; color: var(--ink-2); margin: 4px 0 8px; }
.chart-note { font-size: 11px; color: var(--muted); margin: 6px 0 0; }
.tag {
  display: inline-block; margin-top: 4px;
  font-size: 10px; color: var(--muted);
  border: 1px solid var(--border); border-radius: 4px; padding: 0 6px;
}
.scale-flag td { font-weight: 600; }
.empty { color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.how { margin-top: 40px; border-top: 1px solid var(--grid); padding-top: 16px; font-size: 12px; color: var(--ink-2); }
.how ul { margin: 6px 0 0; padding-left: 18px; }
#tooltip {
  position: absolute; z-index: 10; pointer-events: none;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 5px 8px; font-size: 12px; max-width: 260px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  white-space: pre-line;
}
`;

const SCRIPT = `
(function () {
  var themes = ["auto", "light", "dark"];
  var index = 0;
  var button = document.getElementById("theme-toggle");
  button.addEventListener("click", function () {
    index = (index + 1) % themes.length;
    var theme = themes[index];
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    button.textContent = "Theme: " + theme;
  });

  var tip = document.getElementById("tooltip");
  function show(el) {
    tip.textContent = el.getAttribute("data-tip");
    tip.hidden = false;
    var rect = el.getBoundingClientRect();
    var top = rect.top + window.scrollY - tip.offsetHeight - 6;
    var left = rect.left + window.scrollX + rect.width / 2 - tip.offsetWidth / 2;
    left = Math.max(4, Math.min(left, document.documentElement.clientWidth - tip.offsetWidth - 4));
    if (top < window.scrollY) top = rect.bottom + window.scrollY + 6;
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }
  function hide() { tip.hidden = true; }
  document.addEventListener("pointerover", function (event) {
    var el = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    if (el) show(el); else hide();
  });
  document.addEventListener("focusin", function (event) {
    var el = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    if (el) show(el);
  });
  document.addEventListener("focusout", hide);
})();
`;

interface EmbeddedData {
  readonly generatedAt: string;
  readonly files: ReadonlyArray<string>;
  readonly combos: ReadonlyArray<{
    readonly label: string | null;
    readonly scenario: string;
    readonly surface: string;
    readonly size: string;
    readonly file: string;
    readonly summary: ScenarioResult["summary"];
    readonly runs: ReadonlyArray<{
      readonly wallMs: number;
      readonly appGpuMsPerSecond: number;
      readonly gpuProcessCpuMs: number | null;
      readonly gpuBackend: string | null;
      readonly scriptDurationMs: number | null;
      readonly layoutDurationMs: number | null;
      readonly layoutCount: number | null;
      readonly jsHeapUsedBytes: number | null;
      readonly droppedFrames: number | null;
    }>;
    readonly history: ReadonlyArray<{ readonly file: string; readonly summary: ScenarioResult["summary"] }>;
  }>;
  readonly priorities: ReadonlyArray<PriorityItem>;
}

function embeddedData(
  files: ReadonlyArray<ResultFile>,
  combos: ReadonlyArray<Combo>,
  priorities: ReadonlyArray<PriorityItem>,
  generatedAt: string,
): EmbeddedData {
  return {
    generatedAt,
    files: files.map((file) => file.file),
    combos: combos.map((combo) => ({
      label: combo.label,
      scenario: combo.scenario,
      surface: combo.surface,
      size: combo.size,
      file: combo.currentFile,
      summary: combo.current.summary,
      runs: combo.current.runs.map((run) => ({
        wallMs: run.wallMs,
        appGpuMsPerSecond: run.appGpuMsPerSecond,
        gpuProcessCpuMs: runGpuProcessCpuMs(run),
        gpuBackend: runGpuBackend(run),
        scriptDurationMs: run.renderer?.scriptDurationMs ?? null,
        layoutDurationMs: run.renderer?.layoutDurationMs ?? null,
        layoutCount: run.renderer?.layoutCount ?? null,
        jsHeapUsedBytes: run.renderer?.jsHeapUsedBytes ?? null,
        droppedFrames: run.renderer?.droppedFrames ?? null,
      })),
      history: combo.history.map((entry) => ({ file: entry.file, summary: entry.result.summary })),
    })),
    priorities,
  };
}

function renderHtml(
  files: ReadonlyArray<ResultFile>,
  combos: ReadonlyArray<Combo>,
  priorities: ReadonlyArray<PriorityItem>,
): string {
  const generatedAt = new Date().toISOString();
  const data = embeddedData(files, combos, priorities, generatedAt);
  const json = JSON.stringify(data).replaceAll("</", "<\\/");
  const totalRuns = combos.reduce((sum, combo) => sum + combo.current.runs.length, 0);
  const cards = combos.map((combo) => comboCard(combo)).join("\n");
  const body = `<div class="wrap">
<header class="page-head">
  <div>
    <h1>T3 Code performance report</h1>
    <p class="meta">Generated ${esc(generatedAt)} · ${files.length} result file${files.length === 1 ? "" : "s"} · ${combos.length} scenario combo${combos.length === 1 ? "" : "s"} · ${totalRuns} current runs</p>
  </div>
  <button id="theme-toggle" type="button">Theme: auto</button>
</header>

<section aria-labelledby="prio-h">
  <h2 id="prio-h">Highest priority to fix</h2>
  ${priorityList(priorities)}
</section>

<section aria-labelledby="all-h">
  <h2 id="all-h">All results</h2>
  <div class="legend"><span class="key"><span class="key-line key-web"></span>web</span><span class="key"><span class="key-line key-desktop"></span>desktop</span></div>
  ${combos.length === 0 ? `<p class="empty">No result files found. Run the benchmark first: node packages/perf-analyzer/src/cli.ts</p>` : `<div class="grid">${cards}</div>`}
</section>

${releaseComparison(combos)}

<section aria-labelledby="cmp-surface-h">
  <h2 id="cmp-surface-h">Web vs desktop</h2>
  ${surfaceComparison(combos)}
</section>

<section aria-labelledby="cmp-size-h">
  <h2 id="cmp-size-h">Small vs large</h2>
  ${sizeComparison(combos)}
</section>

<footer class="how">
  <strong>How priorities are scored.</strong> Each metric is banded at the 75th percentile across its runs (the report displays medians), scored good = 0, attention = 1, poor = 3, then multiplied by a weight:
  <ul>
    <li>Interaction wall time, weight 0.25: good at most 200 ms, poor over 500 ms (Core Web Vitals INP, web.dev).</li>
    <li>Dropped frames, weight 0.15: attention over 5%, poor over 50% of the 60 Hz frame budget (Android vitals rendering).</li>
    <li>Cold-start wall time, weight 0.10: good at most 2,000 ms, poor over 5,000 ms (RAIL repeat load; Android vitals cold start).</li>
    <li>Reconnect recovery, weight 0.10: good at most 1,000 ms, poor over 10,000 ms (Nielsen response-time limits).</li>
    <li>GPU per second and GPU-process CPU per second, weight 0.10 each: good at most 10, poor over 100 ms per wall second. Derived bands with no vendor standard, from Apple energy guidance plus the 60 Hz frame budget.</li>
    <li>Script plus layout blocking, weight 0.05: good at most 200 ms, poor over 600 ms (Lighthouse Total Blocking Time).</li>
    <li>JS heap, weight 0.05: large fixture over 1.25x the small one is attention, over 2x is poor. Trend-based, no published standard.</li>
  </ul>
  Two overrides: a user-facing metric in the poor band outranks every resource-only finding, and sustained GPU or GPU-process CPU in the poor band is promoted to that same top tier, because T3 Code is an all-day resident app where idle drain is user impact and continuous repaint is this repo's documented recurring regression. Scroll scenarios have fixed wall time by design, so they are judged on frames and GPU only. Release builds more than 20% worse than stable keep feeding the list, weighted by the regressed metric.
  Bands are judged on the current build of each scenario: the repo build when present, otherwise the newest release. The newest perf-*.json file containing a (label, scenario, surface, size) combo counts as current; older files with the same combo are history. Results without a label are the local repo build.
</footer>
</div>
<div id="tooltip" hidden></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T3 Code performance report</title>
<style>${STYLE}</style>
</head>
<body>
${body}
<script type="application/json" id="perf-data">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const resultsDir =
    values.in !== undefined ? NodePath.resolve(values.in) : NodePath.join(packageDir, "results");
  const outPath =
    values.out !== undefined
      ? NodePath.resolve(values.out)
      : NodePath.join(resultsDir, "report.html");

  const files = await loadResultFiles(resultsDir);
  const combos = groupCombos(files);
  const priorities = computePriorities(combos);
  const html = renderHtml(files, combos, priorities);
  await NodeFSP.mkdir(NodePath.dirname(outPath), { recursive: true });
  await NodeFSP.writeFile(outPath, html);
  console.log(
    `Report: ${outPath} (${files.length} result files, ${combos.length} combos, ${priorities.length} priority items)`,
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
