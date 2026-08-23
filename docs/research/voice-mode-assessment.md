# Voice mode: prior art assessment and recommended architecture

Date: 2026-08-22. Branch: `t3code/research-voice-mode`.
Companion doc: [voice-dictation-local-stt.md](./voice-dictation-local-stt.md) (external options survey with citations).

## 1. Has this been tried before?

Yes, eleven times. Nothing has ever merged, and no human maintainer has reviewed
any voice PR (bot reviews only). Full detail per PR below; the short version:

- The de facto sanctioned design is **PR #5213** (`feat/voice-dictation-beta`,
  authored by the project's own `app/t3-code` account, still open): batch
  push-to-talk dictation in the web/desktop composer, cloud BYO key
  (OpenAI or Groq) via an authenticated server proxy, opt-in behind Beta
  settings. **PR #6625** supersedes it and adds Expo mobile support with keys
  in `expo-secure-store` and Codex-style terminal actions
  (cancel / stop-and-insert / insert-and-send). Both are engineering-solid and
  fully bot-review-clean; both are simply unreviewed.
- The only local-model attempt was **PR #3630/#3631** (whisper.cpp STT plus
  Kokoro TTS, orb overlay, VAD, barge-in). The author self-closed both the same
  day with 13+ unresolved bot findings. It proves the seam works but the code
  is not salvageable as-is.
- **PR #5321** (open, 3 lines) adds the macOS `com.apple.security.device.audio-input`
  entitlement with `entitlementsInherit` for Electron helper processes. Every
  desktop voice feature needs this; treat it as a prerequisite.

### The graveyard, briefly

| PR         | Approach                                                               | Status       | Lesson                                                                                    |
| ---------- | ---------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| 5213       | Cloud BYOK batch (OpenAI/Groq), server proxy, web+desktop              | Open, stale  | The internally-blessed shape: opt-in beta, server-proxied, typed Effect errors, size caps |
| 6625       | 5213 + Expo mobile, secure-store keys, Codex-style actions             | Open, active | Best current dictation base; mobile uploads go direct to provider, not proxied            |
| 3630/3631  | whisper.cpp + Kokoro, fully local, orb UI                              | Self-closed  | Only local prior art; died under contribution-policy pressure and bot findings            |
| 6206       | OpenAI Realtime "voice supervisor" (conversational agent control)      | Draft        | Scope creep: voice control of the orchestrator is a different feature than dictation      |
| 3997       | OpenAI Realtime persistent voice panel                                 | Draft        | Contains fork-identity changes; unmergeable                                               |
| 4174, 5647 | Reuse Codex Desktop's private transcription endpoint via ChatGPT OAuth | Both closed  | Private endpoints are a dead end; died twice                                              |
| 4866       | Deepgram streaming websocket fix                                       | Closed       | Deepgram streaming exists only in a fork; accidental mega-diff                            |
| 4979       | Unix-socket bridge to external VoiceBud app                            | Closed       | Third-party-app bridges are a poor upstream fit                                           |
| 2356       | Kokoro TTS playback (no STT)                                           | Closed       | Wrong-repo accident                                                                       |
| 5321       | macOS mic entitlement                                                  | Open         | Prerequisite for all of the above                                                         |

Recurring bot-review findings that any new attempt must design around:

1. Cap audio size while streaming the body, not after buffering (memory DoS in 4174, 5213).
2. No client-controlled outbound URLs on the server proxy (SSRF found in 5213).
3. Effect conventions: `Schema.TaggedErrorClass`, `catchTags`, environment-acquired `HttpClient`.
4. Mic lifecycle races: double-start, cancel during `getUserMedia`, navigation mid-transcription, tracks left open on unmount.
5. macOS: `NSMicrophoneUsageDescription` plus the 5321 entitlements.

### Quality verdict on the prior art

The #5213/#6625 lineage is genuinely good code: clean provider abstraction,
typed errors, tests, dynamic model listing, careful MediaRecorder hook with
waveform levels, 5-minute and 25 MB caps. What it lacks is exactly the brief
here: no local models, no streaming partials, and (in 5213) no mobile. The
right move is to keep its provider/proxy/settings shape and slot local engines
in as additional providers, rather than starting over.

## 2. Where voice plugs into this codebase

- **Web composer**: `apps/web/src/components/chat/ChatComposer.tsx`; drafts in
  the Zustand `composerDraftStore`; mic button goes in the footer toolbar next
  to `ComposerPrimaryActions`. Beta flag = one boolean on `ClientSettingsSchema`
  (`packages/contracts/src/settings.ts`) plus a row in `BetaSettingsPanel.tsx`.
- **Desktop**: Electron 41, serves the web bundle over `t3code://app`. No mic
  plumbing or entitlements exist today. Needs a permission handler in
  `DesktopWindow.ts` and the PR 5321 entitlements in
  `scripts/build-desktop-artifact.ts`.
- **Expo mobile**: five custom native modules already live in
  `apps/mobile/modules/` (Swift + Kotlin, Expo autolinked). `t3-review-diff` is
  the cleanest template. Info.plist keys and capabilities go through config
  plugins in `apps/mobile/plugins/` registered in `app.config.ts`. Composer is
  `src/features/threads/ThreadComposer.tsx` with `@effect/atom` drafts and an
  `appendComposerDraftText` helper that is exactly what a transcript insert
  needs. Mobile settings are device-local (`mobilePreferencesAtom`), separate
  from web client settings.
- **SwiftUI app** (`apps/swift-ios`, currently on `feat/issue110-reasoning-selector`,
  not on main): own composer stack (`FeatureComposerView.swift`,
  `FeatureComposerDraftStore.swift`) and entitlements files. Voice here is
  pure Swift with no bridge.
- **Server**: clients speak WebSocket RPC (`packages/contracts/src/rpc.ts`);
  HTTP surface is thin. There is no binary upload route; images ride the RPC as
  base64 data URLs. The 5213 HTTP proxy route pattern is the precedent for
  audio-to-cloud forwarding.

## 3. Recommended architecture

Principle: **transcription is a provider interface with local engines first
and OpenAI-compatible cloud as the BYO-key fallback.** One contract, four
platform backends.

### Contract (packages/contracts)

```
TranscriptionEngine =
  | { kind: "local" }                      // resolved per platform, see below
  | { kind: "cloud", provider: "openai" | "groq" | "mistral" | "custom",
      baseUrl?, model, apiKey (client-held or server env) }
```

Settings: `voiceDictationEnabled` (beta flag), engine choice, model choice,
push-to-talk keybinding. Web/desktop settings on `ClientSettingsSchema`;
mobile mirrors in `mobilePreferences`; SwiftUI app in its own store.

### Per-platform local default

| Platform                           | Default engine                                                                                                                                   | Why                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| iPhone (SwiftUI app + Expo module) | Apple `SpeechAnalyzer`/`SpeechTranscriber` on iOS 26+                                                                                            | Zero download (system assets), streaming volatile partials, plain Swift; gate with `#available(iOS 26, *)`                     |
| iPhone (iOS 17-25 fallback)        | FluidAudio Parakeet v3 CoreML (~0.5 GB) or on-device `SFSpeechRecognizer` as the no-download floor                                               | Parakeet for quality; SFSpeech for zero-setup                                                                                  |
| Mac desktop (Electron)             | Parakeet-tdt-0.6b-v3 via a small FluidAudio Swift sidecar binary spawned by the Electron main process                                            | ~110-190x realtime on M-series, streaming + VAD + end-of-utterance; same model family Superwhisper and MacWhisper converged on |
| Headless Linux server              | whisper.cpp (quantized large-v3-turbo) CLI/server                                                                                                | Portable, no GPU assumption; Groq as the remote default when no local capacity                                                 |
| Plain browser (no desktop host)    | Web Speech API with `processLocally: true` where available (Chrome 139+), else cloud fallback with an explicit "audio leaves this device" notice | Honest privacy labeling; transformers.js WebGPU Whisper only as an experimental toggle                                         |

Cloud fallback is one OpenAI-compatible client (`/v1/audio/transcriptions`,
configurable base URL from a server-side allowlist, never client-supplied):
OpenAI gpt-4o-transcribe / mini, Groq whisper-large-v3-turbo, Mistral Voxtral.
Deepgram is not OpenAI-compatible; skip it unless networked word-level
streaming becomes a requirement.

### Delivery plan (small PRs, in dependency order)

1. **Entitlements prerequisite**: adopt/rebase PR 5321 (desktop mic
   entitlement) and add `NSMicrophoneUsageDescription` +
   `NSSpeechRecognitionUsageDescription` config plugin to Expo.
2. **Contract + web/desktop cloud path**: rebase the #6625 lineage (proxy,
   settings, composer button, hook) onto the engine interface. This is mostly
   existing, bot-clean code.
3. **Local engine, desktop**: FluidAudio sidecar (Swift, ships as a small
   signed helper in the mac artifact); whisper.cpp path for Linux/Windows.
   Model download manager with explicit size prompts, Superwhisper-style.
4. **Expo native module `t3-voice`**: Swift `SpeechTranscriber` (iOS 26) +
   FluidAudio fallback, Kotlin side via Android SpeechRecognizer or
   whisper.cpp JNI later; streaming partials into
   `appendComposerDraftText`, terminal actions per #6625's UX.
5. **SwiftUI app**: native `SpeechTranscriber` in `FeatureComposerView`,
   hold-to-talk button with volatile-partial rendering. Smallest lift of all
   the surfaces since there is no bridging.

### UX (from Superwhisper/MacWhisper)

Hold-to-talk (press and hold the mic or a global key), release to insert;
tap to toggle for long dictation; live waveform plus streaming partial text
in a composer overlay; explicit model download screen with sizes; always show
where audio goes (on-device vs named cloud provider).

## 4. Risks and open questions

- iOS 26 adoption: `SpeechTranscriber` is 26.0+ only; the FluidAudio fallback
  costs ~0.5 GB of download that mobile users must opt into.
- Parakeet iPhone realtime factor is not verified from primary sources yet
  (flagged in the survey doc); prototype before committing to it as the
  sub-26 default.
- `SpeechTranscriber`'s permission model (whether it requires
  `NSSpeechRecognitionUsageDescription` authorization like SFSpeech) needs
  verification against Apple's live-audio sample code.
- Upstream contribution policy discourages large feature PRs and maintainers
  have ignored every voice PR. If upstreaming is the goal, land the
  entitlement fix and the contract change first and keep each PR small; if
  this is for the fork, that pressure disappears.
- Electron cannot use FluidAudio directly (it is Swift); the sidecar process
  is the clean seam, and it doubles as the thing a future menu-bar
  quick-dictation feature can reuse.

## 5. Building the sidecar

In development the transcriber binary is one command away:

```sh
pnpm --dir apps/server run build:voice-transcriber
```

which runs `swift build -c release --package-path native/voice-transcriber`.
The server probes the SwiftPM release output path automatically (or honors
`T3_VOICE_TRANSCRIBER_PATH`). Packaging the sidecar into the desktop artifact
is still an open task: the build script does not yet compile or bundle the
binary, so shipped desktop builds report dictation as unsupported until that
is done.
