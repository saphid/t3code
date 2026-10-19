# Perf analyzer

`packages/perf-analyzer` measures what T3 Code costs to run: wall time,
renderer CPU, memory, and per-process GPU time for user-visible behaviors, on
the web client and the desktop app, at a small and a large data scale, and
under degraded network conditions. It exists so "T3 Code is fast" stays a
measured claim, and so a regression shows up as a number before a user notices
a dropped frame.

## Running it

```bash
# Build what the harness launches (server, web bundle, desktop main):
vp run --filter @t3tools/server --filter @t3tools/web --filter @t3tools/desktop build

# Small batch, safe to run any time:
node packages/perf-analyzer/src/cli.ts --headless

# Everything, including machine-saturating scenarios:
node packages/perf-analyzer/src/cli.ts --heavy --runs 10
```

`--list` shows scenarios. Filters: `--scenario`, `--surface web|desktop`,
`--size small|large`, `--runs N`. Results land in
`packages/perf-analyzer/results/` as raw JSON plus a markdown summary; timings
are medians with 95% confidence intervals, counts are exact.

## Design in one paragraph

Every run boots the built server or Electron app against a throwaway home in
the OS temp dir, seeds deterministic projection rows (the documented render
fixture approach), drives the UI with playwright-core, and wraps each scenario
in a metrics window. The window collects CDP `Performance.getMetrics` diffs
(script/layout/task time, heap, DOM and layout counts), Electron
`app.getAppMetrics()` (per-process CPU and memory, desktop), and true GPU
busy time per process from delta-sampling `ioreg -c AGXDeviceUserClient` on
Apple Silicon, which needs no sudo and is immune to everything else running
on the machine because a Chromium app's GPU work all flows through its single
GPU helper pid. Network scenarios route the web client through an in-process
TCP relay (toxiproxy-style latency/jitter/bandwidth/stall/RST primitives)
because stream-level shaping is the only unprivileged way to degrade an
established WebSocket.

## Boundaries

- The developer's `~/.t3` is never touched; fixture homes are temp dirs,
  deleted after each run.
- Raw projection seeding is for render/transport measurement only. It proves
  nothing about backend behavior; behavior tests belong in
  `apps/server/integration/`.
- GPU sampling reads undocumented IORegistry keys and fails loudly if a macOS
  release changes them. Non-macOS platforms fall back to dropped-frame counts
  from CDP.
- Scenario bodies stay dumb: find seeded text, act, wait for the visible
  result. New scenarios are one object in
  `packages/perf-analyzer/src/scenarios.ts`.
