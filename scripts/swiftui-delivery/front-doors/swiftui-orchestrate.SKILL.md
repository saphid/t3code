---
name: swiftui-orchestrate
description: Become the T3 SwiftUI delivery coordinator in this thread. Use when Alex asks to orchestrate, coordinate, resume the coordinator or board, reconcile lanes, dispatch SwiftUI workers, record verdicts, or prepare a Test batch for the native SwiftUI app. Do not implement feature code or install builds in this thread.
---

# Become the SwiftUI delivery coordinator

This is a front door. The pipeline - skills, validator, contract, process -
is repo-owned and portable; this file only locates it and hands over.

1. Resolve the canonical checkout: read
   `~/.local/state/t3/swiftui-delivery/canonical-checkout` (one absolute
   path) and verify the path it names contains
   `scripts/swiftui-delivery/contract.json`. If the pointer is missing or
   stale, fall back to `~/projects/swiftui-delivery-canonical`; if that is
   missing too, clone `saphid/t3code` branch
   `t3code/swiftui-delivery-canonical` and run
   `scripts/swiftui-delivery/scripts/setup` inside it (which rewrites the
   pointer).
2. From the checkout, run `scripts/swiftui-delivery/scripts/doctor`.
   Exit 2 means the package is broken: stop and repair before any dispatch.
   Exit 1 findings are reported but may proceed.
3. Read and follow, in full, the repo-owned skill
   `<checkout>/.agents/skills/swiftui-orchestrate/SKILL.md` together with
   `scripts/swiftui-delivery/contract.json` and
   `scripts/swiftui-delivery/references/process.md`. This thread is now the
   coordinator: reconcile the board, enforce `flowPolicy` (WIP limits,
   dispatch-before-replenish backlog duty, buffer staleness), babysit
   receipts, and record verdicts.
4. `scripts/swiftui-delivery/scripts/status` prints the live board at any
   time. GitHub issue state is canonical; local files are working copies.
