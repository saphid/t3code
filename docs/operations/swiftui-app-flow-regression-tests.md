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

| Layer                    | Owns                                                                                                                                                                 | Routine oracle                                                               | Model use                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Deterministic app flow   | Launch, onboarding entry, home/search/filter, new-task workspace/model/reasoning/attachment menus, settings/connections, thread context actions, and workspace tools | Accessibility identifiers, labels, state, and a three-second response budget | Inspect retained screenshots only on failure or an intentional visual review               |
| Live Dev/Test smoke      | Pairing, server-backed project/task/message operations, reconnect, approval/input requests, real file/review/source-control/terminal data                            | Explicit state assertions against a disposable environment                   | Diagnose failures after logs, accessibility state, and screenshots have narrowed the cause |
| TestFlight release smoke | Read-only/navigation checks plus narrowly approved live mutations                                                                                                    | Human-observed release checklist with build number and timestamp             | Visual review of the release evidence; never put fixture launch arguments into Release     |

The fixture exists only in `DEBUG`. Release and TestFlight builds always compose
`NativeFeatureClient` and cannot opt into fixture state.

## Deterministic journeys

`T3CodeUITests/AppFlowUITests` currently covers:

- direct-connection onboarding through enabled manual credentials;
- home, search, project filtering, and new-task entry;
- current-checkout/new-worktree, model, reasoning, and attachment menus;
- task creation plus a follow-up message through the production composer;
- add-project and add-connection entry points without creating or deleting data;
- Settings, theme choices, connection list, and connection detail;
- the complete non-destructive thread context-menu inventory;
- thread detail plus Files, Review, Source Control, and Terminal surfaces;
- retained screenshots at the meaningful checkpoints.

The tests deliberately do not tap destructive confirmation actions, system
photo/camera/file pickers, external URLs, or buttons that would send live data.
An additional opt-in journey pairs a clean simulator to a disposable backend
and asserts that its seeded project reaches the real Home project menu.

## Run and evidence

Use the repository's iOS build-hygiene lease/wrapper when running locally, then:

```sh
T3_SWIFT_DERIVED_DATA_PATH="$LEASED_DERIVED_DATA" \
T3_SWIFT_SIMULATOR_ID="$SIMULATOR_UDID" \
./apps/swift-ios/Scripts/ci-app-flow-test.sh
```

The script prints the `.xcresult` path. Screenshots use `keepAlways`, so they
remain available even on a passing run. A routine pass should not spend model
tokens: accessibility and timing assertions own the verdict.

Known product failures are explicit tests that skip with their issue URL during
the routine pass. Run the red audit deliberately with:

```sh
T3_APP_FLOW_RUN_KNOWN_FAILURES=1 ./apps/swift-ios/Scripts/ci-app-flow-test.sh
```

Run the live transport smoke only against disposable state and a fresh,
single-use pairing token:

```sh
T3_APP_FLOW_LIVE_SERVER=http://127.0.0.1:49631 \
T3_APP_FLOW_LIVE_TOKEN='<single-use token>' \
./apps/swift-ios/Scripts/ci-app-flow-test.sh
```

Without both values, the live journey skips. The routine fixture journeys still
run, so use `-only-testing` when the intent is a focused live check.

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

The frozen routine audit contains eight programmatic journeys and three
issue-linked red audits, plus one opt-in live transport journey. On iPhone 17e / iOS 26.5, one serial run passed seven,
skipped the three known defects, and failed only because the Terminal test had
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
| Initial thread open loses live updates                         | `initial-thread-live-updates`                                                                     | Test build 41, `needs-you`                                                  |
| Composer/skill menu collides with the keyboard or is too small | `skills-popup-keyboard-clearance` plus [#57](https://github.com/saphid/t3code-personal/issues/57) | Build 41 awaits approval; expanded popup is in Test build 51                |
| Retained tool errors hide recoverable content                  | `safe-tool-content-recovery`                                                                      | Test build 41, `needs-you`; this does not fix the missing sheet exit in #60 |
| Test cannot be paired conveniently                             | [#54](https://github.com/saphid/t3code-personal/issues/54)                                        | Personal Connect is in Test build 44                                        |
| Pull-request workspace/inbox is absent                         | `pull-request-workspace-protocol` plus the PR inbox feature                                       | Foundation awaits approval in build 41; inbox is in Test build 50           |
| Test feature approval must happen in app                       | [#56](https://github.com/saphid/t3code-personal/issues/56)                                        | Test build 52 is recorded installed-and-launched                            |

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
