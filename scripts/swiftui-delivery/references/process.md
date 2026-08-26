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
   exact proof and inspection hashes.
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

Every generation plan also binds a dependency-closure catalog. The validator
reopens it, rejects missing or duplicate issues and cycles, requires each plan
work item to match its catalog entry exactly, and checks every dependency's
observed stage against `satisfiedAt`. An unrelated issue outside the closure
does not enter the catalog and cannot create a global hold.
   On every new install the coordinator opens a `UAT <build>` thread per
   contract `uatThreads` so Alex always has a guided test script for what
   just landed on the phone.
8. **accepted**: Alex explicitly accepts phone behavior. Acceptance is
   the ONLY human gate in the phone lane; installation is automatic.
   Stage vocabulary for reports: proof-ready means simulator-proven and
   awaiting the next Test generation - NOT on the phone; phone-test means
   installed on the phone awaiting Alex's verdict.
9. **pr-open / landed**: a separate grant authorizes PR/push work; babysitting
   verifies current-head checks and review feedback. `accepted -> pr-open`
   additionally requires the vouched contributor handoff standard
   ([upstream-handoff.md](upstream-handoff.md), sourced from the product
   repo's `CONTRIBUTING_VOUCHED.md`): evidence format, nine-part current
   description, branch hygiene with maintainer edits, and the final handoff
   checklist recorded in the generation receipt. The ordinary
   `accepted -> pr-open -> landed` path and all of its receipts remain the
   required path for this work item's own contribution.

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

The protocol validates the declared prior-generation receipt and exact carry
set. It does not yet independently interrogate a phone to prove that receipt is
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

There is no background label auditor, custom dispatch daemon, or second
deployment runtime. The orchestrator follows GitHub work items and durable
receipts using the tools already provided by T3 Code and the product repo.

## Flow control: WIP-limited stations, unbounded buffers

The pipeline is a pull system. Stations that consume scarce capacity carry
WIP limits from `contract.json` `flowPolicy.wipLimits`; the buffers between
them are deliberately unbounded:

- **Stations (limited):** active implementation lanes (worker threads),
  simulator proof lanes (one per leased UDID), phone verification (one — it
  is Alex).
- **Buffers (unbounded):** `queued`; implemented-and-unit-tested work waiting
  for a simulator lane; proof-ready work waiting for a phone verdict;
  accepted work waiting for PR authority.

Rules:

1. A blocker at one station never idles another. A phone or signing blocker
   affects publication only; implementation, focused tests, and review lanes
   keep pulling from the backlog.
2. While any approved worker provider has usable token capacity, the
   coordinator keeps implementation lanes at their WIP limit: dispatch
   already-ready queued work into open slots first, then replenish. When
   `queued` drops below `flowPolicy.backlog.minQueuedReady`, file new lanes
   from the upstream contribution queue and the React Native mobile app
   parity gap — as housekeeping that never delays dispatch of ready work.
3. Buffered work ages. An implemented item older than
   `flowPolicy.bufferStaleness.revalidateImplementedAfterDays` days is
   re-validated against the current carry before it may enter a simulator
   lane; the re-materialization cost is the price of a deep buffer, kept low
   by small, file-disjoint items.
4. Setup and self-checks are `scripts/setup` (environment readiness, run on
   any new machine) and `scripts/doctor` (package integrity, zero-test guard,
   state roots, board reachability). A doctor exit of 2 stops dispatch.
