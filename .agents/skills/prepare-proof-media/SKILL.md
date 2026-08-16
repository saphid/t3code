---
name: prepare-proof-media
description: Create concise PR and test evidence from raw screen recordings and screenshots. Produce paired clean and annotated MP4 videos and PNG images, visible tap and swipe animations, explanatory captions, deterministic idle trimming, contact sheets, and edit receipts. Use after web, desktop, iOS Simulator, or Android verification. Also use when a proof video, demo, walkthrough, comparison image, or interaction recording needs editing, and before attaching UI media to a PR.
---

# Prepare Proof Media

Preserve the raw capture. Derive matched clean and annotated proof. Use the
bundled script instead of designing an edit in the model context.

## Capture one truthful source

1. Record only the affected flow with the recorder owned by the current test
   surface. Keep secrets and unrelated personal data outside the frame.
2. Record semantic actions in a timeline while driving the UI. Use normalized
   coordinates (`0` to `1`) so annotations survive resolution changes.
3. Leave at least `0.4` seconds before an action and `1.0` second after it so
   the source contains the app's real pressed, transition, and result states.
4. Keep the raw recording immutable. Gesture overlays supplement the real UI
   animation; they never replace a missing or cut-off product response.

Create and append to a timeline without hand-writing JSON:

```bash
MEDIA=.agents/skills/prepare-proof-media/scripts/prepare_proof_media.py
python3 "$MEDIA" timeline-init <timeline.json> --title "Focused proof"
python3 "$MEDIA" timeline-add <timeline.json> --kind tap --at 1.8 \
  --action-id new-session --point 0.84,0.92 --label "New session" \
  --expect "The composer opens without changing projects"
python3 "$MEDIA" timeline-add <timeline.json> --kind swipe --at 3.1 \
  --action-id session-list --duration 0.6 \
  --from 0.5,0.8 --to 0.5,0.3 \
  --label "Session list" --expect "Older sessions remain reachable"
```

Use timestamps from the recorder's source clock or the automation action
history. The renderer performs the source-to-output time mapping.

For a `verify-swift-ios-app-flow` exploration ledger, convert its passed
actions instead of copying the semantic labels or times. The ledger does not
contain screen coordinates, so provide one small normalized action map:

```json
{
  "version": 1,
  "recording_started_at": "2026-08-14T01:00:00Z",
  "actions": [
    { "action_id": "event-1", "point": [0.84, 0.92] },
    {
      "action_id": "event-3",
      "from": [0.5, 0.8],
      "to": [0.5, 0.3],
      "duration": 0.6
    }
  ]
}
```

Then run:

```bash
python3 "$MEDIA" timeline-from-app-flow <agent-session.json> \
  --action-map <visual-action-map.json> --output <timeline.json>
```

The adapter requires exact action coverage and a passed assertion for every
action. It derives relative source times from `recording_started_at`, uses the
stable selector and postcondition for `Next:` and `Expected:`, and binds both
input hashes into the generated timeline. Set an action's `at` in the map only
when the recorder provides an authoritative source-clock timestamp.

Read [timeline-schema.md](references/timeline-schema.md) only when creating or
debugging a timeline by hand.

## Build the proof packet

Require `python3`, `ffmpeg`, `ffprobe`, and ImageMagick 7 (`magick`). Then run:

```bash
python3 "$MEDIA" build \
  <raw-recording.mp4> \
  --timeline <timeline.json> \
  --output-dir <artifact-directory> \
  --stem <proof-name>
```

For a Review Item, bind the finished video packet to the clean, passed private-CI
proof build before catalog assembly:

```bash
python3 "$MEDIA" validate-packet <proof-name-receipt.json> \
  --timeline <timeline.json> \
  --history <app-flow-session.json> \
  --feature-id <review-item-id> \
  --build-receipt <candidate-simulator-or-test-train-receipt.json> \
  --output <validation.json>
```

The private-CI receipt supplies the source revision and run ID. The validator
rejects a failed, planned, dirty, or non-proof build. Do not type these binding
values by hand. It also rejects an app-flow session that started before the
bound build run, so an older capture cannot be relabeled as final-head proof.

The media artifacts are byte-for-byte repeatable on the same machine with the
same tool versions, inputs, and build options. The build emits:

- `<stem>-clean.mp4`: concise footage with no added marks or captions;
- `<stem>-annotated.mp4`: the same cut with animated taps, swipes, and captions;
- matched clean and annotated poster PNGs;
- an annotated contact sheet for quick PR review; and
- `<stem>-receipt.json`: hashes, durations, cuts, mapped actions, and tool
  versions.

The raw source remains the unmodified provenance artifact. The clean MP4 shows
the viewing cut without added marks or captions. Its only edit removes excess
idle time.

Validate an interaction packet before it enters a review or stream receipt:

```bash
python3 "$MEDIA" validate-packet <proof-name-receipt.json> \
  --timeline <timeline.json> \
  --history <agent-session.json> \
  --output <proof-name-validation.json>
```

Omit `--history` for a hand-authored timeline. The validator requires a unique
`action_id`, an expected result, and a rendered `Expected:` caption for every
tap and swipe. It verifies all packet hashes, exact timeline-to-receipt action
mapping, content-probed video metadata and duration, decoded audio equality,
and clean versus annotated visual similarity. For every declared action and
caption window, it fast-seeks to a decodable frame and requires localized
difference in the expected tap, swipe, or caption region. The local similarity
must be below both the whole-video baseline and a fixed ceiling, so neither a
remux nor a lossy annotation-free re-encode can pass. An app-flow timeline
additionally requires its hash-bound session and a passed assertion for every
action. The output is a sealed `proof-packet-validation` receipt with the
verified action inventory and pairing measurements.

For an existing screenshot, select the timeline event that the image proves:

```bash
python3 "$MEDIA" image <raw-screenshot.png> \
  --timeline <timeline.json> \
  --event 0 \
  --output-dir <artifact-directory> \
  --stem <proof-name>
```

This emits `<stem>-image-clean.png`, `<stem>-image-annotated.png`, and
`<stem>-image-receipt.json`. Omit `--event` to annotate the last timeline
event. Keep before and after states as separate source images. Do not compose a
comparison that hides detail.

By default the script shortens long frozen intervals with FFmpeg's
`freezedetect`. For sources with audio, the script shortens only frozen and
silent intervals. This rule keeps spoken narration and audible state changes.
The script protects the lead-in, complete gesture, app response, and every
explicit keep range. Use `--no-auto-trim` when timing itself is the claim.
Use explicit `keep` ranges in the timeline when a moving spinner or animation
prevents freeze detection from recognizing an excessive wait.

The renderer refuses known pairing and API credential shapes in captions, labels,
and expected-result text. Add repeatable `--deny-secret-pattern <regex>` options
for project-specific identifiers that must never appear in rendered evidence.

## Annotate the claim

Write captions for a reviewer who has no task context. Name the action and the
observable expected result, for example:

```json
{
  "kind": "tap",
  "at": 1.8,
  "x": 0.84,
  "y": 0.92,
  "label": "New session",
  "expect": "The composer opens without changing projects"
}
```

The script turns that into a short `Next:` and `Expected:` caption and a tap
pulse. Supply `caption` to override the generated wording. For a swipe, include
`from`, `to`, and `duration`; the annotated cut shows the path and a moving
touch point. Use two to six decisive actions. Do not record a narrated tour.

## Inspect before delivery

1. Compare both videos at the same timestamps. Require the same content and
   duration, with overlays as the only visual difference.
2. Confirm every gesture animation begins just before the real action, remains
   visible during it, and leaves the product response unobscured.
3. Confirm captions describe what is about to happen and the state that proves
   success. Shorten or move them if they cover the affected control.
4. Inspect the contact sheet and both poster PNGs. Rebuild with an explicit
   `--poster-at <source-seconds>` when the default frame is weak.
5. Check the receipt's hashes and duration reduction. Treat a large reduction
   or an unexpected cut as a reason to watch the whole clean cut.

After inspection, use `share-video-evidence` for playable delivery. For a PR,
keep the raw and receipt in private/local evidence storage and attach the clean
and annotated derivatives through the repository's approved media path.
