---
name: swiftui-orchestrate
description: Coordinate and babysit native T3 Code SwiftUI issue work across shared lanes. Use to select ready work, create isolated worktrees and threads, reconcile receipts, record verdicts, audit drift, or prepare an evidence-gated Test batch. Do not implement code or install builds.
---

# Orchestrate and babysit SwiftUI delivery

Read `../../../scripts/swiftui-delivery/contract.json` and
`../../../scripts/swiftui-delivery/references/process.md` relative to this skill.
Read `../../../scripts/swiftui-delivery/references/simulator-lanes.md` when
allocating, reusing, recovering, or releasing simulator capacity. GitHub
issues hold canonical work-item state. Local files are working copies and
content-addressed receipts. Use `scripts/swiftui-delivery` for every gate.

## Reconcile

1. Extract every `swiftui-work-item-v2` block and validate the full JSON array:
   `scripts/swiftui-delivery validate-catalog catalog.json`.
2. Enforce one work item per issue and one `laneId` per work item. Multiple
   issues may share a lane. Check dependency closure and cycles across lanes.
3. Treat the stage label as a repairable index. The fenced block and its exact
   proof, inspection, and generation hashes are authoritative.
4. Quarantine unrelated drift instead of blocking healthy work. Report each
   work item's own waiting reason and proof. Do not create a global conflict
   merely because two issues share a lane.

## Start and babysit one work item

For a dependency-ready queued work item, resolve the current base and create a
unique branch, worktree, T3 project/thread, and launch receipt. Bind the exact
issue, lane, base, branch, worktree, environment, project, and thread. Write
`active` only after validating and reading back the receipt and issue update.
Acquire one explicit simulator lease for the lane; other lanes may allocate
other UDIDs concurrently, while issues sharing this lane use its ordered
runtime context.
Dispatch `$swiftui-feature-work` for that exact work item.

```sh
scripts/swiftui-delivery transition-work-item work-item.json --to active \
  --launch-receipt launch-receipt.json
```

Babysit from receipts, not thread titles or timers. At each checkpoint, require
the artifact that proves it:

- reproduction: exact-base build receipt, before image, and annotated video;
- implementation: focused test commands with nonzero matched tests;
- fix proof: exact-head build receipt, after image, and annotated video;
- inspection: one agent review row for every capture, plus an explicit
  unintended-side-effect assessment;
- publication: validated generation plan, authority, and generation receipt.

Do not advance `active -> proof-ready` until both files pass:

```sh
scripts/swiftui-delivery validate-proof proof.json
scripts/swiftui-delivery validate-inspection inspection.json --proof proof.json
scripts/swiftui-delivery transition-work-item work-item.json --to proof-ready \
  --proof proof.json --inspection inspection.json
```

An after-code commit invalidates proof and inspection. A change after Test also
invalidates the generation receipt. Return the work item to `active` with an
explicit reject or rework verdict.

Phone acceptance is also a durable checkpoint, not a loose CLI word. Require
Alex's explicit verdict in an acceptance receipt bound to the exact phone
generation, then supply both `--verdict accept` and `--acceptance-receipt`.

## Prepare Test, never install it

Build a `publish-test` plan whose entries point to the exact work-item, proof,
and inspection files. Bind a catalog artifact containing the complete issue
dependency closure. Include the exact installed carry from the prior Test
receipt. Validate the combined code and the complete plan:

```sh
scripts/swiftui-delivery validate-generation-plan generation-plan.json
```

This command reads and validates every referenced media manifest and every
capture review. Only then hand the exact plan to `$swiftui-deliver`. No phone
queue, build, or install begins in this skill.

## Continuous Test publication duty

At every pass, compare the proof-ready set against the latest published
Test generation receipt. If any proof-ready item is missing, IMMEDIATELY
prepare and validate a combined `publish-test` plan (disjointness + full
carry set) and dispatch `$swiftui-deliver` to build and publish it. Do not
wait for Alex or ask permission - Test publication runs under the standing
authorization in contract `testPublication`. Every generation's
entry set is COMPLETE: prior installed carry plus every proof-ready and
published-pending item not explicitly replaced - a newer generation never
silently drops an earlier improvement. If a further item becomes
proof-ready while a build is in flight, queue the next generation behind
it; never cancel or overwrite a published build. Items advance
`proof-ready -> phone-test` only on the watcher's matching device receipt
(`~/.t3/swiftui-stream/device-receipts/test.json`), never on pointer flip. Alex's verdicts are only
ever required at `phone-test -> accepted`.

## UAT thread duty

Whenever the device receipt (`~/.t3/swiftui-stream/device-receipts/*.json`)
reports a NEWLY installed build, immediately create a T3 thread in the
T3 Code SwiftUI project named `UAT <build number>` (contract `uatThreads`).
Its opening message tells Alex: which build and channel installed; each new
candidate with what it is, why we need it (owning issue's problem
statement), and exactly how to test it on the phone (acceptance points as
concrete steps); carried items listed separately; and a per-item request
for accept/reject verdicts. Record returned verdicts as acceptance
receipts bound to that generation.

## Conflicted-PR duty

Our PR branches are ours to modify freely; other people's changes are
inviolable. For conflicted saphid PRs, dispatch one Sol worker per PR
following `../../../scripts/swiftui-delivery/references/conflict-resolution.md`
- proceed without asking whenever the resolution only changes our branch
and preserves upstream behavior; stop and report anything that would alter
another contributor's change.

## Backlog and WIP duty

Enforce `flowPolicy` from the contract at every pass. Keep active
implementation lanes at their WIP limit while any approved worker provider
has usable token capacity; a simulator, signing, or phone blocker never
idles implementation, test, or review lanes. Dispatch already-ready queued
work into open slots FIRST; then, if `queued` has fallen below
`flowPolicy.backlog.minQueuedReady`, replenish the backlog — from the
upstream contribution queue and the React Native mobile app parity gap — via
`file-swiftui-lane-issue`. Replenishment is coordinator housekeeping and
never delays dispatch of ready work. Unbounded buffers (`queued`,
implemented awaiting simulator, proof-ready awaiting Test generation, accepted
awaiting PR authority) are healthy, not a stall; re-validate implemented
items older than `flowPolicy.bufferStaleness.revalidateImplementedAfterDays`
days against the current carry before they enter a simulator lane. Run
`scripts/doctor` at bootstrap; exit 2 stops dispatch until the package is
repaired.
