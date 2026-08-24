// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off globalFetch:off globalTimers:off - Host-side batch orchestrator; runs outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

/**
 * Deterministic batch orchestrator for benchmarking a queue of published
 * releases. Plain node, zero dependencies, no agent in the loop: progress is
 * observable from Grafana, not from a chat transcript.
 *
 * Two telemetry feeds, kept separate on purpose:
 * - orchestrator: queue lifecycle (install/run/export phases, exits,
 *   durations) as Loki logs {job="t3perf-orchestrator"} and OTLP gauges
 *   (t3perf.batch.*).
 * - harness: every stdout/stderr line of each suite run as Loki logs
 *   {job="t3perf-harness", version} — the per-run details.
 *
 * Telemetry never fails the batch: pushes that error are dropped with a
 * local warning, and the local orchestrator.log stays the source of truth.
 * Resumable: versions recorded as done (exit 0) in the ledger are skipped;
 * a legacy bash batch.log in the results dir is imported once.
 */

const HELP = `t3 perf batch orchestrator

Usage: node packages/perf-analyzer/src/batchOrchestrator.ts \\
  --versions <tsv> --releases <dir> --results <dir> \\
  --otlp <url> [--loki <url>] [--suite full] [--surface web]

The versions file is "<version>\\t<publish ISO>" per line. Runs are always
scheduled newest first, regardless of file order.
Each version: npm-install into <releases>/<version> if missing, run the
suite with the harness in this package, then export the results via
otlpBackfill stamped at the publish time.
`;

interface VersionEntry {
  readonly version: string;
  readonly publishedIso: string;
}

interface LedgerEntry {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly finishedAt: string;
  /** Combo counts from the run's results file; absent on legacy imports. */
  readonly combosOk?: number;
  readonly combosFailed?: number;
}

type Ledger = Record<string, LedgerEntry>;

const packageDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const host = NodeOS.hostname();

// ---------------------------------------------------------------- telemetry

class LokiShipper {
  private readonly buffers = new Map<string, Array<[string, string]>>();
  private warned = false;
  private readonly baseUrl: string | undefined;

  constructor(baseUrl: string | undefined) {
    this.baseUrl = baseUrl;
  }

  push(labels: Record<string, string>, line: string): void {
    if (this.baseUrl === undefined) return;
    const key = JSON.stringify(labels);
    const buffer = this.buffers.get(key) ?? [];
    buffer.push([`${Date.now()}000000`, line]);
    this.buffers.set(key, buffer);
  }

  async flush(): Promise<void> {
    if (this.baseUrl === undefined || this.buffers.size === 0) return;
    const streams = [...this.buffers.entries()].map(([key, values]) => ({
      stream: JSON.parse(key) as Record<string, string>,
      values,
    }));
    this.buffers.clear();
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/loki/api/v1/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streams }),
      });
      if (!response.ok && !this.warned) {
        this.warned = true;
        console.warn(`Loki push rejected: HTTP ${response.status} (further errors muted)`);
      }
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Loki push failed: ${message} (further errors muted)`);
      }
    }
  }
}

class MetricsPusher {
  private readonly gauges = new Map<
    string,
    { name: string; value: number; labels: Record<string, string> }
  >();
  private warned = false;
  private readonly otlpUrl: string;

  constructor(otlpUrl: string) {
    this.otlpUrl = otlpUrl;
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    // Metric identity is (name, labels); later writes overwrite earlier ones.
    this.gauges.set(JSON.stringify([name, labels]), { name, value, labels: { ...labels, host } });
  }

  async flush(): Promise<void> {
    if (this.gauges.size === 0) return;
    const timeUnixNano = `${Date.now()}000000`;
    const byName = new Map<string, Array<{ value: number; labels: Record<string, string> }>>();
    for (const entry of this.gauges.values()) {
      const list = byName.get(entry.name) ?? [];
      list.push(entry);
      byName.set(entry.name, list);
    }
    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "t3-perf-batch" } }],
          },
          scopeMetrics: [
            {
              scope: { name: "t3perf-batch" },
              metrics: [...byName.entries()].map(([name, points]) => ({
                name,
                unit: "1",
                gauge: {
                  dataPoints: points.map((point) => ({
                    attributes: Object.entries(point.labels).map(([key, value]) => ({
                      key,
                      value: { stringValue: value },
                    })),
                    timeUnixNano,
                    asDouble: point.value,
                  })),
                },
              })),
            },
          ],
        },
      ],
    };
    try {
      const response = await fetch(`${this.otlpUrl.replace(/\/+$/, "")}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok && !this.warned) {
        this.warned = true;
        console.warn(`OTLP batch-metric push rejected: HTTP ${response.status} (muted)`);
      }
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`OTLP batch-metric push failed: ${message} (muted)`);
      }
    }
  }
}

// -------------------------------------------------------------------- utils

function spawnLogged(
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd: string; env: NodeJS.ProcessEnv },
  onLine: (line: string, stream: "stdout" | "stderr") => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    const wire = (stream: "stdout" | "stderr") => {
      let pending = "";
      child[stream].setEncoding("utf8");
      child[stream].on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim() !== "") onLine(line, stream);
      });
      child[stream].on("end", () => {
        if (pending.trim() !== "") onLine(pending, stream);
      });
    };
    wire("stdout");
    wire("stderr");
    child.on("close", (code) => {
      activeChild = null;
      resolve(code ?? 1);
    });
    child.on("error", (error) => {
      activeChild = null;
      onLine(`spawn failed: ${error.message}`, "stderr");
      resolve(127);
    });
  });
}

let activeChild: NodeChildProcess.ChildProcess | null = null;

/**
 * Combo counts from a version's results dir, or null when no run completed
 * a single combo there. The harness exits 1 when any combo fails, but old
 * releases legitimately fail scenarios whose UI didn't exist yet, so "did
 * the suite produce results" is the done criterion, not the exit code.
 */
function readComboCounts(outDir: string): { ok: number; failed: number } | null {
  try {
    const files = NodeFS.readdirSync(outDir).filter(
      (name) => name.startsWith("perf-") && name.endsWith(".json"),
    );
    let ok = 0;
    let failed = 0;
    let found = false;
    for (const name of files) {
      const parsed = JSON.parse(NodeFS.readFileSync(NodePath.join(outDir, name), "utf8")) as {
        results?: Array<unknown>;
        failures?: Array<unknown>;
      };
      if (!Array.isArray(parsed.results)) continue;
      found = true;
      ok = parsed.results.length;
      failed = Array.isArray(parsed.failures) ? parsed.failures.length : 0;
    }
    return found && ok > 0 ? { ok, failed } : null;
  } catch {
    return null;
  }
}

async function readVersions(path: string): Promise<Array<VersionEntry>> {
  const raw = await NodeFSP.readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [version, publishedIso] = line.split("\t");
      if (
        version === undefined ||
        publishedIso === undefined ||
        Number.isNaN(Date.parse(publishedIso))
      ) {
        throw new Error(`Bad versions line: ${line}`);
      }
      return { version, publishedIso };
    });
}

// --------------------------------------------------------------------- main

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: {
      versions: { type: "string" },
      releases: { type: "string" },
      results: { type: "string" },
      otlp: { type: "string" },
      loki: { type: "string" },
      suite: { type: "string", default: "full" },
      surface: { type: "string", default: "web" },
      help: { type: "boolean", default: false },
    },
  });
  if (
    values.help ||
    values.versions === undefined ||
    values.releases === undefined ||
    values.results === undefined ||
    values.otlp === undefined
  ) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  const resultsDir = NodePath.resolve(values.results);
  const releasesDir = NodePath.resolve(values.releases);
  await NodeFSP.mkdir(resultsDir, { recursive: true });
  await NodeFSP.mkdir(releasesDir, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(resultsDir, "orchestrator.pid"), `${process.pid}\n`);

  const localLog = NodeFS.createWriteStream(NodePath.join(resultsDir, "orchestrator.log"), {
    flags: "a",
  });
  const loki = new LokiShipper(values.loki);
  const metrics = new MetricsPusher(values.otlp);

  const say = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    localLog.write(stamped + "\n");
    console.log(stamped);
    loki.push({ job: "t3perf-orchestrator", host }, line);
  };

  // Ledger, with a one-time import of the legacy bash batch log.
  const ledgerPath = NodePath.join(resultsDir, "orchestrator-state.json");
  let ledger: Ledger = {};
  try {
    ledger = JSON.parse(await NodeFSP.readFile(ledgerPath, "utf8")) as Ledger;
  } catch {
    try {
      const legacy = await NodeFSP.readFile(NodePath.join(resultsDir, "batch.log"), "utf8");
      for (const match of legacy.matchAll(/=== done (\S+) exit=0 (\S+) ===/g)) {
        ledger[match[1] ?? ""] = { exitCode: 0, durationMs: 0, finishedAt: match[2] ?? "" };
      }
      delete ledger[""];
      if (Object.keys(ledger).length > 0) {
        say(`imported ${Object.keys(ledger).length} completed version(s) from legacy batch.log`);
      }
    } catch {
      // No prior state; a fresh queue.
    }
  }
  const saveLedger = () => NodeFSP.writeFile(ledgerPath, JSON.stringify(ledger, null, 2));

  // Entries written before combo counts existed: read them off disk once, so
  // a version whose suite completed (with expected old-UI combo failures)
  // is not re-run.
  for (const [version, entry] of Object.entries(ledger)) {
    if (entry.combosOk !== undefined) continue;
    const counts = readComboCounts(NodePath.join(resultsDir, version));
    if (counts !== null) {
      ledger[version] = { ...entry, combosOk: counts.ok, combosFailed: counts.failed };
    }
  }
  await saveLedger();

  const queue = await readVersions(values.versions);
  // Done = the suite produced results (legacy exit-0 imports count too);
  // failed = it produced none (install failure, crash before any combo).
  const isDone = (entry: LedgerEntry) =>
    entry.exitCode === 0 || (entry.combosOk !== undefined && entry.combosOk > 0);
  const doneCount = () => Object.values(ledger).filter(isDone).length;
  const failedCount = () => Object.values(ledger).filter((entry) => !isDone(entry)).length;
  const combosFailedTotal = () =>
    Object.values(ledger).reduce((sum, entry) => sum + (entry.combosFailed ?? 0), 0);

  let currentVersion = "";
  let currentPhase = 0; // 0 idle, 1 install, 2 run, 3 export
  let combosDone = 0;

  const beat = () => {
    metrics.gauge("t3perf.batch.heartbeat_unix_seconds", Date.now() / 1000);
    metrics.gauge("t3perf.batch.versions_total", queue.length);
    metrics.gauge("t3perf.batch.versions_done", doneCount());
    metrics.gauge("t3perf.batch.versions_failed", failedCount());
    metrics.gauge("t3perf.batch.combos_failed_total", combosFailedTotal());
    if (currentVersion !== "") {
      metrics.gauge("t3perf.batch.current_phase", currentPhase, { version: currentVersion });
      metrics.gauge("t3perf.batch.combos_done", combosDone, { version: currentVersion });
    }
  };
  const telemetryTimer = setInterval(() => {
    beat();
    void metrics.flush();
    void loki.flush();
  }, 15_000);

  const stop = () => {
    say("received stop signal; terminating current child");
    if (activeChild !== null) activeChild.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  say(
    `batch start: ${queue.length} version(s), suite=${values.suite}, surface=${values.surface}, host=${host}`,
  );

  for (const { version, publishedIso } of queue) {
    const prior = ledger[version];
    if (prior !== undefined && isDone(prior)) {
      say(`skip ${version}: already done`);
      continue;
    }
    currentVersion = version;
    combosDone = 0;
    const startedAt = Date.now();
    const serverBin = NodePath.join(releasesDir, version, "node_modules", "t3", "dist", "bin.mjs");

    if (!NodeFS.existsSync(serverBin)) {
      currentPhase = 1;
      say(`install ${version}`);
      beat();
      await metrics.flush();
      const installCode = await spawnLogged(
        "npm",
        ["install", "--prefix", NodePath.join(releasesDir, version), "--silent", `t3@${version}`],
        { cwd: resultsDir, env: process.env },
        (line, stream) => {
          localLog.write(`[install ${version}] ${line}\n`);
          loki.push({ job: "t3perf-orchestrator", host, stream }, `[install ${version}] ${line}`);
        },
      );
      if (installCode !== 0 || !NodeFS.existsSync(serverBin)) {
        say(`install-failed ${version} exit=${installCode}`);
        ledger[version] = {
          exitCode: installCode === 0 ? 1 : installCode,
          durationMs: Date.now() - startedAt,
          finishedAt: new Date().toISOString(),
        };
        await saveLedger();
        continue;
      }
    }

    currentPhase = 2;
    say(`run ${version} (suite ${values.suite}, surface ${values.surface})`);
    beat();
    await metrics.flush();
    const outDir = NodePath.join(resultsDir, version);
    await NodeFSP.mkdir(outDir, { recursive: true });
    // Leftovers from an aborted attempt would double-export under this build.
    for (const stale of NodeFS.readdirSync(outDir)) {
      if (/^perf-.*\.(json|md)$/.test(stale)) await NodeFSP.rm(NodePath.join(outDir, stale));
    }
    const comboLine = /^\S+ \/ (web|desktop|server) \/ \S+ \/ net=/;
    const runCode = await spawnLogged(
      process.execPath,
      [
        "src/cli.ts",
        "--suite",
        values.suite,
        "--surface",
        values.surface,
        "--headless",
        "--label",
        version,
        "--build",
        version,
        "--out",
        outDir,
      ],
      { cwd: packageDir, env: { ...process.env, T3_PERF_SERVER_BIN: serverBin } },
      (line, stream) => {
        if (comboLine.test(line)) combosDone += 1;
        localLog.write(`[${version}] ${line}\n`);
        loki.push({ job: "t3perf-harness", host, version, stream }, line);
      },
    );

    currentPhase = 3;
    say(`export ${version} at publish time ${publishedIso}`);
    beat();
    await metrics.flush();
    const exportCode = await spawnLogged(
      process.execPath,
      ["src/otlpBackfill.ts", "--in", outDir, "--otlp", values.otlp, "--time", publishedIso],
      { cwd: packageDir, env: process.env },
      (line, stream) => {
        localLog.write(`[export ${version}] ${line}\n`);
        loki.push({ job: "t3perf-orchestrator", host, stream }, `[export ${version}] ${line}`);
      },
    );

    const durationMs = Date.now() - startedAt;
    const counts = readComboCounts(outDir);
    ledger[version] = {
      exitCode: runCode,
      durationMs,
      finishedAt: new Date().toISOString(),
      combosOk: counts?.ok ?? 0,
      combosFailed: counts?.failed ?? 0,
    };
    await saveLedger();
    metrics.gauge("t3perf.batch.version_duration_ms", durationMs, { version });
    metrics.gauge("t3perf.batch.version_combos_failed", counts?.failed ?? 0, { version });
    say(
      `done ${version} combos-ok=${counts?.ok ?? 0} combos-failed=${counts?.failed ?? 0} exit=${runCode} export-exit=${exportCode} duration=${Math.round(durationMs / 60000)}m`,
    );
    currentPhase = 0;
    beat();
    await metrics.flush();
    await loki.flush();
  }

  currentVersion = "";
  currentPhase = 0;
  say(`ALL-DONE: ${doneCount()} ok, ${failedCount()} failed, of ${queue.length}`);
  clearInterval(telemetryTimer);
  beat();
  await metrics.flush();
  await loki.flush();
  localLog.end();
  return failedCount() === 0 ? 0 : 1;
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
