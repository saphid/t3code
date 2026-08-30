---
name: file-swiftui-lane-issue
description: Capture one native T3 Code SwiftUI feature or fix as an issue-backed work item in exactly one delivery lane. Use when asked to capture, file, log, or queue native SwiftUI work. Do not use to implement, test, publish, or land it.
---

# Capture one SwiftUI work item

Create or update one GitHub issue and put its delivery state in one fenced
`swiftui-work-item-v2` JSON block. Read `../../../scripts/swiftui-delivery/contract.json`
and `../../../scripts/swiftui-delivery/references/process.md` relative to this skill before
acting. Run `scripts/swiftui-delivery` from this skill for validation.

A lane is a named work stream. It can contain many issues. A work item is the
state and proof for exactly one issue, and it names exactly one `laneId`.
Neither the issue nor the work item owns its lane.

## Capture

1. Read the product repository instructions and resolve the current SwiftUI
   base live. Recorded paths, IDs, and SHAs are evidence, never configuration.
2. Search open and closed issues for the same user outcome. Update a true match
   instead of creating a duplicate.
3. Classify intake provenance. File only an Alex-requested SwiftUI or Electron
   outcome (`alex-priority`, `swiftui-product`, or `electron-product`). The
   upstream contribution queue and React Native parity are discovery inputs,
   not automatic work sources; do not create an issue from either unless Alex
   explicitly promotes the concrete behavior.
4. Write observable acceptance statements. Assign one existing or intentionally
   new `laneId`, a rank within that lane, and typed dependencies. For a port of
   a web or React Native feature, capture reference screenshots of that feature
   in the React Native mobile app first, attach them to the issue, and derive
   the acceptance points from what they show.
5. If authorized, create the issue first so GitHub assigns its number. Then add
   exactly one validated block and one stage label.

```swiftui-work-item-v2
{
  "schemaVersion": 2,
  "kind": "swiftui-work-item",
  "issue": "saphid/t3code-personal#123",
  "laneId": "native-ui",
  "rank": 10,
  "stage": "queued",
  "classification": {
    "category": "feature",
    "surface": "ui",
    "source": "alex-priority",
    "upstream": [
      {
        "kind": "issue",
        "reference": "pingdotgg/t3code#1234"
      }
    ]
  },
  "acceptance": ["An observable outcome"],
  "dependencies": [],
  "binding": {
    "baseCommit": null,
    "headCommit": null,
    "launchReceiptSha256": null,
    "proofSha256": null,
    "inspectionSha256": null,
    "phoneGenerationReceiptSha256": null,
    "acceptanceReceiptSha256": null,
    "prGenerationReceiptSha256": null,
    "landedReceiptSha256": null
  }
}
```

`classification.category` and `classification.source` use the contract's `workItemClassification`
categories. `surface` is exactly `ui` or `non-ui`. Record every known upstream
issue or pull request with an exact `kind` and an
`owner/repository#number` reference; leave the array empty only when there is
no upstream record yet. Existing work items without this object remain valid,
but the dashboard shows them as unclassified until their next normal issue
update.

Validate the extracted JSON:

```sh
scripts/swiftui-delivery validate-work-item work-item.json
```

Before updating an existing issue, compare its live `updatedAt` and fenced
block hash with the values used to prepare the write. Refuse a changed issue
and re-plan. Include a unique operation marker in the single intended write,
read the issue and labels back, and match the exact marker. A dry run performs
no live reads or writes and never invents an issue number.

Complete when the issue has testable acceptance statements, one lane
membership, valid dependencies, one canonical block, one matching stage label,
and a successful read-back.

## Vouched contributor intake fields

Per `../../../scripts/swiftui-delivery/references/upstream-handoff.md`, the
issue body must state the problem in user terms (triggering action, current
behavior, expected behavior) and carry an affected-surface map: which entry
points, clients, providers, contract/server/projection layers, and
connection modes the change touches, the reverse action, and any unsupported
paths. Most items touch only a few surfaces — name them rather than listing
everything.
