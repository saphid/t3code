# Local-first voice dictation / push-to-talk: options survey

Research notes, 2026-08-22. Scope: adding a local-first dictation / push-to-talk mode to a
cross-platform coding-agent app (web + Electron desktop + Expo React Native iOS app with custom
native Swift modules), with BYO-API-key cloud fallback.

Note on location: the repo had no research/notes directory under `docs/` (only architecture, user,
operations, etc.), so this file establishes `docs/research/` as the convention.

All claims below were checked against primary sources (official docs, GitHub repos, Hugging Face
model cards, Apple developer documentation, provider API docs). Where only a secondary source was
available, it is flagged as such.

---

## 1. NVIDIA Parakeet family on Apple Silicon

### The models

- **parakeet-tdt-0.6b-v2**: 600M-parameter English-only ASR model. "Use of this model is governed
  by the CC-BY-4.0 license." Average WER 6.05% on the HF Open ASR leaderboard; "achieves an RTFx of
  3380 on the HF-Open-ASR leaderboard with a batch size of 128" (a server-GPU batch figure, not an
  on-device number). Automatic punctuation and capitalization, char/word/segment timestamps.
  https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- **parakeet-tdt-0.6b-v3**: same 600M architecture, 25 European languages (incl. English, German,
  French, Spanish, Russian, Ukrainian, ...). CC-BY-4.0. Average WER 6.34%, RTFx 3332 on the
  leaderboard. Supports a chunked "streaming mode" script, punctuation/capitalization, word and
  segment timestamps. https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3

License takeaway: weights are CC-BY-4.0 (commercial use OK, attribution required). Wrapper code is
separately licensed (Apache-2.0 for both wrappers below).

### parakeet-mlx (senstella) — Python/MLX, Mac only

- "An implementation of the Parakeet models ... for Apple Silicon using MLX." `pip install
  parakeet-mlx`; ships a CLI (`parakeet-mlx <audio> --output-format srt/vtt/json ...`). Code is
  Apache-2.0. Default model is `mlx-community/parakeet-tdt-0.6b-v3`.
  https://github.com/senstella/parakeet-mlx
- Real-time support: a `transcribe_stream` method enables real-time transcription with configurable
  context windows. (Same source.)
- Model download: the MLX conversion `mlx-community/parakeet-tdt-0.6b-v3` is F32 and 2.51 GB
  (fp16/quantized conversions are smaller). CC-BY-4.0.
  https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3
- Integration surface is Python only, so for this app it would need a sidecar process. No published
  RTF numbers in the repo.

### FluidAudio (FluidInference) — Swift SDK, CoreML/ANE, macOS + iOS

- Swift SDK for "fully local, low-latency audio AI on Apple devices, with inference offloaded to
  the Apple Neural Engine (ANE)". Swift Package Manager (v0.12.x) and CocoaPods; React Native/Expo
  and Rust/Tauri wrappers exist. Apache-2.0 code. https://github.com/FluidInference/FluidAudio
- Models: `parakeet-tdt-0.6b-v3-coreml` (multilingual) and `parakeet-tdt-0.6b-v2-coreml`
  (English-only, "highest recall"); plus a Parakeet EOU (120M) model for streaming end-of-utterance,
  Silero VAD with configurable thresholds, and diarization pipelines (Pyannote, Sortformer,
  LS-EEND). Streaming ASR is provided via a sliding-window manager with real-time partials. (Same
  source.)
- Performance: README claims roughly 190x RTF on M4 Pro; the CoreML model card states "~110x RTF on
  M4 Pro for batch ASR (1 min audio ≈ 0.5 s)". Either way, dictation-length utterances transcribe
  in well under a second on M-series. https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml
- iPhone feasibility: the CoreML conversion targets macOS 14+ / iOS 17+ and runs on ANE/CPU with no
  network requirement (same model card). No official iPhone RTF is published. Size-wise a 0.6B
  model is practical: Superwhisper ships quantized Parakeet builds at 476 MB (English) and 494 MB
  (multilingual), see section 5.
- CoreML conversion is "mixed precision optimized for Core ML execution (ANE/CPU)"; exact repo
  download size is not stated on the card (expect roughly 0.6-1.2 GB for fp16-class weights,
  ~0.5 GB quantized based on the Superwhisper builds).

---

## 2. WhisperKit (Argmax)

- On-device Whisper on Apple Silicon via Core ML. MIT license ("Argmax OSS is released under the
  MIT License"). The project now lives in the `argmax-oss-swift` package
  (https://github.com/argmaxinc/argmax-oss-swift, README mirrored at argmaxinc/WhisperKit).
  Requirements per README: macOS 14.0+, Xcode 16.0+; iOS supported (models are explicitly
  "Recommended across iOS and macOS"). SPM product `WhisperKit`.
  https://github.com/argmaxinc/WhisperKit
- Models auto-download from Hugging Face `argmaxinc/whisperkit-coreml`; "WhisperKit automatically
  downloads the recommended model for the device if not specified." Variants: tiny/tiny.en through
  large-v3; `large-v3-v20240930_626MB` (compressed, 626 MB) is "Recommended across iOS and macOS
  for maximum accuracy"; `large-v3-v20240930_turbo` is "Recommended on macOS for maximum speed and
  accuracy". (Same README.)
- Streaming: real-time transcription is supported (the repo ships a streaming example app and the
  local server exposes output streaming via Server-Sent Events). CLI available (`argmax-cli`, also
  via Homebrew). (Same README.)
- Performance: Argmax reports "On M2 Ultra, WhisperKit runs the latest OpenAI Large V3 Turbo model
  as fast as 72x real-time with a GPU+ANE config"
  (https://github.com/argmaxinc/WhisperKit/discussions/243). Device-by-device numbers (including
  iPhones) are published continuously at
  https://huggingface.co/spaces/argmaxinc/whisperkit-benchmarks (data:
  https://huggingface.co/datasets/argmaxinc/whisperkit-evals). Rule of thumb: Whisper large-v3-turbo
  is comfortably faster than real time on modern iPhones, but roughly an order of magnitude slower
  than Parakeet on the same hardware (see MacWhisper/Argmax Parakeet numbers in section 5).
- iPhone feasibility: yes; the 626 MB compressed large-v3 is the iOS recommendation, and
  small/base/tiny variants trade accuracy for footprint.

---

## 3. whisper.cpp and Node bindings (Electron main / headless Node)

### whisper.cpp core

- MIT-licensed C/C++ port of Whisper, "Plain C/C++ implementation without dependencies"; Apple
  Silicon path is "optimized via ARM NEON, Accelerate framework, Metal and Core ML" (Core ML runs
  the encoder on the ANE, "more than x3 faster compared with CPU-only execution").
  https://github.com/ggml-org/whisper.cpp
- Model sizes (ggml, disk / memory): tiny 75 MiB / ~273 MB; base 142 MiB / ~388 MB; small 466 MiB /
  ~852 MB; medium 1.5 GiB / ~2.1 GB; large 2.9 GiB / ~3.9 GB. Integer quantization (e.g. Q5_0)
  shrinks these further. (Same README.)
- Streaming: the `stream` example "samples the audio every half a second and runs the transcription
  continuously" (requires SDL2). Distribution: build from source with CMake; a precompiled
  XCFramework is published for iOS/macOS/visionOS/tvOS; Docker images exist. There is also an HTTP
  server example in the repo for headless use. (Same README.)

### Node bindings

- **smart-whisper** (https://github.com/JacobLinCool/smart-whisper): "native Node.js addon designed
  for efficient and streamlined interaction with the whisper.cpp". MIT. Compiles via node-gyp at
  install; "automatically enables the GPU and CPU acceleration on macOS" (Metal on Apple Silicon);
  Linux/Windows acceleration is bring-your-own-libs (`BYOL`). Per-task events
  (`task.on('transcribed', ...)`) give segment-level progress, not token streaming. Small community
  (~76 stars), modest maintenance.
- **nodejs-whisper** (https://github.com/ChetanXpro/nodejs-whisper): MIT; builds whisper.cpp locally
  at install (needs build-essential / MinGW; CMake flags overridable via
  `NODEJS_WHISPER_CMAKE_ARGS`). Auto-downloads any of 30+ quantized models (tiny through
  large-v3-turbo) and Silero VAD models. No streaming. Actively maintained (~211 stars).
- **whisper-node** (https://github.com/ariym/whisper-node): MIT; older wrapper, requires `make`,
  16 kHz WAV input only, and the roadmap still lists stream support as future work. Not
  recommended.

Electron distribution caveat (analysis, not a sourced claim): none of these ship universal prebuilt
binaries for all platforms, so an Electron app must either compile the addon per-arch in CI
(electron-rebuild) or vendor prebuilt `whisper-cli`/server binaries per platform and spawn them.
The vendored-binary route also serves the headless Linux server unchanged.

---

## 4. Apple Speech framework

### SFSpeechRecognizer (legacy, iOS 10+)

- Availability: iOS/iPadOS 10+, macOS 10.15+, visionOS 1+.
  `supportsOnDeviceRecognition`: "A Boolean value that indicates whether the speech recognizer can
  operate without network access." (There is also `SFSpeechRecognitionRequest.requiresOnDeviceRecognition`
  on the request object.) https://developer.apple.com/documentation/speech/sfspeechrecognizer
- Hard limits for the networked path: "the framework stops speech recognition tasks that last
  longer than one minute", and "Individual devices may be limited in the number of recognitions
  that can be performed per day, and each app may be throttled globally". Authorization via
  `requestAuthorization(_:)` is mandatory. (Same page.)
- Verdict: fine as a legacy fallback for iOS < 26, cramped for dictation (1-minute cap on the
  server path, quality below Whisper/Parakeet).

### SpeechAnalyzer / SpeechTranscriber (WWDC25, OS 26)

- Availability (from Apple's doc JSON): iOS 26.0+, iPadOS 26.0+, macOS 26.0+, tvOS 26.0+,
  visionOS 26.0+, Mac Catalyst 26.0+.
  https://developer.apple.com/documentation/speech/speechanalyzer and
  https://developer.apple.com/documentation/speech/speechtranscriber
- Architecture: `SpeechAnalyzer` manages the session; modules like `SpeechTranscriber` produce
  results as an `AsyncSequence`. Input is an `AsyncStream<AnalyzerInput>`; presets such as
  `.transcription` / `.offlineTranscription`; `prepareToAnalyze(in:)` preheats models. (Same docs.)
- Fully on-device, system-managed models: "Simply install the relevant model assets via the new
  AssetInventory API ... The model is retained in system storage and does not increase the download
  or storage size of your application, nor does it increase the run-time memory size", and "the
  system will automatically install updates as they become available".
  https://developer.apple.com/videos/play/wwdc2025/277/
- Live partials ("volatile results"): "They're delivered almost as soon as they're spoken but they
  are less accurate guesses", then replaced by finalized results (`result.isFinal`). Designed to be
  "Faster and more flexible" than SFSpeechRecognizer and "Good for long-form and distant audio";
  no one-minute limit. Already powers "Notes, Voice Memos, Journal, and more". (Same session.)
- Languages: `SpeechTranscriber.supportedLocales` vs `installedLocales` enumerate them at runtime
  (roughly the Apple dictation set, ~10 languages at launch, "with more to come" per the session);
  `DictationTranscriber` is the fallback module covering "the same languages, speech-to-text model,
  and devices as iOS 10's on-device SFSpeechRecognizer".
- Entitlements: none are documented for SpeechAnalyzer/SpeechTranscriber (nothing in the class docs
  or session). Microphone permission is required for live audio as usual; secondary sources report
  the `NSSpeechRecognitionUsageDescription` Info.plist key and speech authorization still apply
  (e.g. https://blakecrosley.com/blog/speech-framework-vs-sfspeechrecognizer). Verify against
  Apple's "Recognizing speech in live audio" sample before shipping.
- Expo usability: it is a plain Swift API (async/await, no special entitlement), so a custom Expo
  native module can wrap it directly. Constraints: build with the Xcode 26 SDK and gate at runtime
  with `#available(iOS 26.0, *)`; on-device model quality is generally judged below Whisper
  large/Parakeet for accuracy but with zero app-bundle cost (analysis).

---

## 5. UX references: Superwhisper and MacWhisper

### Superwhisper (superwhisper.com)

- macOS, Windows, and iOS. Activation: "Select an app, press ⌥ + space and start dictating", plus a
  dedicated push-to-talk mode: "Hold, speak, release." Works offline. BYO API keys supported for
  LLM post-processing (OpenAI, Anthropic, Mistral, Gemini, ...). https://superwhisper.com/
- Local model catalog with sizes (from https://superwhisper.com/docs/models/voice): Whisper-family
  Fast 75 MB / Nano 150 MB / Standard 500 MB (free tier); Pro 1.5 GB, Ultra V3 Turbo 1.6 GB, Ultra
  3 GB (Pro tier); **Parakeet 476 MB (English) and Parakeet Multilanguage 494 MB** (Pro tier), both
  rated speed 10 with accuracy 8, i.e. their fastest local models. Cloud options: S1-Voice and
  Ultra (Cloud).
- Parakeet shipped in Superwhisper v2.0.0 (July 2025), first English-only then Parakeet V3
  multilingual (secondary source:
  https://alternativeto.net/news/2025/7/superwhisper-v2-0-presents-new-design-faster-parakeet-model-and-lower-latency/).
- UX pattern worth copying: model picker as a simple table of size / speed / accuracy / languages,
  free small models by default, big or fast models behind the paid tier, one-key toggle plus
  hold-to-talk.

### MacWhisper (Goodsnooze)

- Local transcription app for macOS with a dictation mode. In v13 it added Parakeet "Thanks to our
  collaboration with the team at Argmax"; at launch it "currently supports English-only
  transcription" (Parakeet v2) with multilingual to follow. Demonstrated speed: a 30-minute podcast
  transcribed and diarized "in under 8 seconds"; a 3-hour episode in 1:22 on an M2 Pro.
  https://9to5mac.com/2025/06/27/macwhisper-13-supports-nvidia-parakeet-transcription-model/
- Signal for this project: both leading Mac dictation apps converged on Parakeet-on-CoreML (via
  Argmax / equivalent) as the fast local default, keeping Whisper large variants for accuracy and
  cloud keys (OpenAI/Groq-style) as fallback.

---

## 6. Browser-only options for the web app

### Web Speech API (SpeechRecognition)

- Baseline status: "Limited availability ... does not work in some of the most widely-used
  browsers." Default privacy caveat: "On some browsers, like Chrome, using Speech Recognition on a
  web page involves a server-based recognition engine. Your audio is sent to a web service for
  recognition processing, so it won't work offline."
  https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- On-device mode (Chrome 139, Aug 2025): "Websites can query the availability of on-device speech
  recognition for specific languages, prompt users to install the necessary resources ... and
  choose between on-device or cloud-based speech recognition", so "audio and transcribed speech are
  not sent to a third-party service for processing."
  https://developer.chrome.com/blog/new-in-chrome-139
  API surface: `SpeechRecognition.available()`, `SpeechRecognition.install({langs, processLocally})`,
  and per-recognizer `processLocally = true` (MDN, plus explainer:
  https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md).
- Safari: supports (webkit-prefixed) SpeechRecognition; recognition rides Siri dictation, so audio
  "may be sent to Apple" depending on device capability, language, and settings; newer
  devices/languages process on device (https://www.apple.com/legal/privacy/data/en/ask-siri-dictation/,
  https://developer.apple.com/forums/thread/690575). Firefox: unsupported.
- Net: usable as a zero-download default with feature detection (`available()` then
  `processLocally`), but audio leaves the machine in Safari and in pre-139/uninstalled-pack Chrome.
  Streaming partials (interim results) are native to the API.

### transformers.js Whisper in-browser (whisper-web)

- "ML-powered speech recognition directly in your browser! Built with Transformers.js." MIT.
  Experimental WebGPU support lives on a branch with its own demo. Models load from the Hugging
  Face Hub (ONNX conversions, e.g. the onnx-community/Xenova repos) and are cached by the browser,
  so first load is a tens-to-hundreds-of-MB download depending on model (tiny/base/small class,
  quantized) and quality is capped accordingly. https://github.com/xenova/whisper-web, demo
  https://hf.co/spaces/Xenova/whisper-web
- Feasibility: acceptable as an offline-capable fallback on WebGPU-capable browsers, but batch
  oriented (record, then transcribe) and materially worse accuracy than the desktop options.
  Treat as experimental tier, not the default.

---

## 7. BYO-key cloud endpoints (OpenAI-compatible /v1/audio/transcriptions)

### OpenAI

- Endpoint `/v1/audio/transcriptions`; models: `gpt-transcribe` (current recommendation for bounded
  audio), `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-transcribe-diarize`, legacy
  `whisper-1` (timestamps/translation/subtitles). Streamed output via `stream=true`
  ("`transcript.text.delta` events ... then ... `transcript.text.done`"); live audio uses the
  Realtime API (`gpt-live-transcribe`). "Files can be up to 25 MB."
  https://developers.openai.com/api/docs/guides/speech-to-text
- Pricing (secondary confirmations; verify on the pricing page at integration time): whisper-1
  $0.006/min; gpt-4o-transcribe ~$0.006/min; gpt-4o-mini-transcribe ~$0.003/min
  (https://costgoat.com/pricing/openai-transcription, https://openrouter.ai/openai/whisper-1).

### Groq

- OpenAI-compatible: `https://api.groq.com/openai/v1/audio/transcriptions`. Models and prices:
  `whisper-large-v3` $0.111/hour (~$0.00185/min, 189x speed factor); `whisper-large-v3-turbo`
  $0.04/hour (~$0.00067/min, 216x). File limit 25 MB free tier / 100 MB dev tier; 10-second minimum
  billing. No streaming (batch only). https://console.groq.com/docs/speech-to-text
- Cheapest and fastest BYO-key option; drop-in with any OpenAI-compatible client.

### Deepgram

- Own API, not OpenAI-compatible: REST `https://api.deepgram.com/v1/listen?model=nova-3` plus a
  WebSocket for true streaming. `nova-3` (multilingual) and `nova-3-medical`; also `flux` ("first
  conversational speech recognition model built specifically for voice agents", ultra-low latency).
  https://developers.deepgram.com/docs/models-languages-overview
- Pricing: Nova-3 pre-recorded $0.0043/min (mono) / $0.0052/min (multi); streaming list price
  $0.0077/min mono ($0.0048 promo), $0.0092/min multi. https://deepgram.com/pricing
- Only justify the custom adapter if word-by-word streaming dictation over the network is a
  requirement; otherwise skip.

### Mistral Voxtral

- Hosted, OpenAI-style `/v1/audio/transcriptions`: **Voxtral Mini Transcribe V2** (`voxtral-mini-latest`)
  at $0.003/min with speaker diarization, context biasing (up to 100 custom terms), word
  timestamps; **Voxtral Realtime** (`voxtral-mini-transcribe-realtime-2602`) at $0.006/min,
  "latency configurable down to sub-200ms", ~4% WER on FLEURS, 13 languages.
  https://mistral.ai/news/voxtral-transcribe-2/ and https://docs.mistral.ai/capabilities/audio/
- Open weights: `mistralai/Voxtral-Mini-3B-2507` (Apache 2.0, ~9.5 GB GPU RAM in bf16/fp16;
  https://huggingface.co/mistralai/Voxtral-Mini-3B-2507) and the realtime model
  `mistralai/Voxtral-Mini-4B-Realtime-2602` (Apache 2.0). Interesting for the headless Linux server
  if a GPU is available; too heavy for laptops/phones.
- Context biasing is uniquely useful for a coding agent (bias toward identifiers, repo terms).

---

## Comparison table

RTF = real-time factor on-device (higher is faster); sizes are the practical dictation-quality
option for each stack. Weights vs code licenses are listed where they differ.

| Option | License (code / weights) | Download | RTF on M-series | iPhone | Streaming partials | Integration surface |
|---|---|---|---|---|---|---|
| FluidAudio + Parakeet v3 CoreML | Apache-2.0 / CC-BY-4.0 | ~0.5 GB quantized to ~1.2 GB fp16-class | ~110-190x (M4 Pro, batch) | Yes (iOS 17+, ANE); no published RTF | Yes (sliding window + EOU model, Silero VAD) | Swift package (+ RN/Expo wrapper) |
| parakeet-mlx | Apache-2.0 / CC-BY-4.0 | 2.51 GB (F32; smaller quantized) | Fast, unpublished | No (MLX, Mac only) | Yes (`transcribe_stream`) | Python lib + CLI (sidecar) |
| WhisperKit (large-v3 626MB) | MIT / OpenAI Whisper (MIT) | 626 MB (tiny 75 MiB-class at low end) | 72x RT (large-v3-turbo, M2 Ultra) | Yes, recommended config | Yes (streaming example, SSE server) | Swift package + CLI + Homebrew |
| whisper.cpp (+ smart-whisper) | MIT | 75 MiB (tiny) - 2.9 GiB (large); q5 smaller | >real-time w/ Metal+CoreML, model-dependent | Yes via XCFramework (but WhisperKit is easier) | 0.5 s chunked `stream` tool; addon is per-task events | C lib, XCFramework, npm addon, CLI, HTTP server example |
| Apple SpeechTranscriber (OS 26) | Apple system API | 0 app-side (system asset via AssetInventory) | "Faster" than SFSpeechRecognizer; unpublished | Yes (iOS 26+) | Yes (volatile results) | Swift API (Expo custom module) |
| SFSpeechRecognizer on-device | Apple system API | 0 | n/a | Yes (iOS 10+, `supportsOnDeviceRecognition`) | Yes (partial results) | Swift API |
| Web Speech API (Chrome 139 local) | Browser API | Language pack via `install()` | n/a | n/a (mobile Safari = Siri servers possible) | Yes (interim results) | Browser JS |
| transformers.js whisper-web | MIT | tens-hundreds MB (tiny/base/small ONNX) | WebGPU, experimental | Impractical | Batch-oriented | npm (browser) |
| OpenAI gpt-4o(-mini)-transcribe | Cloud | 0 | ~$0.006 / $0.003 per min | any | SSE deltas; Realtime API for live | HTTP `/v1/audio/transcriptions` |
| Groq whisper-large-v3-turbo | Cloud | 0 | $0.04/hr, 216x server-side | any | No (batch) | OpenAI-compatible HTTP |
| Deepgram nova-3 | Cloud | 0 | $0.0043/min batch, ~$0.0048-0.0077/min stream | any | Yes (WebSocket) | Proprietary REST/WS |
| Mistral Voxtral (hosted) | Cloud (open weights Apache-2.0) | 0 (self-host ~9.5 GB GPU) | $0.003/min batch, $0.006/min realtime | any | Yes (realtime model, sub-200ms) | OpenAI-style HTTP |

---

## Recommended default stack per platform

Principle: local by default, one shared OpenAI-compatible BYO-key fallback (`/v1/audio/transcriptions`
with configurable base URL + model), so OpenAI, Groq, and Mistral all work through a single client.
Deepgram stays out of the default set (proprietary API; only add if networked word-by-word streaming
becomes a requirement).

1. **iPhone (Expo + custom Swift module)**: default to Apple `SpeechTranscriber` on iOS 26+
   (zero download, system-managed models, volatile partials for live push-to-talk UX); fall back to
   FluidAudio Parakeet v3 CoreML (~0.5 GB opt-in download) for iOS 17-25 or unsupported locales,
   with `SFSpeechRecognizer` on-device as the no-download legacy floor. BYO-key cloud as explicit
   user choice.
2. **Mac desktop (Electron)**: local default is Parakeet v3 via a small Swift sidecar helper built
   on FluidAudio (ANE, streaming partials, Silero VAD, shares model + code path with iOS); this is
   the same bet Superwhisper and MacWhisper made. Pure-Node alternative if a Swift helper is
   unwanted: smart-whisper (Metal) with whisper large-v3-turbo. WhisperKit is the accuracy-focused
   alternative when Whisper-quality multilingual output matters more than speed.
3. **Headless Linux server**: whisper.cpp `server`/CLI with a quantized large-v3-turbo (CPU or CUDA)
   as the local option; Voxtral Mini/Realtime self-hosted if a GPU is available. Default remote
   fallback: Groq whisper-large-v3-turbo ($0.04/hr) through the shared OpenAI-compatible client.
4. **Plain browser (web app)**: Web Speech API with `processLocally: true` where
   `SpeechRecognition.available()` says the pack is installed (Chrome 139+); otherwise surface the
   privacy caveat (Chrome cloud engine / Safari-Siri) and prefer the user's BYO key via
   MediaRecorder upload to `/v1/audio/transcriptions` (OpenAI streams partials over SSE).
   transformers.js WebGPU Whisper only as an experimental offline toggle.

Push-to-talk UX to copy from Superwhisper: one global shortcut with both toggle and hold-speak-release
modes, Silero VAD to trim silence, volatile/interim partials rendered inline, and a model manager
table (name, size, speed, accuracy, languages) with small free defaults and larger opt-in downloads.
