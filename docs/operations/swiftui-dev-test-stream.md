# Personal SwiftUI Dev/Test stream

This runbook is the source of truth for Alex's personal native SwiftUI work. It
does not change Theo's public contribution policy or the upstream Release build.

## Branch contract

| Branch | Contains | May receive |
| --- | --- | --- |
| `upstream/t3code/rebuild-mobile-app-swift` | Theo's current SwiftUI line | Theo's upstream commits |
| `personal/swiftui-dev` | Theo plus human-approved features and this workflow | Per-feature promotions and reviewed Theo updates |
| `personal/swiftui-test` | Dev plus every compatible candidate awaiting approval | Forward merges from Dev and attributed candidate integrations |
| Feature/fix branch | One candidate based on the current Dev tip | Only that feature and its tests/evidence |
| `personal/swiftui-approved` | Frozen legacy evidence | Nothing; preserve it and its migration tag read-only |

Dev and Test are append-only shared lines. Do not force-push or delete either
branch. Test must always contain Dev, and Dev must always contain Theo. Reject
bad shared work with a focused, tested revert. Never promote Test wholesale:
promotion selects an exact feature receipt, integrates only its attributed
commits into Dev, then merges Dev forward into Test.

Theo updates are baseline maintenance. Merge or rebase them into Dev only after
conflict review, focused tests, an independent review, and Simulator validation;
then merge Dev forward to Test. They do not need feature-by-feature phone
approval.

## Lifecycle

The canonical states are:

`developing → proved → in-test → needs-you → approved → in-dev → upstream-validation → needs-pr → upstream-pr → landed`

Exceptional states are `blocked`, `rejected`, and `superseded`. The
machine-readable catalog is
`scripts/swiftui-stream/stream.json`; `stream.py` also imports the frozen
legacy manifest and read-only T3 thread projections.

After an upstream PR exists:

- Metadata or evidence-only changes remain `upstream-pr`.
- A patch-equivalent rebase returns to `upstream-validation` but keeps phone
  approval.
- Any executable or behavior-changing diff returns to `developing`, creates a
  new receipt, goes through Test, and needs new human approval.
- Dependency or chain changes return to `upstream-validation`.
- A maintainer behavior rejection becomes `rejected`.
- An equivalent upstream landing is verified before becoming `landed`.

## Test approval

Invoke `$approve-swiftui-feature`.

With no argument, the skill prints a frozen, stable, ordered numbered list of
the features in the exact installed Test build and asks Alex to choose a number.
A number always resolves against that frozen snapshot, followed by a fresh
eligibility check. With text after the skill name, it ranks names, aliases,
issues, behavior, branches, and commits; it confirms the best match, or offers a
short numbered list when ambiguous. It always asks for final human confirmation.

Approval is per feature. If the feature has dependencies, the skill expands to
the smallest explicit dependency group and confirms the group. Under the single
promotion lease it records approval, re-audits, integrates the attributed
feature into Dev, runs focused tests and review, pushes Dev normally, merges Dev
forward to Test, produces the current Dev build, refreshes Test if its manifest
changed, and advances upstream validation.

The durable queue reorders itself topologically. Independent promotions retain
approval order; blocked items are recorded and skipped so unrelated work keeps
moving.

## Upstream delivery validation

Every upstream contribution passes `upstream-validation` and is classified as:

- `direct`: independent and safe to merge directly to Theo's branch.
- `chain`: depends on one or more ordered PRs.
- `blocked`: cannot be made safely direct or chained yet.

Every upstream PR body must contain:

```text
Delivery: direct|chain|blocked
Validated against Theo commit: <full or short SHA>
Depends on: none|#123, #124
Merge order: this PR only|#123 → #124 → this PR
Validation status: <focused tests, review, Simulator, CI/conflict state>
```

A chain PR must name every dependency and its order. A direct PR says
`Depends on: none` and `Merge order: this PR only`. Validate a prepared body
with `scripts/swiftui-stream/stream.py validate-pr-body --number <PR> --body <file>`. After a
parent lands, rebase and validate the child again; convert it to direct when the
dependency disappears.

## App identities

| Scheme / configuration | Icon and in-app suffix | Home Screen name | Bundle ID | App Group | Route |
| --- | --- | --- | --- | --- | --- |
| `T3CodeDev` / `Dev` | Orange `Dev` | SwiftUI Dev | `com.saphid.t3code.swiftui.dev` | `group.com.saphid.t3code.swiftui.dev` | `t3code-swiftui-personal-dev` |
| `T3CodeTest` / `Test` | Purple `Test` | SwiftUI Test | `com.alxs.t3code.typed-swiftui.dev` | `group.com.alxs.t3code.typed-swiftui.dev` | `t3code-swiftui-personal` |
| `T3Code` / `Release` | Upstream | T3 Code SwiftUI | `com.t3tools.t3code.swiftui` | upstream | `t3code-swiftui` |

These host and extension bundle identifiers deliberately reuse the two locally
provisioned personal-team identities. That allows both apps to coexist and be
renewed without creating a new Apple identifier. Free personal-team profiles do
not carry App Groups, push, Sign in with Apple, or associated-domain
webcredentials. Device builds therefore use the empty personal entitlement
file. Distinct bundle IDs keep host persistence and credentials isolated; the
configured group names remain distinct for a future paid-team profile. Widgets
and the share extension cannot exchange group data, remote push cannot arrive,
Sign in with Apple is unavailable, and Clerk password autofill is unavailable
until those capabilities are provisioned.

Widgets and Share extensions use the matching channel bundle ID and App Group.
The channels therefore have separate host credentials, persistence, and
deep-link ownership. App Group-dependent share inboxes and widgets remain
disabled under free personal-team signing. Dev and Test build counters are
independent and monotonically increasing.

## Build and automatic phone install

On the matching clean branch, publish an immutable signed artifact:

```sh
T3_SWIFT_DEVICE_ID="<CoreDevice or UDID>" \
T3_SWIFT_DEVELOPMENT_TEAM="<team>" \
scripts/swiftui-stream/build-ready.sh dev

T3_SWIFT_DEVICE_ID="<CoreDevice or UDID>" \
T3_SWIFT_DEVELOPMENT_TEAM="<team>" \
scripts/swiftui-stream/build-ready.sh test
```

The build command verifies the channel identity, embedded channel, signature,
exact full commit, and monotonic counter, stores the artifact below
`~/.t3/artifacts/swiftui-stream/<channel>/`, then atomically advances that
channel's ready pointer.

`com.saphid.t3-swiftui-phone-watch` is a normally dormant 60-second
LaunchAgent. It uses no model and no tokens. While a ready build is pending, it
takes `~/.t3/locks/swiftui-phone-install.lock`, reads the current pointer under
that lease, verifies its archive hash and code signature, extracts a private
install copy, and always chooses the highest sequence. If A is ready and
A+B replaces it before the phone becomes usable, only A+B is installed. It never
downgrades. Locked, disconnected, and launch-failed states produce durable
receipts under `~/.t3/swiftui-stream/device-receipts/`.

The watcher sends one deduplicated prompt per pending build to `#agent-ops` in
the existing Life Agent Business OS Discord server through the existing Hermes
sender. Discord failure is recorded but never blocks installation. Configure it
with:

```sh
T3_SWIFT_DEVICE_ID="<CoreDevice or UDID>" \
scripts/swiftui-stream/configure-phone-watcher.sh
```

## Status and evidence

```sh
scripts/swiftui-stream/stream.py validate
scripts/swiftui-stream/stream.py status
scripts/swiftui-stream/stream.py status --verbose
scripts/swiftui-stream/stream.py approval-list
scripts/swiftui-stream/stream.py match '<feature text>'
scripts/swiftui-stream/stream.py queue-order
scripts/swiftui-stream/stream.py verify-branches
```

Feature receipts are immutable and per-feature. Aggregate train receipts never
replace a feature's own source range. GitHub issue
[#53](https://github.com/saphid/t3code-personal/issues/53) is the durable rollup;
each feature keeps its own issue/thread evidence. Unexpected empty scans,
unmapped T3 threads, missing artifacts, or device/receipt disagreement are
anomalies to investigate, not proof that no work exists.

### Read-only drift monitor

`com.saphid.t3-swiftui-drift-monitor` runs from the stable primary clone, fetches the three canonical refs every
two hours and verifies Theo is an ancestor of Dev and Dev is an ancestor of
Test. Fetch failure is an unhealthy state, and every evidence record includes
`checkedAt`. It never merges or pushes. A changed failure state is posted once to
issue #53; recovery is posted once after the invariant is restored. Install or
refresh it with:

```sh
scripts/swiftui-stream/configure-drift-monitor.sh
```

Disable it with
`launchctl bootout gui/$(id -u)/com.saphid.t3-swiftui-drift-monitor` and remove
`~/Library/LaunchAgents/com.saphid.t3-swiftui-drift-monitor.plist` only when the
stream is intentionally retired.

## Failure and rollback

- A Test rejection records the exact rejected receipt and installs a newer Test
  train containing every other accepted or still-pending feature.
- A defect already in Dev is reverted with a focused tested commit; history is
  not rewritten.
- A promotion that loses its lease, changes after audit, or no longer matches
  the installed Test build stops before modifying Dev.
- A locked or disconnected phone leaves the newest immutable build ready for the
  watcher; no agent needs to remain alive.
- The old `personal/swiftui-approved` ref, its final tag, old sync script,
  disabled LaunchAgent plist, and logs are rollback evidence and must not be
  deleted. The legacy agent must remain booted out.
