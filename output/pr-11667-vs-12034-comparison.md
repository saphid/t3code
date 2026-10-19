# Cross-review: #11667 (quentinsteinke) vs #12034 (ours)

Draft comment for pingdotgg/t3code#11667 (cross-postable to #12034). Both PRs ship a GPT-Live voice agent against `api.openai.com/v1/live/sessions` with WebRTC client media and a server-held OpenAI key. They overlap on intent and diverge on almost every layer below that. Written from reading both server implementations in full.

## 1. Transport, protocol, and security posture

| | #11667 (theirs) | #12034 (ours) |
|---|---|---|
| Control plane | 2 RPC methods (`voiceStart`/`voiceStop`) over the existing authenticated WebSocket, per-socket session | HTTP routes under `/api/voice/sessions*`, `/api/voice/settings*`, `/api/voice/backend`, each with its own auth |
| Key source | `process.env.OPENAI_API_KEY`, read at call time, never logged | `ServerSecretStore` `openai-api-key` secret, read per mint, settable and clearable in the settings UI |
| Delegation | GPT-Live native: `delegation: { type: "client" }`. Server attaches a sideband WebSocket (`/v1/live/sessions/{id}/attach`), receives transcript deltas and `session.delegation.created`, builds the delegation prompt from the server-held transcript, dispatches `thread.turn.start` | Client-relayed Responses bridge: the Live session gets `voice.*` function tools, the web runtime relays tool calls to `/api/voice/backend`, which calls `/v1/responses` with the environment key. Also supports a server-side `delegation: { type: "responses" }` mode |
| Client-event hardening | Pins `allowed_client_events`/`allowed_server_events` in the session payload (only close/mute/unmute out) | Not pinned client-side |
| Hangup accounting | Unconfirmed-hangup tracking: a session OpenAI did not confirm closed blocks new calls until a retry confirms | Broker retains session ids and usage in memory; close is a local state flip, no upstream confirmation |
| Capability gating | None (the methods exist whenever the server has the code) | `voiceLive` flag on the environment descriptor, advertised only while the key secret exists, so clients hide the entry point under version skew |
| Thread data to OpenAI | Eager: title, model selection, last 12 messages (500 chars each) sent as session context at mint | None at mint; thread content reaches OpenAI only when a voice tool reads it |

Both keep the key off the client and issue no ephemeral keys. Theirs has the better protocol hygiene: event allowlist, unconfirmed-hangup discipline, per-socket ownership (one call per connection), bounded server-side transcript, prompt-injection hardening in the instructions. Ours has the better operational posture: secret store instead of an env var, capability flag for skew, settings UI, close and usage accounting routes, frozen error codes mapped to HTTP statuses.

## 2. Existing-thread semantics

Theirs is strict and small. The threadId comes from the active thread and is re-verified server-side at context load and at dispatch (deleted or archived threads refuse). A delegation becomes a `thread.turn.start` with deterministic `voice:{session}:{delegation}` command and message ids. Voice can never switch threads, create threads, approve, or cancel. Orchestration events are observed and spoken back (assistant message completion, approval-requested, session status), with the explicit rule that speech never approves a pending permission.

Ours is broader and policy-pinned. `continueThread` reuses the existing thread (never a replacement), with a stale pre-dispatch error fix. The `startThread` destination-project policy separates "thread being discussed" from "destination of new work". Plus navigation, cross-environment search and read, and UI control activation with provenance guards. Same core invariant (voice never approves), larger semantic surface, larger prompt surface to maintain.

These are complementary in capability and rival in mechanism: theirs delegates through GPT-Live's own client-delegation events; ours delegates through a second model over Responses with client-relayed tool calls. Only one should own thread dispatch in a merged server.

## 3. Surface area

Theirs: web, desktop, and mobile. The controller lives in `packages/client-runtime` (transport-agnostic, 15 tests), browser and native WebRTC transports behind one interface, thin UI (composer button plus dialog on web, modal call screen on mobile), and a microphone reservation so Live capture and dictation cannot overlap.

Ours: web only, deep UX (about 9k lines including tests): ordered speaker-labeled transcript rendered as chat, durable recoverable session history, minimized draggable overlay with silence auto-collapse, control discovery and activation with disambiguation and click-outcome recording, completion chimes, voice settings in the integration settings UI.

The mobile surface and the client-runtime controller placement are the two things in theirs we do not have and should not rebuild. The deep web UX is the thing in ours they do not have. The two UIs are rivals only at the entry point.

## 4. Server integration collisions

- `packages/contracts/src/voice.ts`: both add this file. Theirs is 18 lines (`VoiceStartInput`, `VoiceStopInput`, `VoiceError`); ours is 726 (broker schemas, tool registry, usage). Direct add/add conflict, trivially mergeable by keeping one file with both or renaming ours to `voiceBroker.ts`. Same for `contracts/index.ts`.
- `ws.ts`: only theirs touches it, and it carries a real fix. The per-socket layer previously finalized before the HTTP effect served the socket, disposing voice handlers on early close; their change keeps the layer alive via `acquireUseRelease` around `RpcServer.toHttpEffectWebsocket`. That fix is voice-independent and worth landing regardless of which voice PR ships.
- `RpcAuthorization.ts`: only theirs (two scope entries). Ours does HTTP auth inside the broker routes instead, so no conflict.
- `server.ts`: only ours (one layer-merge line for `voiceBrokerRouteLayer`).
- `ServerEnvironment.ts` and `contracts/environment.ts`: only ours (descriptor capability).
- `ChatComposer.tsx`: only theirs (button and dialog).
- Shared noise: `pnpm-lock.yaml`, `docs/user/` (their `live-voice.md` versus our four voice docs), `packages/client-runtime` (theirs only).

No semantic collision in orchestration, checkpointing, or provider code. A combined landing is mostly a contracts-file merge plus a decision on the delegation mechanism.

## 5. Tests and runtime dependencies

Theirs: 60 focused test blocks across protocol, session, authorization, controller, and transports, plus a real HTTP/WS lifecycle regression in `server.test.ts`, and the PR body records a real end-to-end GPT-Live call (synthetic audio). Runtime deps: `ws` on the server, `react-native-webrtc` plus an Expo config plugin on mobile.

Ours: heavier and deeper on the web side (broker 942 test lines; web suites for the live client, tools, history, command session, control discovery, DOM controls), broker tested at the HTTP boundary with auth, scope, and capability cases. No new runtime dependencies beyond the existing stack.

Neither PR has verified relay/tunnel behavior or physical microphone capture end to end. Ours additionally has an unverified-against-live-API gate acknowledged in the broker source: the mint decodes the documented response shape, not an observed one.

## 6. Verdict

**Recommended merge order: land #11667 first, then rebase #12034 onto it in two pieces.**

1. **#11667 as the protocol and mobile baseline.** It is smaller, exercises the real GPT-Live delegation protocol, includes the `ws.ts` lifecycle fix, and its per-socket ownership, event allowlist, and hangup confirmation are the right server semantics to standardize on.
2. **From #12034, extract an infrastructure PR (mechanical, small).** Swap their `process.env.OPENAI_API_KEY` read for a `ServerSecretStore` read (keeping their call-time-read pattern), add the `voice-broker-config` overrides, the `voiceLive` descriptor capability, and the voice settings UI. This layers onto their `makeVoiceTransport` without changing its shape.
3. **Resolve the delegation rivalry deliberately.** The minimal combined server is their `VoiceSession` with its transport pointed at a broker that reads the key from the secret store and retains session ids and usage. Our `/api/voice/backend` Responses bridge can survive as an alternative delegation mode for non-thread actions (navigation, search, control activation), selected per session the way our broker's `clientDelegation` flag already does. Thread dispatch stays theirs; UI-command dispatch can stay ours until maintainers want one model.
4. **Bring the #12034 web deep UX forward separately**, re-terminated on their `voiceStart`/`voiceStop` RPC and sideband transcript events instead of our HTTP-brokered Realtime client. The transcript, history, and control-activation layers are protocol-agnostic; only `live-client.ts` needs rewiring.

**What #11667 should adopt from #12034:**

- Secret-store key management and the settings UI. An env var plus server restart is coarse; the secret is settable and clearable at runtime and never leaves the server process.
- The `voiceLive` capability flag, so clients on older servers hide the entry point instead of failing at call time.
- Session close and usage accounting routes (theirs trusts `session.closed` on the sideband; a broker-retained ledger also survives sideband loss).
- The delegation-mode split, if maintainers want navigation and control activation by voice without growing GPT-Live's instructions.

**What #12034 should adopt from #11667:**

- The client-runtime controller placement and the mobile surface. Both are things we lack outright.
- The `ws.ts` handler-lifecycle fix.
- Per-socket session ownership and the unconfirmed-hangup retry discipline (our close is a local flip; theirs refuses new calls until OpenAI confirms the previous session ended, which is better billing hygiene).
- The client/server event allowlist in the minted session config.
- The pattern of announcing approval-requested and user-input-requested events over voice while stating that voice cannot approve.

**Combined architecture, if one is mechanical:** yes, with the caveat above. Their server (VoiceSession + liveProtocol + voiceStart/voiceStop) as the canonical voice control plane; our broker reduced to a transport module inside their `makeVoiceTransport` (secret-store key, config overrides, session retention and usage); our web runtime re-terminated on their RPC and sideband events; our tools bridge kept as the second delegation mode for non-thread actions; their mobile client unchanged. Net result: one thread-dispatch path, one key path, two delegation modes, two client surfaces sharing one controller.

Note for our fork: saphid/t3code#68 pins #12034 into fork Nightly and is unaffected by upstream merge order.
