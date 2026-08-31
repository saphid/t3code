# SwiftUI evidence specification

## Required media

Every user-visible work item records exact-base before evidence and exact-head
after evidence. Each phase needs at least one screenshot and one video. A visual
appearance change also needs light and dark screenshots in both phases.

Schema-3 proof names one `laneId`. Each capture records an ID, phase, kind,
exact commit, installed binary hash, Booted assertion, leased simulator
UDID/runtime/device type, lane ID, lease hash, token-free lease-binding artifact,
driver and AXe versions, interaction point dimensions, capture pixel
dimensions, input method and software-keyboard visibility, appearance, UTC
timestamp, expected behavior, observed behavior, artifact path, and SHA-256.
Schema 2 remains readable for retained evidence created before parallel lanes.

The lease-binding artifact must have been generated while that lease was
active. Its exact bytes bind the proof lane, UDID, and active lease hash without
publishing the secret release token. The validator checks all four identities.

Element references are driver-process-local and never cross an invocation.
Use an atomic AXe selector action through `simulator-lane`, or keep observation
and action in one persistent driver process. A screenshot's optimized pixel
size is not an interaction coordinate system; record both dimensions rather than
silently transforming points. HID typing counts as hardware input. When the
software keyboard is evidence, tap its visible keys and keep it visible.

Retained app bytes are content-addressed and may be shared when two builds are
byte-identical. Commit, configuration, platform, product, and executable path
remain separate identity receipts, so identical bytes from different commits
never inherit one another's commit claim. Reuse verifies the full stored tree
and executable before capture.

## Video editing and annotation

Keep the raw screen recording. Prefer RocketSim's free recorder and post editor
for iOS evidence because it provides native touch trails, tap indicators,
pinch/rotate gestures, device bezels, backgrounds, and timeline trimming. Use a
clean, consistent style and remove dead time. Retain inactivity only when the
wait itself proves the reported behavior.

The edit plan remains mandatory regardless of editor. It declares retained
ranges, the reason each range matters, and time-bounded annotations telling the
viewer what to watch. Record the editor and version in the edit receipt and
bind both raw and edited SHA-256 values.

After exporting from RocketSim, run `scripts/annotate-video PLAN --adopt-output
--editor "RocketSim VERSION"`. This does not modify the video; it validates the
plan and records the editor, raw/output hashes, durations, and plan hash.

Use the repo-owned ImageMagick/FFmpeg renderer when an automated receipt or
explicit callout caption is needed. Its default visual language is SF Rounded,
translucent dark cards, cyan gesture marks, and optional highlight boxes. It
supports `tap`, `longPress`, `swipe`, `pinch`, and `rotate` overlays. The
renderer preserves the raw file and writes a receipt containing tool versions,
font, exact command, edit-plan hash, retained ranges, and output hash.

## Agent visual inspection

Inspection is a separate receipt bound to exact proof bytes. It identifies the
reviewing agent, model, and harness. It contains one review row for every
capture and no extras. Each row repeats the artifact hash and records expected
behavior, observed behavior, side effects checked, and verdict. The overall
receipt states whether the implementation matches intent and what unintended
side effects were checked.

Only non-user-visible work may omit media. The proof gives a specific reason
why images and video add no evidence; the inspector independently accepts or
rejects that reason. Convenience, build cost, or simulator trouble are not
valid exceptions.

## Issue embed

The GitHub issue is Alex's review surface, so a user-visible work item's issue
embeds the same media its PR will need (contract `issueEvidence`): full-size
before and after screenshots under separate Before and After headings, light
and dark appearances, the animated GIF, and the interaction video when the
change is motion, scrolling, focus, timing, or gesture-driven. Upload the
proof's artifacts as GitHub issue attachments so they render inline - never
bare local paths - under headings naming the exact base and head commits.
The embed is refreshed whenever proof is replaced and must be current before
the item enters a Test generation or an open-pr plan. Editing the body never
alters the `swiftui-work-item-v2` block's bytes. Non-user-visible work embeds
the recorded no-media reason instead.

Publish with `scripts/publish-issue-evidence --proof PROOF --inspection
INSPECTION --gif GIF --receipt RECEIPT`. The tool validates both receipts,
then sends each image or video as a raw-body `POST` to
`https://uploads.github.com/user-attachments/assets` with the active `gh` OAuth
bearer token, file metadata, and the repository ID. GitHub returns the final
`user-attachments` URL with HTTP 201. The tool manages one marked evidence
section, preserves the work-item fence byte-for-byte, rereads the issue after
editing, and writes a content-bound publication receipt. Browser authorization
is a fallback gate only after this exact token path is proved unavailable for
the target repository or media. Publication receipts are write-once. To reuse
already uploaded URLs after a safe retry, pass the old receipt with
`--reuse-receipt` and write the new result to a different receipt path; the tool
reopens and hashes every local asset before accepting those URL bindings.

The generation-plan validator reopens and validates all of these files. It also
checks candidate eligibility and the exact carry-forward set from the prior
Test receipt. This prevents a Test or phone queue, build, lease, or deployment
before media exists and has been visually reviewed.
