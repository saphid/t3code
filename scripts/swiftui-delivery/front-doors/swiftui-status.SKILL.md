---
name: swiftui-status
description: Show the exact state of the T3 SwiftUI delivery pipeline - every OPEN work item, its stage and lane (closed/landed history stays on GitHub), station occupancy vs WIP limits, buffer depths, backlog health, and drift. Use when Alex asks what is in flight, what is waiting on him, where a feature is up to, or for a board/status report. Read-only.
---

# SwiftUI delivery status

1. Resolve the canonical checkout: read
   `~/.local/state/t3/swiftui-delivery/canonical-checkout` and verify the
   path it names contains `scripts/swiftui-delivery/contract.json`; if the
   pointer is missing or stale, try `~/projects/swiftui-delivery-canonical`;
   if that is missing too, clone `saphid/t3code` branch
   `t3code/swiftui-delivery-canonical` and run
   `scripts/swiftui-delivery/scripts/setup` inside it (which rewrites the
   pointer).
2. Run `<checkout>/scripts/swiftui-delivery/scripts/status` (add `--json`
   for structure). It lists every open work item with stage, lane, and hold;
   station occupancy against `flowPolicy` WIP limits; buffer depths; backlog
   floor state; and DRIFT rows (label/block disagreement or legacy issues
   without a work-item block).
3. Report to Alex, ordered by what needs him: phone-test items first (his
   acceptance verdicts), then proof-ready items (awaiting a phone slot),
   then holds, then station/backlog health, then
   drift worth fixing. Do not mutate anything from this skill.
4. Optionally run `scripts/swiftui-delivery/scripts/doctor` for package
   health when something looks wrong.
