# SwiftUI evidence specification

## Required media

Every user-visible work item records exact-base before evidence and exact-head
after evidence. Each phase needs at least one screenshot and one video. A visual
appearance change also needs light and dark screenshots in both phases.

Every capture records an ID, phase, kind, exact commit, installed binary hash,
Booted assertion, device, appearance, UTC timestamp, expected behavior,
observed behavior, artifact path, and artifact SHA-256.

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

The generation-plan validator reopens and validates all of these files. It also
checks candidate eligibility and the exact carry-forward set from the prior
Test receipt. This prevents a Test or phone queue, build, lease, or deployment
before media exists and has been visually reviewed.
