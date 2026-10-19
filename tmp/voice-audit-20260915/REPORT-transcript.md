# Voice transcript: ordered speaker-labeled chat

Worker: opencode, enablers/xlarge (GLM 5.3 Flash), single thread, no children.
Worktree: /Users/aus-m5p-as/projects/t3code-voice-transcript-chat, branch agent/voice-transcript-chat, base 194db89fe5 (shipped fork voice build).

## Commit

- 2a7c3e7aa6 `fix(web): voice panel transcript renders as ordered speaker-labeled chat` (11 files, +508/-54)

## Problem

The voice sidebar appended every input delta into one paragraph and every output delta into
another, so a multi-turn session produced two growing blobs: all user speech at the top, all
assistant speech at the bottom.

## Approach

- live-client.ts: transcript events now carry a stable `utterance` key (`in-N` / `out-N`). The
  Live protocol's `session.input_transcript.delta` / `session.output_transcript.delta` payloads
  carry no item ids, so boundaries come from what the client actually sees: a channel flip (user
  spoke after the assistant or vice versa) and `session.delegation.created`, which closes the
  accumulated input utterance. Typed text (`sendText`) is surfaced as its own input utterance.
- voicePanelController.ts: `VoicePanelState.utterances` (ordered, oldest first) replaces the two
  transcript strings. Deltas fold by utterance key; late or interleaved deltas append to their
  matching entry in place, keeping reading order stable. Retained entries cap at the latest 200.
  Connect resets, Clear empties, End keeps the transcript readable.
- VoiceTranscript.tsx: renders the ordered list with `You:` / `Assistant:` labels
  (`data-voice-utterance`, `data-voice-speaker` hooks), `max-h-64` bounded height with
  `overflow-y-auto`, and scroll-follow only when the reader is already at the bottom
  (`isNearBottom`, threshold 24px); scrolling up into history is never yanked back down.
- command-session.ts (fast commands wrapper): its synthetic typed-text event emits the new
  utterance field with a `typed-N` key (no collision with voice-derived keys).
- docs/user/voice.md: "Using voice" section documents the ordered labeled transcript, streaming
  in place, the 200-entry window, bottom-only auto-follow, and Clear/reconnect behavior.
- Another worker's scope (tool execution, contracts) untouched; no contract schema changes were
  needed because the utterance key is derived client-side from existing protocol events.

## Verification

- `vp test run` on 5 focused files, all pass: live-client.test.ts,
  ui/voicePanelController.test.ts, ui/VoiceTranscript.test.tsx (new), command-session.test.ts,
  index.test.ts. 94 tests.
  - New live-client tests: channel-flip utterances across a multi-turn conversation;
    delegation.created closes the input utterance; typed text becomes its own utterance.
  - New controller tests: ordered labeled folding, interleaved multi-turn with interruption,
    late delta folding in place, 200-entry cap, clear and reconnect resets.
  - New render tests: arrival order with speaker labels, entry keys, bounded scroll container,
    `isNearBottom` follow/no-follow decision.
- `tsc --noEmit` in apps/web: clean (pre-existing effect suggestions filtered, none from this
  change).
- `vp lint` on changed files: no new warnings (remaining warnings pre-exist in live-client.ts and
  VoicePanel.tsx).
- `vp fmt` applied to apps/web/src/voice and docs/user/voice.md.
- pnpm-lock.yaml churn from `vp i` reverted; commit contains only the concern.

## Limitations

- The Live transcript deltas expose no item ids, so two assistant responses with no intervening
  input and no delegation boundary merge into one entry; likewise consecutive user utterances
  without assistant speech or a delegation merge. This matches the protocol's actual observable
  boundaries; if the server later adds item ids to the delta payloads, the client can adopt them
  directly.
- A late output delta that arrives after the user started speaking again opens a new assistant
  entry rather than teleporting text upward; without protocol ids this is the safest placement.
- Utterance keys reset per client instance; the panel controller resets utterances on connect, so
  cross-session keys never collide.
- Verification was headless by design: no dev server, browser, or live Live session. Parent owns
  integration and client verification.
