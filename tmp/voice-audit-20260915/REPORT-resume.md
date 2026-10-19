# REPORT-resume: stale status after voice continueThread

Concern: F4 from REPORT-audit.md. One commit, one concern, on branch `agent/voice-resume` in worktree `/Users/aus-m5p-as/projects/t3code-voice-resume` (base 194db89fe5).

## Commit

`1fe161c3c7` fix(voice): continueThread no longer echoes a stale pre-dispatch session error

Files:

- `apps/web/src/voice/tools.ts`: new `postDispatchSessionReadout` helper; `continueThread` now captures the pre-dispatch session from its existing validation read and passes both sessions through the helper.
- `apps/web/src/voice/start.test.ts`: 4 focused regression tests in the existing-thread follow-ups suite.
- `packages/contracts/src/voice.ts`: doc comment on `VoiceStartThreadOutput.session` documenting the stale-readback semantics. No wire shape changed.

## Root cause

Voice tool execution is client-owned (preserved as-is). `continueThread` dispatches `thread.turn.start` and immediately reads the thread back. Server-side, turn acceptance only projects the user message and the turn-start intent; the session projection advances only via `thread.session-set` events emitted by the async provider reactor when it picks the turn up. So the immediate post-dispatch read-back reliably shows the PREVIOUS turn's session state. After a server restart that state is the startup reconciliation error (`ORPHANED_PROVIDER_SESSION_ERROR`, apps/server/src/serverRuntimeStartup.ts:342: "Provider session did not survive a server restart. Send a new message to continue."). The tool echoed it as the follow-up's outcome; the voice agent narrated "worker not working" while the follow-up sent at 01:15:48 to thread e334459e was accepted and completed at 01:17:22 (recovered-evidence.json, REPORT-audit.md F4).

## Fix

`postDispatchSessionReadout(preDispatch, readback)` compares the two sessions (status, lastError, updatedAt):

- Identical state: the read-back describes the previous turn, not the accepted follow-up. Reported as `{ status: "starting", lastError: null }`, the frozen contract's in-flight state ("started means running, not finished" per the broker's delegation instructions). No wait, no sleep, no polling: the dispatch receipt (`commandId`, `messageId`, `dispatchSequence`) remains the proof of acceptance and the new turn identity; completion is never claimed from dispatch.
- Changed state: reported as observed, including a genuine post-dispatch error with a newer updatedAt (real failures are not suppressed).
- Unchanged live in-flight states (`starting`, `running`) and the neutral missing-session `idle` are reported as observed.

Command acceptance, new turn identity, and stale pre-dispatch projection are now distinguished: the receipt proves the first two; the third is never reported as this turn's outcome.

## Verification

- `vp test run apps/web/src/voice/start.test.ts`: 44 passed (40 existing + 4 new). New tests: stale reconciliation error reported as `starting`; genuine post-dispatch error advance reported as observed; running advance reported as observed; unchanged live running reported as observed.
- `vp test run apps/web/src/voice/command-session.test.ts`: 11 passed.
- `vp run --filter ./apps/web --filter ./packages/contracts typecheck`: exit 0 (pre-existing suggestions only, none from this change).
- `vp lint` on the three changed files: clean.
- Dependencies installed via `vp i`; incidental `pnpm-lock.yaml` peer-hash churn from install was reverted, not committed.

## Limitations

- Reproduced and fixed at the tool layer with focused tests; no live server/browser verification (per instructions; parent handles integration and client verification).
- `startThread`'s replay-after-restart path can in principle hit the same stale read-back; left untouched to keep the patch narrow (out of this concern's ownership).
- The broker's `DEFAULT_DELEGATION_INSTRUCTIONS` were not changed; the existing "starting" and "started means running, not finished" wording already covers the new output honestly.
- The helper's staleness test compares the pre- and post-dispatch session triples read from the same environment; a session-set landing between the two reads with an identical triple is theoretically possible but would have to reproduce all three fields exactly.
