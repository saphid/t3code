# Installed terminal live-output evidence

This additive diagnostic slice is implemented on lxso2 above fb041994189bef8a1baaf98e95b283355d27e8bb. It does not replace the interactive Terminal panel. Work spine: saphid/personal-ops#128. Architecture: [terminal-output-events-plan.md](terminal-output-events-plan.md).

## What is implemented

The public t3.terminal/output-events@1.0.0 stream observes an existing terminal using a bounded snapshot and ordered live events. It requires both the installation grant t3.terminal/read-output and authenticated root terminal:operate. Native workspace identity is checked against the host-derived environment/project/thread scope. Registration alone gives no authority.

A native readonly observation seam captures snapshot/listener/epoch under the thread mutation lock. Actions capture their source epoch before asynchronous work; an old process cannot close or contaminate a new observer. A deterministic test holds the actual awaited unregisterTerminal step across restart and proves the late old exit is ignored. Disk persistence itself is enqueue-only on output; no held disk-write proof is claimed.

Queues retain at most eight native events and 256KiB raw payload. Public chunks preserve surrogate pairs and fit the broker's encoded-frame limit, including escaped control characters. Overflow, clear, process exit, close and reincarnation have explicit outcomes. Cancellation releases pending acquisition, listeners and iterators. Already-exited/error snapshots finish without a second lifecycle frame.

The SDK adds backward-compatible defineStreamApi/bindStreamApi typing. An independently installed tarball consumer typechecks against exported contracts; the helper preserves the actual host iterator and cancellation. The existing t3.terminal/output@1.0.0 descriptor is tested unchanged against its earlier package fixture.

The SDK ships an independently packaged client/server example, example.terminal-live-output. Its own example.terminal-live-output/events API forwards the host stream using public contracts. It has no private application imports. The client validates ordering and complete chunk groups, bounds displayed data, clears unavailable output, and renders a scrollable diagnostic tail.

## Verification receipts

All artifacts are under /home/saphid/artifacts/t3-extensions-health-rounds-20260909/terminal-live-output on lxso2.

- native-tests-v10-exit.json: exit0, 106 tests across native Manager and provider. This includes existing native regression tests; 106 is not a count of newly added cases.
- server-types-v9-exit.json and web-types-v6-exit.json: exit0.
- sdk-tests-v12-exit.json: exit0, 44 SDK tests. published-consumer-v12-exit.json: exit0, actual npm tarball install, exported TypeScript contracts and packaged authoring examples.
- lint-v9-exit.json: exit0, all changed executable files with zero warnings/errors. client-lint-v12-exit.json: exit0 after the final diagnostic viewport correction.
- build-v16-exit.json: exit0. All source hashes were unchanged during that production build. Only the independently loaded example client changed afterward; its published package is separately hashed and tested.
- installed-proof-v16-r2-exit.json: exit0, ten real installed-path checks. The retained isolated server is server11 on port8196; it uses disposable proof state, never live T3 userdata.
- files-regression-v16-exit.json, root-regression-v16-r2-exit.json, metadata-regression-v16-exit.json and output-regression-v16-exit.json: exit0, preserving earlier installed/native comparisons.

The final installed package content hash is 84feaeab243caf2278864db3513015d59d4f4b4958a23a1ee27c2e3449d425ef. Source provenance is published-source-v12-receipt.json. The package came from the installed SDK tarball, not the repository source path.

The installed proof verifies separate plugin/root grants, absent-session admission without spawning, unsupported cursor rejection, actual foreign native workspace denial, exact initial native history tail with unchanged PID/history, live Unicode/control bytes, the example's own client UI, native clear/reset, idle grant and authenticated-session revocation, restart/new epoch, process exit and already-exited completion, slow-consumer overflow and fresh recovery on the unchanged process, and terminal close. It cleans up its own installation, PTYs and login sessions.

The final run matched 21 native events / 21 public frames / 1858 bytes exactly. Signed local packet arrival difference (public minus native) had median 0.487ms and p95 2.855ms. This is a small local diagnostic measurement; independent fanout ordering can produce negative deltas. It does not measure total overhead, sustained output throughput, complete terminal rendering, or remote latency. The slow-consumer test held real WebSocket ACKs and produced explicit bounded overflow after a 165ms native receipt-driven burst.

## Independent review and trial corrections

A second-account Luna medium builder and separate Luna medium monitor worked through repeated correction rounds. Parent verification found and corrected stale source/evidence reports, non-exercising race tests, unexecuted Effect callbacks, queue accounting bugs, equal-sequence lifecycle loss, scope/cleanup gaps and pre-snapshot failure ordering. Exact current monitor findings are retained in monitor/independent-review.md and monitor/progress.json; a completed agent turn alone is not acceptance.

Parent visual inspection caught clipped output despite ten passing data assertions. The final installed client uses a bounded scroll viewport and follows new output while the viewer remains at the bottom. The corrected screenshot is installed-proof-v16-r2/installed-live-panel.png; it shows the newest Unicode marker and diagnostic limitation text.

The initial baseline audit proof failed because it read a retired test-server log after restart. Its failed receipt is retained; the corrected r2 proof reads the captured current server11 log. This was a proof identity error, not an application authorization failure.

A direct Claude Opus5 high review was attempted with /usr/local/bin/claude --print --model claude-opus-5 --effort high --tools "" --no-session-persistence --output-format json. Process exit1: OAuth session expired and could not refresh; modelUsage was empty. No Claude model review occurred. The inspected repository/primary-worktree locations had no CODING_STANDARDS.md; searched paths are retained in review/standards.json.

## Remaining limits

- Full Terminal remains a privileged wrapper. No public interactive open/write/resize/restart/close API, complete VT renderer integration, persisted terminal selection/layout, or full terminal feature parity is claimed.
- Retained snapshot history is sanitized; live output is raw PTY data. This diagnostic client displays control sequences literally. It is not a terminal emulator or a durable replay log.
- Resume cursors are rejected. Server restart/reload continuity of an already-installed live terminal observer is not proved here; process restart/reincarnation is.
- Sustained high-volume output performance remains unmeasured. An explicit bounded overflow state is reliable failure behavior, not throughput parity with the native panel.
- Web was exercised against a local isolated lxso2 server. Desktop packaging, React Native mobile, SwiftUI mobile, relay/tunnel and orchestration V2 execution remain unproved for this slice.
- Browser, Diff, Version Control, Agents and full Files/Terminal migrations remain incomplete. The earlier readonly Files path is a real API-driven replacement for its proved read/open scope.
- Shared catalogue compatibility currently preserves one exact definition per API ID. General simultaneous multi-version retention remains future work; this slice adds a separate API ID and preserves the old descriptor.
- Latest fetched origin/main is 8d8189e67dc091ffb91df451c9a957bbd68a5364. It is not yet integrated; the read-only merge assessment found 13 conflicts. These results apply to the recorded branch baseline.
