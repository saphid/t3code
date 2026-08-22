# Parallel iOS Simulator delivery: primary-source research

Research date: 2026-08-23
Host checked: macOS with Xcode 26.6 (`17F113`)
Scope: native SwiftUI build, install, launch, UI automation, screenshots, video recording, and browser streaming across concurrent issue lanes.

## Conclusion

Multiple booted iOS Simulators are a supported operating mode, not an exceptional one. Apple explicitly tells callers to select a device by name or UDID when several are booted. The previously pinned XcodeBuildMCP 2.6.2 already kept runtime UI snapshots and action queues keyed by simulator UDID, serialized actions only on the same simulator, and had a source test proving that actions against different simulators run concurrently. serve-sim 0.1.45 also supports several devices with one helper and state file per UDID.

The best design is therefore **one stable simulator lease per active lane, with every operation bound to its exact UDID**. Observation commands may be stateless. UI actions must either remain inside one persistent driver process or resolve a semantic selector and act atomically; process-local element references must never cross driver invocations. Builds are separate from simulator operation: build a reusable `.app` once for an exact source head, preserve it, and install that artifact into as many lane simulators as need it. Use keyed locks only for resources that are actually mutable and shared: one UI-action queue per UDID, one writer per DerivedData/package-cache directory, and an explicit capacity limit for expensive builds. Do not serialize all native work behind one machine-wide lease.

For the issue #135 observation, “multiple booted simulators broke AXe” is not established. No raw failing AXe diagnostic was retained with the accepted issue evidence, so the cause cannot now be proved. The source makes three stronger hypotheses:

1. An operation used `booted` or a shared session default and reached a different device. Local `simctl` help says `booted` chooses one device when several are booted; it does not promise which one.
2. The lane used XcodeBuildMCP 2.6.2's bundled AXe 1.7.1 and hit an accessibility-transport/readiness fault. AXe 1.8.0 substantially rewrote that path, added bounded retries, and restarts the target simulator's `testmanagerd` after specific channel failures.
3. The selected simulator itself was still starting, had no healthy frontmost accessibility hierarchy, or had a stale SpringBoard/CoreSimulator bridge. AXe's underlying error defines “no translation object” as a failure to obtain an accessibility translation for that request; it is not defined as “too many simulators.”

The current process creates the bottleneck itself: `ios-build-hygiene` holds one global lease for every direct or MCP Xcode operation, even when lanes have different DerivedData, package state, and simulators. That lease should become resource-keyed.

## Issues to solve

### 1. Device identity can silently become ambiguous

`simctl` accepts an exact UDID, a name, or the special value `booted`. On this host, `xcrun simctl help` reports that when several devices are booted, `booted` chooses one of them. Apple likewise says that with several booted simulators, callers should specify the intended simulator by name or UDID ([WWDC20, “Become a Simulator expert”](https://developer.apple.com/videos/play/wwdc2020/10647/?time=692)).

A name is not a sufficient durable key because duplicate device names are valid. A lane must persist the UDID and include it in build destinations, `simctl`, AXe, XcodeBuildMCP, video, and streaming operations.

### 2. Session defaults are mutable routing state

XcodeBuildMCP session defaults include `simulatorId`, `derivedDataPath`, project/workspace, scheme, and bundle ID. The documentation says subsequent tools reuse them, and that `simulatorId` wins over a name ([XcodeBuildMCP session defaults](https://www.xcodebuildmcp.com/docs/session-defaults)). This is convenient inside one lane, but one shared MCP process cannot safely let independent lanes replace the same defaults.

Element references are also runtime-local. XcodeBuildMCP's source says they are process/session-scoped handles and deliberately stores them in memory so another MCP, daemon, or CLI runtime cannot consume them ([2.6.2 snapshot state](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/src/mcp/tools/ui-automation/shared/snapshot-ui-state.ts#L8-L14)). Passing an element reference from one lane driver to another is invalid even if both target the same screen.

### 3. The build caches are distinct mutable resources

`-derivedDataPath` controls products and other derived build state; `-clonedSourcePackagesDirPath` controls fetched remote package checkouts; `-packageCachePath` controls package-support caches. Xcode 26.6 exposes all three in `xcodebuild -help`. Apple identifies `xcodebuild` as the authoritative local command reference and directs developers to its manual/help output ([Xcode command-line tool reference](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference)).

XcodeBuildMCP 2.6.2 supplies the exact UDID as the `xcodebuild` destination and an effective DerivedData path. For simulator test actions it also supplies `-packageCachePath`, defaulting to the user's global SwiftPM cache unless an explicit path is provided ([2.6.2 build command construction](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/src/utils/build-utils.ts#L76-L170)). Isolated DerivedData therefore does not isolate all SwiftPM mutation. The package-cache contention observed during #135 is consistent with this source.

### 4. Our hygiene lease is broader than the resource

The current `ios-build-hygiene` scripts use one directory, `ios-build-hygiene.lock`, and return exit 75 whenever that lock represents any active native build. That makes unrelated worktrees and simulators wait even though Xcode and CoreSimulator support concurrency. Cleanup safety is valuable; the global scope is not.

The replacement needs leases keyed by canonical mutable resource:

- DerivedData directory
- cloned SourcePackages directory
- package cache directory
- result bundle path
- simulator UDID for destructive lifecycle actions

A separate capacity semaphore may bound concurrent compilation according to measured memory and disk headroom. Capacity is not ownership: a lane waiting for build capacity may still install, launch, inspect, capture, or stream an already-built artifact on its own simulator.

### 5. Accessibility transport readiness is not simulator exclusivity

AXe 1.7.1 resolves the requested simulator by exact UDID from the device set ([AXe 1.7.1 `AccessibilityFetcher`](https://github.com/cameroncooke/AXe/blob/v1.7.1/Sources/AXe/Utilities/AccessibilityFetcher.swift#L17-L40)). It does not select “the only booted device.”

The accessibility translator in the AXe IDB fork is process-wide, but the implementation explicitly describes one shared dispatcher that disambiguates concurrent requests with per-request tokens protected by a lock ([AXe IDB fork dispatcher construction](https://github.com/cameroncooke/idb/blob/604c51013438f0c3603b720a05a44b7c5b8f286d/FBSimulatorControl/Commands/FBSimulatorAccessibilityCommands.swift#L29-L40), [token registry](https://github.com/cameroncooke/idb/blob/604c51013438f0c3603b720a05a44b7c5b8f286d/FBSimulatorControl/Commands/FBAXTranslationDispatcher.swift#L32-L99)). That design exists specifically to keep concurrent requests distinct.

AXe 1.8.0 replaces the older future bridge with direct async accessibility handles. It retries empty hierarchies with bounded exponential delays and, for exact `Channel disconnected` or DTX/file-descriptor exhaustion failures, restarts `testmanagerd` inside the exact simulator UDID once before retrying ([AXe 1.8.0 recovery](https://github.com/cameroncooke/AXe/blob/v1.8.0/Sources/AXe/Utilities/AccessibilityFetcher.swift#L33-L188)). XcodeBuildMCP 2.7.0 pins AXe 1.8.0; XcodeBuildMCP 2.6.2 pins AXe 1.7.1 ([2.7.0 pin](https://github.com/getsentry/XcodeBuildMCP/blob/v2.7.0/.axe-version), [2.6.2 pin](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/.axe-version)).

“No translation object” is raised when the private translator returns no root translation or cannot convert it into a platform element ([dispatcher](https://github.com/cameroncooke/idb/blob/604c51013438f0c3603b720a05a44b7c5b8f286d/FBSimulatorControl/Commands/FBAXTranslationDispatcher.swift#L51-L71)). Its own error text points to an invalid/invisible point; the frontmost-hierarchy path also has remediation for stale SpringBoard/CoreSimulator bridge state ([error definition](https://github.com/cameroncooke/idb/blob/604c51013438f0c3603b720a05a44b7c5b8f286d/FBSimulatorControl/Commands/FBAccessibilityError.swift#L42-L80), [frontmost remediation](https://github.com/cameroncooke/idb/blob/604c51013438f0c3603b720a05a44b7c5b8f286d/FBSimulatorControl/Commands/FBSimulatorAccessibilityCommands.swift#L130-L199)). It is not evidence by itself that another booted device interfered.

### 6. Actions on one device must remain ordered

Concurrent lanes do not mean concurrent gestures against one simulator. A screenshot must describe the state produced by the preceding action, not race it.

XcodeBuildMCP 2.6.2 already implements the correct primitive: a promise queue keyed by simulator ID. Same-UDID transactions serialize; different-UDID transactions proceed independently ([queue implementation](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/src/mcp/tools/ui-automation/shared/snapshot-ui-state.ts#L12-L41)). Its tests explicitly prove both behaviors ([same-device and different-device tests](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/src/mcp/tools/ui-automation/__tests__/snapshot-ui-state.test.ts#L240-L318)).

This is the pattern the delivery system should copy: **keyed order, cross-key concurrency**.

### 7. Captures and streams need per-UDID ownership

Apple supports screenshots and videos through `simctl io`; it says Simulator.app need not be running and advises an explicit device when several are booted ([WWDC20 capture section](https://developer.apple.com/videos/play/wwdc2020/10647/?time=755), [archived Simulator guide](https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/InteractingwiththeiOSSimulator/InteractingwiththeiOSSimulator.html)). Local Xcode 26.6 help confirms both `screenshot` and `recordVideo` accept a device argument and that SIGINT finalizes a recording.

XcodeBuildMCP keys active AXe recording processes by simulator UUID, rejecting a second recording only for the same UUID ([video session map](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/src/utils/video_capture.ts#L1-L25), [start guard](https://github.com/getsentry/XcodeBuildMCP/blob/v2.6.2/src/utils/video_capture.ts#L135-L181)). Different simulators can record concurrently.

serve-sim's official source says multiple booted simulators are supported, allocates an available port for each device, and keeps child processes/state by UDID ([README at the npm 0.1.45 source revision](https://github.com/EvanBacon/serve-sim/blob/14ad57ff922551bf7be81e907ddfcfa6191e64f2/packages/serve-sim/README.md#L129-L138), [multi-device startup](https://github.com/EvanBacon/serve-sim/blob/14ad57ff922551bf7be81e907ddfcfa6191e64f2/packages/serve-sim/src/index.ts#L409-L570)). The npm registry currently reports 0.1.46 as latest, while 0.1.45 is the repository's current project pin.

There is a provenance wrinkle: npm's 0.1.45 metadata points to Git commit `14ad57ff…`, but that commit's checked-in package manifest says 0.1.34. The 0.1.45 registry tarball itself says 0.1.45 and contains the same multi-device code. That mismatch does not block parallel streaming, but it is a reason to retain the exact tarball integrity/hash in our repo pin instead of treating a floating npm version as reproducible source.

### 8. Resource pressure is real but should be measured

Several booted simulators consume RAM, GPU, disk, and host file descriptors. That calls for admission control, not a one-simulator invariant. serve-sim 0.1.45 already exposes a grid memory report that estimates additional simulator capacity from available bytes and measured per-simulator process usage. Xcode's parallel testing has long distributed workers over cloned simulators, with explicit worker-count limits ([Xcode 10 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-10-release-notes)).

The delivery orchestrator should record a capacity sample before allocating another simulator and limit expensive concurrent builds independently from cheap already-built runtime verification.

## Candidate systems

| Candidate | What works | What fails | Decision |
|---|---|---|---|
| One global simulator and one global native lock | Simple ownership and cleanup | Creates the current bottleneck; evidence and gestures for unrelated issues block each other | Reject |
| One shared MCP process, callers always pass explicit UDIDs | XcodeBuildMCP can queue per UDID and run different UDIDs concurrently | Session defaults are shared mutable state; element refs are process/session scoped; independent agents can replace defaults | Useful inside one orchestrator, not as the cross-lane boundary |
| Persistent driver per lane plus exact UDID | Isolates defaults and process-local refs, but adds MCP lifecycle machinery | More processes and cleanup | Viable, unnecessary for atomic semantic actions |
| Stateless observations plus atomic AXe selector actions | Exact UDID every time; no mutable defaults or transferred refs | Selectors must be unique and accessibility-backed | **Choose** |
| One CoreSimulator device set per lane (`simctl --set`) | Strong namespace isolation, duplicate names harmless | AXe currently calls `getSimulatorSet(deviceSetPath: nil)` and XcodeBuildMCP assumes the normal set; alternate sets need unproven environment plumbing | Document and defer |
| XCTest's automatic parallel clones | Excellent for parallel automated test classes | Clones are runner-owned and unsuitable as durable interactive issue/evidence devices | Keep for test suites only |
| Shared driver with a global AXe serialization fallback | Can mask private-API instability if reproduced | Reintroduces a UI bottleneck even though current source supports concurrent UDIDs | Keep only as a measured, temporary circuit breaker |

## Recommended system

### Lane allocation

Each active lane has a durable runtime binding:

```text
lane ID
  simulator UDID
  simulator runtime + device type
  XcodeBuildMCP version + AXe version
  DerivedData path
  cloned SourcePackages path
  package cache path
  installed build artifact hash
  serve-sim PID, port, URL, and ownership
  active recording PID/session and output path
```

Multiple issues may belong to a lane, but only the lane runtime owner mutates its simulator. Switching issues in a lane either reuses compatible app state deliberately or resets from a named checkpoint/template.

### Build path

1. Resolve packages into lane/build-keyed package state. A build key includes repository, exact commit, Xcode build, SDK/runtime family, scheme, configuration, and dependency lockfile hash.
2. Use unique writable DerivedData and package-cache paths for concurrent writers.
3. Preserve the finished `.app`, dSYM, build receipt, and dependency/build key.
4. Install that one `.app` into each explicit simulator UDID that needs the same build. Apple demonstrates installing one app bundle by drag and drop and selecting one simulator or all simulators from the share sheet ([WWDC19, “Getting the Most Out of Simulator”](https://developer.apple.com/videos/play/wwdc2019/418/)).
5. Rebuild only when the build key changes or a destination is not binary-compatible.

An optional optimization is a read-only warm seed for SourcePackages/package downloads, copied or cloned into each lane's writable package directories before `xcodebuild`. Do not make several builds write one global SwiftPM cache merely to save disk; #135 already demonstrated that this can serialize or wedge otherwise independent work.

### Runtime path

1. Allocate or reuse a stable lane simulator in the normal CoreSimulator device set.
2. Boot by exact UDID and wait for boot completion.
3. Route every observation with the exact leased UDID. For UI mutation, use one atomic AXe selector invocation, or one persistent driver only when a flow truly needs process-local element references.
4. Install and launch by exact UDID.
5. Run a readiness probe (`snapshot_ui`/AXe describe) with bounded retry before the reproduction. Do not infer readiness from `Booted` alone.
6. Queue actions and captures per UDID. Other UDIDs continue concurrently.
7. Start serve-sim for all requested UDIDs or one owned helper per lane; persist each returned port/URL.
8. Keep raw errors, command version, UDID, timestamps, and simulator service state in the evidence receipt.

### Recovery path

Recovery remains scoped to one UDID:

1. Refresh the UI snapshot; stale element refs are never reused.
2. Retry only documented transient AX/empty-hierarchy startup failures with a bound.
3. Let AXe 1.8 perform its one-shot target-UDID `testmanagerd` recovery for matching transport faults.
4. If the simulator remains unhealthy, restart services or reboot only that lane simulator, then re-install the preserved build.
5. A global AXe mutex is activated only if a repeatable experiment shows failures on different UDIDs that disappear under serialization. Record the trigger rate and remove the circuit breaker once upstream is fixed.

### Capacity and cleanup

- `simulator:<UDID>` lease: boot/shutdown/erase/delete and ordered UI mutations.
- `derived-data:<canonical path>` lease: one writer, many post-build readers.
- `package-cache:<canonical path>` lease: one writer; prefer separate paths for simultaneous builds.
- `build-capacity` semaphore: start with two concurrent builds, then tune from peak memory and elapsed-time evidence.
- `runtime-capacity` semaphore: based on measured simulator/serve-sim memory, not a constant of one.
- Cleanup removes only resources recorded in the lane binding. Stable lane simulators and preserved build artifacts remain available until retention policy expires.

## Hypotheses and experiments

The following experiments distinguish the suspected causes. They should run against disposable lane simulators and retain command transcripts.

### Experiment A: explicit-UDID direct tools

Create or clone two devices, boot both, and run these pairs concurrently with different explicit UDIDs:

- `simctl install`, `launch`, and `io screenshot`
- `simctl io recordVideo`
- AXe `describe-ui`, tap/gesture, and screenshot
- serve-sim streams

Success criterion: 20 iterations per device, zero cross-device screenshots/actions, zero translation failures after the readiness probe. This is the baseline because it removes XcodeBuildMCP defaults from the hypothesis.

### Experiment B: one XcodeBuildMCP process

Use one 2.7.0 process but call internal/UI tools with explicit different UDIDs. Verify concurrent start timestamps and correct device state. Repeat same-UDID calls and verify they remain ordered. The upstream source test already proves queue semantics; this host test proves the bundled AXe/CoreSimulator integration.

### Experiment C: persistent driver candidate

Run two XcodeBuildMCP 2.7.0 processes, each with immutable defaults for one UDID and its own DerivedData/package paths. Compare their isolation, memory, cleanup, and stale-process burden with stateless exact-UDID commands. This candidate was tested and rejected for the default topology because atomic AXe selectors do not need retained element-reference state.

### Experiment D: pinned versus new AXe

Repeat experiment C with XcodeBuildMCP 2.6.2/AXe 1.7.1 and 2.7.0/AXe 1.8.0. Classify exact error domains/messages. If 1.8.0 removes the failures, the root was transport/readiness rather than simultaneous boot state.

### Experiment E: package-state isolation

Run two clean focused builds in parallel under four configurations:

1. shared default SwiftPM package cache
2. unique package cache only
3. unique cloned SourcePackages only
4. both unique, pre-seeded from one immutable warm snapshot

Record wall time, lock waits, network traffic, disk growth, and exit status. Choose the fastest configuration with no cross-process wait or corruption. Source and #135 evidence predict option 4 will be the reliable default; the experiment determines whether its extra disk is worthwhile.

### Experiment F: fallback serialization

If concurrent AXe calls still fail, run the identical workload through one host-wide AXe mutex while keeping simulator runtime, streaming, installation, and screenshots concurrent. A statistically meaningful reduction would justify a temporary AXe-only circuit breaker. No reduction falsifies the shared-translator-contention hypothesis.

### Experiment G: alternate device sets

Try one `simctl --set` path and XcodeBuildMCP/AXe process per lane with an explicit device-set environment. Success requires list, boot, install, AXe hierarchy, screenshot, and Xcode destination resolution. Until all pass on documented interfaces, alternate sets remain an experiment rather than the delivery default.

## What is already proved without a host stress run

- Apple supports multiple booted simulators and says to use a name or UDID.
- A built app can be installed into multiple Simulator destinations.
- Xcode accepts exact destination IDs and separate DerivedData, package checkout, and package-cache paths.
- XcodeBuildMCP 2.6.2 serializes same-UDID UI work and permits different-UDID UI work concurrently in source and tests.
- XcodeBuildMCP recording state is keyed by simulator UUID.
- AXe resolves every operation by the supplied UDID.
- AXe's shared accessibility translator uses per-request tokens and a locked registry.
- AXe 1.8.0 has materially stronger accessibility readiness and recovery than the 1.7.1 bundled by the previous 2.6.2 pin.
- serve-sim 0.1.45 supports multiple devices and isolates helpers/state/ports by UDID.
- The repository's previous global hygiene lease was an avoidable source of serialization.

## Host experiments and adopted result

The following experiments ran on 2026-08-23 against two simultaneously booted
iOS 26 simulators, `4401D856-DE6C-4769-A649-468778C929F6` and
`B0B16E05-D2DE-4243-B27B-6837D50FDFE6`. Durable outputs live beneath
`~/.local/state/t3/swiftui-delivery/research/136/`.
The auditable command/result summary is
[`parallel-ios-simulator-experiment-receipt.json`](parallel-ios-simulator-experiment-receipt.json);
it records versions, real statuses, elapsed times, host measurements, artifact
paths, counts, and aggregate hashes, including the failed first AXe-locator run.
The exact secret-free shell/JSON-RPC record is
[`parallel-ios-simulator-command-transcript.md`](parallel-ios-simulator-command-transcript.md)
and its hash is bound by the receipt.

| Experiment | Result | Decision |
|---|---|---|
| Six concurrent XcodeBuildMCP 2.6.2 snapshots, three per UDID | 6/6 succeeded in 5 seconds; every artifact named its requested UDID | Multiple booted devices were not the cause of a deterministic 2.6.2 failure |
| Forty concurrent XcodeBuildMCP 2.7.0 snapshots, 20 per UDID in four batches | 40/40 succeeded in 28 seconds with zero cross-device captures | Adopt 2.7.0 and explicit per-command UDIDs |
| Concurrent lane-specific taps | Both commands reached the correct devices; reusing `e47` by assumed meaning opened General on B because refs differed between snapshots | Never transfer element refs between driver processes |
| Corrected semantic AXe taps | A opened General while B opened Accessibility and each action resolved inside its own exact-UDID AXe process | Adopt atomic selector actions for independent concurrent flows |
| Two AXe 1.8.0 recordings | Both finalized with exit 0; durations were 3.553 and 3.542 seconds | Concurrent per-UDID video is viable |
| serve-sim 0.1.45 with both UDIDs | Helpers ran on ports 3320 and 3321; both MJPEG endpoints returned HTTP 200; killing A left B running and streaming | Keep 0.1.45 and use one returned helper identity per UDID |
| T3 preview of serve-sim | The wrapper page loaded, but preview snapshot/evaluate timed out on the streaming canvas while the MJPEG endpoint continued serving | Treat serve-sim as the human feed; capture proof through the simulator tools |
| Two clean SwiftUI builds with private DerivedData, SourcePackages, and package caches | Both builds succeeded in the same 65-second interval; both private trees and capacity slots were reclaimed | Replace the global native lock with two isolated build slots |
| First atomic-AXe full-flow run | The first eight iterations per lane failed because the package symlink was resolved one directory too far; the remaining twelve succeeded after the live fix | Preserve this failed run and unit-test the locator; do not hide integration failures |
| Twenty full direct flows per lane | Two lanes concurrently completed 40 install → launch → swipe → screenshot flows in 75 seconds; 0 failures and 40 lane-separated PNGs | Direct exact-UDID operations remove the shared-driver bottleneck |
| Serialized fallback | Ten equivalent flows, five per lane, completed in 30 seconds with 0 failures; linear projection for 40 is about 120 seconds | Keep serialization only as a failure circuit breaker; it discards roughly 38% throughput in this sample |
| Two persistent XcodeBuildMCP processes | Each retained an independent simulator default correctly, but used about 205 MB RSS at startup; startup also reported 22–24 matching old MCP peers and `peer-count-high`/`peer-age-high` anomalies | Viable but unnecessary lifecycle and stale-process burden for atomic selector actions |

The adopted implementation is repo-owned: `scripts/simulator-lane` provides an
atomic per-UDID lease, a pinned explicit-UDID XcodeBuildMCP 2.7.0 runner, and a
snapshot binding validator. It refuses cross-process element-ref actions and
uses bundled AXe 1.8.0 for atomic semantic actions. `ios-build-hygiene` now admits two builds, isolates
all three writable build/package roots, and releases a completed slot even when
global XCTest clone cleanup must wait for unrelated native work.

The retained experiment roots are `direct-flow-20` (including the locator
failure), `direct-flow-20-clean`, and `serialized-fallback-10` beneath the
research state root. The two test MCP PIDs were terminated explicitly, the
second simulator was returned to Shutdown, and both test leases were released.

### Current-host capacity sample

The current host reported 18 logical CPUs, 48 GiB physical RAM, 62% free memory,
and about 26 GiB free disk. Booting the second iOS 26 simulator took 5.956
seconds and increased the observed CoreSimulator/Simulator process RSS by about
10.0 GiB. Two simultaneous clean builds completed in 65 seconds. Disk and
smooth video, not CoreSimulator's ability to boot a second device, are the
present constraints. Two builds is therefore the safe measured default; the
tool accepts a reviewed `T3_IOS_BUILD_CAPACITY=1..8` override for future hosts.

## Remaining empirical work

- The exact cause and rate of the #135 AXe failure, because its raw error was not preserved.
- AXe 1.8.0 passed 40 simultaneous hierarchy requests and concurrent video;
  longer soak runs remain useful if a raw transport failure recurs.
- The practical simulator count above two while preserving smooth evidence
  video. The current second-device sample is enough to remove the one-device
  bottleneck, but not to claim that three or more are smooth under simultaneous video.
- The best warm package-cache seeding and retention budget. Two fully isolated
  cold caches already passed concurrently, so seeding is an optimization.
- Whether alternate CoreSimulator device sets work through the complete XcodeBuildMCP + AXe toolchain.
- Whether serve-sim 0.1.46 should replace 0.1.45 after checking the registry artifact against an auditable source revision.

## Version recommendation

- Upgrade the repository pin from XcodeBuildMCP 2.6.2 to **2.7.0** and record that its bundled AXe is **1.8.0**. The new AXe transport/recovery is directly relevant to the observed failure, while the XcodeBuildMCP per-UDID concurrency behavior is retained.
- Keep serve-sim **0.1.45** for the first parallel rollout because it already contains the required multi-device implementation and is the version currently named by the repo. Evaluate **0.1.46** in a separate smoke/provenance check; “latest” alone is not a correctness argument.
- Replace “establish one simulator context” with “lease one exact simulator UDID per active lane.”
- Replace the one global native hygiene lease with keyed resource leases plus capacity semaphores.
- Preserve raw AXe error chains and exact versions in every runtime evidence receipt so the next failure is diagnosable rather than anecdotal.

## Primary sources

- Apple, [Xcode command-line tool reference](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference)
- Apple, [Become a Simulator expert](https://developer.apple.com/videos/play/wwdc2020/10647/)
- Apple, [Getting the Most Out of Simulator](https://developer.apple.com/videos/play/wwdc2019/418/)
- Apple, [Xcode 10 parallel-testing release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-10-release-notes)
- XcodeBuildMCP, [session defaults](https://www.xcodebuildmcp.com/docs/session-defaults)
- XcodeBuildMCP, [v2.6.2 source](https://github.com/getsentry/XcodeBuildMCP/tree/v2.6.2)
- XcodeBuildMCP, [v2.7.0 source](https://github.com/getsentry/XcodeBuildMCP/tree/v2.7.0)
- AXe, [v1.7.1 source](https://github.com/cameroncooke/AXe/tree/v1.7.1)
- AXe, [v1.8.0 source](https://github.com/cameroncooke/AXe/tree/v1.8.0)
- AXe IDB fork, [pinned v1.8.0 dependency revision](https://github.com/cameroncooke/idb/tree/604c51013438f0c3603b720a05a44b7c5b8f286d)
- serve-sim, [official repository](https://github.com/EvanBacon/serve-sim)
- npm registry, [serve-sim 0.1.45 artifact](https://registry.npmjs.org/serve-sim/-/serve-sim-0.1.45.tgz)
