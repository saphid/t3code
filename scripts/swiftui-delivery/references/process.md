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
7. **phone-test**: only an explicitly authorized, fully validated generation
   plan may be built and installed. A Test plan contains at least one newly
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
8. **accepted**: Alex explicitly accepts phone behavior.
9. **pr-open / landed**: a separate grant authorizes PR/push work; babysitting
   verifies current-head checks and review feedback.

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
