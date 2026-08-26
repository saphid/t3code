---
name: swiftui-deliver
description: Execute one exact, evidence-gated, explicitly authorized native T3 Code SwiftUI Test, Dev, or PR generation plan. Use only after orchestration has selected and validated the batch. Do not choose work, implement code, infer authority, or accept a phone result.
---

# Deliver one authorized SwiftUI generation

Execute, do not select. Read `../../../scripts/swiftui-delivery/contract.json` and
`../../../scripts/swiftui-delivery/references/process.md` relative to this skill. Run the
local `scripts/swiftui-delivery` adapter. Resolve product checkout, device,
simulator, T3 runtime, CLI, signing identity, and maintainer base live.

## Hard preflight

Immediately before any queue, build, install, push, or PR write:

```sh
scripts/swiftui-delivery validate-generation-plan generation-plan.json
```

The validator opens the dependency-closure catalog and every referenced work
item, proof, video edit receipt, and inspection. It rejects missing or
unsatisfied dependencies, missing before/after media, unannotated videos,
stale hashes, incomplete capture reviews, failed side-effect review,
ineligible stage, or mismatched head. There is no degraded mode.

Re-read the authority source. Actor, mode, exact issue/head set, and scope hash
must still match the structured grant. For phone publication, acquire the
project-owned exclusive lease and retain its returned release token only for
this operation:

```sh
scripts/phone-lease acquire --operation-id "$OPERATION_ID" --actor Alex \
  --mode publish-test --scope-sha256 "$SCOPE_SHA256"
```

Never break a live lease owned by another operation. Release it with
`scripts/phone-lease release --token "$RELEASE_TOKEN"` on success or partial
failure. An unreadable or abandoned lease requires human review; the tool has
no force option.

## Execute exactly one mode

- `publish-test`: build and install exactly the candidate plus required
  installed-carry set. No unreviewed head enters the generation.
- `publish-dev`: require accepted or landed entries and a fresh resolved base.
- `open-pr`: re-resolve the maintainer base. If it moved, return the item to
  `active`, rebuild, and re-prove it. Otherwise rebuild the exact proved head,
  run focused tests and the independent review attempt, and require complete
  evidence plus live media links. Use the protected
  `$t3code-land-contribution` skill for upstream policy.

Verify archive identity, injected commit, signing, installed artifact hash,
and destination. Write a `swiftui-generation-receipt` bound to the exact plan
bytes and validate it:

```sh
scripts/swiftui-delivery validate-generation-receipt generation-receipt.json \
  --plan generation-plan.json
```

Only after a successful Test install may the coordinator plan
`proof-ready -> phone-test` with both files. Phone behavior still requires
Alex's explicit accept verdict and a receipt bound to that phone generation
before `accepted`. Opening a PR similarly requires the exact `open-pr` plan and
receipt; landing requires a separate landed receipt with the PR and merge
commit. These checkpoints are append-only fields, so Test evidence is not
overwritten by later PR evidence.

For an authorized PR, invoke `$babysit-pr` only with a separate watcher/push
grant. Any pushed change to the PR head — including babysitter fixes —
returns the work item to `active`: renewed proof, inspection, and (for
behavior changes) phone acceptance are required before `landed`. A PR's existence grants no branch mutation. On partial failure preserve
the last verified build and receipt, release only the lease this run owns, and
report the exact failed checkpoint.

## Vouched contributor handoff (open-pr mode)

Before requesting human review on any upstream PR, apply
`../../../scripts/swiftui-delivery/references/upstream-handoff.md` in full:
for user-visible changes, separate-heading full-size before/after evidence
(never side-by-side tables) and affected-state coverage — non-UI work keeps
the existing risk-tiered evidence rules; the nine-part description kept current
with the head, branch hygiene including maintainer edits, and the
evidence-per-finding review-response protocol. The guide's final handoff
checklist must pass and be recorded in the open-pr generation receipt as
`vouchedHandoffChecklist: pass` with stated gaps. Authoritative source: the vendored
`../../../scripts/swiftui-delivery/references/CONTRIBUTING_VOUCHED.md`
(prefer the product repository root copy once it lands upstream).


## Continuous Test publication (standing authorization)

`publish-test` requires NO per-batch human or agent approval - it runs
under contract `testPublication.standingAuthorization` (Alex, 2026-08-26).
Build each generation into its own new directory under the contract
`buildStore`; never modify or delete a previous generation's directory.
After the archive is complete: zip it, record its sha256, and only then
atomically replace `~/.t3/swiftui-stream/ready/test.json` (schemaVersion 1
pointer: channel, build, sequence, commit, bundleId, appPath, zipPath,
sha256, deviceId) via a same-directory temp-file rename. The deterministic
LaunchAgent `com.saphid.t3-swiftui-phone-watch` installs the pointer target
whenever the phone is reachable and never downgrades, so an in-flight newer
generation never blocks the phone from getting the newest COMPLETE build.
Phone installation is not this skill's job and needs no lease beyond the
build itself.
