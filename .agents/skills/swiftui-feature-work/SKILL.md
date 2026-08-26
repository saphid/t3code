---
name: swiftui-feature-work
description: Build, test, review, and prove one native T3 Code SwiftUI work item in its isolated worktree. Use when asked to start or resume a specific SwiftUI feature or fix. Do not coordinate other issues, publish a phone build, open a PR, or accept the result.
---

# Build, test, and prove one SwiftUI work item

Finish one exact issue at the `proof-ready` gate. Read
`../../../scripts/swiftui-delivery/contract.json`,
`../../../scripts/swiftui-delivery/references/process.md`, and
`../../../scripts/swiftui-delivery/references/evidence.md` relative to this
skill. For simulator allocation, concurrent UI driving, build reuse, and
recovery, also read
`../../../scripts/swiftui-delivery/references/simulator-lanes.md`. Use the
repo-owned scripts exposed in this skill's `scripts/` directory.

## Bind and reproduce

Verify the issue, `laneId`, launch receipt, base, branch, worktree, T3
environment, project, and thread. Refuse a shared or mismatched worktree.
Acquire the lane's exact simulator through `scripts/simulator-lane`; bind its
receipt hash and use the explicit-UDID runner for concurrent lane work.

Before code changes, build and run the exact base. Preserve the `.app` so the
same build can be reused later:

```sh
scripts/preserve-build preserve path/to/T3.app --commit "$BASE_COMMIT" \
  --configuration Debug --platform iphonesimulator
```

Record a screenshot and raw screen recording that reproduce the issue. Prefer
RocketSim's free capture and post editor for modern touch trails, tap ripples,
pinch/rotate indicators, device frames, and trimming. Keep the raw recording.
Use the repo renderer when automated receipts or explicit callout captions are
needed. Trim dead time, retain intentional waits only when they prove timing or
slowness, and annotate what the viewer should watch:

```sh
scripts/annotate-video before-video-plan.json
```

For an edit exported by RocketSim, bind the existing output without rendering
it again:

```sh
scripts/annotate-video before-video-plan.json --adopt-output \
  --editor "RocketSim 16.4.3"
```

The edited video and edit receipt are proof artifacts. RocketSim output still
needs a checked-in edit plan and a receipt that binds its raw and edited bytes.
The repo-owned fallback uses SF Rounded cards, modern gesture overlays,
ImageMagick, and FFmpeg; it does not depend on FFmpeg's optional `drawtext`
filter.

## Implement and test

Use test-driven work where practical. Run the smallest focused tests and
static checks that prove the behavior. Confirm every selected suite matched at
least one test. Use the repo-owned `$ios-build-hygiene` skill for direct Xcode
builds. Apply protected upstream review specialists only when their domain is
touched. After tests, follow the current explicit reviewer fallback order
supplied by the user or repository policy. Record the actual launcher, model,
exit status, and findings. A failed capacity check is recorded, never disguised
as a review.

## Prove the exact head

Build the exact head and preserve it. On the lane's leased proof simulator,
capture an after screenshot and annotated video that show the intended result.
For visual changes, capture light and dark screenshots before and after. Create
the schema-3 lease binding and satisfy the single capture contract in
`references/evidence.md`; do not restate or weaken that contract here.

Validate `proof.json`, then ask a separate agent pass to perform the complete
visual inspection required by `references/evidence.md`. Completion means both
validators below pass; this skill does not carry a second copy of the policy.

```sh
scripts/swiftui-delivery validate-proof proof.json
scripts/swiftui-delivery validate-inspection inspection.json --proof proof.json
```

Do not queue, build, or install a phone generation. Hand the validated proof
and inspection to `$swiftui-orchestrate`, which binds their exact hashes to the
work item. Use `$share-video-evidence` to make the final recording playable in
T3 after the proof gate passes.

## Vouched contributor build rules

Apply the implementation and proof sections of
`../../../scripts/swiftui-delivery/references/upstream-handoff.md`: find the
cause before choosing a patch; fix state at its owner, never with a display
patch; reuse the convention that already owns the behavior; keep provider
and platform differences at adapter boundaries; represent states in types,
not strings or timing; treat performance as correctness (websocket volume,
render-triggered effects, long-thread scaling); keep the smallest coherent
diff; never let a passing test depend on a sleep; ask before launching
browsers or dev servers; and record what was NOT exercised as plainly as
what was.
