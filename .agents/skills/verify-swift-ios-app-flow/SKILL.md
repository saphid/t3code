---
name: verify-swift-ios-app-flow
description: Build, extend, diagnose, and prove T3's native Swift iOS app-flow journeys. Use for SwiftUI Simulator integration/regression/click-through tests, XCUITest journey changes, app-flow fixtures or personas, visual/accessibility checkpoints, reusable .xctestproducts, live pairing smoke tests, or Swift iOS PR verification.
---

# Verify Swift iOS app flow

Keep XCUITest as the release-gate oracle. Use accessibility-first agent control
for discovery and diagnosis, then promote useful exploration into a cataloged,
no-model replay.

## 1. Resolve the contract

Read the repository `AGENTS.md`, then read:

- `apps/swift-ios/Scripts/app-flow-catalog.json`
- `apps/swift-ios/TestPlans/*.xctestplan`
- `docs/operations/swiftui-app-flow-regression-tests.md`

Run `python3 apps/swift-ios/Scripts/app-flow.py check`. Stop on catalog drift.
Choose one cataloged plan. Use `visual-accessibility` for the critical semantic
lane and `known-red` only for issue-linked defect audits. Let CI's reviewed
impact map select `pr` or the fail-safe `regression` fallback.

Choose the Xcode gate separately. Use `CandidateJourneys` for one candidate,
`TestTrain` for SwiftUI Test, `DevPromotion` for SwiftUI Dev, `UpstreamPR` for
an upstream pull request, and `OfficialRelease` only under release authority.
Use `Focused` for native unit tests. Set `T3_SWIFT_XCODE_TEST_PLAN`; do not edit
a plan at run time.

## 2. Prepare one owned run

Use the installed iOS build-hygiene workflow for direct local Xcode builds.
Execute the repository entry point rather than reconstructing its Xcode flags:

```sh
apps/swift-ios/Scripts/ci-verify.sh pr
```

The verifier creates and deletes a disposable Simulator. An explicit
`T3_SWIFT_SIMULATOR_ID` is an advanced caller-owned target; record that ownership
and delete it outside the verifier.

Treat retained accessibility trees as diagnostic evidence. Pinned visual
snapshots provide the automated visual and Dynamic Type smoke. The runbook
records why `performAccessibilityAudit` is not currently a required oracle.

Reuse `.xctestproducts` only through `T3_SWIFT_REUSE_TEST_PRODUCTS=1`; the
source/build manifest must validate. The runners use `build-for-testing` once
and `test-without-building` for each selected lane. For an upstream
CI-equivalent pass, run
`apps/swift-ios/Scripts/ci-verify.sh pr` or `regression`.

## 3. Explore through the typed semantic surface

For an unfamiliar or failing path, use the repository's iOS debugger and
Simulator-browser skills. Wrap that work in `Scripts/app-flow-agent.py`:

1. `prepare` freezes source, catalog, Simulator, and plan into one session.
2. `inspect` records the fresh semantic hierarchy.
3. `act` names one stable selector, action, and expected postcondition.
4. `assert` binds a passed or failed observation to that action ID.
5. `collect` hashes a screenshot, accessibility tree, or log.
6. `promote` emits a sealed XCTest draft only when every action has a passed
   postcondition and content-addressed evidence.
7. `finish --cleanup-status passed` closes the session after cleanup.

Use `--help` for exact arguments. Reinspect after navigation because element
references become stale. A promotion is a draft until its cataloged XCUITest
passes without a model in the verdict loop.

Explore only DEBUG fixture or disposable-live state. Keep destructive
confirmations outside the path. Stage real pairing codes through a mode-`600`
credential file; keep them out of typed XCTest actions, launch arguments, logs,
and prompts. The repository runner masks both staged fields, quarantines and
scans credential-bearing command output, and uninstalls the app afterward; do
not bypass that ingress. A model's visual opinion diagnoses; semantic assertions decide.

## 4. Promote discoveries

When exploration finds a durable journey:

1. Add or tighten one `AppFlowUITests` method with bounded state waits.
2. Add its stable journey ID, lane, persona, surfaces, duration, and checkpoint
   names to the catalog. Keep every fixture journey in `regression`.
3. Attach a screenshot and accessibility tree at each meaningful checkpoint.
4. Run the catalog check and `ci-app-flow-test.test.sh`.
5. Run the promoted journey through its named plan from fresh app state without
   a model in the verdict loop.

Create a new named fixture persona when accumulated state, recovery, permission,
or empty-state behavior is the subject. Keep the production SwiftUI hierarchy;
put fixture selection behind DEBUG composition.

## 5. Read the evidence

Accept a run only when the receipt verdict is `passed`, the source/build manifest
matches, the exact executed identifiers equal the plan, aggregate failures,
skips, and expected failures are zero, and every declared checkpoint has both a
PNG and accessibility attachment. Preserve the first failed result; a later pass
classifies a flake but does not turn the first attempt green.

For the full `ci-verify` profile, also require `native-unit.receipt.json` to be
green. It must name both visual snapshot tests and only the documented
live-transport skip; aggregate xcodebuild success alone is not a verdict.

For a live run, use the exact-SHA backend adapter entry point:

```sh
T3_APP_FLOW_BACKEND_ADAPTER=/protected/path/adapter \
T3_APP_FLOW_BACKEND_ADAPTER_SHA256="$ADAPTER_SHA256" \
apps/swift-ios/Scripts/ci-live-app-flow-test.sh
```

The adapter must provision the cataloged project and clean it after pairing,
task creation, and follow-up. The wrapper owns and deletes the Simulator because
pairing persists a derived bearer credential in Simulator Keychain.

## Completion

Finish only when `verification.receipt.json` has a valid seal and passed verdict,
the shell contract suite is green, and cleanup is attested. For protected
physical-device/TestFlight evidence, validate the lane's JSON with
`app-flow.py release-receipt`; pass the protected candidate's commit and content
hash plus the directory containing every named artifact. The validator hashes
those files itself. The example input is in `Scripts/TestFixtures`.
Report one receipt path and one concrete verdict/count. For executable changes,
obtain the repository-required independent review before shipping.
