# SwiftUI app-flow regression tests

This suite answers two different questions without confusing them:

1. Can a person reach and operate the native app's non-destructive menus and
   happy-path surfaces?
2. Do live Dev, Test, and TestFlight builds still complete the networked flows
   against real infrastructure?

The first question is a deterministic XCUITest verdict. The second needs a
small live smoke pass because credentials, server state, Apple services, the
camera, extensions, and push delivery cannot be made truthful by an in-process
fixture.

## What existed before this suite

`T3CodeTests` already covered native models, persistence, protocol mapping,
pairing contracts, feature state, and many regressions. There was no UI-testing
target, no `XCUIApplication` journey suite, no automated menu inventory, and no
retained screenshot evidence. The release checklist therefore left the main
app journeys as manual smoke tests.

## Test layers

| Layer                    | Owns                                                                                                                                                                 | Routine oracle                                                                   | Model use                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Deterministic app flow   | Launch, onboarding entry, home/search/filter, new-task workspace/model/reasoning/attachment menus, settings/connections, thread context actions, and workspace tools | Accessibility identifiers, labels, state, and a three-second response budget     | Inspect retained screenshots only on failure or an intentional visual review               |
| Visual and accessibility | Phone standard/XXL/RTL and iPad onboarding snapshots, unique critical-screen identifiers, plus semantic trees at every XCUITest checkpoint                           | Tolerant PNG comparison on a pinned environment and explicit semantic assertions | Diagnose snapshot or semantic failures; Apple audit API remains a measured prototype       |
| Live Dev/Test smoke      | Pairing, server-backed project/task/message operations, reconnect, approval/input requests, real file/review/source-control/terminal data                            | Explicit state assertions against a disposable environment                       | Diagnose failures after logs, accessibility state, and screenshots have narrowed the cause |
| TestFlight release smoke | Read-only/navigation checks plus narrowly approved live mutations                                                                                                    | Human-observed release checklist with build number and timestamp                 | Visual review of the release evidence; never put fixture launch arguments into Release     |

The fixture exists only in `DEBUG`. Release and TestFlight builds always compose
`NativeFeatureClient` and cannot opt into fixture state.

## Deterministic journeys

`T3CodeUITests/AppFlowUITests` currently covers:

- direct-connection onboarding through a completed manual fixture connection;
- home, search, project filtering, and new-task entry;
- current-checkout/new-worktree, model, reasoning, and attachment menus;
- task creation plus a follow-up message through the production composer;
- add-project and add-connection entry points without creating or deleting data;
- Settings, theme choices, connection list, and connection detail;
- a keyboard-safe Skills popup with readable long rows, full-list scrolling,
  unfiltered bottom-row selection, and filtered selection;
- ordinary upward and downward Home-list scrolling, including top-edge rubber
  banding, without opening the command palette;
- cold-launch Home scrolling while deterministic metadata snapshots arrive,
  followed by a thread open, return, and second list drag;
- command-palette direction isolation and drag thresholds from both Home and a
  keyboard-focused thread;
- the complete non-destructive thread context-menu inventory;
- thread detail plus Files, Review, Source Control, and Terminal surfaces;
- exact Dev build and feature attribution, the six-stage promotion diagram,
  pending-proof approval blocking, and both verdict confirmations;
- Personal Connect host failure, one-action fixture pairing, and the persisted
  connected Home after an app reopen;
- a newer live thread update winning over stale initial history, with the same
  ordered timeline after reopening the thread;
- a default-off XCUITest proof-event emitter that writes actual tap centers,
  normalized swipe paths, passed postconditions, and monotonic recording
  offsets in the existing app-flow-agent session and proof-map schemas when
  output paths are supplied;
- retained screenshots and semantic accessibility hierarchies at the meaningful
  checkpoints;
- four pinned onboarding snapshot smokes: light/standard, dark/accessibility
  XXL, right-to-left, and iPad Mini;
- a separate critical-screen accessibility lane that rejects duplicate nonempty
  identifiers across onboarding, Home, and Settings.

The 19 fixture journeys cover fifteen named personas: first-run user, returning
user, task author, error-recovery user, permissions-denied user, long-lived
user, one-handed mobile user, environment manager, thread operator, and
developer, release reviewer, conversation user, proof operator, cold-start
user, and private-fleet user.

The tests deliberately do not tap destructive actions against retained state,
system photo/camera/file pickers, external URLs, or buttons that would send live
data. The approval-control journey records its verdict only in the isolated
in-process fixture and resets that fixture receipt before each launch.
An additional opt-in journey pairs a clean simulator to a disposable backend
and asserts that its seeded project reaches the real Home project menu.

### Proof-pending review-item coverage audit

This table maps the fifteen `proofPending` stream items to deterministic app
coverage. It does not change any review state. Every item remains proof pending
until its required clean and annotated media passes the separate proof gates.

| Priority | Review item | Current deterministic coverage | Remaining acceptance gap |
| --- | --- | --- | --- |
| 1 | `in-app-stream-approval-control` | Exact build identity, six pipeline stages, priority order, pending-proof block, review text, attribution, and both verdict confirmations | Capture and validate the final clean and annotated media against the installed Test build |
| 2 | `initial-thread-live-updates` | A controlled initial-load race proves that newer live state wins once and stays ordered after reopen | Capture the installed Test build under a real busy-thread update |
| 3 | `cold-boot-home-list-scrolling` | Metadata snapshots arrive while the first Home drag runs; the test opens a thread, returns, and drags again | Capture the installed Test build during real cold metadata loading |
| 3 | `command-palette-top-drawer` | Home and thread drags cover direction isolation, close and open thresholds, and keyboard state | Capture the final dark-mode gesture video |
| 3 | `home-thread-list-scrolling` | Top rubber-band, upward scroll, downward scroll, and accumulated-history reachability | Capture the final dark-mode gesture video |
| 3 | `widget-build-channel-links` | Extension contract tests prove the Test URL scheme and `new-task` URL | A simulator journey still must tap the installed widget body and its New task link |
| 4 | `skill-popup-readability-and-height` | The keyboard-visible popup checks full long labels, row height, full-list scrolling, and bottom selection | Capture the final dark-mode gesture video and annotated images |
| 4 | `skills-popup-keyboard-clearance` | The same journey checks menu-to-keyboard clearance before and after filtering and selection | Capture the final dark-mode gesture video and annotated images |
| 5 | `swiftui-test-personal-connect` | A Test-channel fixture shows the private host list, exact unavailable state, one-action connection, and persisted reopen | Run the same path against the private Tailnet host in the installed Test build |
| 6 | `shared-electron-vscode-themes` | Theme catalog navigation, one named dark card, visual snapshots, and accessibility labels have coverage | Search, broad light/dark selection, relaunch persistence, and native/terminal color agreement need one focused journey |
| 7 | `pull-request-inbox-summary-timeline` | Pull-request models and wire contracts have focused lower-level tests | No deterministic connected inbox, Summary, and Timeline XCUITest journey exists |
| 7 | `pull-request-workspace-protocol` | Pull-request protocol and HTTP/RPC contracts have focused lower-level tests | No deterministic PR workspace UI journey exists |
| 8 | `safe-tool-content-recovery` | General tool surfaces and explicit sheet dismissal have UI coverage | Retained error content, accessible Retry, focus recovery, and duplicate prevention are not covered as one journey |
| 9 | `development-build-source-thread` | The approval fixture proves thread attribution for a review item | Build changelog expansion and source-thread routing do not have a stable fixture journey |
| 10 | `app-flow-regression-tests` | Catalog checks, XCUITest receipts, screenshots, accessibility exports, and the opt-in tap/swipe ledger have deterministic contracts | The complete recorded, annotated, secret-scanned proof packet still needs an end-to-end evidence run |

## Run and evidence

Use the repository's iOS build-hygiene lease/wrapper when running locally, then:

```sh
T3_SWIFT_DERIVED_DATA_PATH="$LEASED_DERIVED_DATA" \
T3_SWIFT_SIMULATOR_ID="$SIMULATOR_UDID" \
./apps/swift-ios/Scripts/ci-app-flow-test.sh
```

The script prints the `.xcresult` and receipt paths. Each plan resolves exact
test methods from `Scripts/app-flow-catalog.json`; catalog validation rejects
uncataloged Swift tests, missing fixture journeys, mixed lane semantics, and
duplicate checkpoint names. Screenshots and semantic accessibility trees use
`keepAlways`, are exported from the result bundle, and are required by the
receipt for every declared checkpoint. A routine pass should not spend model
tokens: semantic assertions, pinned snapshots, timing, exact test inventory,
and result status own the verdict.
Retained accessibility trees are diagnostic evidence, not an accessibility
oracle by themselves.

### Deterministic acceptance-proof assembly

The XCUITest receipt remains the semantic verdict. It retains checkpoint PNGs
and accessibility trees but does not contain an action-timed raw video. Use the
separate proof replay only after the exact cataloged journey passes. The
machine-readable mapping is
`apps/swift-ios/Scripts/app-flow-proof-catalog.json`:

| Feature | Green journey | Dark image states | Recorded video claim |
| --- | --- | --- | --- |
| `skills-popup-keyboard-clearance` | `skills-popup-keyboard-readability` | `thread-skills-popup-scrolled`, `thread-skills-popup-selected` | Scroll the complete menu and select the bottom and filtered skill without losing keyboard clearance. |
| `home-thread-list-scrolling` | `home-thread-list-scrolling` | `home-thread-list-scrolled` | Rubber-band and ordinary list swipes move Home without opening the command palette. |
| `command-palette-top-drawer` | `command-palette-top-drawer` | `command-palette-home-threshold`, `command-palette-thread-keyboard` | Below-threshold drags stay closed; above-threshold drags open from Home and a keyboard-focused thread. |

For each image, the `.xcresult` checkpoint is gate evidence. Capture the
mapping's `cleanInput` PNG during the same dark proof replay that records the
video; use that raw PNG to derive the paired clean and annotated images. This
keeps the image geometry and action ledger from the same UI attempt.

Prepare one session, then give `record` a semantic driver that performs only
the mapping's `captureActions`:

```sh
AGENT=apps/swift-ios/Scripts/app-flow-agent.py
python3 "$AGENT" prepare \
  --session "$EVIDENCE/session.json" --simulator-id "$SIMULATOR_UDID" \
  --plan regression
python3 "$AGENT" record \
  --session "$EVIDENCE/session.json" --journey-id <journey-id> \
  --video "$EVIDENCE/<journey>-raw.mov" -- <semantic-driver-command>
python3 "$AGENT" proof-map \
  --session "$EVIDENCE/session.json" \
  --output "$EVIDENCE/<journey>-action-map.json" --title "<proof title>"
python3 .agents/skills/prepare-proof-media/scripts/prepare_proof_media.py \
  timeline-from-app-flow "$EVIDENCE/session.json" \
  --action-map "$EVIDENCE/<journey>-action-map.json" \
  --output "$EVIDENCE/<journey>-timeline.json"
```

The recording wrapper sets the Simulator to dark before `simctl recordVideo`
starts. Each driver `act` supplies normalized visual geometry and receives a
source-video timestamp from the recording clock; each action then receives a
passed semantic `assert`. `proof-map` rejects untimed, unasserted, or
geometry-free actions and hashes the raw recording. Build and `validate-packet`
create the clean and annotated videos named in the proof catalog. The
fake-recorder test exercises this assembly contract without producing proof.

For a focused XCUITest command that runs more than one method, put `{test}` in
the session and action-map output paths. The test runner replaces it with a
safe method name, so one journey cannot overwrite another journey's ledger.

An XCTest `performAccessibilityAudit` prototype was not promoted. On Xcode 26.6
and iOS 26.5, combined, split-screen, and single-screen contrast-only probes all
hit process deadlines without finalizing a valid result bundle. The catalog
keeps that boundary explicit. Re-evaluate the API on a later Xcode/runtime; do
not make a hanging audit required or add a blanket issue suppression.

Known product failures are excluded from routine plans and selected only by an
explicit issue-linked red audit. Run it deliberately with:

```sh
T3_APP_FLOW_PLAN=known-red ./apps/swift-ios/Scripts/ci-app-flow-test.sh
```

Run the live transport smoke only against disposable state and a fresh,
single-use pairing token. Put the endpoint and token in a mode-`600` JSON file
outside the evidence directory:

```sh
T3_SWIFT_SIMULATOR_ID="$RUN_OWNED_SIMULATOR_UDID" \
T3_APP_FLOW_LIVE_CREDENTIALS_FILE=/private/path/app-flow-live.json \
T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR=1 \
T3_APP_FLOW_PLAN=live \
./apps/swift-ios/Scripts/ci-app-flow-test.sh
```

The file must contain `{"server":"http://127.0.0.1:49631","token":"..."}`.
The server must be an HTTP(S) origin without user info, path, query, or fragment.
Raw credential environment variables are rejected. The runner builds a portable
test product, boots the selected Simulator, installs its app, and copies the
mode-`600` credentials into that app's data container. The DEBUG app consumes
and deletes the file before XCTest acts, so the token never enters an XCTest
action or launch environment. The product masks both staged fields, and
credential-bearing xcodebuild output is quarantined from the console. The
runner scans that log plus the completed result bundle, extracted
summary/inventory, checkpoints, and receipt for the exact endpoint and token.
If it finds either one—or cannot complete a scan—it removes the unsafe,
run-owned evidence and fails. It then uninstalls the app so the
credential-bearing data container is not retained. The scan is a plaintext
oracle rather than OCR; masking the staged fields is what keeps automatic
failure screenshots from rendering the values.
Because successful pairing exchanges the one-time code for a bearer token in
Simulator Keychain, the `live` plan also requires the explicit disposable-target
flag and deletes that run-owned Simulator before issuing a passing receipt.
Never point the live plan at a shared development Simulator.
The live plan fails before Xcode if the file is absent; deterministic plans
reject credential input instead of silently running a different lane.

The same credential-file mode also enables an isolated fixture audit that uses
the identical staged-file ingress without contacting the server. Run only
the `security` plan with a valid-format sentinel token to prove the XCTest
activity log, screenshot, accessibility attachment, extracted inventory, and
receipt remain clean; the runner's fail-closed endpoint-and-token scan owns that
verdict. Because cleanup uninstalls the tested app and its data container, both
the security plan and the encompassing `ci-verify.sh` profile require an
run-owned state. `ci-verify.sh` creates and deletes a uniquely named disposable
Simulator by default; an explicit UDID is treated as caller-owned.

## Plans and receipts

| Plan                   | Purpose                                                                     | Retry policy                                 |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `pr`                   | Four critical deterministic journeys for pull requests                      | None; first failure is red                   |
| `regression`           | Every fixture journey across thirteen named personas, with zero expected skips | None                                         |
| `stability`            | Three fresh-runner repetitions of onboarding and task/follow-up             | No retry-to-green; all attempts are retained |
| `live`                 | One disposable-backend pairing/project smoke                                | None; requires a fresh one-time code         |
| `security`             | Staged credential ingress and evidence-leak audit                           | None; valid-format sentinel only             |
| `visual-accessibility` | Critical-screen identifier uniqueness plus screenshot and semantic evidence | None                                         |
| `known-red`            | Explicit issue-linked product-defect audits                                 | Expected to stay outside required PR gates   |

One build manifest binds reusable `.xctestproducts` to the exact repository
content hash, commit, dirty state, catalog, scheme, Xcode build, platform, the
committed `Package.resolved` graph, and every file and symlink in the portable
test-product tree. Reuse fails if any
identity changes or any app, unit/UI test, framework, resource, or metadata file
is tampered with. The final receipt rechecks that identity after execution and
compares the exact executed test identifiers—not only aggregate counts—with the
selected plan. A plan-derived process-group watchdog preserves exit `124` on a
wall-clock timeout and prevents Xcode's post-failure diagnostics from consuming
the enclosing CI job. Each plan receives twice its catalog estimate or five
minutes of fixed startup/diagnostic headroom, whichever is larger, and every UI
test receives a 180-second default / 360-second maximum XCTest allowance.

For the fork-safe upstream profile, run `Scripts/ci-verify.sh pr`; trusted main
uses `ci-verify.sh regression`; a weekly/manual run uses `ci-verify.sh
stability`. All profiles reuse one product for app-flow, native unit, visual
snapshot, and sentinel-security verdicts. CI pins Xcode 26.6, iOS 26.5,
and iPhone 17 Pro, and the receipt independently checks the actual xcresult
destination. Native units have a separate exact receipt: all four app-flow
visual tests must execute and pass, and the only accepted skip is the named
disposable-live per-message-deflate transport test. Snapshot comparisons use
`0.99` pixel precision and `0.98` perceptual precision. Their point size, phone
3x / tablet 2x display scale, locale, layout direction, appearance, and Dynamic Type input are explicit, so the
references do not inherit the host Simulator model's scale. The workflow's
exact Xcode/runtime pin is intentionally fail-closed: image refreshes require a
reviewed baseline update rather than a degraded comparison. Failed result bundles
and exported native-unit attachments are retained for diagnosis. CI retains
small receipts/summaries/checkpoint
exports for 30 days and full result bundles only on failure for 14 days. Live
credentials and the Release/TestFlight archive belong to a separate protected
exact-SHA workflow; no privileged workflow executes products uploaded by a pull
request.

`verification.receipt.json` is the content-addressed attempt ledger. It requires
an exact, unique plan set bound to one source identity and one frozen build
manifest; missing telemetry, mixed candidates, and duplicate receipts fail
closed. It records component and artifact hashes, first-attempt status,
pass-after-failure signals,
durations, secret/credential cleanup attestations, and owned-Simulator cleanup.
Both component receipt creation and ledger aggregation derive required
secret-scan and cleanup attestations from the selected catalog plan; manual
callers cannot downgrade a credential-bearing lane to `not-required`. Reused
build manifests must retain a valid seal in addition to matching their source,
catalog, package resolution, toolchain, and product hashes.
A rerun never changes an earlier failure to green. Before treating timing or
flake thresholds as release policy, collect a calibration baseline of at least
20 consecutive pull-request runs and 200 scheduled journey attempts on the
pinned runner; until then, the only automated threshold is zero failed first
attempts.

Do not teach a routine assertion to accept broken behavior. Isolate a confirmed
red behind the audit flag, link its issue from the skip, and return it to the
normal suite when the owning fix lands.

When a test fails:

1. Preserve the result bundle and inspect the first failed assertion, app logs,
   and accessibility hierarchy.
2. Inspect the nearest retained screenshot with a vision-capable model. Ask a
   narrow question such as whether the destination is absent, obscured,
   disabled, clipped, or visually still loading.
3. Reproduce only that journey against the relevant live channel if the failure
   could be fixture-specific.
4. Record the channel, build/commit, exact step, elapsed time, evidence path,
   likely layer, and whether an existing stream feature owns a fix.
5. File or link a priority issue only after distinguishing a product bug from a
   stale accessibility label, fixture gap, or infrastructure failure.

## Live and release matrix

The following still needs live evidence and must not be declared covered by the
fixture suite:

| Flow                                      | Dev/Test                | TestFlight               | Notes                                      |
| ----------------------------------------- | ----------------------- | ------------------------ | ------------------------------------------ |
| Direct URL and QR pairing                 | Required                | Required                 | Camera permission and real one-time code   |
| T3 Connect sign-in/discovery              | Required                | Required                 | Account, relay, and DPoP state             |
| Multi-environment reconnect               | Required                | Read-only preferred      | Induce only on disposable environments     |
| Create project/task and send follow-up    | Required                | Narrow approved mutation | Use a disposable project/thread            |
| Attachment upload                         | Required                | Narrow approved mutation | One small fixture image                    |
| Approval and input request                | Required                | Optional release sample  | Requires a server-generated request        |
| Background/deep-link/notification routing | Required                | Required                 | OS lifecycle and APNs cannot be faked      |
| Share extension, widgets, Live Activities | Required                | Required                 | Separate extension processes and App Group |
| iPad layout                               | Required before release | Required before release  | One representative iPad journey            |

## Deterministic Xcode gates

The checked-in Xcode Test Plan is the gate contract. The app-flow catalog is the
journey-selection contract. Do not use an agent to replace either contract.

| Gate               | Scheme      | Xcode Test Plan   | Required result                         |
| ------------------ | ----------- | ----------------- | --------------------------------------- |
| Focused work       | T3Code      | Focused           | Native `.xcresult`                      |
| Candidate proof    | Any         | CandidateJourneys | Catalog receipt and UI `.xcresult`      |
| SwiftUI Test train | T3CodeTest  | TestTrain         | Train receipt and complete `.xcresult`  |
| SwiftUI Dev gate   | T3CodeDev   | DevPromotion      | Promotion receipt and phone proof       |
| Upstream PR        | T3Code      | UpstreamPR        | PR receipt and complete `.xcresult`     |
| Official release   | T3Code      | OfficialRelease   | Authorized release receipt and evidence |

The native and UI runners build a reusable `.xctestproducts` directory with
`build-for-testing`. They run selected tests with `test-without-building`. A
sealed manifest binds reused products to the source, scheme, toolchain, package
resolution, and artifact hashes. Each invocation uses an unused
`-resultBundlePath`. It keeps the structured `.xcresult`, JSON summary, test
inventory, attachments, and receipt.

Xcode 26 compilation caching is enabled only for Debug, Dev, and Test. This
helps clean and branch-switch builds. It does not change Release build settings.

GitHub Actions starts only for an upstream pull request or a push to upstream
`main`. It uses `UpstreamPR` for pull requests and `OfficialRelease` for `main`.
The private SwiftUI Test and SwiftUI Dev lanes do not depend on GitHub Actions.

## Failure ledger

Issue [#58](https://github.com/saphid/t3code-personal/issues/58) is the durable
roll-up for this audit. Add one row per confirmed failure; do not collapse
several symptoms into “the app is broken.”

| Channel/build                 | Journey and failed step                                                                                                         | Evidence                                                                                                                                                                                       | Existing fix/owner                                                                                                              | Priority            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Live Dev baseline `125ed781e` | Existing saved environment remains on `Alex's MacBook Pro reconnecting`; server-backed projects and threads are unavailable     | Baseline Simulator screenshot; blocked stream threads `Fix iPhone T3 Code Environment Connection`, `XXL Connect/Continue SwiftUI TestFlight Connection`, and `Investigate iPhone App Slowdown` | No native SwiftUI reconnect fix found. #54 improves Personal Connect but does not repair this state.                            | P1                  |
| Dev baseline `125ed781e`      | Thread actions → Files has no visible or accessible Done control; the other tool sheets use the same presentation seam          | Issue [#60](https://github.com/saphid/t3code-personal/issues/60), retained `thread-files` screenshot                                                                                           | No staged fix found; new product defect                                                                                         | P2                  |
| Dev baseline `125ed781e`      | Settings → Connections → Add has no visible or accessible Close control                                                         | Issue [#61](https://github.com/saphid/t3code-personal/issues/61), retained `add-connection-entry` screenshot                                                                                   | No staged fix found; same toolbar-placement family as #60                                                                       | P2                  |
| Dev baseline `125ed781e`      | New Task's visible Cancel can fail after the attachment source popover has been dismissed                                       | Issue [#62](https://github.com/saphid/t3code-personal/issues/62), synthesized tap event and final accessibility hierarchy                                                                      | No staged fix found; promote to P1 if reproduced manually or dismissal is otherwise blocked                                     | P2                  |
| Dev widget build 26           | Four `T3CodeWidgets` processes crashed with `EXC_BREAKPOINT` in `_EXRunningExtension._start` during one passing host-app UI run | Issue [#63](https://github.com/saphid/t3code-personal/issues/63), four `.ips` attachments in the result bundle                                                                                 | No staged fix found; confirm on physical Test/TestFlight before promotion                                                       | P2                  |
| Debug baseline `125ed781e`    | `t3code-swiftui-dev://connections/new` is rejected as an unsupported link instead of opening Add Environment                    | Issue [#64](https://github.com/saphid/t3code-personal/issues/64), live Simulator screenshot                                                                                                    | No staged fix found; visible manual onboarding remains a workaround                                                             | P2                  |
| Deterministic harness         | UIKit thread cells discarded the stable thread identifier, so automation could not select a known fixture thread                | Initial red UI run                                                                                                                                                                             | Fixed on this feature branch by assigning `thread-<id>` and clearing it on cell reuse                                           | Test infrastructure |
| Deterministic harness         | Persisted composer drafts and fixture message IDs made typed text repeat and a follow-up render twice across focused reruns     | Visual review of `created-task-detail` and `sent-follow-up` from the first focused pass                                                                                                        | Fixed in the harness by replacing existing draft text, preserving submission identity, and asserting exactly one rendered value | Test infrastructure |

### Historical harness-development evidence

The counts and paths below describe the earlier harness-development audit, not
the current catalog or required-plan semantics. The current machine-readable
catalog and receipts are authoritative.

The first complete simulator run produced 1 pass, 5 failures, and 1 known-issue
skip in 2m16s. Screenshot and accessibility inspection classified three failures
as ambiguous test selectors rather than product defects. After tightening those
selectors and isolating tool sheets, the second run produced 3 passes, 3
failures, and 1 known-issue skip in 3m01s. It confirmed both defects above and
left only onboarding fixture selection and two platform-dismissal assumptions
to repair in the harness. XcodeBuildMCP retains its result bundles under its
workspace; the shell entry point writes result bundles under ignored
`.t3/evidence` unless `T3_SWIFT_RESULT_BUNDLE_PATH` overrides it.

A third focused rerun passed onboarding and project/connection entry and
reproduced only New Task Cancel. That failure had a valid synthesized tap on the
visible button and persisted for four seconds, so it moved from “automation
assumption” to tracked issue #62. Routine coverage keeps the attachment-menu
assertions; the failing dismissal sequence is an opt-in known-failure test.

The first focused create-task/follow-up run then passed semantically. Its
retained screenshots exposed repeated message text that the initial
identifier-only assertion had missed. The fixture now uses the production
submission identity so optimistic and delivered messages reconcile, injects
fresh per-launch draft and outbox stores, rejects any stale composer value, and
asserts exactly one rendered message with the submitted value. The same result
bundle also surfaced four widget-extension
crash reports, tracked separately as #63 rather than hidden behind the passing
host-app verdict.

That earlier frozen routine audit contained eight programmatic journeys and
three issue-linked red audits, plus one opt-in live transport journey. On iPhone
17e / iOS 26.5, one serial run passed seven, skipped the three known defects,
and failed only because the Terminal test had
hard-coded a user-configurable `14 pt` label. The corrected Terminal/tools
journey then passed in 1m32s; together these results cover every routine journey
with the exact staged source. The onboarding journey also passed under both the
personal `T3CodeDev` and `T3CodeTest` configurations, proving their bundle and
runner wiring. The corrected focused create-task/follow-up result passed in
35.4s and its
final visual evidence contains exactly one copy of each message. Result bundles:

- routine: `test_sim_2026-08-13T06-54-59-046Z_pid50911_628c2ff8.xcresult`;
- corrected tools: `test_sim_2026-08-13T06-59-52-892Z_pid50911_c5d24375.xcresult`;
- create/follow-up: `test_sim_2026-08-13T06-53-45-992Z_pid50911_507a04a2.xcresult`;
- Dev onboarding: `test_sim_2026-08-13T07-01-37-521Z_pid50911_68b2aa41.xcresult`;
- Test onboarding: `test_sim_2026-08-13T07-02-52-435Z_pid50911_b817dc78.xcresult`.

A separate clean-simulator run paired through the real HTTP/token exchange and
found the seeded `App Flow Regression Fixture` project. It passed in 30.6s and
retained a visually reviewed Home project-menu screenshot in
`test_sim_2026-08-13T07-19-47-371Z_pid50911_f4d00dff.xcresult`. The screenshot
showed the expected project with no loading or connection error. This verifies
Debug manual pairing and project discovery; it does not stand in for Dev, Test,
TestFlight, QR/camera, reconnect, task/message, or Apple-service checks.

## Existing fixes and current priority

Do not reopen these as new bugs until the exact Test build has been checked.
They already have fixes in the Dev/Test stream, but installation is not human
approval:

| Symptom area                                                   | Existing fix                                                                                      | Current evidence/state                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Home does not accept scrolling during cold-start metadata work | [#55](https://github.com/saphid/t3code-personal/issues/55)                                        | Test build 45, `needs-you`, installed-and-launched receipt                  |
| Ordinary Home thread-list scrolling                            | `home-thread-list-scrolling`                                                                      | Test build 41, `needs-you`                                                  |
| Initial thread open loses live updates                         | `initial-thread-live-updates`                                                                     | Test build 41, `needs-you`; deterministic initial-open and reopen journey   |
| Composer/skill menu collides with the keyboard or is too small | `skills-popup-keyboard-clearance` plus [#57](https://github.com/saphid/t3code-personal/issues/57) | Build 41 awaits approval; expanded popup is in Test build 51                |
| Retained tool errors hide recoverable content                  | `safe-tool-content-recovery`                                                                      | Test build 41, `needs-you`; this does not fix the missing sheet exit in #60 |
| Test cannot be paired conveniently                             | [#54](https://github.com/saphid/t3code-personal/issues/54)                                        | Personal Connect is in Test build 44                                        |
| Pull-request workspace/inbox is absent                         | `pull-request-workspace-protocol` plus the PR inbox feature                                       | Foundation awaits approval in build 41; inbox is in Test build 50           |
| Test feature approval must happen in app                       | [#56](https://github.com/saphid/t3code-personal/issues/56)                                        | Test build 52 is installed; deterministic exact-verdict journey added       |

The latest durable device receipts observed during this audit are Dev build 45
at `6d150260` and Test build 52 at `20fd9b7d`, both installed-and-launched. The
released TestFlight identity was not reachable from the shared Simulator, and
no current TestFlight build receipt was found in the Dev/Test stream. Its live
status therefore remains explicitly unverified rather than inferred from Test.

The next work order is therefore: restore one disposable live connection and
task/message journey in Dev/Test; capture the exact released TestFlight build
and repeat that narrow journey; then fix #60/#61's toolbar seam and reduce #62
to its minimum sequence. Apple-service, extension, notification, and iPad
coverage should follow only after the P1 live connection path is trustworthy.

Priority meanings:

- **P0:** data loss, credential exposure, or a release-wide hard stop.
- **P1:** onboarding, home navigation, task creation, or conversation is blocked.
- **P2:** an important secondary surface is broken or consistently too slow.
- **P3:** visual/accessibility polish with a usable workaround.
