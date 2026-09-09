# Comparing extension surfaces

Run the comparison on an isolated Linux host before replacing built-in surfaces. The harness currently supplies deterministic inputs, scheduling, driver protocol and a fail-closed analyzer. **Real-client journey drivers are still required. No surface migration has passed this gate.** Pure analyzer tests use synthetic data and prove only the decision logic.

## Operator contract

The integration owner starts separately built, clean, exact-SHA baseline and candidate apps with disposable state. Never use live T3 state. Both targets must serve the same deterministic fixture, use identical browser/Electron versions and run on the same host. Do not run competing builds or tests during measurement. The runner acquires the shared nonblocking heavy-check lock and uses a 4096 MB Node heap.

Create a plan outside the repository with this shape:

```json
{
  "seed": 20260909,
  "timeoutMs": 600000,
  "adapterCommand": ["/absolute/path/to/node", "/absolute/path/to/driver.mjs"],
  "adapterSource": "/absolute/path/to/driver.mjs",
  "targets": {
    "baseline": {
      "worktree": "/absolute/baseline",
      "sha": "<40-character baseline commit>",
      "webUrl": "http://127.0.0.1:4000",
      "electronCdpUrl": "http://127.0.0.1:9222",
      "disposableState": "/absolute/disposable/baseline"
    },
    "candidate": {
      "worktree": "/absolute/candidate",
      "sha": "<different 40-character candidate commit>",
      "webUrl": "http://127.0.0.1:4001",
      "electronCdpUrl": "http://127.0.0.1:9223",
      "disposableState": "/absolute/disposable/candidate"
    }
  }
}
```

Invoke `node scripts/extensions-comparison/run.mjs /path/plan.json /path/new-run-directory`. The directory must not exist. Raw stdout/stderr from every driver attempt, the complete fixture, incremental run receipt and final analysis are retained, including failures. A failed driver stops the experiment and missing coverage fails the gate. Rerun into a new directory; never discard a failed attempt. Analysis alone can be repeated with `node scripts/extensions-comparison/analyze.mjs /path/run.json`.

The schedule runs three isolated batches, three warmups per variant per journey per batch, and ten measured repetitions per batch (30 measured samples for each of four variants). Baseline calibration A/B and baseline/candidate are deterministically shuffled within each repetition. Drivers must reset the same seed and drain all work between invocations. Opening a fresh page is not sufficient to reset server resources. Record cleanup in the lifecycle observations.

## Driver boundary

An adapter is an explicitly supplied command, called once per scheduled observation. It reads one JSON request on stdin and returns one JSON observation on stdout; diagnostics go to stderr. Requests include the target URL/CDP endpoint, frozen build SHA, full seeded fixture, fixture/environment hashes, batch, iteration, warmup flag and journey with required checks. A headless Playwright driver connects to the supplied web app; an Electron driver connects to the supplied owned Electron CDP endpoint under xvfb. The integration owner owns app/browser process launch and teardown. Driver commands must not spawn untracked grandchildren: timeout terminates the direct driver process, and owner cleanup must still close its pages and resources. No driver may attach to a personal signed-in browser.

Drivers must verify the build actually served (for example using a separately checked build receipt), apply the fixture through disposable host services, interact with rendered accessible controls, and assert visible results plus service receipts. Separate baseline and candidate selectors are allowed; two aliases of the same implementation are not. Do not manufacture success by copying expected checks or request identity fields into an observation.

Required observation fields are enforced in `analyze.mjs`:

- `status: "passed"`, `servedBuildSha`, `fixtureHash`, `environmentHash`, `clientVersion`, and `realClient` (`web` or `electron`).
- `checks`: each journey check has an ID, `passed: true`, and evidence path or substantive observable assertion. Save traces/screenshots/receipt IDs under the run artifact tree.
- `metrics`: open-to-ready and action-to-result milliseconds, process CPU milliseconds over equal windows, RSS bytes, JS heap bytes, listener and handle counts after drain, wire bytes, hidden presentation event count, and sustained processed events per second. Measure app/browser processes, not the driver. Use rendering readiness and domain receipts, never sleeps as readiness. Zero is valid only when actually measured.
- `soak`: at least 100 open/hide/show/close/switch cycles, positive duration and event count, zero lost events, proof an unrelated session remains alive, all declared faults injected, and equal before/after listener/handle/resource counts after drain.

Each observation includes the lifecycle soak; time only the named microjourney window, not fixture setup or soak. This deliberately costs more than a benchmark-only run. Preserve the explicit soak duration and event count separately from latency samples.

## Six concrete journey adapters still to implement

The source tests listed in `protocol.mjs` ground these real-client journeys; those tests alone do not prove UI parity.

| Surface | Fixture and externally observed journey |
| --- | --- |
| Files | 512 nested files, 20,000-line content, ignored/untracked/binary/deleted/unreadable entries and a non-Git project. Expand/collapse, select and open exact text, perform same-length edits and observe refresh, switch A→B while A is delayed, and verify missing/error and traversal outcomes. Inventory toolbar, tab/menu, palette and shortcut routes actually present. |
| Diff | Seed working-tree and turn checkpoint diffs with changed/deleted/binary files and many-file/large-file cases. Select both diff sources, navigate to source, change own/sibling turns, delay old responses across context changes, restore split layout and produce a missing-checkpoint error without altering checkpoint receipts. |
| Version Control | Seed two environment/repository identities and 125 paged review records. Open the navigation destination and contextual panel, refresh branch/status, page reviews, edit and restore an unsent draft, inject unauthorized/rate-limit/loading/error outcomes, and assert unsupported non-Git operations. Route write requests only to a disposable recording fake; no external comments, push or merge. |
| Browser | Serve two local fixture pages and a failing navigation. Open, navigate, back/forward/reload, restore tabs, annotate and attach context, resize and use keyboard, reject unsafe navigation, reconnect and close one of two viewers while the other resource remains usable. Run Linux Electron; Linux web substitutes cannot pass this journey. |
| Terminal | Create/connect a real disposable PTY; send and visibly observe Unicode, BOM and ANSI output, resize, burst 10,000 events, test scrollback, reconnect from retained history with stale metadata, hide/show two viewers, then close versus explicit terminate. Check process exit/error and no orphan PTY after owner teardown. |
| Agents | Seed 500 parent/child agents with pending/running/completed/failed/interrupted states. Navigate parent/child, apply live activity and duplicate/late terminal updates, reconnect and interrupt a dead session. Confirm first completion remains stable, no double listeners and no new control authority. |

Every adapter must also exercise the four fault types and keyboard/focus entry points. Enumerate unsupported or absent entry points with source evidence during adapter review; a missing adapter or unverifiable behavior remains a failed release gate.

## Decision limits

Reports retain per-batch p50/p95 and raw samples. Baseline A/B noise above max(5%, 2 ms for latency) is inconclusive. Candidate degradation above max(3%, 1 ms for latency, twice measured noise) in at least two batches fails; one batch is inconclusive. The 10%/5 ms investigation flag does not grant permission for smaller regressions. CPU and memory use relative thresholds. These are initial practical detection limits, not statistical confidence intervals or a claim that subthreshold changes are free. Review distributions and diagnose material effects before approval.

The harness gates six Linux journeys only. macOS native webviews, RN/SwiftUI, provider adapters and other connection modes require their own inventory and proof. Do not infer their parity from this result.
