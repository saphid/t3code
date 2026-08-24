# @t3tools/perf-analyzer

Measures what T3 Code costs to run: wall time, CPU, memory, and true GPU time
for user-visible behaviors, on both the web client and the desktop app, at a
small and a large data scale, and under degraded network conditions.

## Quick start

```bash
# Build the artifacts the harness launches (once per code change):
vp run --filter @t3tools/server --filter @t3tools/web --filter @t3tools/desktop build

# Small batch (all non-heavy scenarios, small fixture, 5 runs each):
node packages/perf-analyzer/src/cli.ts --headless

# One scenario:
node packages/perf-analyzer/src/cli.ts --scenario scroll-giant-thread --surface desktop

# Full suite (heavy scenarios + large fixtures; saturates the machine):
node packages/perf-analyzer/src/cli.ts --heavy --runs 10
```

Results land in `packages/perf-analyzer/results/` as JSON (every raw run) and
a markdown summary table. Timings are reported as median with a 95% confidence
interval over N runs; counts (layouts, DOM nodes) are deterministic and
reported exactly.

## How it measures

- **Isolation.** Every run creates a throwaway home directory in the OS temp
  dir, boots the _built_ server (`apps/server/dist/bin.mjs`) or desktop app
  (`apps/desktop/dist-electron/main.cjs`) against it, and deletes it
  afterwards. The developer's `~/.t3` is never read or written.
- **Fixtures.** `src/seed.ts` writes deterministic projection rows (the
  documented render-fixture approach): `small` is an everyday workspace,
  `large` is 400 threads with a 600-message giant thread. Same bytes every
  run.
- **Wall time / renderer cost.** Playwright drives installed Chrome (web) or
  the repo's Electron (desktop). CDP `Performance.getMetrics` diffs give
  script/layout/task time, JS heap, DOM node and layout counts per scenario.
- **GPU, per process, no sudo.** On Apple Silicon, `ioreg -c
AGXDeviceUserClient` exposes accumulated GPU nanoseconds per Metal command
  queue, keyed by owning pid. All of a Chromium app's GPU work funnels through
  its one `--type=gpu-process` helper, so delta-sampling that pid measures
  this app's GPU time exactly, regardless of what else the machine is doing
  (`src/gpu.ts`). WindowServer's own time (compositing on our behalf) is
  reported alongside as context, and whole-device utilization is recorded as
  an ambient-noise guard.
- **CPU / memory per process.** Desktop: `app.getAppMetrics()` (includes the
  GPU helper). Web: `ps` RSS for the server process, renderer heap via CDP.
- **Network.** `src/netShaper.ts` is a ~150-line TCP relay between client and
  server (toxiproxy-style: latency+jitter, bandwidth token bucket, stall,
  RST drop, refuse-connections). Stream-level, so it degrades WebSocket and
  HTTP traffic alike — CDP throttling cannot add latency to an established
  WebSocket. Scenario code changes conditions mid-run with plain method calls.

## Adding a scenario

Append one object to `src/scenarios.ts`. Locate UI by seeded text (the seeder
returns deterministic thread titles), act, wait for the visible result. Mark
it `heavy: true` if it saturates the machine or runs long. The harness
handles launching, metrics, statistics, and reporting.

## Server benches

Server write/read-path benches (PLANS.md items 11-15) are vitest integration
tests in `apps/server/integration`, not Playwright scenarios. They record
through `apps/server/integration/perfBench.integration.ts`, which writes the
same `{results, failures}` JSON this package's runner emits (surface
`"server"`) to `results-server/` (override with `T3CODE_PERF_BENCH_OUT`).
Run one focused, e.g.:

```bash
cd apps/server && ../../node_modules/.bin/vp test run integration/snapshot-query-latency.integration.test.ts
node packages/perf-analyzer/src/report.ts --in packages/perf-analyzer/results-server
```

`report.ts --in` and `otlpBackfill.ts --in` ingest the directory unchanged.

## Report

```bash
node packages/perf-analyzer/src/report.ts            # writes results/report.html
node packages/perf-analyzer/src/report.ts --out /tmp/perf.html
```

Renders every `results/perf-*.json` into one self-contained HTML dashboard
(inline CSS/JS, no network). The newest file containing a
(scenario, surface, size) combo counts as current; older files with the same
combo become history for trend and regression comparison. The report leads
with a ranked "highest priority to fix" list computed from transparent
heuristics (sustained GPU cost over 50 GPU-ms/s, dropped frames, metrics
scaling worse than 3x from small to large, results over 20% worse than the
previous file, startup over 5s or interactions over 1s), then a card per
combo with medians, 95% confidence intervals, and per-run variance strips,
plus web-vs-desktop and small-vs-large comparisons where both exist. Corrupt
or unrecognized result files are skipped with a console warning.

## Docker

`docker/` packages the harness for any Linux host: Node 24, pinned Playwright
Chromium, and an entrypoint that npm-installs a published `t3` release at
container start and benchmarks it headless on the web surface.

```bash
# Build (context is this package):
cd packages/perf-analyzer
docker build -f docker/Dockerfile -t t3-perf:latest .

# Run: mount a host directory as /results, pick a release and knobs via env.
mkdir -p ~/perf-results
docker run --rm \
  -e T3_VERSION=0.0.33 \        # npm version or dist-tag (default: nightly)
  -e SCENARIOS=startup \        # comma-separated (default: all non-heavy)
  -e SIZES=small \              # small,large (default: small)
  -e RUNS=5 \                   # measured runs per scenario (default: 5)
  -e LABEL=0.0.33-stable \      # result label (default: resolved version)
  -e BUILD=0.0.33 \             # build id for dashboards (default: resolved version)
  -v ~/perf-results:/results \
  t3-perf:latest

# Extra CLI flags pass through after the image name:
docker run --rm -v ~/perf-results:/results t3-perf:latest --heavy
```

Results land in the mounted directory as `perf-*.json` plus a markdown
summary. Containers have no GPU, so Chromium software-renders:
`gpuProcessCpuMs` is the rendering-cost metric there and `gpuBackend` reports
`"none"`. The entrypoint always passes `--surface web --headless` and gives
Chromium `--no-sandbox --disable-dev-shm-usage` via `T3_PERF_CHROME_ARGS`
(override that env to change it).

## Grafana / OTel export

Pass `--otlp <url>` (or set `T3_PERF_OTLP_URL`) to POST the run's summary
metrics to an OpenTelemetry collector as OTLP/HTTP JSON, once at the end of
the run:

```bash
node packages/perf-analyzer/src/cli.ts --headless --otlp http://localhost:4318
```

The export never fails the run: if the collector is down the CLI prints the
reason and the JSON/markdown results are still on disk.

Each `(scenario, surface, size)` result becomes gauge metrics computed from
the raw runs, with a `stat` attribute distinguishing `median` and `p75`:

- `t3perf.wall_ms`, `t3perf.script_ms` (ms)
- `t3perf.gpu_ms_per_s`, `t3perf.gpu_process_cpu_ms_per_s` (ms per wall
  second; the latter only on hosts that measure GPU-process CPU)
- `t3perf.js_heap_bytes`, `t3perf.layout_count`
- `t3perf.runs` (run count, no `stat` attribute)

Every datapoint carries `scenario`, `surface`, `size`, `label` (default
`repo`), `build`, `network` (default `good`), `host`, `time_basis`, `run`, and
`gpu_backend` attributes, so Grafana can group and compare releases. The test
host is always an independent `host` attribute; it is never embedded in the
label, build, or scenario. `build` identifies the
build under test and comes from `--build` (default: the run's UTC timestamp
to the minute, since nightlies publish every few hours; the Docker entrypoint
defaults it to the resolved npm version instead). Prometheus stores the names
with underscores: `t3perf_wall_ms{stat="median"}`.

`observability/` is a standalone stack (collector, Prometheus with 90d
retention, Loki for logs on host port 3105, Grafana with provisioned
datasources and dashboards), separate from `docker/`. A persistent instance of it runs on the benchmark box, so
results exported with `--otlp` show up there without any local setup:

```bash
cd packages/perf-analyzer/observability
docker compose up -d
# run the harness with --otlp http://localhost:4318, then open
# http://localhost:3000 (login required)
```

Prometheus and Grafana keep their history in named volumes, and all
services restart with the box. The collector pushes to Prometheus via remote
write (with an out-of-order window) rather than being scraped. Fleet and
release-backfill datapoints use the npm publication timestamp and carry
`time_basis="release"`; standalone local runs use their run timestamp and
carry `time_basis="run"`.
Seven dashboards are provisioned: Overview, Build trends, GPU outliers,
Batch status, Release comparison, Network conditions, and Resources; the
metric boards are filterable by `$label`, `$network`, `$size`, `$surface`,
and `$host` (default All). Overview and Build trends default to seven days.
Build trends answers "faster or slower release over release": one line per
independent host/scenario/surface/size/network test, each point at the
release's npm publication time, normalized to that same test's best release
in range (0% = fastest, drifting up = regressing). GPU outliers ranks every feature
by GPU cost, worst first, thresholded at the report heuristics' 50 GPU-ms/s,
because an almost-entirely-text app has no business being red there.

## Batch orchestrator

`src/batchOrchestrator.ts` runs a queue of published releases through the
suite deterministically, with no agent in the loop; watch it from the Batch
status dashboard instead. It ships two telemetry feeds: its own lifecycle
(install/run/export phases, exits, durations) as `{job="t3perf-orchestrator"}`
logs plus `t3perf_batch_*` gauges (heartbeat, queue counts, per-version
duration, combo progress), and every harness stdout/stderr line as
`{job="t3perf-harness", version=...}` logs. Telemetry failures never fail a
run, and `<results>/orchestrator.log` stays the local source of truth.

```bash
node packages/perf-analyzer/src/batchOrchestrator.ts \
  --versions versions.tsv \        # "<version>\t<publish ISO>" per line
  --releases ~/t3-perf-batch/releases --results ~/t3-perf-batch/results \
  --otlp http://<host>:4318 --loki http://<host>:3105
```

Each version is npm-installed if missing, benchmarked (`--suite`/`--surface`,
default full/web), and exported stamped at its publish time so dashboards
chart build chronology. Resumable: versions completed cleanly (recorded in
`<results>/orchestrator-state.json`, with a one-time import from a legacy
bash `batch.log`) are skipped, and its pid lands in
`<results>/orchestrator.pid` for a clean stop.

To load existing on-disk results into a collector (for example after
standing the stack up, or to import a batch from another machine):

```bash
node packages/perf-analyzer/src/otlpBackfill.ts \
  --in packages/perf-analyzer/results \
  --in packages/perf-analyzer/results-lxs02 \
  --otlp http://localhost:4318
```

It reads every `perf-*.json` in each `--in` directory (repeatable), skips
corrupt files with a warning, and exports the concatenated results once;
`T3_PERF_OTLP_URL` works as the `--otlp` fallback here too. Each file's
stamp becomes its datapoints' timestamps (history lands at its real run
times) and, for results written before builds were recorded, the `build` id.

## Distributed fleet

For the centrally leased nightly fleet, use `src/fleetScheduler.ts` on lxso2
and `scripts/install-fleet-worker.sh` on each explicitly enrolled worker. The
scheduler refreshes the live npm registry every three hours, assigns by publish
timestamp newest first, and recovers expired leases without duplicating a
nightly. See [the fleet runbook](../../docs/operations/perf-fleet.md) for the
installer, health checks, update, rollback, uninstall, and safety boundaries.

## Known limits (v1)

- Startup scenarios attach renderer/GPU sampling just after process launch,
  so their renderer numbers understate slightly; wall time is the headline
  there.
- The network relay shapes web only; the desktop app talks to its bundled
  server directly.
- GPU sampling relies on undocumented IORegistry keys; it fails loudly (not
  silently) if a macOS update changes them, and other platforms fall back to
  dropped-frame counts.
- Web runs use the installed Chrome, which tracks its own release channel
  rather than Electron's Chromium version.
