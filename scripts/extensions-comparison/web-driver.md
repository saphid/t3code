# Attach-only web UI observation driver

`web-driver.mjs` attaches Playwright to an explicitly owned, already launched and paired disposable Chromium CDP endpoint. It never launches a browser/dev server or reads browser profile credentials. The integration owner prepares separate baseline/candidate environments and cleans up domain resources. Driver closes only its own page and disconnects its CDP client. A fresh page does not reset backend resources.

This is a **partial real-client probe**, not a completed parity gate. Normal adapter mode returns `inconclusive` (exit 2), even after successful UI observation. The strict schema-2 runner therefore retains partial observations and fails closed. `--probe` returns `observed` (exit 0) only after actual visible→hidden→visible UI assertions and recorded counters; this status must never be relabeled `passed`. Unsupported Browser/Electron, Agents and Version Control journeys remain inconclusive in both modes.

## Invoke after the owner launches Chromium

Install Playwright in the operator's existing dependency environment. If it is not resolvable from this worktree, set `T3_COMPARISON_PLAYWRIGHT_MODULE` to the absolute installed module entry file (for example its `node_modules/playwright/index.mjs`). No package or lockfile modification is needed. The operator supplies the CDP endpoint belonging to the paired disposable profile, not a personal signed-in browser.

Write a request outside the repository; the example's CDP port must be replaced with the actual captured launch endpoint:

```json
{
  "phase": "timing",
  "journey": "files",
  "target": {
    "ownedBrowser": true,
    "disposable": true,
    "webUrl": "http://localhost:8179/16c3698b-f18a-4d35-89c9-8403fa99c45a/92962785-3bb1-493b-bfef-387654465b23",
    "webCdpUrl": "http://127.0.0.1:9222",
    "threadTitle": "Surface parity",
    "artifactDir": "/home/saphid/artifacts/t3-extensions-20260909/validation/web-probes",
    "timeoutMs": 15000
  }
}
```

```sh
flock /home/saphid/artifacts/t3-extensions-20260909/heavy-check.lock   env CI=true NODE_OPTIONS=--max-old-space-size=4096   node scripts/extensions-comparison/web-driver.mjs --probe   < /absolute/request.json > /absolute/new-receipt.json
```

For 100 actual UI hide/reopen cycles set phase to `conformance`. It records completed cycles incrementally to `cycles.jsonl`; a timed-out later cycle cannot erase earlier observations. Choose journey `files`, `diff`, `terminal`, or `sidebar`. Normal mode accepts the runner's journey descriptor object as well as its string ID. Set adapterSource/adapterCommand to web-driver.mjs in the existing run.mjs plan only to collect an explicitly incomplete gate attempt; it will stop at the first incomplete conformance result. No schedule identities or requested check lists are copied into proven observations.

Readiness overrides are optional: target.selectors.files.ready (or the selected journey) accepts one `{ "css": "..." }` or exact `{ "role": "button", "name": "..." }` descriptor. It must resolve to exactly one visible element. Default anchors are Files' Refresh workspace files, Diff's Diff layout group, drawer terminal canvas, and sidebar New project. Existing right panel cards or Add panel surface menu select Files/Diff before measurement. Side panel terminal placement is not covered by the default drawer journey.

## Evidence and meaning

Each call creates a unique evidence directory with initial/final screenshots, completed cycle JSON lines and observation.json. Standard output is one JSON record; page errors are retained as error types, not potentially credential-bearing messages/URLs. No request/response/WebSocket bodies or browser storage are saved. Failed stage identifies which awaited observation failed. Input URLs reject credentials, queries and fragments; pair before invoking.

Timing samples measure openMs from reopen click to unique visible anchor plus two animation frames; actionMs measures hide click to hidden anchor plus two frames. They include Playwright/CDP round trips. Setup, navigation, panel selection and screenshot capture are outside these sample windows. Conformance records individual hideMs/openMs, not a fabricated aggregate latency. Measurements over the complete cycles include:

- rendererTaskMs: difference in CDP Performance.TaskDuration, in milliseconds. This is renderer task occupancy, **not process CPU time**.
- observationWindowMs: CDP timestamp delta; heapBytes: final JSHeapUsedSize; domListeners and domNodes: final Memory.getDOMCounters, with before/after counters and per-cycle hidden snapshots.
- httpReceivedBodyEncodedBytes: encoded response-body chunks observed by Network.dataReceived during the window, excluding HTTP headers/TLS and other targets.
- webSocketReceivedPayloadBytes/webSocketSentPayloadBytes: UTF-8 or decoded binary payload bytes; webSocketReceivedFrames: actual incoming frame count. No payload retention, framing/TLS accounting or claim about backend wire totals.

Missing metrics are errors, not substituted zeros; counter resets fail. Before/after growth is retained as measured, never normalized back to baseline. No explicit GC changes the measurement. Hidden snapshots do not establish a fixed hidden-work rate. Visible canvas does not prove a connected PTY or correct terminal output. Mounted diff/tree controls do not prove loaded file text, filesystem refresh, diff correctness or keyboard behavior. There is no backend receipt, fixture reset, served-build SHA, fault injection, process RSS/handles, full listener/resource drain, unrelated-session or sustained-throughput proof. These remain required independent measurements; the driver does not invent corresponding protocol fields.

The owner should freeze build receipts and fixture installation, warm both targets equally, run baseline-vs-baseline noise calibration, then interleave >=30 samples per target in three batches without competing builds. Retain every receipt. This probe alone cannot satisfy schema-2 parity/performance acceptance, and must not be used to replace missing native Electron Browser testing.

## Focused integrity tests

```sh
node --test scripts/extensions-comparison/web-driver-observations.test.mjs
```

Tests cover input ownership and credential rejection, selector shape, missing/reset metrics, UTF-8/binary byte accounting and unsupported-journey fail-closed behavior. They never launch browsers or claim real-client success. Actual selector/runtime verification belongs to the integrated owner run.

Fresh page startup is outside surface timing. Navigation, app-shell readiness and seeded-thread readiness each have a 60-second wait and their cumulative elapsed time (from page creation, including CDP setup) is retained in `startupStages`. The configured interaction timeout (15 seconds by default) resumes before selecting the native surface. The outer runner still bounds each complete probe; increasing startup tolerance does not grant a slower hide/reopen pass or establish startup performance.
