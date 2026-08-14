# T3 Code (SwiftUI)

A native SwiftUI client for T3 Code. The project targets iOS 17 and later on
iPhone and iPad. It has its own bundle identifier and can be installed beside the
React Native T3 Code app.

## Requirements

- A current Xcode release with an iOS Simulator runtime.
- iOS 17 or later for physical-device builds.
- A T3 pairing URL for direct connections. T3 Connect builds additionally need
  the cloud settings below.

## Open

Open `T3Code.xcodeproj`, choose the `T3Code` scheme, and run an installed iOS
Simulator. Xcode automatically includes files added below `App`, `Core`,
`Features`, `DesignSystem`, and `Resources`; `Info.plist` is the one resource
excluded from copying because it supplies the target's generated Info.plist.

Pair with the same URL produced by a T3 server. The one-time pairing credential is
exchanged for an access token and stored in the Keychain. Environment metadata and
the active selection are stored separately in Application Support.

## Structure

- `App` owns the app lifecycle and the thin root composition seam.
- `Core` owns persistence, credentials, transport, and the T3 protocol.
- `Features` owns onboarding, environments, threads, messages, and settings.
- `DesignSystem` contains the small set of shared visual tokens.
- `Resources` contains the asset catalog.
- `Tests` covers pairing, wire contracts, persistence, and feature state changes.
- `UITests` drives deterministic app-flow and menu journeys through the production
  SwiftUI hierarchy and retains screenshots in the result bundle.

`RootView` deliberately accepts any SwiftUI content. Production composition injects
`FeatureRootView(client:)` there, keeping protocol adapters out of the UI shell.

## Included

- Local-network preflight, direct pairing links, QR scanning, token exchange,
  Keychain credentials, saved environment management, and optional T3 Connect
  account and relay discovery.
- A merged Web V2 home across saved environments, with per-device reachability,
  collision-safe identities, last-known rows, live active-device updates, and
  low-frequency passive refresh.
- Remote filesystem browsing, source discovery, repository cloning, project
  creation, plus thread search, creation, rename, archive, restore, delete,
  settle, and snooze.
- Provider/model selection, paginated synchronized conversation history, rich Markdown,
  photo/camera/file image attachments, turn cancellation, approval decisions, and
  structured user-input requests.
- Workspace files and previews, working-tree review, Git status and common actions,
  plus Ghostty-rendered terminal sessions with VT/ANSI output, scrollback, hardware
  and software keyboard controls, and per-thread session switching.
- Native settings with persisted appearance and behavior preferences, platform
  deep links, shortcuts, background refresh, and notification routing.
- A Share extension that imports text, URLs, and images into persistent project
  drafts, plus Home Screen widgets and aggregate Live Activities for active work.
- DPoP-bound T3 Connect sessions with account-scoped relay credentials, APNs
  device registration on iOS 18+, and automatic credential recovery.

The app speaks the existing HTTP and Effect RPC WebSocket contracts directly. It
does not embed a JavaScript runtime.

## Build configuration

The project expands these user-defined Xcode build settings into its generated
Info.plist:

| Setting                        | Required        | Purpose                                         |
| ------------------------------ | --------------- | ----------------------------------------------- |
| `T3CODE_CLERK_PUBLISHABLE_KEY` | T3 Connect only | Clerk publishable key.                          |
| `T3CODE_CLERK_JWT_TEMPLATE`    | No              | Relay JWT template; defaults to `t3-relay`.     |
| `T3CODE_RELAY_URL`             | T3 Connect only | Relay base URL using HTTPS.                     |
| `DEVELOPMENT_TEAM`             | Device/archive  | Apple Developer team used by automatic signing. |
| `MARKETING_VERSION`            | Release         | User-facing version.                            |
| `CURRENT_PROJECT_VERSION`      | Release         | Monotonically increasing build number.          |

Unset T3 Connect values disable that connection method without affecting direct
pairing. Supply settings on the `xcodebuild` command line or through a local
`.xcconfig`; do not commit private release configuration.

The upstream configurations remain available. Alex's personal workflow adds
separate Dev and Test schemes so both personal builds can remain installed
beside each other and beside TestFlight:

| Scheme / configuration | Display name    | Bundle identifier                   | URL scheme                    |
| ---------------------- | --------------- | ----------------------------------- | ----------------------------- |
| T3CodeDev / Dev        | SwiftUI Dev     | `com.saphid.t3code.swiftui.dev`     | `t3code-swiftui-personal-dev` |
| T3CodeTest / Test      | SwiftUI Test    | `com.alxs.t3code.typed-swiftui.dev` | `t3code-swiftui-personal`     |
| T3Code / Debug         | T3 Swift Dev    | `com.t3tools.t3code.swiftui.dev`    | `t3code-swiftui-dev`          |
| T3Code / Release       | T3 Code SwiftUI | `com.t3tools.t3code.swiftui`        | `t3code-swiftui`              |

Each personal identity has matching widget and share-extension bundle
identifiers, a separate App Group, a distinct icon, and an in-app channel suffix.
Dev and Test data, credentials, share inboxes, and widgets are isolated. The
complete branch, promotion, build, phone-watcher, and upstream-PR rules live in
`../../docs/operations/swiftui-dev-test-stream.md`.

## Verify

Run the `T3Code` scheme's tests in Xcode, or use the repository entry point. A
local run chooses an available iPhone from the newest installed Simulator
runtime; CI creates an iPhone 17 Pro on iOS 26.5 and selects Xcode 26.6:

```sh
./Scripts/ci-test.sh
```

Set `T3_SWIFT_SIMULATOR_ID` to pin a specific simulator. CI can invoke this same
entry point without duplicating the simulator-selection or signing policy. The
script uses `build-for-testing` and `test-without-building`. It always writes an
`.xcresult` under `.t3/evidence`, unless `T3_SWIFT_RESULT_BUNDLE_PATH` selects an
unused path. Set `T3_SWIFT_REUSE_TEST_PRODUCTS=1` only for a source-bound
`.xctestproducts` directory with its generated manifest.

The shared Xcode Test Plans define the deterministic gate, while the app-flow
catalog selects the exact UI journeys inside that gate:

| Xcode Test Plan    | Test targets                 | Owner and use                         |
| ------------------ | ---------------------------- | ------------------------------------- |
| Focused            | Native unit tests            | Candidate-focused checks              |
| CandidateJourneys  | Deterministic UI journeys    | One feature or fix                    |
| TestTrain          | Native unit and UI tests     | SwiftUI Test integration              |
| DevPromotion       | Native unit and UI tests     | SwiftUI Dev promotion                 |
| UpstreamPR         | Native unit and UI tests     | Upstream pull request                 |
| OfficialRelease    | Native unit and UI tests     | Authorized upstream release candidate |

`T3CodeTest` defaults to `TestTrain`. `T3CodeDev` defaults to `DevPromotion`.
The upstream `T3Code` scheme defaults to `UpstreamPR`. Set
`T3_SWIFT_XCODE_TEST_PLAN` to choose another plan at a controlled gate.
Compilation caching is enabled for Debug, Dev, and Test. Release keeps Xcode's
release defaults.

Run the focused native app-flow regression suite separately:

```sh
./Scripts/ci-app-flow-test.sh
```

It launches a debug-only, in-process fixture so routine navigation and menu
checks do not need credentials or a live server. The default `regression` plan
runs every deterministic journey with no expected skips. Use
`T3_APP_FLOW_PLAN=pr`, `regression`, `stability`, or `known-red` for the named
cadence in `Scripts/app-flow-catalog.json`. Set `T3_SWIFT_SCHEME` to
`T3CodeDev` or `T3CodeTest` to exercise those configurations. Result bundles
and a portable JSON summary, exact executed-test inventory, exported screenshots
and accessibility trees, source-bound build manifest, and verdict receipt are
written under the ignored `.t3/evidence` directory by default. The runner builds
one portable test product with `build-for-testing`, runs selected journeys with
`test-without-building`, and supports source-verified reuse with
`T3_SWIFT_REUSE_TEST_PRODUCTS=1`. The coverage boundaries and live/TestFlight
follow-up protocol are documented in
[`../../docs/operations/swiftui-app-flow-regression-tests.md`](../../docs/operations/swiftui-app-flow-regression-tests.md).
For the opt-in real-pairing journey, create a mode-`600` JSON file outside the
evidence directory with `server` and single-use `token` string fields, then set
`T3_APP_FLOW_PLAN=live`, `T3_APP_FLOW_LIVE_CREDENTIALS_FILE` to its path, and
`T3_SWIFT_SIMULATOR_ID` plus `T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR=1` only
after creating a run-owned Simulator that the runner may delete.
Raw credential environment
variables are rejected. The runner builds one portable test product, installs
its app, stages a one-shot file in that app's data container, and the DEBUG app
consumes and deletes it before XCTest acts. It then runs the selected journey
with `test-without-building`; staged server and code fields are masked, the
credential-bearing xcodebuild log is kept out of console output, and every
retained text/binary artifact is scanned before retention. Endpoint or token
evidence is removed and the run fails closed, then the app is uninstalled to
remove its data container. A real live run deletes its disposable Simulator to
destroy the bearer credential exchanged into Keychain. The server must be a
credential-free HTTP(S) origin. The `live` and
`security` plans require the file; other plans reject it. The security plan uses
the same ingress with a non-secret sentinel and fixture backend.

CI uses the installable one-command profile. By default it creates and deletes
a unique disposable Simulator; set `T3_SWIFT_SIMULATOR_ID` only for an advanced
caller-owned destination:

```sh
./Scripts/ci-verify.sh pr
./Scripts/ci-verify.sh regression
./Scripts/ci-verify.sh stability
```

It validates the shell and agent-promotion contracts, builds once, runs the
impact-selected app-flow plan, the explicit visual/accessibility lane, native
units, and the credential-security audit from one source-bound product. Sealed
receipts hash retained evidence and roll into `verification.receipt.json`, whose
policy requires first-attempt success. Pinned phone standard/XXL/RTL and iPad
snapshots own the deterministic layout smoke. Real live pairing uses
`Scripts/ci-live-app-flow-test.sh` with an exact-SHA disposable-backend adapter;
physical-device/TestFlight lanes validate content-addressed evidence with
`app-flow.py release-receipt`, an explicit artifact root, and protected
candidate commit and content hashes. The validator hashes every named artifact
itself; caller-supplied digests are not treated as proof.

Contract fixtures are encoded from the TypeScript schemas and decoded by the
Swift test target. Regenerate and verify them after a relevant wire change:

```sh
node scripts/generate-swift-wire-fixtures.ts
node scripts/generate-swift-wire-fixtures.ts --check
```

Pull requests that change `apps/swift-ios`, `packages/contracts`, or the fixture
generator run both checks in the path-gated SwiftUI workflow.

## Install on a physical device

Enable Developer Mode on the device, connect and trust the Mac, then find its
CoreDevice identifier or hardware UDID with
`xcrun devicectl list devices --columns UDID`. The script resolves either form to
the destination UDID expected by Xcode. Xcode must be signed into an Apple
Developer account for the requested team.

```sh
T3_SWIFT_DEVICE_ID="DEVICE-IDENTIFIER" \
T3_SWIFT_DEVELOPMENT_TEAM="TEAMID1234" \
./Scripts/install-device.sh
```

The script builds, provisions, installs, and launches the Debug identity by
default. Set `T3_SWIFT_CONFIGURATION=Release` for the TestFlight identity. It
accepts the T3 Connect build settings above as environment variables. Optional
overrides are `T3_SWIFT_DERIVED_DATA_PATH`, `T3_SWIFT_VERSION`,
`T3_SWIFT_BUILD_NUMBER`, and—on Debug builds only—`T3_SWIFT_BASE_REF` for the
build comparison line. Run with
`T3_SWIFT_VERIFY_BUNDLE_IDENTIFIERS_ONLY=1` to verify the configuration's host
and extension bundle identifiers without a device build.

Debug installations embed an offline changelog for the commits after
`upstream/t3code/rebuild-mobile-app-swift`. Set `T3_SWIFT_CHANGELOG_BASE_REF` to
compare with another build base. Set `T3_SWIFT_CHANGELOG_USE_LUNA=1` to generate
one GPT-5.6 Luna summary per commit with the local Codex CLI, or pass a previously
generated response with `T3_SWIFT_CHANGELOG_SUMMARIES`.

## Release checklist

1. Set a unique `MARKETING_VERSION` and a higher `CURRENT_PROJECT_VERSION`.
2. Confirm the production bundle identifier, display name, app icon, signing team,
   and T3 Connect HTTPS relay configuration.
3. Run `./Scripts/ci-test.sh` and confirm the native test job is green.
4. Smoke-test direct URL and QR pairing, T3 Connect, multi-environment navigation,
   task creation, follow-up messages, attachments, approvals, input requests,
   background/reconnect behavior, and deep links on an iPhone and iPad.
5. Confirm the host, widget, and share-extension identifiers have App Group
   provisioning, and the host has Push Notifications provisioning. Verify APNs
   device registration and Share-extension handoff end to end.
6. Archive the `T3Code` scheme in Release, run Xcode's Validate App and privacy
   report, and confirm `PrivacyInfo.xcprivacy` is bundled. Re-audit the manifest
   whenever code adds a Required Reason API or data collection.
7. Confirm `ITSAppUsesNonExemptEncryption = NO` remains accurate, then distribute
   an internal TestFlight build before App Store submission.
