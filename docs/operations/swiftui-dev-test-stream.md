# Personal SwiftUI Dev/Test stream

This runbook is the source of truth for Alex's personal native SwiftUI work. It
does not change Theo's public contribution policy or the upstream Release build.

## Branch contract

| Branch | Contains | May receive |
| --- | --- | --- |
| `upstream/t3code/rebuild-mobile-app-swift` | Theo's current SwiftUI line | Theo's upstream commits |
| `personal/swiftui-dev` | Theo plus human-approved features and this workflow | Per-feature promotions and reviewed Theo updates |
| `personal/swiftui-test` | Dev plus every compatible candidate awaiting approval | Forward merges from Dev and attributed candidate integrations |
| Feature/fix branch | One candidate based on the current Dev tip | Only that feature, its tests/evidence, and one immutable Dev review build |
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

For a visual feature or fix, the PR body must additionally contain the exact
dark-mode proof packet used by the review build:

```text
Dark mode evidence: yes
Clean screenshot: <durable HTTPS URL>
Annotated screenshot: <durable HTTPS URL>
Clean video: <durable HTTPS URL>
Annotated video: <durable HTTPS URL>
```

The two video lines are required for interaction or motion changes.

Create paired clean and annotated outputs with `prepare-proof-media`. The
annotated media carries visible tap and swipe animations plus concise `Next:`
and `Expected:` captions; clean media shows the same frames without overlays.
Deliver it through `share-video-evidence`, verify that every intended reviewer
can fetch and play it, and retain the proof-media receipt under durable
`~/.t3` storage. A private Tailnet URL is acceptable for personal Dev/Test PRs;
before an upstream PR, rehost the byte-identical packet at an access-controlled
endpoint the maintainers can reach and preserve its hashes in the receipt.
Light-mode captures, local-only file paths, stale or synthetic captures, or an
unplayable URL do not satisfy this gate. Validate every PR body with
`--feature-id <catalog-id>` and also `--number` when applicable.

A chain PR must name every dependency and its order. A direct PR says
`Depends on: none` and `Merge order: this PR only`. Validate a prepared body
with `scripts/swiftui-stream/stream.py validate-pr-body --feature-id <catalog-id> --number <PR> --body <file>`. After a
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

The Test target alone defines `T3_PERSONAL_CONNECT`. That condition embeds the
allowlisted private fleet and exposes one-tap pairing through each host's
authenticated `/__t3/mobile-pair` Tailnet broker. The broker requires Alex's
Tailnet identity and allowlisted iPhone; Dev and upstream app binaries contain
no private fleet addresses. QR, paste, and manual pairing remain available in
every channel.

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

### In-app Dev and Test verdicts

A proved feature branch may publish exactly one receipt-matched `dev` artifact
without merging the candidate into shared Dev. `build-ready.sh dev` requires
the branch to match one `proved` catalog record, requires its frozen candidate
commit to underlie the build revision, permits only metadata-only catalog
commits after that candidate, requires that exact build revision to be
published on the receipt's remote feature branch, and embeds only that feature. When the
proof receipt is frozen, record the full candidate SHA as `candidateCommit`,
the exact branch as `sourceBranch`, the current remote Dev tip as
`startingBaseline`, and every commit in that baseline-to-candidate range in
`commits`; then advance the catalog record to `proved`.
Shared `personal/swiftui-dev` builds never claim unmerged proved features. This lets
Alex exercise the actual candidate in the orange Dev app while shared Dev
remains the approved baseline.

The Dev app's **What’s ready for testing** section shows the exact build,
candidate commits, owning T3 threads, and issue. A confirmed **Ready for Test**
or **Not ready** verdict is sent to the owning thread with that evidence. Only
the guarded stream workflow may integrate a ready candidate into Test. Those
Dev verdict messages invoke `$swiftui-feature-fix`, the personal candidate
workflow that re-audits the embedded receipt before changing Test.

The purple Test app's **What’s testing** section contains the exact aggregate
Test-build candidates. Every Dev and Test review item carries a plain-language
summary, what Alex should check, and the observable signs of success. Both
screens show the complete `Development → Test → Dev → Upstream` path and name
their current gate. When review items are present, both screens also offer a
collapsed **Proposed PR promotion flow** diagram. It explains a possible future
PR-gated pipeline and uses conditional language; it does not claim those PR
approval, auto-merge, build, or deployment actions are implemented. The current
receipt-based workflow in this runbook remains authoritative. Test's confirmed
**Ready for Dev** dialog sends an
evidence-carrying request into the existing per-feature promotion or rejection
path. The approval skill still shows the frozen evidence and asks for its
required final human confirmation before promoting the feature into Dev; only
then does upstream validation begin. A **Not ready** Test verdict invokes `$swiftui-feature-fix` to
record the rejection and construct a replacement Test train that removes only
that feature while preserving every unrelated candidate. A queued verdict is
remembered for that exact channel, build, revision, and feature; submitting the
opposite verdict remains available as the explicit reversal. The app never
changes Git refs itself. Release and ordinary Debug builds expose neither
section.

Visual review items also contain a collapsed **Visual evidence** section. It
shows the annotated dark-mode image or playable annotated video in the app and
links to both the clean and annotated versions. Those URLs must be the same
durable proof packet named in the candidate's Dev and upstream-delivery PR
bodies; metadata alone or a host-local path is not review evidence.

Every Test record carries both `sourceCommit` for attribution and the full
`integratedCommit` that is actually in Test. The app labels those roles and uses
only integrated commits as build provenance. A pending feature remains listed
in every later Test build until it is approved, rejected, or superseded.

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
