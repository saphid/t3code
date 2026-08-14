# Deterministic iOS delivery tooling for the T3 Code Dev/Test stream

**Research date:** 2026-08-14  
**Scope:** The private SwiftUI Test and SwiftUI Dev tracks, the upstream contribution path, and the official release boundary.  
**Method:** Primary sources only: product documentation, Apple documentation, and source repositories owned by the tool maintainers. This report does not assign calendar phases or time estimates.

## Decision

Use a normal CI/CD system as the control plane. Agents must not run routine build, test, signing, installation, evidence, or promotion steps one command at a time.

The recommended stack is:

1. **Git and fixed branch rules** for source identity and promotion.
2. **Checked-in shell entry points or Fastlane lanes** for every repeated operation.
3. **Xcode schemes, Test Plans, `xcodebuild`, and `.xcresult`** as the native build and test core.
4. **Buildkite with one self-hosted Mac agent** as the private pre-upstream pipeline. Use a concurrency group of one for the Simulator, signing keychain, and physical phone.
5. **XCTest and XCUITest** for unit, integration, semantic UI, and release-oracle tests.
6. **Maestro CLI** for readable black-box happy paths and regression journeys on iOS Simulator.
7. **`simctl`** for Simulator life cycle and raw capture. Use **Meta `idb` only for a declared HID gesture that the normal tools cannot perform**.
8. **The existing deterministic proof-media renderer** for clean and annotated evidence. It must render tap pulses, swipe paths, `Next:` captions, and `Expected:` captions from test metadata.
9. **Two separate signed phone apps**: SwiftUI Test first, then SwiftUI Dev. They must use separate bundle identifiers and data containers.
10. **GitHub Actions only after the change enters the upstream contribution path.** Do not make a personal Test or Dev promotion depend on GitHub Actions.
11. **Fastlane or the existing upstream EAS service for protected release mechanics**, based on the product line. Apple or upstream maintainer authority remains a manual gate.

This design uses agents for diagnosis and judgment. It uses deterministic programs for mechanics.

## “Basil” and the linked X post

“Basil” is probably a speech-to-text rendering of **Bazel**. Bazel is a build and test system with declared action inputs and outputs, local and remote caches, and remote execution support. Its remote cache uses an action cache and a content-addressable store ([Bazel remote-cache documentation](https://bazel.build/remote/caching)). The Apple rules build and bundle iOS applications, while `rules_swift` compiles Swift code ([rules_apple](https://github.com/bazelbuild/rules_apple), [rules_swift](https://github.com/bazelbuild/rules_swift)). This is an inference, not a confirmed transcription.

The supplied [X post](https://x.com/Nal_uh/status/2088051249044504967?s=20) is directly relevant. Its page data describes an iOS workflow with sub-two-second incremental Bazel builds, no checked-in Xcode project, an agent-created REST control interface, end-to-end exploration, multi-account coverage, and real-device operation.

The useful idea is not “let an agent invent every test.” The useful idea is to give automation a semantic control surface and a fast, reproducible build graph. A release gate still needs named scenarios, stable fixtures, assertions, and stored results. Agent exploration can discover a failure. It must then produce a deterministic regression test.

Do not copy the “no Xcode project” part as a goal by itself. Xcode projects, Bazel graphs, and generated projects are implementation choices. Build speed, repeatability, test coverage, debugging quality, and maintenance cost are the decision criteria.

## Current local inventory

The private SwiftUI stream is more complete than a greenfield pipeline. Preserve these parts.

| Capability | Current evidence | Decision |
| --- | --- | --- |
| Dev and Test branch rules | `docs/operations/swiftui-dev-test-stream.md` defines upstream, Dev, Test, Candidate, promotion, and rejection rules. | Keep. Make the CI pipeline enforce them. |
| Separate phone checkpoints | `T3CodeTest` and `T3CodeDev` have separate configurations, bundle identifiers, URL schemes, data containers, build counters, ready pointers, and signed artifacts. | Keep. Treat Test and Dev as separate protected resources. |
| Immutable phone artifacts | `scripts/swiftui-stream/build-ready.sh` verifies branch, commit, build, channel, bundle identifiers, extensions, signature, and artifact hash. | Keep. Wrap it as one pipeline step. |
| Token-free phone installation | The LaunchAgent watcher verifies the ready pointer, signature, hash, sequence, installation, and launch. It writes device receipts and resumes after device lock or disconnection. | Keep. Do not replace it with agent polling. |
| Stream status and drift checks | `stream.py`, receipts, the drift monitor, and branch ancestry checks exist. | Keep. Make their output the admission gate for each job. |
| Unit and contract tests | `apps/swift-ios/Scripts/ci-test.sh` runs the `T3CodeTests` target on one Simulator. The project contains a substantial native test suite. | Keep, then split it into named Test Plans. |
| Visual proof tooling | Raw capture, clean and annotated derivatives, hashes, and playback checks already exist in skills and receipts. | Keep. Drive overlays from a structured action manifest. |
| App-flow regression work | A proved Candidate receipt records eight passing deterministic journeys and retained `.xcresult` bundles. It remains blocked from integration by native-resource cleanup. | Reconcile and land it before creating another UI harness. |

The main gaps are ordinary pipeline gaps:

- No Buildkite pipeline or equivalent private CI scheduler exists.
- No Fastfile, pinned Fastlane bundle, Bazel graph, Tuist manifest, Maestro suite, or checked-in Test Plan exists in the inspected SwiftUI branch.
- The Xcode project does not enable Xcode 26 compilation caching.
- `ci-test.sh` does not set `-resultBundlePath`, use `build-for-testing`, or reuse test products with `test-without-building`.
- The inspected branch has one unit-test target and no integrated UI-test target. The app-flow Candidate exists as receipt evidence, not as accepted branch truth.
- The current local resource leases prevent unsafe overlap but do not provide a visible queue, job history, or artifact view.
- The existing SwiftUI GitHub workflow is suitable for an upstream PR. The private Dev/Test stream must not depend on it or create a pre-upstream GitHub Actions gate.

The private SwiftUI app and the Expo/React Native app are different product lines. The SwiftUI project is a committed native Xcode project with one external Swift package and native extensions. The Expo line uses generated native projects and EAS. Do not force one build system onto both.

## What must be deterministic

| Operation | Deterministic owner | Agent or human role |
| --- | --- | --- |
| Create a worktree and branch | A checked-in command validates the base SHA and creates the named branch. | An agent or person selects the work item and branch name. |
| Select tests | A path-to-test catalog, Xcode Test Plan, test tags, or a dependency-graph tool selects the suite. | An agent updates the catalog when the product structure changes. |
| Build | `xcodebuild build-for-testing`, `build`, or `archive` with pinned inputs. | An agent diagnoses a failed command. |
| Run unit and integration tests | `xcodebuild` and XCTest/Swift Testing. | An agent writes or repairs tests. |
| Run user journeys | XCUITest and checked-in Maestro YAML flows. | A person defines acceptance intent. An agent can author or repair a flow. |
| Start and reset Simulator | A script uses one explicit device identifier and owned cleanup. | An agent investigates Simulator infrastructure failures. |
| Create evidence | The test runner emits action/assertion events. The media renderer creates clean and annotated files from one manifest. | A person reviews the result. An agent explains an unexpected state. |
| Sign and install SwiftUI Test | A lane builds one exact Test SHA, signs it, installs it, launches it, and writes a receipt. | A human unlocks the phone when required. |
| Accept a feature | The system presents the exact feature, SHA, tests, and proof. | Alex approves or rejects it. No tool or agent substitutes for this verdict. |
| Promote to SwiftUI Dev | A lane verifies the approved set, makes the defined Git operation, runs the Dev gate, signs, installs, and records the result. | Alex authorizes promotion. An agent resolves conflicts only when requested. |
| Prepare an upstream contribution | Git commands create the contribution branch from the current owner tip. | An agent decides how to re-express the personal change and prepares the PR text. |
| Upstream checks | GitHub Actions starts only after the upstream branch or PR exists. | Agents classify and repair actionable failures. Maintainers approve and merge. |
| Official release | A protected release job archives, signs, uploads, and records the exact SHA and build number. | Upstream maintainers and Apple roles control release authority. |

Agents are suitable for ambiguity: defect diagnosis, test design, review, merge-conflict judgment, dependency updates, and pipeline repair. Agents are not suitable as the scheduler, retry loop, artifact store, lock manager, or routine command runner.

## The private pipeline

```text
Feature branch from current SwiftUI Dev
  -> deterministic focused checks
  -> build-for-testing once
  -> unit + integration + selected XCUITest/Maestro flows
  -> raw + clean + annotated proof
  -> integrate the compatible candidate set into SwiftUI Test
  -> full Test regression
  -> sign/install/launch SwiftUI Test on the phone
  -> human feature verdicts
  -> promote only approved work to SwiftUI Dev
  -> full Dev regression
  -> sign/install/launch SwiftUI Dev on the phone
  -> final human verification
  -> create a clean upstream contribution branch
  -> open upstream PR
  -> GitHub Actions and maintainer review
  -> protected official build and TestFlight release
```

Each arrow is a program with a documented input, output, exit status, and receipt. It is not a new agent prompt.

## The two phone checkpoints

### SwiftUI Test

SwiftUI Test is the unstable acceptance app. It receives the cumulative candidate train first.

- Use a Test-only bundle identifier, display name, icon treatment, URL scheme, and app data container.
- Build from the exact SwiftUI Test commit. Record the source SHA, build number, Xcode version, signing identity, provisioning profile, bundle identifier, device identifier, artifact hash, installation result, and launch result.
- Keep the prior signed Test artifact so rollback is an installation, not a rebuild.
- Present verdicts per feature even when several compatible candidates are in one Test build.
- A Test failure must never overwrite SwiftUI Dev or its data.

Apple provisioning profiles bind app installation authority to certificates, device identifiers, and a bundle ID ([Apple profile API](https://developer.apple.com/documentation/appstoreconnectapi/profiles)). Apple supports direct testing on registered devices through development or Ad Hoc provisioning ([registered-device distribution](https://developer.apple.com/documentation/Xcode/distributing-your-app-to-registered-devices), [Ad Hoc profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/)).

### SwiftUI Dev

SwiftUI Dev is the stable personal app and the fallback control surface for T3 Code.

- Use a Dev-only bundle identifier and data container.
- Do not install arbitrary feature branches into this app.
- Accept only the approved set from SwiftUI Test.
- Run the complete Dev gate before installation.
- Preserve the prior signed Dev artifact and receipt until the new Dev build passes final phone verification.
- If the new Dev build cannot launch or connect, reinstall the prior Dev artifact. SwiftUI Test remains available for diagnosis.

The two apps solve two separate risks. SwiftUI Test absorbs unstable candidate risk. SwiftUI Dev remains a usable control surface if a candidate breaks T3 Code on the phone.

### Phone installation command

Use Apple's `devicectl` as the normal scripted phone interface. A pinned wrapper must list the exact device, install the signed `.app`, launch its bundle identifier, request JSON output, preserve the real exit status, and write the device receipt. Apple documents `devicectl` as the command-line tool for device management, app installation, diagnostics, and CI integration ([Apple Device Hub and `devicectl`](https://developer.apple.com/videos/play/wwdc2026/260/)). Use Xcode's graphical device window only as a manual recovery path.

## Native build and test core

### Xcode schemes and Test Plans

Use Xcode Test Plans for named gates, not agent-generated command lists. Apple supports separate plans for a focused module, complete integration checks, and pre-release tests. Xcode 16 and later can include or exclude Swift Testing tags such as priority, kind, cadence, feature area, and dependency ([Apple Test Plan guide](https://developer.apple.com/documentation/xcode/organizing-tests-to-improve-feedback)).

Recommended plans:

| Plan | Contents | Required gate |
| --- | --- | --- |
| `Focused` | Tests selected for the changed targets plus contract and static checks. | Every feature commit before Simulator proof. |
| `CandidateJourneys` | Critical happy paths, fixed regressions, accessibility assertions, and changed-feature flows. | Before Test integration. |
| `TestTrain` | Full unit/integration suite plus the supported Simulator journey matrix. | Before a SwiftUI Test phone install. |
| `DevPromotion` | Full TestTrain plus backup-connectivity, migration, launch, and rollback smoke tests. | Before a SwiftUI Dev phone install. |
| `UpstreamPR` | Fork-safe tests without personal credentials, phone state, or private endpoints. | After the upstream PR exists. |
| `OfficialRelease` | Trusted full suite, archive validation, entitlement checks, and release smoke tests. | Only on an authorized upstream SHA. |

Apple recommends many fast unit tests, fewer integration tests, and fewer UI tests because UI tests provide high fidelity but have more runtime variables ([Apple testing overview](https://developer.apple.com/documentation/xcode/testing)).

### Build once and test many times

Use `xcodebuild build-for-testing` once for an exact source and toolchain fingerprint. Reuse its `.xctestproducts` bundle with `xcodebuild test-without-building` for several Simulator destinations or test selections. Apple documents this split and warns that build and runner systems must use the same Xcode version ([Apple Testing in Xcode](https://developer.apple.com/videos/play/wwdc2019/413/), [Xcode 13.3 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-13_3-release-notes)).

Every invocation must set `-resultBundlePath`. The resulting `.xcresult` contains structured build, test, coverage, log, and attachment data and can be inspected with `xcresulttool` ([Apple result-bundle documentation](https://developer.apple.com/documentation/xcode/running-tests-and-interpreting-results), [Xcode 11 release notes](https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-11-release-notes)). Store the `.xcresult`, not only formatted console text.

### Selective tests

Use these layers in this order:

1. Xcode Test Plans and test tags.
2. A checked-in changed-path to target/test-plan map.
3. `-only-testing` for a named test or suite. Apple documents the test identifier format and command option ([running tests](https://developer.apple.com/documentation/xcode/running-tests-and-interpreting-results)).
4. `build-for-testing` plus `test-without-building` so test selection does not trigger another compile.
5. A Tuist selective-testing pilot if test execution is still a material bottleneck.

Tuist calculates target hashes from target attributes, files, and dependency hashes ([Tuist hashing](https://docs.tuist.dev/en/guides/features/projects/hashing)). Its selective-testing feature runs tests affected since the last successful run and can wrap an existing Xcode project through `tuist xcodebuild test`; its maximum safe granularity is the target because it cannot detect every in-code dependency ([Tuist selective testing](https://tuist.dev/en/docs/guides/features/selective-testing)). Therefore, run a complete TestTrain and DevPromotion plan at promotion boundaries even when focused selection passes.

Do not use a model to guess the tests on every run. An agent may propose a catalog change. A reviewed catalog or dependency graph must make the routine selection.

## User-flow automation and proof

### XCTest and XCUITest

Keep XCUITest as the semantic UI and release oracle. It is part of Xcode, controls the app through XCUIAutomation, produces attachments in `.xcresult`, and can record screenshots or video as configured by the Test Plan ([Apple testing overview](https://developer.apple.com/documentation/xcode/testing), [Xcode 15 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-15-release-notes)).

Use stable accessibility identifiers and deterministic fixtures. Do not use image coordinates when a semantic control exists.

### Maestro

Use Maestro for readable black-box flows that product reviewers can understand. Maestro flows are YAML. The CLI supports commands such as `launchApp`, `tapOn`, `swipe`, `assertVisible`, `takeScreenshot`, `startRecording`, and `stopRecording` ([Maestro command reference](https://docs.maestro.dev/api-reference/commands)). On iOS, Maestro works through the accessibility layer and runs against an iOS Simulator `.app` ([Maestro iOS guide](https://docs.maestro.dev/getting-started/build-and-install-your-app/ios)).

Maestro must not replace focused unit tests or the XCUITest release oracle. Use it for critical happy paths, past regression journeys, permissions, system dialogs, deep links, and cross-app flows. Keep dynamic JavaScript out of ordinary flows unless a deterministic fixture cannot supply the data.

### Meta `idb`

`idb` has a macOS companion and a client. It exposes small Simulator/device automation primitives and supports remote target control and Simulator pools ([Meta `idb` repository](https://github.com/facebook/idb)). Maestro can use `idb` to reach iOS Simulators in self-managed CI ([Maestro CI guide](https://docs.maestro.dev/getting-started/running-flows-in-the-cloud)).

Do not make `idb` the normal accessibility or test driver. This project has already found a narrow useful case: a stepped HID drag. Put that operation behind a pinned wrapper with an explicit UDID, timeout, nonzero error status, deterministic postcondition, and receipt. If the standard driver can perform the gesture, do not call `idb`.

### Visual proof

The proof pipeline must remain deterministic:

1. The test runner records a raw video and an action/assertion manifest from one monotonic clock.
2. Each tap event includes time, target, and normalized location.
3. Each swipe event includes start time, end time, path, action text, and expected result.
4. The renderer creates matched clean and annotated video from the same edit decision list.
5. The annotated output shows an expanding tap pulse, an animated swipe path, `Next:` text before the action, and `Expected:` text for the assertion.
6. The renderer creates poster frames, contact sheets, media hashes, and a receipt.
7. The pipeline fails if captions are clipped, action overlays are outside the content area, an expected event was cut, or the clean and annotated outputs differ in duration.

FFmpeg provides machine-driven trim, timestamp, concat, overlay, and freeze-detection filters ([FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html)). `ffprobe` can emit machine-readable JSON for stream validation ([ffprobe documentation](https://ffmpeg.org/ffprobe.html)). These operations do not need a model.

## Private CI orchestrator

### Recommended: Buildkite on the existing Mac

Buildkite is the best match for the private lane because its agent can run on owned hardware while the service schedules jobs and stores results. Buildkite also offers managed macOS agents, but those are a Pro or Enterprise feature ([Buildkite macOS agents](https://buildkite.com/docs/agent/buildkite-hosted/macos)).

Use one queue and these resource groups:

```yaml
native-build:        concurrency 1
ios-simulator:       concurrency 1
swiftui-test-phone:  concurrency 1
swiftui-dev-phone:   concurrency 1
apple-signing:       concurrency 1
```

Buildkite concurrency groups act as organization-wide queues and can guarantee a limit of one for shared resources ([Buildkite concurrency](https://buildkite.com/docs/pipelines/configure/workflows/controlling-concurrency)). This replaces the current mix of agent-held leases, process scans, and ad hoc waiting with a visible scheduler.

Upload `.xcresult`, `.xctestproducts`, app/IPA artifacts, receipts, screenshots, videos, and logs as build artifacts. Buildkite artifacts can pass files between steps and retain final logs, reports, archives, and images ([Buildkite artifacts](https://buildkite.com/docs/guides/artifacts)).

Do not start with parallel iOS Simulator jobs on one Mac. When isolated runners exist, Buildkite can split long test suites using historical timing data and track flaky tests ([Buildkite test splitting](https://buildkite.com/docs/pipelines/speed-up-builds-with-bktec), [Test Engine](https://buildkite.com/docs/pipelines/configure/tests)). First prove that every shard has an isolated Simulator, DerivedData path, test result path, service port range, and cleanup owner.

### Alternative: Bitrise

Bitrise is a sound hosted alternative when Mac management is unwanted. Its iOS steps can run Xcode tests, build for testing, and produce unsigned Simulator apps ([Bitrise iOS testing](https://devcenter.bitrise.io/en/testing/testing-ios-apps.html)). Bitrise also offers dependency caching and an Xcode compilation cache ([Bitrise dependency and cache overview](https://docs.bitrise.io/en/bitrise-ci/dependencies-and-caching/dependencies-and-caching-overview)).

Do not adopt Bitrise and Buildkite together for the same private lane. That would duplicate workflow definitions and evidence. Choose Bitrise only if the self-hosted Mac agent is too costly to maintain or if hosted Mac isolation is required.

### Xcode Cloud

Xcode Cloud can build, run tests in parallel, and distribute builds through TestFlight. Apple integrates its results with Xcode and App Store Connect ([Xcode Cloud](https://developer.apple.com/xcode-cloud/)). It can archive and upload an internal TestFlight build as a workflow post-action ([Xcode Cloud TestFlight distribution](https://developer.apple.com/documentation/xcode/distributing-your-xcode-cloud-builds-through-testflight)).

Use Xcode Cloud only where the upstream owner approves the source connection, workflow, credentials, and TestFlight group. It is a good official-release option. It is not required for the private SwiftUI Test and SwiftUI Dev phone loop.

### GitHub Actions

GitHub Actions begins at the upstream PR boundary. Before that boundary, Buildkite and local scripts own the private gates. Upstream Actions must be fork-safe and must not receive Apple signing credentials on an untrusted PR.

Use GitHub concurrency controls for official release or deployment jobs so two releases cannot mutate the same destination at once ([GitHub Actions concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)). Upstream repository checks remain upstream maintainer policy, not a substitute for the private phone verdicts.

## Build system and cache decision

### Bazel: do not migrate yet

Bazel provides the strongest deterministic build graph in this comparison. It declares action inputs and outputs, computes content hashes, reuses local or remote results, and supports remote execution ([Bazel remote caching](https://bazel.build/remote/caching), [remote execution](https://bazel.build/docs/remote-execution)). `rules_apple` can create iOS applications, tests, IPAs, and Xcode archives ([rules_apple API](https://registry.bazel.build/docs/rules_apple)). `rules_xcodeproj` generates Xcode projects with indexing, debugging, test selection, previews, and focused targets ([rules_xcodeproj](https://github.com/MobileNativeFoundation/rules_xcodeproj)).

However, Bazel is not a CI scheduler, phone installer, signing authority, or TestFlight service. Adopting it requires a second build graph, BUILD files, Apple/Swift rules, Xcode-project generation, dependency integration, and version compatibility management. The `rules_apple` maintainers state that Bazel changes often require matching `rules_apple` and `rules_swift` updates ([rules_apple compatibility](https://github.com/bazelbuild/rules_apple#supported-bazel-versions)).

The private SwiftUI project is a more plausible Bazel candidate than the Expo app. It is a native project with an app, tests, widgets, a share extension, and one external Swift package. A Bazel pilot can represent those targets with `rules_swift`, `rules_apple`, and `rules_xcodeproj`.

That feasibility does not establish value. The project has no recorded build benchmark that proves compilation is the dominant delay. Xcode 26 compilation caching is available but not enabled in the inspected project ([Xcode 26 release notes](https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-26-release-notes), [build setting](https://developer.apple.com/documentation/xcode/build-settings-reference#Enable-Compilation-Caching)). The current test command also rebuilds instead of using build-once/test-many. Apply and measure those lower-cost controls first.

The separate Expo/React Native product uses generated native projects, native modules, and EAS ([mobile README](../../apps/mobile/README.md), [mobile package](../../apps/mobile/package.json), [EAS configuration](../../apps/mobile/eas.json)). A Bazel migration for that product would be a product-platform project, not a pipeline clean-up. Do not make SwiftUI Bazel adoption contingent on moving the Expo line.

Adopt Bazel only if measurements show that native compilation remains the dominant delay after build-once/test-many, fixed Test Plans, dependency caching, and ordinary Xcode caching. Require a proof that a small representative target has:

- the same app behavior and entitlements;
- the same unit and UI test coverage;
- stable Xcode debugging and previews;
- reproducible local and CI outputs;
- a measured cache-hit benefit; and
- one source of truth, not a permanently divergent Xcode and Bazel graph.

### Tuist: lower-risk performance pilot

Tuist is closer to the current Xcode workflow. It can generate focused projects, cache modules as `.xcframework` binaries, and select tests by target hashes ([Tuist module cache](https://docs.tuist.dev/en/guides/features/cache/module-cache), [Tuist selective testing](https://tuist.dev/en/docs/guides/features/selective-testing)). Tuist also supports Xcode's compilation cache across machines ([Tuist Xcode cache](https://docs.tuist.dev/en/guides/features/cache/xcode-cache)).

Run Tuist as an evidence-based pilot, not a mandatory foundation. Compare clean build, warm build, focused test, full test, cache correctness, debugging, and maintenance cost. Keep a complete promotion plan because selective execution cannot prove dependencies that its target graph does not express.

### Cache policy

Use these cache rules for every provider:

- The cache key includes source/dependency fingerprint, Xcode version, SDK version, architecture, build configuration, relevant environment, and build-system version.
- Untrusted feature jobs may read trusted caches but must not publish release caches.
- Only a clean trusted branch job writes the shared promotion/release cache.
- Signed app artifacts are immutable artifacts, not cache entries.
- Never share mutable DerivedData paths between active jobs.
- A cache miss runs the build. It is not a failure.
- A suspected poisoned cache triggers a no-cache rebuild and comparison.

Bazel warns that environment leakage, tools outside the workspace, concurrent input changes, and uncontrolled cache writers can produce misses or invalid results ([Bazel remote-cache known issues](https://bazel.build/remote/caching)). Expo gives similar guidance: shared actors can unintentionally share cache artifacts, and trusted jobs should publish clean caches ([EAS caching](https://docs.expo.dev/build-reference/caching/)).

## Repeated mechanics: Fastlane

Use Fastlane as a versioned command layer, not as the source of business policy.

Recommended lanes:

```text
verify_focused
build_test_products
run_candidate_journeys
build_swiftui_test
install_swiftui_test
build_swiftui_dev
install_swiftui_dev
archive_official
upload_testflight
```

Fastlane `run_tests` wraps Xcode test execution and supports build-for-testing and test-without-building ([Fastlane `run_tests`](https://docs.fastlane.tools/actions/run_tests/)). `build_app`/`gym` builds and signs the application, while `upload_to_testflight`/`pilot` uploads to TestFlight ([Fastlane actions](https://docs.fastlane.tools/actions/), [TestFlight action](https://docs.fastlane.tools/actions/testflight/)). Pin Fastlane in a `Gemfile.lock`; do not install an arbitrary latest version during a release.

Do not adopt `match` merely because Fastlane provides it. `match` centralizes certificates and profiles in Git, Google Cloud, or S3 and can repair expired assets ([Fastlane match](https://docs.fastlane.tools/actions/match/)). For one controlled Mac, Xcode automatic signing or a dedicated local keychain is simpler. Consider `match` only when several build Macs must share the same identity. Use read-only mode in routine CI and protect the storage encryption secret.

For official upload, prefer a narrowly scoped App Store Connect API key. Apple API keys are role-based and revocable ([App Store Connect API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api)). Apple supports Xcode, Transporter, `altool`, or the App Store Connect API for build upload, and the build still requires Apple-side processing ([Apple build upload](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)).

## Expo/EAS boundary

The checked-out upstream mobile product already uses Expo and EAS. EAS Build is a hosted build service for Expo and React Native. It supports build profiles, internal distribution, signing credentials, build reuse, and EAS Submit ([EAS Build](https://docs.expo.dev/build/introduction/)). EAS Submit uploads an iOS IPA to App Store Connect and can assign TestFlight groups ([EAS Submit](https://docs.expo.dev/submit/ios/), [EAS workflow syntax](https://docs.expo.dev/eas/workflows/syntax/)).

Preserve EAS for the Expo/React Native line unless upstream deliberately replaces it. Do not force the private native SwiftUI acceptance stream through EAS only to make all mobile builds look alike. The two lines can share receipt fields and release gates without sharing the same build implementation.

## Required pipeline contract

Every job must emit one machine-readable receipt with at least:

```yaml
schema: t3-ios-job/v1
job_id: immutable-id
stage: focused|candidate|test-train|test-phone|dev-promotion|dev-phone|upstream-pr|release
source:
  repository: canonical-url
  commit: full-sha
  base_commit: full-sha
toolchain:
  macos: exact-version
  xcode: exact-version
  swift: exact-version
build:
  scheme: name
  configuration: name
  test_plan: name
  fingerprint: sha256
  artifact_sha256: sha256
tests:
  selected: [stable-identifiers]
  passed: number
  failed: number
  skipped: number
  xcresult_sha256: sha256
device:
  kind: simulator|phone
  identifier: exact-id
  bundle_id: exact-bundle-id
  install_exit: integer
  launch_exit: integer
proof:
  raw_sha256: sha256
  clean_sha256: sha256
  annotated_sha256: sha256
authority:
  requested_by: identity
  verdict: pending|approved|rejected|not-required
result:
  status: passed|failed|blocked|infrastructure-failed
  exit_code: integer
```

The CI UI is a projection of these receipts. The receipt store is the durable evidence. A job is not green because an agent said it looked green.

## Failure classes and automatic action

| Failure | Automatic response | Agent involvement |
| --- | --- | --- |
| Compile, test, assertion, or journey failure | Stop. Retain artifact and evidence. Do not promote. | Diagnose when requested. |
| Simulator boot or test-manager failure | One owned reset and one retry. Preserve both attempts. | Investigate if the retry fails. |
| Signing or profile failure | Stop before installation. Do not regenerate identities without authority. | Explain the exact missing asset or permission. |
| Phone locked or unavailable | Mark `blocked-device`; keep the signed artifact ready. | No diagnosis unless the device remains unavailable. |
| Cache miss | Build normally. Record miss. | None. |
| Suspected cache corruption | Run one no-cache comparison. Quarantine the cache on mismatch. | Diagnose the differing inputs. |
| Proof renderer failure | Keep raw capture. Do not claim visual proof. | Repair renderer or manifest. |
| GitHub Actions unavailable before upstream | Irrelevant. The private pipeline continues without it. | None. |
| Upstream check infrastructure failure | Classify separately from product failure. | Report and repair only if the project owns it. |
| Human rejection | Preserve evidence and move the feature back to its branch. Do not promote it to Dev. | Implement the requested correction in a new candidate. |

Retries must be explicit and bounded. A retry must never replace the first failure evidence.

## Adoption gates

Use conditions, not dates.

1. **Codify entry points.** Exit when one command can run each existing build, test, Simulator, evidence, Test-phone, and Dev-phone operation with a real exit status.
2. **Add structured receipts.** Exit when every command writes the common schema and artifact hashes.
3. **Install Buildkite scheduling.** Exit when jobs queue visibly and the native resource concurrency group prevents overlapping Xcode, Simulator, signing, or phone work.
4. **Move routine flows to Test Plans and Maestro/XCUITest.** Exit when a clean machine can run the named gates without an agent deciding the next command.
5. **Automate proof media.** Exit when the same journey produces raw, clean, and annotated evidence with visible taps, swipes, and expectation captions.
6. **Enforce the two phone apps.** Exit when SwiftUI Test and SwiftUI Dev install side by side, have separate data, retain rollback artifacts, and each launch receipt names the exact commit.
7. **Enforce the upstream boundary.** Exit when no personal promotion waits for GitHub Actions and no GitHub Action receives private phone or signing authority from an untrusted PR.
8. **Measure before adding build-system complexity.** Exit when collected receipts show where time is spent. Pilot Tuist only if compile or test selection is material. Pilot Bazel only if the remaining build cost justifies a build-graph migration.

## Main risks

1. **Two sources of truth.** A second generated project or Bazel graph can drift from Xcode. Require generation and drift checks before adoption.
2. **Cache poisoning.** Limit writers, hash the toolchain, and run no-cache comparisons when results conflict.
3. **Signing authority leakage.** Keep Apple credentials out of feature and fork PR jobs. Use separate protected queues and keychains.
4. **False confidence from selective tests.** Run full TestTrain and DevPromotion plans at promotion boundaries.
5. **Flaky UI retries hiding defects.** Retain first-failure evidence. Quarantine only with an owned repair item.
6. **SwiftUI Test damaging the backup.** Separate bundle identifiers and containers. Never install a candidate with the Dev identity.
7. **Private workflow dependence on GitHub.** Buildkite and local artifacts must continue when GitHub-hosted jobs are unavailable.
8. **CI as a new bespoke product.** Prefer Fastlane, Xcode, Buildkite, Maestro, and standard artifact APIs. Keep custom code limited to T3-specific receipts, promotion rules, fixtures, and proof annotations.

## Final recommendation

Do not start with Bazel. Start by turning the existing good mechanics into a Buildkite pipeline that calls pinned Fastlane or shell entry points. Use Xcode Test Plans, build once, test without rebuilding, and store `.xcresult` and signed artifacts. Use Maestro for readable Simulator journeys. Keep XCUITest as the semantic oracle. Use Meta `idb` only for the one gesture gap. Generate visual proof without a model. Install the cumulative train to SwiftUI Test, obtain human verdicts, promote approved work to SwiftUI Dev, and verify the stable backup on the phone. Only then create the upstream PR and start GitHub Actions.

Collect timings and cache evidence from that ordinary pipeline. If compilation still dominates, pilot Tuist. Consider Bazel only after the pilot proves that a build-graph migration provides enough measured benefit to justify its maintenance cost.
