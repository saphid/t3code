---
name: swiftui-orchestrate
description: Coordinate and babysit native T3 Code SwiftUI issue work across shared lanes. Use to select ready work, create isolated worktrees and threads, reconcile receipts, record verdicts, audit drift, or prepare an evidence-gated Test batch. Do not implement code or install builds.
---

# Orchestrate and babysit SwiftUI delivery

Read `../../../scripts/swiftui-delivery/contract.json` and
`../../../scripts/swiftui-delivery/references/process.md` relative to this skill. GitHub
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
