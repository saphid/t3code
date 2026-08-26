---
name: ios-build-hygiene
description: Run direct iOS Xcode builds and tests with isolated temporary DerivedData, then reclaim generated DerivedData and idle XCTest device clones without touching source, result bundles, simulator app data, or concurrent builds. Also cleans up simulator sessions from any project - shuts down booted simulators that no active lease owns, deletes unavailable device records, and quits Simulator.app when nothing remains booted. Use whenever a skill or agent invokes xcodebuild, runs Swift/SwiftUI simulator tests, or performs an XcodeBuildMCP verification pass.
---

# iOS build hygiene

Serialize native verification through the bundled helpers. Treat cleanup as
part of the result on success, failure, cancellation, and timeout.

## Read-only Xcode inspection

Do not run raw `xcodebuild -showBuildSettings`, `-showdestinations`, or `-list`
queries. They can wait indefinitely on Xcode package or workspace state and
leave an entire shell pipeline alive. Run them through the bounded helper:

```bash
~/.agents/skills/ios-build-hygiene/scripts/run-xcode-inspection.py \
  --timeout-seconds 30 \
  --receipt .t3/evidence/show-build-settings.json -- \
  -project apps/swift-ios/T3Code.xcodeproj \
  -scheme T3CodeTest \
  -configuration Test \
  -showBuildSettings
```

The helper acquires the same native hygiene lane as build/test wrappers, accepts
exactly one inspection operation, refuses build, test, archive, clean, and
explicit DerivedData actions, preserves the real exit status, and emits elapsed
time. Exit `75` means another native owner has the lane; it starts no Xcode
process. Exit `124` means the deadline expired; the helper terminates the exact
process group, escalates after a short grace period, and records the timeout in
the optional atomic JSON receipt. Pipe or filter its stdout only after the
helper so an early-closing consumer cannot strand `xcodebuild`.

## Direct xcodebuild

Run from the target repository:

```bash
~/.agents/skills/ios-build-hygiene/scripts/run-xcodebuild-clean.sh -- \
  -project apps/swift-ios/T3Code.xcodeproj \
  -scheme T3Code \
  -destination 'platform=iOS Simulator,id=<udid>' \
  test -only-testing:<focused-test>
```

The wrapper holds the shared hygiene lock, supplies a unique temporary
`-derivedDataPath`, forwards termination signals, preserves `xcodebuild`'s exit
status, deletes only its private temporary tree, and requests an idle clone
sweep through CoreSimulator. Put evidence that must survive cleanup in an
explicit `-resultBundlePath`; relative paths resolve from the repository.

A focused `-only-testing` run that matches zero tests can still print
`** TEST SUCCEEDED **` and exit 0 (method-level Swift Testing selectors are the
classic cause). Treat that as a failure, not a pass: target the suite rather
than a single method, and before accepting or promoting on a green focused run,
confirm a nonzero executed-test count from the result bundle
(`xcrun xcresulttool get test-results tests --path <bundle> --format json`).

## XcodeBuildMCP

Before the first MCP build/test, acquire the hygiene lease and create an
isolated path:

```bash
derived_data=$(~/.agents/skills/ios-build-hygiene/scripts/new-mcp-derived-data.sh)
```

Pass that exact absolute value as `derivedDataPath` in
`session_set_defaults`. Reuse it during one verification loop. After the last
MCP build/test and after preserving required logs or result bundles, run:

```bash
~/.agents/skills/ios-build-hygiene/scripts/sweep-idle-xcode.sh \
  --derived-data "$derived_data" --clones
```

Do not sweep XcodeBuildMCP's shared default workspace cache. An MCP loop is
complete only after its isolated path is removed or cleanup is explicitly
deferred to the final finishing test. The sweep releases the lease only after
all requested cleanup completes.

## Sweep result

- Exit `0`: requested cleanup completed or the exact generated path was
  already absent.
- Exit `64`: invocation or deletion target was refused; fix the command.
- Exit `75`: another native build/test, active clone, open handle, or failed
  safety check deferred cleanup. The final finishing test owns the retry.

Before reporting verification complete, record the real build/test exit status
and durable evidence location, then record cleanup as `complete` or `deferred`.

## Read-only resource inventory

Before changing ownership or cleanup policy, inspect the current native state:

```bash
~/.agents/skills/ios-build-hygiene/scripts/inspect-native-resources.py
```

The command emits a versioned JSON snapshot to stdout and writes no state. It
reads the existing hygiene lock, relevant process metadata, known DerivedData
roots, Simulator list output, receipt references, open handles, and disk
headroom. It never grants a lease, marks cleanup eligibility, signals a
process, changes a Simulator, or removes a path. Unknown or contradictory
ownership is always `protected-unknown`; age alone never makes a resource safe
to reclaim.

Use `--derived-data <exact-path>` to include another known root. Use
`--fixture <json>` only for deterministic replay and tests; fixture mode does
not inspect the live host. A partial snapshot is still printed but exits `3`
and includes structured errors. Treat it as incomplete evidence, not as proof
that a resource is absent or idle.


## Simulator session cleanup (any project)

Desktops accumulate booted simulators and Simulator.app windows across
projects. `scripts/clean-simulator-sessions.sh` reclaims them safely:

```bash
~/.agents/skills/ios-build-hygiene/scripts/clean-simulator-sessions.sh status
~/.agents/skills/ios-build-hygiene/scripts/clean-simulator-sessions.sh clean [--dry-run] [--keep-app]
```

Safety model: a booted simulator is NEVER touched when an active delivery
lease exists for its UDID (`~/.local/state/t3/swiftui-delivery/simulator-leases/<UDID>.lock`)
or the UDID is listed in `$SIMULATOR_CLEAN_PROTECT` (comma-separated) - so
any project can adopt the same protection by either taking a lease-shaped
lock or exporting the protect list before running builds. `clean` shuts
down unprotected booted devices, runs `simctl delete unavailable`, and
quits Simulator.app only when zero devices remain booted. Exit 0 clean,
1 if any action failed. Run it at the end of simulator work and whenever
the desktop fills with stray simulator windows.
