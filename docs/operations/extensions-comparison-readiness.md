# Content-ready comparison probes

The web probe supports Files, Diff, Terminal and the main sidebar. Browser, Agents and Version Control still return inconclusive. Sidebar is not an Agents substitute. These probes do not establish full six-surface or schema-2 parity.

Files, Diff and Terminal now require an explicit `target.content` fixture. Missing content fails before browser connection; old shell-only requests cannot silently receive a stronger result. The stdin request and `--probe` interface remain unchanged. Example:

```json
{
  "phase": "timing",
  "journey": "files",
  "target": {
    "ownedBrowser": true,
    "disposable": true,
    "webUrl": "http://localhost:18526/fixture-environment/fixture-thread",
    "webCdpUrl": "http://127.0.0.1:9222",
    "artifactDir": "/absolute/new-evidence-root",
    "pageMode": "reuse",
    "threadTitle": "Second surface parity",
    "timeoutMs": 20000,
    "content": {
      "files": { "filename": "new.txt", "text": "Untracked fixture" },
      "diff": {
        "file": "src/dir-0/deep/nested/file-0.txt",
        "before": "seed=20260909; file=0; before",
        "after": "seed=20260909; file=0; after!"
      }
    }
  }
}
```

Replace endpoints and fixture identities with the parent's actual owned production environment. The example is not a running fixture. Set `T3_COMPARISON_PLAYWRIGHT_MODULE` to the absolute installed Playwright module when needed, then use:

```sh
timeout --signal=TERM --kill-after=10s 120s node scripts/extensions-comparison/web-driver.mjs --probe < /absolute/request.json > /absolute/new-probe-result.json
```

Capture the actual command exit separately. Use a larger explicit outer deadline for the100-cycle conformance probe. Its phase name remains for compatibility; it still covers hide/reopen only, not close/switch/fault conformance. Each attempt gets a unique evidence directory with raw cycles and observation JSON. An interrupted process may lack final JSON; never infer completion from request counts.

`pageMode: "reuse"` attaches to exactly one existing page at the complete requested credential-free URL. It neither navigates nor closes that page. The parent creates/pairs/navigates each variant page once per batch. An ambiguous or wrong URL fails; there is no navigation fallback. Omitted mode retains the earlier fresh-page behavior. Browser connection and per-probe CDP listeners are detached afterward. Resource ownership remains with the parent.

Files preparation selects the exact tree path and checks the actual current-file breadcrumb; each reopen requires that path and expected file contents visibly present in the actual right-panel subtree. Diff preparation selects Working tree, expands the configured file if needed, refreshes, then requires filename and both expected changed lines after reopening. The CDP reader traverses closed shadow roots and checks clipped presentation, including shadow hosts. It excludes chat content, script/style and aria-hidden subtrees. Ambiguous visible matches fail. It reads document structure in memory but persists only configured expected text/path matches, not an arbitrary document dump.

For Terminal add an explicit fixture:

```json
{ "terminal": { "threadId": "fixture-thread", "terminalId": "term-1", "allowInput": true } }
```

Before running, the parent must select that one active disposable shell and ensure it is an idle shell owned for validation. `allowInput` authorizes a screen clear and encoded printf command. The driver does not create, close or terminate a terminal explicitly, but the application's ordinary drawer opener can start its native default resource; provision/select the intended resource first. The fresh random marker is absent from the typed command text. Readiness requires a new WebSocket output event for the exact configured thread and terminal plus the actual system clipboard returning that marker after pointer selection and a real Control+C shortcut. Each reopen must copy the retained marker. Clipboard read/write permissions are granted to the disposable origin, and a unique clipboard sentinel must be replaced by the actual shortcut result. Permissions remain on the owned context; the parent discards that context after the batch. Split/multiple visible canvases fail. Before any keyboard input, a guard wraps the actual WebSocket send method and rejects malformed frames or terminal.write requests for any other thread, terminal or host before forwarding. It stays installed through all copy shortcuts and is restored during cleanup; violations and forwarded-write counts are retained. The installed Effect socket writer dynamically calls ws.send, so the guard covers existing reused-page sockets without reconnecting. This is test instrumentation, not product authority enforcement. No literal marker seeded into an assertion, screenshot canvas presence or echoed command can satisfy the fresh output oracle. The driver does not assert PID survival or terminal ownership from DOM alone; separate native lifecycle evidence remains necessary.

`openMs` now includes content verification, including CDP traversal and terminal pointer selection/copy overhead. It is warm reopen-to-content verification latency, not pure paint time, and must not be pooled with historical button-only samples. Preparation/file refresh/marker generation occur outside the timed cycle. `actionMs` remains hide-to-clipped plus two presented frames. CPU-like `rendererTaskMs` remains CDP renderer task occupancy. Heap and DOM/listener values are uncollected renderer endpoints. No OS CPU/RSS, transport-drain or backend-resource metrics are fabricated.

Every successful raw cycle includes its content receipt. Before producing a successful probe result, the driver rereads the persisted cycle file, validates the exact sequence/count, finite nonnegative timings and content evidence, and records its SHA256. Any observed page error fails, including an error during final screenshot. Warmups/calibration must retain separate phase labels in the parent schedule; only complete successful raw observations belong in measured pairs.

Focused verification:

```sh
node --test scripts/extensions-comparison/web-driver-observations.test.mjs scripts/extensions-comparison/web-driver-content.test.mjs
```

These tests exercise observation integrity and input rejection. They are not substitute real-client passes. Parent runs integrated production smoke and matched repeated comparisons after merging the driver.
