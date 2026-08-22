---
name: ios-build-hygiene
description: Run direct iOS Xcode builds and tests with isolated temporary DerivedData, then reclaim generated DerivedData and idle XCTest device clones without touching source, result bundles, simulator app data, or concurrent builds. Use whenever a skill or agent invokes xcodebuild, runs Swift/SwiftUI simulator tests, or performs an XcodeBuildMCP verification pass.
---

# iOS build hygiene

Use two isolated native build slots by default. This is the measured safe value
for the current host, not a machine-wide invariant; set
`T3_IOS_BUILD_CAPACITY=1..8` only from recorded host measurements. Each slot owns private DerivedData, cloned
SourcePackages, and package cache paths; unrelated simulator runtime work does
not consume a build slot. Treat cleanup as part of the result on success,
failure, cancellation, and timeout. Read
`../../../scripts/swiftui-delivery/references/simulator-lanes.md` when several
delivery lanes are active.

## Read-only Xcode inspection

Do not run raw `xcodebuild -showBuildSettings`, `-showdestinations`, or `-list`
queries. They can wait indefinitely on Xcode package or workspace state and
leave an entire shell pipeline alive. Run them through the bounded helper:

```bash
.agents/skills/ios-build-hygiene/scripts/run-xcode-inspection.py \
  --timeout-seconds 30 \
  --receipt .t3/evidence/show-build-settings.json -- \
  -project apps/swift-ios/T3Code.xcodeproj \
  -scheme T3CodeTest \
  -configuration Test \
  -showBuildSettings
```

The helper bounds one metadata query, accepts exactly one inspection operation,
refuses build, test, archive, clean, and
explicit DerivedData actions, preserves the real exit status, and emits elapsed
time. Exit `75` means the bounded inspection owner is busy; it starts no Xcode
process. Exit `124` means the deadline expired; the helper terminates the exact
process group, escalates after a short grace period, and records the timeout in
the optional atomic JSON receipt. Pipe or filter its stdout only after the
helper so an early-closing consumer cannot strand `xcodebuild`.

## Direct xcodebuild

Run from the target repository:

```bash
.agents/skills/ios-build-hygiene/scripts/run-xcodebuild-clean.sh -- \
  -project apps/swift-ios/T3Code.xcodeproj \
  -scheme T3Code \
  -destination 'platform=iOS Simulator,id=<udid>' \
  test -only-testing:<focused-test>
```

The wrapper acquires one of the configured build slots; supplies unique temporary
DerivedData, cloned SourcePackages, and package cache paths; forwards
termination signals; preserves `xcodebuild`'s exit status; deletes only its
private tree; and requests an idle clone sweep through CoreSimulator. Put
evidence that must survive cleanup in an explicit `-resultBundlePath`; relative
paths resolve from the repository.

## XcodeBuildMCP

Before the first MCP build/test, acquire the hygiene lease and create an
isolated path:

```bash
derived_data=$(.agents/skills/ios-build-hygiene/scripts/new-mcp-derived-data.sh)
```

Pass that exact absolute value as `derivedDataPath` in
`session_set_defaults`. Its parent also contains `SourcePackages` and
`PackageCache`; pass both paths through XcodeBuildMCP `extraArgs`. Reuse all
three during one verification loop. After the last
MCP build/test and after preserving required logs or result bundles, run:

```bash
.agents/skills/ios-build-hygiene/scripts/sweep-idle-xcode.sh \
  --derived-data "$derived_data" --clones
```

Do not sweep XcodeBuildMCP's shared default workspace cache. An MCP loop is
complete only after its isolated path is removed or cleanup is explicitly
deferred to the final finishing test. The sweep releases the private build slot
as soon as that exact tree is safely removed. Optional global XCTest clone
cleanup is a separate result and may remain deferred without holding a finished
build slot.

If an MCP process crashes while its isolated path still exists, its one build
slot remains occupied while the other remains usable. Inspect the lease and
path, then run the same explicit
`sweep-idle-xcode.sh --derived-data "$derived_data" --clones` command after
confirming that exact tree is idle. There is no age-based or force cleanup.
An allocator that dies before publishing a run root is reclaimed only when its
recorded PID is dead; a completely empty partial lock receives a 60-second
grace. Active run roots are never age-reclaimed.

## Sweep result

- Exit `0`: requested cleanup completed or the exact generated path was
  already absent.
- Exit `64`: invocation or deletion target was refused; fix the command.
- Exit `75`: all configured build slots are occupied, or an active clone, exact-tree open
  handle, or failed safety check deferred cleanup. The final finishing test
  owns the retry.

Before reporting verification complete, record the real build/test exit status
and durable evidence location, then record cleanup as `complete` or `deferred`.

## Read-only resource inventory

Before changing ownership or cleanup policy, inspect the current native state:

```bash
.agents/skills/ios-build-hygiene/scripts/inspect-native-resources.py
```

The command emits a versioned JSON snapshot to stdout and writes no state. It
reads keyed build slots, the bounded-inspection legacy lock, relevant process
metadata, known DerivedData roots, Simulator list output, open handles, and disk
headroom. It never grants a lease, marks cleanup eligibility, signals a
process, changes a Simulator, or removes a path. Unknown or contradictory
ownership is always `protected-unknown`; age alone never makes a resource safe
to reclaim.

Use `--derived-data <exact-path>` to include another known root. Use
`--fixture <json>` only for deterministic replay and tests; fixture mode does
not inspect the live host. A partial snapshot is still printed but exits `3`
and includes structured errors. Treat it as incomplete evidence, not as proof
that a resource is absent or idle.
