# Voice history: durable recoverable session history

Thread `554d4caa-8fcd-4c14-bcd2-b23b5980b0db`, worktree `/Users/aus-m5p-as/projects/t3code-voice-history`, branch `agent/voice-history`.

## Commit

`60de21447b` feat(web): durable recoverable voice session history

Base: `edac977131` (the chronological transcript commit), itself on shipped fork voice build `194db89fe5`. `pnpm-lock.yaml` churn from `vp i` was left uncommitted.

## What was built

- `apps/web/src/voice/history.ts`: tolerant localStorage-backed store (index key plus one payload key per session, the index.ts guarded-storage pattern) and a recorder that folds the panel's client event stream into chronological entries: utterances (speaker, stable utterance key, text, timestamps), timing marks, errors, direct command results, navigation outcomes with target identities, and tool calls.
- Tool records carry sanitized bounded outcome fields for diagnosis: dispatch identity and sequence (requestId/commandId/messageId/dispatchSequence), target session status and lastError, environment status and in-band error, open acknowledgment and selected destination, and listControls/clickControl controlId/name/state/message. The stale-session incident shape (a resolved continueThread whose target session reports lastError) is persisted and export-tested; semantic refusals (disabled control) and in-band environment failures are recorded even though the tool resolved. `controlId` is allowlisted in inputs for the controls worker's tools.
- Never recorded: audio (no audio reaches the module), credentials or tokens (input/output allowlists, negative-tested), raw thread contents, model reasoning.
- Write discipline: transcript deltas fold in memory; storage is touched only at boundaries (new utterance opens, non-transcript event, session end, explicit flush) and each write touches only the active session key. Retention bounded at 20 sessions of at most 500 entries, oldest trimmed with payload deletion.
- Lifecycle: controller opens a record at connect, records the same event stream the panel displays (both fast-command and managed paths, since the controller subscribes to the outer client), records navigation with environment/thread identity, and ends the record on end, dispose, or the client's closed state. Session identity is the Live session id once minted.
- UI: `VoiceHistory.tsx` section in the panel; review (session list with counts), per-session Delete, Export JSON download, Clear all. Clear/delete freeze while live. Export/Clear/Delete covered by tests; recorder is a useSyncExternalStore-compatible snapshot source, so no effects or polling.
- Scope: client-local only, documented in `docs/user/voice-history.md` and the module header: web and desktop share saved history only when they resolve to the same browser profile origin; Electron storage partitions can be separate; mobile is separate; nothing syncs to the server. Also linked from `docs/user/voice.md`.

## Checks

- `vp test run apps/web/src/voice`: 14 files, 272 tests, all pass (31 new tests: store round-trip/trim/tolerant decode, no-write-per-delta, utterance folding and identity, stale-session and in-band-failure and control-refusal outcome persistence plus export round-trip, secret-dropping, reconnect separation, reload recovery, flush, snapshot/subscribe, export payload; controller-level event/tool/navigation/error recording, reconnect separation, failed tool; VoiceHistory rendering and frozen state).
- `tsc --noEmit` (apps/web): clean.
- `vp lint apps/web/src/voice`: no new warnings (8 pre-existing baseline warnings unchanged).

## Limitations

- Covering "actual close/reconnect/remount" is done at the unit/integration level (controller reconnect separation, recorder reload recovery over the same storage, pagehide flush registered in the panel); a real browser or desktop pass is left to the parent's integrated verification, per instructions.
- History is per client; a session witnessed only by the desktop app will not appear in a browser on another profile, and nothing is recoverable from the server side.
- Text fields are capped at 2000 characters and controls at 10 entries per tool outcome; the transcript record is bounded, not a full thread archive.
- Export is a JSON download (browser Blob); no import path.
- The controls tools (listControls/clickControl) do not exist on this base; their recording is shape-tolerant and tested against fixtures matching the agreed field names, so integration depends on the controls worker using controlId/name/state/message as reviewed.
