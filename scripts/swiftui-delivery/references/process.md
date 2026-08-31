# SwiftUI delivery process

This repository owns the process, four delivery skills, their validators, the
build store, and the video transformer. The T3 Code product repository owns
product code, product-local simulator/browser skills, builds, and device work.
Protected upstream specialist skills remain external references and are never
copied or edited here.

## Domain model

- A **lane** is a named work stream. A lane can contain multiple issues.
- A **work item** is the delivery state and proof for exactly one GitHub issue.
- Every work item names exactly one `laneId`.
- An issue appears in exactly one work item. Neither an issue nor a work item
  owns a lane.
- Proof, inspection, acceptance, and generation receipts belong to the work
  item, not to the lane.
- New work items record a dashboard classification: category, UI or non-UI
  surface, and known upstream issue or pull-request references. This metadata
  describes the work; it does not replace stage, receipt, or GitHub state.

## Checkpoints

1. **queued**: issue, lane membership, acceptance statements, rank, and typed
   dependencies are valid.
2. **active**: a launch receipt binds one issue to one branch, worktree,
   environment, project, thread, and exact base.
3. **reproduced** (within active): an exact-base retained build plus before
   screenshot and annotated video demonstrate the issue.
4. **implemented** (within active): focused tests match at least one test and
   pass; the review attempt is recorded.
5. **proved** (within active): an exact-head retained build plus after
   screenshot and annotated video demonstrate the result.
6. **proof-ready**: a visual agent review covers every capture and explicitly
   checks intended behavior and unintended side effects. The work item binds
   exact proof and inspection hashes. Proof validation also satisfies the
   issue-embed duty (contract `issueEvidence`): the owning GitHub issue embeds
   the same media its PR will need - before and after, light and dark, the
   animated GIF, and the interaction video when interaction changed - so Alex
   can judge the feature from the ticket alone. Refresh the embed whenever
   proof is replaced.

## Human authorization gates

A browser, Computer Use, credential, approval, or other human-authorization
dependency is not an ordinary queue wait. On the first occurrence, record a
structured `authorization-required` waiting entry with the affected issue,
actor, capability, required action, and reason. The coordinator and every
status surface must put `ACTION REQUIRED FROM ALEX` before the normal board,
phone, station, or backlog report. State exactly what Alex can authorize and
what remains blocked until he does. Never bury this condition in a buffer,
parked-work list, euphemistic progress wording, or a generic orchestra-owned
wait.

Status also promotes legacy GitHub issue-attachment and browser-prohibition
reasons, so older receipts cannot remain silent. Once Alex gives the named
authorization, the coordinator acts immediately within that scope and writes
a replacement dispatch receipt that clears the stale gate.

Issue evidence publication is token-first. Run the repo-owned
`scripts/publish-issue-evidence` command, which uses the active `gh` OAuth token
against GitHub's `user-attachments` endpoint and verifies the resulting issue
body. A browser or credential gate exists only after that command demonstrates
the bearer path is unavailable for the exact repository or media.

7. **phone-test**: Test publication is CONTINUOUS under Alex's standing
   authorization (contract `testPublication`, 2026-08-26): whenever the
   proof-ready set is not fully contained in the latest published Test
   generation, the coordinator immediately prepares and validates a new
   combined generation plan and dispatches the build - no per-batch human
   or agent approval. Each generation is built into its own immutable
   build directory (previous builds are never overwritten); after the
   artifact is complete and hash-verified, the ready pointer is replaced
   atomically and the deterministic phone watcher installs it as soon as
   the phone is reachable, never downgrading. Plan validation remains
   fully mechanical: A Test plan contains at least one newly
   proved `candidate`. It also carries forward every issue in the prior
   installed Test-generation receipt as `installed-carry`, except issues that
   the new candidate replaces. If no prior receipt exists, the plan records a
   specific reason. The generation receipt binds the exact ordered issue/head
   set and installed artifact.
   A `candidate` is gated on its retained simulator builds: the validator
   reopens the exact base and head build receipts and matches every capture
   against the retained binary. An `installed-carry` entry is not, because it
   is already running on the phone and its authority is the prior generation
   receipt plus the exact carry-set match, not a fresh reopen. Carry entries
   still bind their proof and inspection hashes to the work item and catalog,
   so identity is preserved; only retained-build reopen is relaxed. Requiring
   it would make publication depend on retaining every simulator build forever,
   and one reviewed eviction would permanently block the pipeline.

   A legacy Test build that has a real device receipt and Alex verdict but no
   generation receipt is never repaired by inventing that missing receipt. A
   freshly rematerialized overlay may instead enter one Test generation as
   `accepted-recovery`. Its recovery receipt binds the original verdict
   marker, installed zip, installed-and-launched device receipt, and the new
   base/head patch. The work item remains accepted on an explicit successor
   hold, and UAT lists it as informational with no new verdict request.

   When Theo's branch moves but a proved product change does not, schema-4
   proof may bind a schema-3 source proof through a proof-equivalence receipt.
   Both target commits still need retained builds. The repository comparator
   emits context-free added/removed product lines for an explicit SwiftUI path
   set and the validator requires the source and target artifacts to be
   byte-identical. Test-only or unrelated contextual changes cannot silently
   expand the proof.

Every generation plan also binds a dependency-closure catalog. The validator
reopens it, rejects missing or duplicate issues and cycles, requires each plan
work item to match its catalog entry exactly, and checks every dependency's
observed stage against `satisfiedAt`. An unrelated issue outside the closure
does not enter the catalog and cannot create a global hold.
On every new install the coordinator opens a `UAT <build>` thread per
contract `uatThreads` so Alex always has a guided test script for what
just landed on the phone. Human-verdict scope is narrower than build
composition. Unchanged `installed-carry` entries with an acceptance receipt
are listed as unchanged context only and never generate spot-check or
verdict requests. Unchanged carry without an acceptance receipt stays
pending initial acceptance: its original steps and first-verdict request are
repeated without regression or reapproval language. A previously accepted
item whose head, proof, inspection, replacement, or behavior changed returns
as a reapproval candidate. Its UAT entry names the exact change, says why the
prior acceptance no longer covers the artifact, repeats the current
acceptance points as concrete phone steps, and directly asks for reapproval.
The report is self-contained traceability (contract `uatThreads.buildReport`):
every entry names its owning issue number and links the issue URL, and an
entry whose change came back from an upstream PR also names that PR's number
and links it, labeling an unlanded PR as unlanded. A visual change embeds its
evidence in the thread itself - full-size dark-mode before and after
screenshots under separate headings plus the animated GIF, and a video as
well when the change is motion, scrolling, focus, timing, or gesture-driven -
meeting the upstream PR evidence-format bar with dark captures only,
delivered playable inline or over the tailnet, never as local paths. 8. **accepted**: Alex explicitly accepts phone behavior. Acceptance is
the ONLY human gate in the phone lane; installation is automatic.
Stage vocabulary for reports: proof-ready means simulator-proven and
awaiting the next Test generation - NOT on the phone; phone-test means
installed on the phone awaiting Alex's verdict.
Acceptance is atomic with its successor (`contract.json`
`successorDuty.accepted`): before recording the verdict the coordinator
either creates or wakes the upstream-handoff thread (the schemaVersion-3
acceptance receipt binds its thread id and a title carrying `#issue`)
or records an explicit allowed hold (`awaiting-pr-authority`), which the
transition writes into the work item so the board names what it waits
on. The transition CLI rejects a bare acceptance, and the transition
mirrors the successor binding into the work item, where work-item and
catalog validation require it for every accepted item not named in
`successorDuty.accepted.preDutyAccepted` - so accepted work with no
next actor cannot exist, whether it arrives through the CLI or a
hand-edited block. Dispatch must precede the verdict
(`dispatchedAt <= acceptedAt`); thread liveness is a coordinator
attestation that board reconciliation checks against live turns.
Receipts dated before the duty's `effectiveFrom` remain valid at
schemaVersion 2, and later transitions clear the mirrored
successor/hold. Timestamps are compared as parsed instants, never as
strings; a shape-valid but impossible date fails closed onto the
post-cutover requirements. 9. **pr-open / landed**: a separate grant authorizes PR/push work; babysitting
verifies current-head checks and review feedback. `accepted -> pr-open`
additionally requires the vouched contributor handoff standard
([upstream-handoff.md](upstream-handoff.md), sourced from the product
repo's `CONTRIBUTING_VOUCHED.md`): evidence format, nine-part current
description, branch hygiene with maintainer edits, and the final handoff
checklist recorded in the generation receipt. The ordinary
`accepted -> pr-open -> landed` path and all of its receipts remain the
required path for this work item's own contribution.

## Returning active work to the backlog

`active -> queued`, `proof-ready -> queued`, and `phone-test -> queued` are
deliberate priority demotions, not rejection or rework. `cancelled -> queued`
and `superseded -> queued` are explicit restorations. Every one requires a
`swiftui-priority-decision-receipt` bound to Alex's authority source, the exact
issue and stages, the decision time, and a specific reason. The transition
clears derived head/proof/generation/verdict bindings, preserves the prior
launch receipt for attribution, and re-enters through current-base
materialization.
Alex may send an active item back to the backlog as a scope or priority
decision - it is not a quality verdict, so no reject or rework wording is
recorded and no proof is invalidated. Record the decision as an issue comment
naming the decision-maker and date, restate any acceptance points that
changed, keep the launch binding so the existing branch and worktree stay
attributable, and flip the issue's `lane:<stage>` label with the transition.
The item re-enters delivery through the ordinary queued pull and
re-materializes against the current base.

An active item may also move directly to the existing **landed** stage when
its exact acceptance behavior landed independently upstream. This is a narrow
reconciliation path, not an alternate delivery path. It requires a
`swiftui-external-landing-receipt` with provenance mode
`external-upstream-landing`. The receipt binds the issue and lane, the active
item's exact base and launch-receipt hash, a merged pull request URL and merge
commit, and a successful `git merge-base --is-ancestor` attestation against an
identified live base. Its acceptance mapping must repeat every work-item
acceptance statement exactly once, point each statement to an observed current
source location, and exactly cover a nonempty set of hashes that still match
the repository source bytes when the transition is validated. The source hash
set names the same live-base commit as the ancestry attestation.

The receipt also records every prohibited side effect named by
`contract.json` as false. In particular, reconciliation does not claim proof,
phone acceptance, a generation, or a PR created for this work item. Those
binding fields stay empty. The resulting landed binding reuses
`landedReceiptSha256` and adds only
`landingProvenance: external-upstream`; catalog validation uses that
discriminator to require the external shape instead of the ordinary complete
delivery chain. Since the result is the existing landed stage, dependency
checks such as `satisfiedAt: landed` continue to use the normal stage ordering.
The transition CLI accepts this receipt only through
`--external-landing-receipt`; the ordinary `--landed-receipt` and open-PR
generation receipt inputs cannot substitute for it.

Launch, proof, inspection, phone generation, human acceptance, PR generation,
and landed receipts have separate binding fields. Later checkpoints never
overwrite the identity of earlier ones.

Any head change invalidates proof and everything downstream. Any generation
change invalidates phone acceptance. Each work item reports its own stage,
waiting reason, and receipts; unrelated issues do not create a global hold.

The protocol validates the declared prior-generation receipt and exact logical
carry set. For every new Test or Dev build, a separate immutable composition
plan resolves the exact live
`origin/t3code/rebuild-mobile-app-swift` commit and requires every selected
issue overlay to have that same base. `compose-generation` creates a brand-new
detached worktree at that commit, applies each base-to-head patch once in plan
order, and records patch hashes plus the resulting commit and tree. A prior
combined build is never an ancestor or source base; it supplies membership
only. A moved Theo ref, stale overlay base, or collision fails closed and sends
the affected item back through re-materialization and proof. New phone
generation receipts bind the composition plan and receipt.

The protocol does not yet independently interrogate a phone to prove that receipt is
the generation currently installed; that is a product/tooling attestation gap
to evaluate during the dry-run pilot.

## Runtime boundaries

Repository source uses repo-relative links. Mutable state lives beneath the
declared `~/.local` roots. Product checkout paths, device IDs, simulator IDs,
branches, commits, T3 environment IDs, thread IDs, ports, and signing values
are resolved live and recorded only in receipts.

Parallel Simulator work follows [`simulator-lanes.md`](simulator-lanes.md): one
exact UDID and ordered driver context per lane, with different lanes running
concurrently. Builds use a measured capacity limit (two on the current host)
with private DerivedData and SwiftPM state; preserved app bytes can be installed
into several compatible simulators.

Phone publication is serialized by the atomic
`~/.local/state/t3/swiftui-delivery/phone-publication.lock`. The owner receives
a secret release token; another operation can inspect but cannot replace or
force-release the lease. An unreadable or abandoned lease fails closed for
human review. Xcode build capacity uses keyed slots under the same state
root; simulator runtime ownership is keyed by UDID.

One small deterministic controller keeps the intermittent coordinator duty
live. It is infrastructure, not product work: it never appears on the delivery
board and consumes no implementation, simulator, or phone WIP. Every two
minutes it reads the same canonical status projection, takes a nonblocking
single-instance lock, and either records idle/waiting state or creates/wakes one
dedicated coordinator thread through T3's typed orchestration API. It never
changes GitHub, transitions a work item, fabricates evidence, chooses a verdict,
or performs feature work. The controller itself uses no model and runs without
provider quota; quota can only affect the worker turn it dispatches. Short-lived
local T3 API sessions are minted and revoked per actionable pass, and duplicate
turns are suppressed mechanically.

Before it dispatches, the controller reads the sanitized live Headroom report
and applies the ordered model policy in `contract.json`. A candidate needs at
least 10% in every fresh reported quota lane. An unreported lane is never
treated as zero or as proven capacity; one unknown lane may be used only as a
last-resort probe when the candidate's other required lane is fresh and above
the threshold. Stale data is unknown. A controller-turn error blocks that model
for 15 minutes. Failover creates a new model-bound thread instead of changing
the model on an existing thread. If no candidate qualifies, the controller
records `no-model-capacity` with the sanitized quota evidence and dispatches
nothing.

`scripts/swiftui-delivery/scripts/status --html <path>` resolves those same
issues and receipts into a self-contained visual board. It may read the live T3
projection to report observed worker liveness, but never writes GitHub, T3, or
receipt state. Missing classification and unresolved receipt hashes stay
visible rather than being inferred from prose.

## Flow control: WIP-limited stations, unbounded buffers

The pipeline is a pull system. Stations that consume scarce capacity carry
WIP limits from `contract.json` `flowPolicy.wipLimits`; the buffers between
them are deliberately unbounded:

- **Stations (limited):** active implementation lanes (worker threads),
  simulator proof lanes (one per leased UDID), phone verification (one — it
  is Alex).
- **Buffers (unbounded):** `queued`; implemented-and-unit-tested work waiting
  for a simulator lane; proof-ready work waiting for a phone verdict;
  accepted work under an explicit `awaiting-pr-authority` hold (stage 8's
  successor duty makes a bare accepted item - no handoff thread, no hold -
  unrepresentable, so this buffer always names what it waits on).

Rules:

1. A blocker at one station never idles another. A phone or signing blocker
   affects publication only; implementation, focused tests, and review lanes
   keep pulling from the backlog.
2. While any approved worker provider has usable token capacity, the
   coordinator keeps implementation lanes at their WIP limit: dispatch
   already-ready queued work into open slots first, then replenish. When
   `queued` drops below `flowPolicy.backlog.minQueuedReady`, file new lanes
   only from Alex's explicit SwiftUI and Electron product priorities. The
   upstream contribution queue and React Native parity are discovery and
   provenance, not automatic filing or dispatch sources; they become eligible
   only when Alex explicitly promotes the concrete behavior.
   Parity sources must belong to the current product path. A legacy,
   deprecated, beta-replaced, or disabled path is not a parity authority when
   its successor intentionally removed that behavior; target the successor
   design or leave the item unfiled.
   A parity lane is reference-first: capture screenshots of the feature in
   the React Native mobile app before implementing, reproduce the SwiftUI
   behavior from those references, and where the source has no SwiftUI
   equivalent prefer the idiomatic SwiftUI pattern when it genuinely
   improves on the source.
3. Buffered work ages. An implemented item older than
   `flowPolicy.bufferStaleness.revalidateImplementedAfterDays` days is
   re-validated against the current carry before it may enter a simulator
   lane; the re-materialization cost is the price of a deep buffer, kept low
   by small, file-disjoint items.
4. Setup and self-checks are `scripts/setup` (environment readiness, run on
   any new machine) and `scripts/doctor` (package integrity, zero-test guard,
   state roots, board reachability). A doctor exit of 2 stops dispatch.
