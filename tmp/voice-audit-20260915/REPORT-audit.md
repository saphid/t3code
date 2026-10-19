# Voice session audit, 2026-09-15 00:00-01:25 UTC

Bounded read-only audit. Sources: window.txt, prior-thread.json, amp-window.txt, the fork code at t3code-oracle-settings-replay-v2, `~/.t3/userdata/logs/*`, and the live T3 projection database read through t3_read.py / read-only sqlite. No live state was written except this report and one log-snapshot file in this directory. No credentials touched.

## What actually happened (evidence timeline, UTC)

From `~/.t3/userdata/logs/server.trace.ndjson.{7,8,9,10}` (captured before log rotation removed them; one surviving line saved to `captured-server-voice-spans.ndjson`):

- 01:15:13.812 POST /api/voice/sessions, status 200. Voice session started in Fork Nightly build 0.0.41-nightly.20260914.1722956577 (user agent in span attributes).
- 01:15:29 to 01:19:42: roughly 25 POST /api/voice/backend calls. These are delegated backend-model turns. Spans carry no request or response payloads.
- 01:22:15.655 POST /api/voice/sessions/close, status 200. Session ended.
- 01:22:17.065 POST /api/voice/sessions, status 200. Reconnect attempt.
- 01:23:49.899 POST /api/voice/sessions/close, status 200. Final close. This matches "Voice Ended" in window.txt.

The projection database shows what the voice session did to real threads:

- 01:15:48 user message in thread e334459e (Project Factory Icon Concepts, gcp-project-factory-migration): "It appears the previous work got stuck. Please try again from the current task, resume the work, and report progress or any blocker." This is the voice follow-up delivered to an existing thread. It did continue the correct thread.
- 01:17:03 voice-created thread 6285911b "Investigate Thread Resume Failure", created in project gcp-project-factory-migration. Alex stopped it at 01:17:40: "the thread was created in the wrong project."
- 01:22:12 Alex dictated the review request that spawned this audit (thread 1b121276).
- amp-window.txt shows the second Fork Nightly window sitting on the pairing screen with "Invalid pairing token. Check the token and try again."

## Distinct observed failures

### F1. Transcript renders as two growing buckets, not a chat

- Evidence: `apps/web/src/voice/ui/voicePanelController.ts:202-205` appends every input delta to `state.inputTranscript` and every output delta to `state.outputTranscript`; `VoiceTranscript.tsx` renders two paragraphs, "You:" then "Assistant:".
- Expected: chronological interleaved utterances. Actual: all user speech in one block, all assistant speech in another.
- Status: implementation worker already dispatched (transcript thread). Listed for completeness.

### F2. Transcript and tool-call history are memory-only; nothing is recoverable after End

- Evidence:
  - `voicePanelController.ts` connect() resets both transcript strings to "" (lines ~264-265) and clear() resets them again (lines ~381-382). A reconnect or Clear erases the record.
  - No voice tables exist in `~/.t3/userdata/state.sqlite` (table list inspected). Voice settings and pending worker-delivery records are stored, but not conversation or tool outcomes (confirmed by the parent thread's own check and by code inspection: only `t3code:` localStorage preference keys in `voice/ui/preferences.ts`).
  - Server trace spans for /api/voice/\* carry URLs, methods, and status codes only, never payloads. Desktop trace has zero lines containing "voice".
  - The parent thread asked "doesn't it get saved as a log somewhere?" and its own search found nothing; this audit confirms that.
- Expected: a voice session leaves a readable record (like a thread does). Actual: nothing durable exists client- or server-side.
- Recovery assessment for the lost 01:15-01:24 conversation: raw user/assistant utterances are unrecoverable. Only indirect fragments survive: (a) the full investigate prompt the voice agent wrote into thread 6285911b, which quotes its own tool results; (b) the follow-up message delivered to thread e334459e at 01:15:48; (c) HTTP span timings listed above. Anything not echoed into a thread is gone. Do not infer transcript content beyond these fragments.
- Test proposal: unit test that a controller-level persistence hook (or a new store) survives close(), clear(), and app relaunch; assert utterance and tool-outcome records are written with timestamps and survive a remount.

### F3. Voice-created thread landed in the wrong project

- Evidence: voice session created thread 6285911b at 01:17:03 in project gcp-project-factory-migration; Alex stopped it at 01:17:40 saying it was created in the wrong project. The voice agent had openThread context for the correct environment but startThread still used the wrong project.
- Expected: a voice "make a thread to investigate X" request creates the thread in the project/environment of the conversation context (or asks). Actual: default/last project won.
- Test proposal: in the tools layer, a startThread call with an active openThread destination must resolve the destination's project; test the ambiguous case falls back to asking, not to a default project.

### F4. continueThread surfaced a stale-session error and the agent misread worker state

- Evidence: quoted verbatim inside the 6285911b prompt: "continueThread returned environment ok but session status error with: 'Provider session did not survive a server restart. Send a new message to continue.' The assistant interpreted this as the worker not resuming. The user pointed out a new message had just been sent." Alex's own words: "why the assistant concluded its worker was not working when the user says it actually was."
- Expected: after a server restart, a follow-up either transparently resumes the provider session or reports clearly that the worker is alive and queued. Actual: a raw session error reached the voice conversation and the agent narrated "not working", contradicting visible reality.
- Test proposal: contract test that a follow-up to a thread whose provider session predates a server restart resumes or requeues instead of erroring; and that the error text returned to the voice layer distinguishes "session stale, message queued" from "worker failed".

### F5. openThread acknowledged success but the user perceived slow or no navigation

- Evidence: same prompt context: "openThread returned environment status ok and acknowledged true", yet Alex asked why opening "appeared slow rather than instant" and said it seemed stuck, then asked it to try again.
- Expected: acknowledged navigation is visibly instant. Actual: acknowledgment succeeded but the visible client state apparently lagged or did not change on the surface Alex watched.
- Gap: this is the weakest-evidence item. The client-side navigation outcome at 01:15-01:17 is not captured anywhere, so "slow" versus "silent failure needing retry" cannot be distinguished. Do not treat as confirmed; the controls/discovery worker's outcome-reporting work overlaps here.

### F6. Second Fork Nightly window stuck at pairing with "Invalid pairing token"

- Evidence: amp-window.txt (full accessibility capture of a second Fork Nightly window): URL t3code://app/#/pair, text "Invalid pairing token. Check the token and try again.", visible before 01:26.
- Expected: a second window of the same desktop app reuses the desktop-managed pairing credential. Actual: pairing screen with an invalid-token error.
- Gap: no log lines were tied to this window; cause (stale token, relay, older build) is undetermined. The user agent in surviving server spans shows one window on the 1722956577 build; the pairing window's build is unknown.

## Development-era evidence (not new session failures)

prior-thread.json (thread bfacf98a "GPT Live T3 Code Feedback Loops", 2026-09-14 06:20 to 2026-09-15 01:12) documents the build campaign: latency measurements (sidebar 55 ms, typed 3.82 s, spoken 4.35 s improved to 1.28 s), the chime-instead-of-narration fix, the existing-thread-follow-up fix with regression tests, the Nightly releases 1722956576 and 1722956577, one CI failure from a missing `window` guard that was fixed, and key setup plus Settings page work. These are completed development reports. The 01:15-01:24 voice session is the first recorded real use after that build and is the source of F3-F6.

## Bottom line

- The recent voice conversation cannot be recovered in raw form. Persistence is absent by design today, not merely unlogged. F2 is the enabling failure: without durable utterance and tool-outcome records, every future voice incident will be as opaque as this one.
- Failures with hard evidence: F3 (wrong-project thread creation) and F4 (stale provider session mishandled). F1 and F2 are code-confirmed. F5 and F6 are observed but under-evidenced.
- Suggested priority for fix threads beyond the two already dispatched: F2 (persistence) first, since it is the auditability prerequisite, then F4, then F3.
