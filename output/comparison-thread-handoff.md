# Handoff: compare our voice agent PR vs upstream #11667

## Your task

Compare **our** upstream PR against the independent upstream voice PR, and produce
a comparison the maintainers (and we) can act on: overlap, divergence, and what a
merged outcome should look like.

- **Ours**: pingdotgg/t3code#12034 — "feat(voice): GPT Live voice agent with fast
  commands, existing-thread follow-ups, and integrated voice UX"
  (head `saphid:voice/gpt-live-voice-agent`, 15 commits, based on the
  `v0.0.41-nightly.20260914.1722` cut)
- **Theirs**: pingdotgg/t3code#11667 — "feat(voice): talk to existing threads with
  GPT-Live" by quentinsteinke (open, 2 commits, ~3695+/42-, 38 files, created 2026-09-14)

## Where the code lives locally

- Our PR branch: worktree `/Users/aus-m5p-as/projects/t3code-voice-upstream-pr`
  (branch `voice/agent-upstream-pr`, base commit `112a7088da`).
- Fork Nightly wiring PR (context for how ours ships): saphid/t3code#68.

## What ours covers (15 commits, bottom-up)

1. Server voice broker (`apps/server/src/voice/broker.ts`, ~730 lines + 768 test):
   mints/relays OpenAI Realtime sessions under `/api/voice/sessions` with the
   environment-owned OpenAI key; `voiceLive` capability advertised only while the
   key secret exists.
2. Web voice runtime (`apps/web/src/voice/`, ~9k lines incl. tests): GPT Live
   client, command policy/session, navigation with local completion chimes,
   research + thread tools, tool bridge to the UI.
3. Existing-thread follow-ups: continue threads by voice without creating
   replacements; `continueThread` stale pre-dispatch error fix.
4. Transcript as ordered speaker-labeled chat; durable recoverable session
   history; minimized draggable overlay with silence auto-collapse.
5. UI control discovery/activation with provenance guards (repeated-control
   disambiguation, redirect reporting, click-outcome recording).
6. Voice settings in integration settings UI.

## What theirs covers (from #11667's file list)

- `apps/server/src/voice/VoiceSession.ts` + `liveProtocol.ts` (server-side session
  + protocol, different file layout from our `broker.ts`)
- `packages/client-runtime/src/live-voice/controller.ts` (runtime-level controller)
- `apps/web/src/components/voice-chat/` (VoiceChatButton/VoiceChatDialog,
  browserVoiceTransport, useVoiceChat)
- Mobile: `apps/mobile/src/features/live-voice/` (LiveVoiceCall,
  nativeLiveVoiceTransport, microphoneReservation) — we have no mobile surface
- Touches `RpcAuthorization.ts`, `ws.ts`, `ChatComposer.tsx`

## Comparison angles to cover

1. **Transport/protocol**: their ws-native protocol + browser transport vs our
   HTTP-brokered Realtime session minting. Security posture (auth on the voice
   routes, key handling) side by side.
2. **Existing-thread semantics**: both PRs claim "talk to existing threads" —
   compare the continuation model (thread reuse, error handling, provenance).
3. **Surface area**: web-only (ours, deep UX) vs web+mobile (theirs, thinner web).
   Which pieces are complementary rather than competing.
4. **Server integration seams**: both touch `server.ts`/`ws.ts`/auth — enumerate
   the exact collision points and whether a combined landing is mechanical.
5. **Test coverage and runtime dependencies** (OpenAI key handling, capability
   gating under version skew).
6. **Verdict**: recommend merge order, what to adopt from theirs (mobile,
   controller placement in client-runtime), what we'd ask them to adopt, and the
   minimal combined architecture.

## Suggested method

- `gh pr diff 11667 --repo pingdotgg/t3code` for their side.
- `git -C /Users/aus-m5p-as/projects/t3code-voice-upstream-pr diff 112a7088da..voice/agent-upstream-pr --stat` for ours.
- Read both server files fully before judging the protocol comparison.
- Deliver the comparison as a comment draft we can post on #11667 or #12034.
