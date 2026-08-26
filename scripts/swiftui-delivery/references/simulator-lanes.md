# Parallel simulator lanes

Use **keyed order**: one explicit Simulator UDID per delivery lane, ordered
actions within that UDID, and concurrent work across different UDIDs. A lane
may contain several issues; the lane, not an issue, holds the runtime lease.

## Allocate

Choose an available device by exact UDID and acquire it before boot, install,
launch, UI automation, capture, or streaming:

```sh
scripts/simulator-lane acquire --lane-id "$LANE_ID" \
  --simulator "$SIMULATOR_UDID" --receipt lane-simulator.json
scripts/simulator-lane verify --receipt lane-simulator.json
```

Allocation is complete when the receipt and active lease agree. A second lane
can acquire another UDID immediately; the same UDID has one runtime owner.
Record the receipt hash in launch and proof state without publishing its token.

## Drive

Concurrent lanes use the repo runner, which pins XcodeBuildMCP 2.7.0 and adds
the leased UDID to every observation command. Semantic actions use its bundled
AXe 1.8.0 directly, so lookup and action happen atomically in one process:

```sh
scripts/simulator-lane xcb --receipt lane-simulator.json -- \
  ui-automation snapshot-ui --output json >snapshot.json
scripts/simulator-lane validate-snapshot --receipt lane-simulator.json \
  --snapshot snapshot.json
scripts/simulator-lane axe --receipt lane-simulator.json -- \
  tap --label "General" --element-type Button
```

The validator requires both structured-output UDIDs and the screen hash.
Element references are process-local and must never be copied from a snapshot
into a new driver process. The runner therefore refuses XcodeBuildMCP element-
reference actions. AXe selector actions resolve and act within one invocation;
prefer an accessibility identifier, or disambiguate a label with element type.
Shared MCP defaults, names, and `booted` are not cross-lane routing boundaries.
The lane tool enforces one ordered action/observation lock per UDID. Different
UDIDs have different locks and remain concurrent. Long-running `record-video`
and `stream-video` commands use a separate per-UDID recording lock so the
ordered gestures they are meant to capture can run while recording; a second
recording on that UDID waits.

## Build once, install many

Build products are independent of interactive simulator ownership. Build and
preserve one `.app` for an exact source/build key, then install those same bytes
into every compatible leased UDID. Rebuild only when that key changes.

`ios-build-hygiene` admits two expensive builds by default, based on the host
measurement in the research report. `T3_IOS_BUILD_CAPACITY` may set a reviewed
value from 1 through 8 when later measurements justify it. Every admitted build
gets private DerivedData, cloned SourcePackages, and package cache directories.
For an MCP build, derive the latter two from the returned path and pass them in
`extraArgs`:

```text
<run-root>/DerivedData
<run-root>/SourcePackages
<run-root>/PackageCache
```

The build is complete when its artifact and receipt are preserved and the
private tree has been swept. Waiting for build capacity never blocks install,
launch, capture, or streaming of an existing artifact.

## Capture and stream

New proof uses schema 3 and follows the complete capture contract in
[`evidence.md`](evidence.md). Create a token-free binding while the lease is
active, then attach that file and hash to the capture:

```sh
scripts/simulator-lane write-binding --receipt lane-simulator.json \
  --output capture-simulator-binding.json
```

serve-sim 0.1.45 accepts several explicit UDIDs in one invocation and returns
one owned helper, port, and URL per device. Persist those values and stop only
the named UDID. A helper failure in one lane must leave the others running.

## Recover and release

Recover the one affected UDID: refresh its snapshot, use AXe's bounded
readiness recovery, then reboot and reinstall the preserved build only if that
lane remains unhealthy. Preserve the raw error, command, version, UDID, and
timestamp. A host-wide AXe mutex is a temporary circuit breaker only after a
repeatable test shows that it lowers failures.

Release with the exact receipt after the lane no longer needs the runtime:

```sh
scripts/simulator-lane release --receipt lane-simulator.json
```

Release is complete only after `inspect --simulator "$SIMULATOR_UDID"` reports
`"active": false`.
If the secret receipt is lost, inspect first. Recovery is deliberately limited
to the exact unchanged lease hash, a Shutdown simulator, no process containing
its UDID, and a specific reason:

```sh
scripts/simulator-lane inspect --simulator "$SIMULATOR_UDID"
scripts/simulator-lane recover --simulator "$SIMULATOR_UDID" \
  --expected-lease-sha256 "$INSPECTED_HASH" --reason "$SPECIFIC_REASON" \
  --receipt recovery.json
```

Booted or process-associated leases fail closed for human coordination.
Restore only lifecycle state that the lane itself changed; stable proof
simulators and preserved builds follow their retention policy.

## Session cleanup

After releasing a lane's lease, run
`.agents/skills/ios-build-hygiene/scripts/clean-simulator-sessions.sh clean`
to shut down the freed simulator and any stray booted devices. The script is
lease-aware: it never touches a UDID that still holds a lease directory, so
running it is always safe while other lanes are active.
