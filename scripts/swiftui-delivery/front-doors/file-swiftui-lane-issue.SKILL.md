---
name: file-swiftui-lane-issue
description: Capture a new bug or feature for the native T3 SwiftUI app as a delivery lane issue. Use whenever Alex describes SwiftUI app behavior to add, fix, or change and it should enter the delivery pipeline. Files one issue with acceptance points and a work-item block; does not implement anything.
---

# File a SwiftUI lane issue

Front door only - the canonical intake procedure is repo-owned.

1. Resolve the canonical checkout: read
   `~/.local/state/t3/swiftui-delivery/canonical-checkout` and verify the
   path it names contains `scripts/swiftui-delivery/contract.json`; if the
   pointer is missing or stale, try `~/projects/swiftui-delivery-canonical`;
   if that is missing too, clone `saphid/t3code` branch
   `t3code/swiftui-delivery-canonical` and run
   `scripts/swiftui-delivery/scripts/setup` inside it (which rewrites the
   pointer).
2. Read and follow `<checkout>/.agents/skills/file-swiftui-lane-issue/SKILL.md`
   with `scripts/swiftui-delivery/contract.json`. In short: search OPEN
   AND CLOSED issues in the `workItemRepository` (`saphid/t3code-personal`)
   for a true match and update it rather than duplicating; otherwise draft
   phone-checkable acceptance points from Alex's description, classify the
   source, and choose or
   create the lane, file ONE issue containing a fenced
   `swiftui-work-item-v2` block at stage `queued` with rank and typed
   dependencies, apply exactly one `lane:queued` label, and verify both
   writes by reading them back.
   Do not file from upstream-contribution intake or React Native parity unless
   Alex explicitly promoted that concrete SwiftUI or Electron behavior.
3. Confirm to Alex: issue number, lane, acceptance points, and that the
   orchestrator will pick it up from `queued` on its next pass.
