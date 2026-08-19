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

Debug and Release use separate identities so a local build can remain installed
beside TestFlight:

| Configuration | Display name    | Bundle identifier                | URL scheme           |
| ------------- | --------------- | -------------------------------- | -------------------- |
| Debug         | T3 Swift Dev    | `com.t3tools.t3code.swiftui.dev` | `t3code-swiftui-dev` |
| Release       | T3 Code SwiftUI | `com.t3tools.t3code.swiftui`     | `t3code-swiftui`     |

Each identity also has matching widget and share-extension bundle identifiers
and a separate App Group. Debug data and credentials therefore do not alter the
TestFlight installation.

## Verify

Run the `T3Code` scheme's tests in Xcode, or use the same entry point as CI. It
chooses an available iPhone from the newest installed Simulator runtime:

```sh
./Scripts/ci-test.sh
```

Set `T3_SWIFT_SIMULATOR_ID` to pin a specific simulator. CI can invoke this same
entry point without duplicating the simulator-selection or signing policy.

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
overrides are `T3_SWIFT_DERIVED_DATA_PATH`, `T3_SWIFT_VERSION`, and
`T3_SWIFT_BUILD_NUMBER`. Run with
`T3_SWIFT_VERIFY_BUNDLE_IDENTIFIERS_ONLY=1` to verify the configuration's host
and extension bundle identifiers without a device build.

## Build a dev branch on your own machine

Teammates can run any pushed dev branch on their own Mac and iPhone without
access to the release signing identity.

1. Clone the fork and check out the branch:

   ```sh
   git clone https://github.com/saphid/t3code.git
   cd t3code
   git checkout <dev-branch>
   ```

2. Open `apps/swift-ios/T3Code.xcodeproj`, select the `T3Code` scheme, and run
   an iOS Simulator. Simulator builds need no signing setup.

### Run on your iPhone

1. Add your Apple ID under Xcode → Settings → Accounts. A free personal team
   works; a paid Developer Program membership is not required.
2. Enable Developer Mode on the iPhone (Settings → Privacy & Security →
   Developer Mode), connect it, and trust the Mac.
3. Select the device as the run destination. Under Signing & Capabilities, set
   your own Team for the `T3Code`, `T3CodeWidgets`, and `T3CodeShare` targets
   in the Debug configuration.
4. Run. The Debug identity installs beside TestFlight with separate data and
   credentials, so it never disturbs a released install. Dev branches may use
   a personal identity such as `com.alxs.t3code.typed-swiftui.dev` shown as
   "SwiftUI Test".

Notes:

- Host and share extension use empty entitlements (`T3CodePersonal`) on dev
  branches, so personal-team signing works. If provisioning fails on the
  widget target's App Group, remove `T3CodeWidgets` from the scheme or empty
  `Extensions/Widgets/T3CodeWidgets.entitlements`; the app itself does not
  depend on the widget.
- Do not use `Scripts/install-device.sh` on personal-identity branches: its
  bundle-identifier check expects `com.t3tools.t3code.swiftui.dev` and aborts.
  Use Xcode's Run action instead.
- Personal-team builds expire after 7 days and count toward the 3-app limit;
  rebuild from Xcode to renew.

### Pair with a backend

The app is a client and needs a T3 server to talk to. The quickest local
backend is:

```sh
npx t3@latest
```

Node.js 22.16+, 23.11+, or 24.10+ is required. Keep the phone and the machine
on the same network (or tailnet), then finish onboarding with the pairing URL
or QR code. Direct pairing needs no extra configuration; T3 Connect stays
disabled unless you supply the Clerk and relay build settings described in
[Build configuration](#build-configuration).

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
