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

## Human action escalation duty (before every normal report)

Run status and inspect `humanActionRequired` before reporting or reconciling
ordinary work. A browser, Computer Use, credential, approval, or other
human-authorization dependency is not routine waiting. Put the literal heading
`ACTION REQUIRED FROM ALEX` first and name every affected issue, the exact
capability or authorization Alex can grant, why it is blocked, and what cannot
happen until he does. Never hide it in a buffer, parked-work list, or generic
progress wording, and never assign it to the SwiftUI orchestra when only Alex
can clear it. Record new gates as structured `authorization-required` waiting
entries under contract `issueEvidence.authorizationEscalation`. Once Alex
authorizes the named action, perform or dispatch it immediately within that
scope and replace the stale waiting receipt.

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

Validating proof-ready also carries the issue-embed duty (contract
`issueEvidence`): upload the proof's captures to the owning GitHub issue so
it embeds exactly what the PR will - before/after, light/dark, GIF, and
interaction video - keeping the fenced work-item block byte-identical, and
refresh that embed whenever proof is replaced. Alex must be able to judge the
feature from the ticket alone.

Use `scripts/swiftui-delivery/scripts/publish-issue-evidence` with the exact
proof, inspection, GIF, and receipt paths. It validates the artifacts, uploads
images and video through GitHub's token-authenticated `user-attachments`
endpoint, edits the issue, and rereads it to prove the work-item block is
byte-identical and every URL is embedded. Treat browser or credential access as
a human gate only when this command demonstrates that bearer publication is
unavailable for the exact repository or media.

An after-code commit invalidates proof and inspection. A change after Test also
invalidates the generation receipt. Return the work item to `active` with an
explicit reject or rework verdict.

Phone acceptance is also a durable checkpoint, not a loose CLI word. Require
Alex's explicit verdict in an acceptance receipt bound to the exact phone
generation, then supply both `--verdict accept` and `--acceptance-receipt`.

Acceptance is atomic with its successor - dispatch BEFORE you record. First
create or wake the upstream-handoff thread for the item (title must carry
`#issue`), or, only when PR authority is genuinely absent, choose the
explicit `awaiting-pr-authority` hold. Then write the schemaVersion-3
acceptance receipt with its `successor` block (`handoff-dispatch` with
threadId/threadTitle/dispatchedAt, or `hold` with reason/recordedAt) and run
the transition. The CLI rejects a bare acceptance; an accepted item with no
next actor cannot exist. This is the same never-batch-wait principle as
station saturation, applied to the verdict step.

## Prepare Test, never install it

Build a `publish-test` plan whose entries point to the exact work-item, proof,
and inspection files. Bind a catalog artifact containing the complete issue
dependency closure. Include the exact logical issue/head carry from the prior
Test receipt, but never reuse its combined commit as a source base. Resolve the
live Theo SwiftUI ref and prepare a composition plan in which every selected
overlay starts from that exact commit. If an old carry was proved from another
base, re-materialize and re-prove it before publication. Validate the complete
generation and composition plans:

```sh
scripts/swiftui-delivery validate-generation-plan generation-plan.json
scripts/swiftui-delivery validate-composition-plan composition-plan.json
```

This command reads and validates every referenced media manifest and every
capture review. Only then hand the exact plan to `$swiftui-deliver`. No phone
queue, build, or install begins in this skill.

## Station saturation duty (first at every pass)

The deterministic controller may create or wake this coordinator turn when a
mechanical liveness condition is present. It is infrastructure, never a work
item, and never consumes a delivery WIP slot. Re-read live state on entry;
controller messages name triggers, not authoritative snapshots. The controller
selects its model from sanitized live headroom under the contract's ordered
failover policy and creates a fresh thread when the selected model changes or
the prior controller turn errored. If no candidate qualifies it dispatches no
turn and records `no-model-capacity`; never treat that state as completed work.

Verify worker LIVENESS before anything else: every active work item must
have a running worker turn - an existing thread with no running turn is a
stalled lane; wake it with thread.turn.start or redispatch. Fill every
implementation slot from queued work. Process work (compliance sweeps, PR
programs, UAT administration) never preempts keeping feature lanes hot,
and a single new proof-ready item triggers the next Test generation
immediately - never batch-wait, never wait for verdicts.

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
T3 Code SwiftUI project named `UAT <build number> (<Test|Dev>)` (contract
`uatThreads`) and PIN it (typed client RPC only - probe the contract first;
never write projections directly; report a ledger gap if unpinnable).
Its opening message tells Alex FIRST which app to open on the phone -
'SwiftUI Test' or 'SwiftUI Dev' by installed display name; then each new
candidate with what it is, why we need it (owning issue's problem
statement), and exactly how to test it on the phone (acceptance points as
concrete steps). Ask for an accept/reject verdict only for candidates whose
exact behavior needs a verdict in this generation. An unchanged
`installed-carry` entry that already has an acceptance receipt is composition
context only: list it separately as unchanged, do not ask Alex to spot-check
it, and do not request another verdict. An unchanged carry entry with no prior
acceptance remains pending initial acceptance; label it that way, repeat its
original acceptance steps, and ask for its first verdict without calling it a
regression or reapproval. If a previously accepted item's head, proof,
inspection, replacement, or behavior changed and therefore needs renewed
acceptance, classify it as a reapproval candidate rather than carry. State
exactly what code or behavior changed, say that the prior acceptance no longer
covers the new artifact, repeat the current acceptance points as concrete
phone steps, and directly ask Alex to reapprove it. Tie every entry to its
provenance (contract `uatThreads.buildReport`): name the owning issue number
with the issue URL, and when the change came back from an upstream PR, name
that PR's number and link it too - label an unlanded PR as unlanded. For a
visual change, embed the evidence in the thread itself - full-size dark-mode
before and after screenshots under separate headings plus the animated GIF,
and a video as well when the change is motion, scrolling, focus, timing, or
gesture-driven - to the upstream PR evidence-format bar with dark captures
only (the PR-time state-capture checklist is not required in the thread;
simulator proof still records light and dark), delivered as an inline playable
attachment or a Tailnet-only URL, never a local path. Record returned verdicts
as acceptance receipts bound to that generation.

## Conflicted-PR duty

Our PR branches are ours to modify freely; other people's changes are
inviolable. For conflicted saphid PRs, dispatch one Sol worker per PR
following `../../../scripts/swiftui-delivery/references/conflict-resolution.md`

- proceed without asking whenever the resolution only changes our branch
  and preserves upstream behavior; stop and report anything that would alter
  another contributor's change.

## Backlog and WIP duty

Enforce `flowPolicy` from the contract at every pass. Alex may demote an
active item back to the backlog (`active -> queued`, contract
`backlogDemotion`): record his decision as an issue comment, keep the launch
binding, restate any changed acceptance points, and flip the `lane:<stage>`
label in the same edit. Demotion is a scope or priority decision - never write
reject or rework language for it.

Keep active
implementation lanes at their WIP limit while any approved worker provider
has usable token capacity; a simulator, signing, or phone blocker never
idles implementation, test, or review lanes. Dispatch already-ready queued
work into open slots FIRST; then, if `queued` has fallen below
`flowPolicy.backlog.minQueuedReady`, replenish only from Alex's explicit
SwiftUI and Electron product priorities via `file-swiftui-lane-issue`.
Upstream contribution intake and React Native parity are discovery/provenance,
not automatic backlog sources: do not file, rank, dispatch, or include them in
a build unless Alex explicitly promotes the concrete behavior. Before filing
promoted parity work, verify the source behavior belongs to the current product
path. Do not extend a legacy, deprecated, beta-replaced, or disabled path when
a successor path intentionally removed that behavior; route the gap against
the successor design or leave it unfiled.
Replenishment is coordinator housekeeping and
never delays dispatch of ready work. Unbounded buffers (`queued`,
implemented awaiting simulator, proof-ready awaiting Test generation, accepted
awaiting PR authority) are healthy, not a stall; re-validate implemented
items older than `flowPolicy.bufferStaleness.revalidateImplementedAfterDays`
days against the current carry before they enter a simulator lane. Run
`scripts/doctor` at bootstrap; exit 2 stops dispatch until the package is
repaired.
