# Proof timeline schema

Times are seconds in the raw recording. Coordinates default to normalized
fractions of width and height; set `coordinate_space` to `pixels` only when the
capture resolution is fixed.

```json
{
  "version": 1,
  "title": "Create a session from the project screen",
  "coordinate_space": "normalized",
  "poster_at": 4.2,
  "keep": [
    { "start": 0.0, "end": 1.0 },
    { "start": 3.5, "end": 5.2 }
  ],
  "events": [
    {
      "action_id": "new-session",
      "kind": "tap",
      "at": 1.8,
      "x": 0.84,
      "y": 0.92,
      "label": "New session",
      "expect": "The composer opens"
    },
    {
      "action_id": "session-list",
      "kind": "swipe",
      "at": 3.0,
      "duration": 0.55,
      "from": [0.5, 0.78],
      "to": [0.5, 0.32],
      "label": "Session list",
      "expect": "Older sessions remain reachable"
    },
    {
      "kind": "caption",
      "start": 4.0,
      "end": 5.5,
      "caption": "Proof: the draft remains in the selected project"
    }
  ]
}
```

## Top-level fields

- `version`: required integer, currently `1`.
- `title`: optional receipt label.
- `coordinate_space`: `normalized` (default) or `pixels`.
- `poster_at`: optional source timestamp for the paired poster images.
- `keep`: optional source intervals protected from automatic idle removal.
- `events`: ordered or unordered action and caption objects. The builder sorts
  them by source time.

## Event fields

All events accept `caption` as exact on-screen wording and optional
`caption_start` / `caption_end` source timestamps. Set `caption_position` to
`top` when the bottom band would cover the behavior under test; it defaults to
`bottom`.

- `tap`: require `at`, `x`, and `y`; use `label` and `expect` to generate a
  caption when `caption` is absent.
- `swipe`: require `at`, `from`, and `to`; `duration` defaults to `0.6` seconds.
- `caption`: require `caption`; use `start` / `end`, or `at` plus `duration`.

Automatic captions begin shortly before an action. `label` names the control
or gesture; `expect` names a visible postcondition rather than an internal
implementation result. An `expect` must be one trimmed line. Captions must fit
within three rendered lines; shorten the action or expected result if the
builder rejects a longer caption.

`validate-packet` requires every tap and swipe to have a unique `action_id` and
a non-empty `expect`. `timeline-add` assigns `action-1`, `action-2`, and so on
when `--action-id` is omitted. A custom action caption must contain the exact
line `Expected: <expect>`, where `<expect>` is that event's complete `expect`
value.

## Explicit cuts

Set top-level `cuts` to a list of source `{start, end}` intervals to bypass
freeze-derived editing completely. Cuts must be ordered, non-overlapping, and
contain every event. Use this for timing-sensitive demonstrations or moving
loading states that cannot be classified as frozen frames.

## App-flow action-map adapter

`timeline-from-app-flow` accepts a version 1 `app-flow-agent.py` session plus a
version 1 visual action map. The map has `recording_started_at` and one `actions`
entry for every semantic `act` event. Each entry names `action_id` and supplies
either `point` for a tap or `from`, `to`, and optional `duration` for a swipe.
Use normalized coordinates. An explicit per-action `at` overrides wall-clock
conversion when the recorder has its own source-clock timestamp.

The adapter rejects missing, duplicate, or unknown action IDs and actions with
no passed assertion. The generated timeline records the SHA-256 hash of both
inputs. Optional action-map fields are `title`, and per action `kind`, `label`,
`expect`, `caption`, and `caption_position`.

## Packet validation receipt

`validate-packet` accepts a version 1 video edit receipt and its exact timeline.
Pass `--history` when the timeline has `source_history`. The version 1 output
has `kind: proof-packet-validation`, `verdict: passed`, the input hashes, the
verified source and artifact inventory, one record per action, video/audio
pairing measurements, and decoded-frame hashes plus cropped local-similarity
evidence for every action and caption window. Standalone caption ids use the
qualified form `event-<index>`. Tool versions and a SHA-256 seal cover the
canonical JSON payload without `seal`. The command writes no receipt on failure
and replaces an existing receipt only with `--overwrite`.
