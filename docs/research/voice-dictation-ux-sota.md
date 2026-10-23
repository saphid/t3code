# Voice dictation UX: state of the art and what users actually love and hate

Research notes, 2026-08-23. Companion docs:
[voice-dictation-local-stt.md](./voice-dictation-local-stt.md) (engine/model survey),
[voice-mode-assessment.md](./voice-mode-assessment.md) (prior art in this repo).

Scope: survey of push-to-talk / dictation products circa 2024-2026, focused on what real users
praise and complain about, sourced from Hacker News threads, Reddit-derived coverage, App Store
reviews, and hands-on reviews. Marketing claims are flagged as such. This informs T3 Code's voice
mode (currently: on-device Apple speech, session-learned vocabulary, tap-to-talk mic in the
composer, live hypothesis typing into the draft).

Sourcing caveat: several search results surface Reddit sentiment second-hand through comparison
blogs (getvoibe.com, spokenly.app, metawhisp.com are all published by competing dictation vendors).
Where a claim only exists in vendor-adjacent coverage it is marked "(vendor blog)". HN comments are
cited with author names and thread IDs and are the highest-trust user voices here.

---

## Part A: product by product

### Superwhisper (macOS, iOS, now Windows)

**Approach.** Local whisper.cpp (later also Parakeet) on Apple Silicon, optional cloud models, and
"modes": per-app/per-task profiles that reshape output style, with optional LLM post-processing.
Toggle hotkey (Option-Space default) with a floating recording HUD. Lifetime license added after
launch-thread pushback; now $249.99 lifetime (was $165 at launch). In 2026 they shipped an
open-weights post-processing model (S1-mini, [HN 49364361](https://news.ycombinator.com/item?id=49364361))
and a Claude Code integration ([HN 47936169](https://news.ycombinator.com/item?id=47936169)).

**Loved.**

- Workflow-changing for long-term users: "I've been using SuperWhisper since the start and it's
  totally changed my workflow" (maccaw, [HN 37204722](https://news.ycombinator.com/item?id=37204722));
  "changed how I interact with the computer ... can't return to typing" (dumbmrblah,
  [HN 44942731](https://news.ycombinator.com/item?id=44942731)).
- Offline/privacy stance is the core draw; Reddit consensus recommends it "for privacy-focused
  advanced users" ([Voibe review roundup](https://www.getvoibe.com/resources/superwhisper-review/), vendor blog).
- Per-app modes are the most-copied feature in the category.
- Responsive developer: the lifetime license exists because HN users refused a subscription
  (darkteflon, xeor in [HN 37204722](https://news.ycombinator.com/item?id=37204722); dev nchudleigh added it).
- 4.9/5 Product Hunt; App Store reviewers call it "a revelation for efficient voice-to-text"
  ([App Store reviews](https://apps.apple.com/us/app/superwhisper-ai-dictation/id6471464415?see-all=reviews)).

**Hated.**

- Setup complexity: "overwhelming" configuration, 15-30 minutes to a useful setup
  ([Voibe](https://www.getvoibe.com/resources/superwhisper-review/), vendor blog, citing PH/Reddit).
- The $249.99 lifetime price is the top complaint since the price hike (same source).
- Larger local models are slow; users who want quality wait, users who want speed drop to small
  models.
- LLM post-processing "can sometimes alter non-English text unexpectedly" (same source) — a
  recurring formatted-dictation failure mode, see Part B.
- iOS keyboard extension is "very buggy" with autocorrect issues and random word deletion; the
  record-in-app-then-paste dance is "totally unreliable" in some apps
  ([App Store reviews](https://apps.apple.com/us/app/superwhisper-ai-dictation/id6471464415?see-all=reviews)).
- At launch: no live transcription (keepamovin), menu-bar-only UI clutter (\_xnmw)
  ([HN 37204722](https://news.ycombinator.com/item?id=37204722)). Live streaming still isn't the default UX.

### Wispr Flow (macOS, Windows, iOS)

**Approach.** Fully cloud: streaming ASR plus aggressive LLM post-formatting ("tone" per app),
auto-learned personal dictionary, context awareness implemented by screenshotting the active window
every few seconds and uploading it. $15/mo. Launch claim: 50-70% of messages need zero edits vs
under 5% for Apple/Google dictation ([HN 41696153](https://news.ycombinator.com/item?id=41696153), marketing).

**Loved.**

- Output quality when it works is the category benchmark: filler-word removal, grammar and
  punctuation fixed without intervention, "impressive [accuracy], even with technical terms, proper
  nouns, and industry jargon"; one reviewer dictated 182k words at an effective 184 WPM
  ([Zack Proser hands-on](https://zackproser.com/blog/wisprflow-review)).
- The auto-learning dictionary — "learns your unique words and adds them to your personal
  dictionary automatically" (same source) — is the single feature HN users name as blocking their
  switch to free alternatives ("ability to provide a dictionary for commonly mistaken words",
  comment on [HN 46628397](https://news.ycombinator.com/item?id=46628397)).
- Works in every text field system-wide; iOS App Store rating 4.8/5 across 8,500+ ratings
  ([Voibe](https://www.getvoibe.com/resources/wispr-flow-review/), vendor blog).

**Hated.**

- The screenshot scandal: a Reddit user watched the app upload screenshots of his active window to
  third-party AI servers every few seconds; Wispr's first response was to ban him, then the CTO
  apologized and made AI training opt-in, but the screenshot capture itself remains ("It's the
  product, not a bug") ([EmberType writeup](https://embertype.com/blog/the-day-wispr-flow-banned-a-user/),
  [HN 47781148](https://news.ycombinator.com/item?id=47781148)). HN reaction: switch to local tools
  (czarofvan listing SuperWhisper, Handy).
- Quality drift: the "Wispr Flow Trust Gap" thread (Feb 2026, r/macapps) — a 350k-word/year user
  says quality "noticeably declined"; multiple reports of the app "working 60% of the time" after
  the trial converts ([Voibe](https://www.getvoibe.com/resources/wispr-flow-review/), vendor blog).
  Trustpilot 2.7/5 vs the 4.8 iOS rating — desktop power users are the unhappy ones.
- Cloud-only is a hard non-starter for a large HN cohort; the wave of "free/local alternative to
  Wispr Flow" Show HNs (277-point [HN 47040375](https://news.ycombinator.com/item?id=47040375),
  591-point Whispering [HN 44942731](https://news.ycombinator.com/item?id=44942731)) is itself
  evidence of the resentment.
- Post-processing adds a visible pause between stopping and text landing
  ([Proser](https://zackproser.com/blog/wisprflow-review)); subscription fatigue everywhere.

### MacWhisper (Goodsnooze)

**Approach.** Local-only Whisper/Parakeet, one-time purchase (~€59 Pro). File transcription is the
core product; system-wide dictation was bolted on later.

**Loved.**

- "Very full featured" with one-time purchase and constant improvement (polo,
  [HN 44942731](https://news.ycombinator.com/item?id=44942731)).
- Parakeet made it feel new: "10x faster transcription than Whisper with better accuracy;
  'seamless' push-to-talk" (daemonologist, same thread); near-instant transcription of long
  monologues.
- Default Reddit r/macapps pick for transcribing recorded audio; price-to-quality leader vs
  Otter/Descript subscriptions ([Voisty review](https://voisty.com/macwhisper-review/), vendor blog).

**Hated.**

- Dictation is visibly secondary: the global dictation shortcut "occasionally fails to trigger the
  mic popup" and the mode "feels secondary to the file-transcription flow"
  ([Voisty](https://voisty.com/macwhisper-review/), vendor blog). A hotkey that silently fails is
  the worst bug class in this category (a lying mic).
- "Overkill" for pure dictation vs minimal tools like Hex (threekindwords,
  [HN 47040375](https://news.ycombinator.com/item?id=47040375)).

### VoiceInk (open source, macOS)

**Approach.** Open source (GPL), local Whisper + Parakeet, $29-69 lifetime tiers (free if built
from source), per-app "power mode" profiles, BYO API key for optional LLM enhancement.

**Loved.**

- Speed: "stunningly fast (near-instant)" with Parakeet V3 (comment on
  [HN 46628397](https://news.ycombinator.com/item?id=46628397)); "seems to be even faster than
  Aqua" locally on an M4 Max (razemio, [HN 43634005](https://news.ycombinator.com/item?id=43634005)).
- Per-app profiles: different dictation settings per target app "a genuine time-saver"
  ([Voibe](https://www.getvoibe.com/resources/voiceink-review/), vendor blog).
- Ergonomics called out specifically: "superior UX and settings clarity ... flexible hotkeys and
  visual recording indicators" (d4rkp4ttern, [HN 44942731](https://news.ycombinator.com/item?id=44942731));
  users proposed and it supports the dual binding: short-press toggles, long-press acts as
  hold-to-talk (oulipo, same thread).
- Open source as trust mechanism plus one-time pricing; "100s of people using the open-source,
  free version" (oulipo, [HN 43634005](https://news.ycombinator.com/item?id=43634005)).

**Hated.**

- Indie polish gap vs commercial tools; AI enhancement requires an external API key; macOS 14.4+
  only ([Voibe](https://www.getvoibe.com/resources/voiceink-review/), vendor blog).

### Aqua Voice (YC W24)

**Approach.** Cloud, custom ASR (Avalon, 3.2% WER Librispeech-clean claim) plus LLM, deep context
awareness, custom instructions per user (ChatGPT-style), 800-word custom dictionary. V1 was a
voice-native editor with spoken editing commands; V2 deliberately dropped the command emphasis:
"less emphasis on streaming for every interaction and less emphasis on commands, replacing it with
context" (the_king, founder, [HN 43634005](https://news.ycombinator.com/item?id=43634005)). Founder
latency claim: 450ms key-up-to-paste vs ~1000ms for competitors.

**Loved.**

- Accuracy: "in another league when it comes to accuracy"; "traveling to another planet in terms of
  improvement" vs Siri dictation (idk1, [HN 43634005](https://news.ycombinator.com/item?id=43634005)).
- Accessibility users are the strongest advocates: an AT assessor "recommend[s] it in my AT
  assessments all the time" (willwade); a historian with carpal tunnel "five times as productive";
  an ex-Dragon user "can't envision returning to Dragon Systems" (rickydroll)
  ([HN 39828686](https://news.ycombinator.com/item?id=39828686), [HN 43634005](https://news.ycombinator.com/item?id=43634005)).
- Latency work noticed and praised (tomblomfield, [HN 43634005](https://news.ycombinator.com/item?id=43634005)).

**Hated.**

- Cloud-only: "Local inference only is an absolute requirement ... it's not even really accessible
  if it's online only" (fxtentacle); "No mention of privacy ... Non-starter for me" (canada_dry)
  (both [HN 43634005](https://news.ycombinator.com/item?id=43634005)). Founder admitted local can't
  hit their speed/quality bar.
- Voice _editing_ commands flopped: "issuing editing commands ... took longer than making edits
  myself" (adamesque); spoken meta-syntax gets transcribed literally ("parentheses word
  parentheses", noahjk). This is why V2 dropped the idea. Big lesson: dictation in, keyboard for
  edits.
- Another subscription (toddmorey); discontinued web product burned paying customers (emacsen);
  AirPods mic initialization latency eats the first words (bklyn11201).

### Willow Voice

**Approach.** Cloud ASR + LLM rewrite, $15/mo, formality controls, macOS-first with iOS keyboard.

**Loved.** Install simplicity, accuracy, formality controls, multilingual; 4.9 Product Hunt
([Product Hunt](https://www.producthunt.com/products/willow-voice)).

**Hated.** The LLM layer is too eager: it "rewrites dictated text and reads 'delete' as an edit
command rather than a word to type, with no clean switch to disable it"; "fine for fresh drafting
and awkward when you dictate into text that already exists"; free allowance exhausts in a couple of
days, forcing the $15 plan; iOS keyboard and hotkey conflicts
([Voibe review](https://www.getvoibe.com/resources/willow-voice-review/), vendor blog, summarizing
Reddit/X sentiment).

### Talon Voice (coders / accessibility)

**Approach.** Free (paid beta tier), local, grammar-of-commands voice control plus dictation,
optional eye tracking and noise inputs (pop click). Not a dictation product so much as a hands-free
input system.

**Loved.** "Talon Voice is the best I've used" for full voice control; free and hackable; the
serious RSI answer — "surprisingly productive despite steep learning curve" (comments collected via
[HN search](https://hn.algolia.com/?query=talon%20voice)). Josh Comeau's canonical writeup: eye
tracker "accuracy is good enough to do some pretty precise things"
([joshwcomeau.com/blog/hands-free-coding](https://www.joshwcomeau.com/blog/hands-free-coding/)).

**Hated.** Steep learning curve, custom syntax memorization, significant setup and a good mic
required; roughly 50% of keyboard productivity even after investment; voice strain over 8-hour
days; Wayland incompatibility (same sources). Nobody recommends Talon for casual dictation; it wins
only when hands are not an option.

### Dragon (Nuance) — legacy baseline

**Approach.** Classic trained ASR with correction-by-voice workflow, per-user voice profiles,
Windows-only since the Mac product died. $699 or $500/yr.

**State.** ~95% accuracy with a good mic and training; still the deepest voice-command/correction
system for documents. But post Microsoft acquisition (2022) "the consumer product has felt
abandoned, with the last major update being version 15 in 2020"; support is poor; the market
caught up "at a fraction of the cost" ([Dictation Daddy](https://www.dictationdaddy.com/blog/dragon-speak-software),
[Voibe](https://www.getvoibe.com/resources/dragon-review/), vendor blogs;
[TrustRadius reviews](https://www.trustradius.com/products/nuance-dragon-speech-recognition/reviews)).
Ex-Dragon users showing up in Aqua/Whisper-tool threads uniformly describe the new generation as a
relief. The durable lesson from Dragon is its _correction_ loop (train the profile on your fixes),
which no modern consumer tool has fully rebuilt.

### Apple built-in dictation (iOS/macOS)

**Approach.** Free, on-device (since A12/M-series), streaming partials typed live into the field.
iOS 26 / macOS Tahoe replaced the engine underneath with SpeechAnalyzer/SpeechTranscriber (plus
DictationTranscriber for command-and-dictation), shipping with the OS.

**Loved.**

- The new API is genuinely fast: 55% faster than MacWhisper's Large V3 Turbo on a 34-minute file in
  MacRumors' test ([MacRumors](https://www.macrumors.com/2025/06/18/apple-transcription-api-faster-than-whisper/));
  first-word latency improved from 780ms to 140ms; ~2x faster than whisper-large-v3-turbo in 2026
  benchmarks while "topping on-device accuracy"
  ([Blake Crosley's SpeechAnalyzer writeup](https://blakecrosley.com/blog/speech-framework-vs-sfspeechrecognizer),
  [iOS 26 SpeechAnalyzer guide](https://antongubarenko.substack.com/p/ios-26-speechanalyzer-guide)).
- Zero install, zero cost, works offline, streams live text. For casual use "Apple's built-in
  dictation is fine" ([afadingthought comparison](https://afadingthought.substack.com/p/best-ai-dictation-tools-for-mac)).

**Hated.**

- The _system dictation UX_ (as opposed to the new API) still carries years of reputation damage:
  mishears, struggles with accents (Australian users reporting they must fake American accents,
  [Apple Communities](https://discussions.apple.com/thread/255405002)), stops listening
  mid-thought, inserts text at the wrong position relative to the cursor, requires spoken
  punctuation. HN shorthand: "Awful" (VESTERDE), "inferior to modern alternatives" (hendersoon)
  ([HN 47040375](https://news.ycombinator.com/item?id=47040375)).
- No vocabulary/jargon adaptation surface for users, no filler removal, no formatting. Wispr's
  launch stat — under 5% of Apple-dictation messages need zero edits — is marketing but directionally
  matches user sentiment ([HN 41696153](https://news.ycombinator.com/item?id=41696153)).
- Key nuance for T3: the iOS 26-era _engine_ is state of the art on-device; the _product_ around it
  is what users hate. Third parties using SpeechAnalyzer/DictationTranscriber inherit the good part.

### ChatGPT / OpenAI mobile voice input

**Approach.** Cloud (Whisper-family / gpt-4o-transcribe). Two distinct modes users constantly
conflate: conversational Voice Mode, and the dictate button (record, tap stop, transcript lands in
the composer).

**Loved.** Low-friction and accurate enough that many people's main dictation habit is "talk into
ChatGPT, copy the text out." It normalized voice-first prompting for exactly T3's audience.

**Hated.**

- Long recordings get silently lost: "messages over 5 minutes often not getting transcribed,
  leading to total loss of content"
  ([OpenAI forum](https://community.openai.com/t/transcription-failures-with-voice-messages-on-chatgpt/705251)).
- A 2026 update removed the transcript preview before send — "major usability regression" thread:
  users want to review/edit the transcript in the composer before it goes to the model
  ([OpenAI forum](https://community.openai.com/t/voice-dictation-no-longer-shows-transcribed-text-before-sending-major-usability-regression/1177339)).
- Pause/resume dictation was lost in an iOS update; the dictation button disappears once any text
  is in the box ([OpenAI forum](https://community.openai.com/t/lost-ability-to-pause-and-continue-dictation-in-ios-app-update/1322147)).
- Whisper's silence hallucinations ("Thank you for watching!", "Please subscribe") are a
  documented, researched failure: ~1% of transcriptions contain fabricated phrases
  ([Careless Whisper, FAccT 2024](https://dl.acm.org/doi/10.1145/3630106.3658996);
  live example in the wild: [OpenWhispr issue #462](https://github.com/OpenWhispr/openwhispr/issues/462)).
- Lesson set for T3: never lose audio, always land the transcript in an editable composer, keep the
  mic reachable when the draft is non-empty, and VAD-gate the recognizer so silence can't
  hallucinate.

### Newer entrants (2025-2026)

- **Handy** (cjpais, open source, Tauri/Rust, all platforms, 23k+ GitHub stars,
  [github.com/cjpais/Handy](https://github.com/cjpais/handy)). Free, offline, push-to-talk,
  Whisper/Parakeet/Moonshine. Loved: "use it daily, looks and works great" (vladstudio); Parakeet
  V3 + Handy "at least as good" as Monologue/Superwhisper/Aqua without subscriptions (peterldowns)
  ([HN 46628397](https://news.ycombinator.com/item?id=46628397)). Hated: 1-2s dead time before it
  hears you on some hardware, so users learn to "wait one or two seconds before talking"
  (mrroryflint, kuatroka, same thread) — a canonical PTT failure (mic not hot when the key is);
  cut-off first words; Linux crashes; weak with non-native accents/AirPods/noise (luigi23). Custom
  words shipped because its absence blocked Wispr converts.
- **Hex** (macOS, free): CoreML/ANE Parakeet, "long ramblings transcribed in under a second";
  "my favorite fully local STT for macOS" (threekindwords,
  [HN 47040375](https://news.ycombinator.com/item?id=47040375)).
- **Whispering** (open source, 591-point Show HN
  [HN 44942731](https://news.ycombinator.com/item?id=44942731)): local-first, BYO backends; thread
  is the best single archive of cross-product sentiment.
- **Monologue** ($8-10/mo): LLM-formatted dictation with a custom dictionary users call decisive:
  "first tool to pass the tipping point ... especially when leveraging the custom dictionary"; a
  reviewer dictated 85k words in 30 days
  ([Matthew Cassinelli](https://matthewcassinelli.com/recommended-apps-monologue-mac-ios/),
  [Slashdot reviews](https://slashdot.org/software/p/Monologue/)).
- **FreeFlow** (zachlatta, free/open,
  [HN 47040375](https://news.ycombinator.com/item?id=47040375)): reproduces Wispr-style "deep
  context" (screenshot + LLM). Author's own admission: the post-processing pipeline costs 5-10s vs
  under 1s raw local — users in the thread consistently treat that as disqualifying for
  interactive dictation.
- **Spokenly, Yap, Voquill, OpenWhispr, BetterDictation, VoiceType/Whispering clones**: the long
  tail all converge on the same shape — free or one-time, local Parakeet/Whisper, hold-or-toggle
  hotkey, paste on release. "Spokenly with Parakeet-v3 [is] the best STT has to offer these days
  ... basically a solved problem" (comment on [HN 46628397](https://news.ycombinator.com/item?id=46628397)).
  BetterDictation notably requires Apple Neural Engine (no Intel) ([alternativeto](https://alternativeto.net/software/betterdictation/about)).

---

## Part B: cross-cutting SOTA patterns (what "good" means in 2026)

**1. Raw ASR is considered solved; the product is everything else.** Parakeet-tdt-0.6b-v3 on
Apple Silicon (or Apple's own SpeechAnalyzer models) transcribe faster than real time with WER
users no longer complain about ("basically a solved problem"). Every complaint that remains is
about ergonomics, formatting, latency of the _pipeline_, vocabulary, and trust.

**2. LLM post-formatting is loved as an outcome and hated as a behavior.** Wispr's zero-edit
formatting is the benchmark and the reason people pay $15/mo. But the failure modes are severe and
recur across every product that does it: rewrites the user's words (Willow), mangles non-English
(Superwhisper), interprets words as commands ("delete"), adds 5-10s latency (FreeFlow), and drifts
in quality over time in ways users can't diagnose (Wispr trust gap). Users consistently ask for a
visible raw-transcript fallback and an off switch. Cleanup must be opt-in, labeled, and reversible.

**3. Context awareness works, but screenshots are radioactive.** Wispr proved both halves:
app-aware tone made output better, and uploading window screenshots to the cloud produced the
category's biggest scandal and a user ban that made it worse. The praised, safe versions of context
are local: per-app modes (Superwhisper, VoiceInk), local vocabulary bias from what the user is
doing. Context should never leave the device unless the user already sent that content anyway.

**4. Personal dictionary is the stickiest feature in the category.** Wispr's auto-learned
dictionary is the named switching blocker; Monologue's custom dictionary is "the tipping point";
Handy had to ship custom words to convert Wispr users. The best pattern combines both directions:
automatic learning from the user's environment and corrections, plus a visible, editable word list
so users trust and can fix it. (Dragon's correction-trains-the-profile loop remains the unmatched
ancestor.)

**5. Push-to-talk ergonomics: offer hold and toggle on the same key.** The community-converged
pattern (VoiceInk, Talk Toggle, whisperer): quick tap toggles recording; press-and-hold acts as a
walkie-talkie and stops on release. Hold-to-talk's virtue is that "the microphone is on for as long
as your finger says it is" — toggle's fatal flaw is forgetting it's on and pasting three pages of
background conversation ([Speechcap, "The case for push-to-talk"](https://www.speechcap.com/blog/the-case-for-push-to-talk)).
Esc cancels. The mic must be hot the instant the key goes down: Handy's 1-2s warm-up and Aqua's
AirPods init latency are both experienced as "it ate my first sentence," among the most-cited
day-to-day failures.

**6. Streaming partials vs transcribe-on-release: users want to see life, not necessarily final
text.** Almost all local tools are batch (release, then paste), and users of those tools explicitly
ask for live text (BizarroLand on Handy). Apple dictation's live typing is its best-liked property.
The counterpoint is Aqua V2 deliberately de-emphasizing streaming because final-pass quality with
context beats eager partials. Synthesis: live hypothesis text is a perceived-latency win and a
trust win (you can see it hearing you), as long as the final commit may revise it. A waveform or
level indicator is the minimum; live words are better.

**7. Local vs cloud: the split is by audience, and T3's audience is the local one.** Mainstream
iOS reviewers give cloud tools 4.8 stars; HN/r/macapps power users treat cloud-only as a
non-starter ("not even really accessible if it's online only") and punish it retroactively when
trust breaks (Wispr 2.7 Trustpilot). Developers dictating into coding agents are the most
privacy-sensitive and self-host-friendly cohort in the market. Local-first also removes the
subscription objection, the other chronic complaint.

**8. Latency bar.** Sub-second stop-to-text is the expectation set by Parakeet-class local tools;
Aqua brags about 450ms; 5-10s LLM pipelines are rejected for interactive use. First-token
(live-partial) latency around 140ms (Apple) reads as instant.

**9. Silence must produce nothing.** Whisper-family silence hallucinations ("Thank you for
watching") are well documented ([FAccT 2024](https://dl.acm.org/doi/10.1145/3630106.3658996)) and
show up as real product bugs ([OpenWhispr #462](https://github.com/OpenWhispr/openwhispr/issues/462)).
VAD gating (Apple's SpeechDetector, Silero) before the recognizer is table stakes. VAD _auto-stop_,
by contrast, is polarizing — users pause to think mid-dictation; auto-stop that fires during a
thinking pause is a known irritant of Apple's system dictation. If offered, it needs a long,
configurable window and should never be the only mode.

**10. The recording indicator must never lie.** The named failure cases: MacWhisper's shortcut
"occasionally fails to trigger the mic popup"; Handy showing its icon while not yet hearing;
toggle modes recording long after the user forgot. Praised patterns: a small persistent HUD/bar
near the cursor or screen bottom with a live waveform (Wispr's bar, VoiceInk's "mini recorder",
Superwhisper's HUD), a distinct audio cue on start/stop, and visible state in exactly one place.
Menu-bar-icon-only state was criticized as early as Superwhisper's launch thread.

**11. Editing is keyboard work.** Voice editing commands failed at Aqua (v2 removed them),
annoy Willow users ("delete" ambiguity), and only survive in Talon where users have no
alternative. The winning loop: dictate into an editable field, fix with hands, send. This also
matches the ChatGPT regression thread: users revolted when the editable-transcript step was
removed.

---

## Part C: lessons for T3 voice mode

What T3 already has, mapped against the loved list:

| Loved feature (source)                                            | T3 status                      |
| ----------------------------------------------------------------- | ------------------------------ |
| On-device, private, no subscription (universal HN demand)         | Yes: Apple on-device stack     |
| Live hypothesis typing (Apple's best-liked trait; asked of Handy) | Yes                            |
| Learned vocabulary (Wispr/Monologue's stickiest feature)          | Partial: session-learned only  |
| Editable transcript before send (ChatGPT regression thread)       | Yes: types into draft composer |
| Tap-to-talk                                                       | Yes, but toggle-only           |

Ranked recommendations:

1. **Add hold-to-talk on the same affordance (and a keyboard binding for it).** Highest
   value-per-effort gap. Community-converged pattern: tap toggles, press-and-hold is walkie-talkie,
   Esc cancels and discards. Toggle-only carries the forgot-it-was-on failure that the
   push-to-talk literature and support threads keep documenting. Ensure the mic is genuinely hot at
   key-down (pre-warmed audio session); "ate my first words" is the most-cited daily failure
   (Handy, Aqua/AirPods).

2. **Persist and expose the vocabulary.** Session-learned vocabulary is the right instinct;
   the loved versions persist per project/user and show an editable list. Extend session learning
   with project-derived terms (file names, branch names, dependency names, thread nouns) — this is
   the privacy-safe version of Wispr's context awareness, and for a coding-agent app the jargon
   ("Zod", "pnpm", "worktree", provider names) is exactly where generic ASR fails. Let users see,
   add, and delete entries; silent learning without visibility is how Wispr lost trust.

3. **Offer optional, clearly-labeled LLM cleanup — never silent, never default-rewriting.**
   The zero-edit output of Wispr is the one cloud feature local tools can't match today, and T3 is
   uniquely positioned: a frontier LLM is already attached to every thread. A "tidy" affordance on
   the dictated draft (remove fillers, punctuate, keep wording) — or a composer toggle — captures
   the value while dodging every documented failure mode (rewrites, command misparsing, non-English
   mangling, latency), because the raw live-typed transcript is already in the editable draft and
   cleanup is a visible transformation of it. Do not add voice editing commands; they failed
   everywhere outside Talon.

4. **Make the recording state unmistakable and honest.** Waveform/level meter while hot, distinct
   start/stop sounds, one state surface. If the recognizer or mic fails to start, say so
   immediately rather than showing a live-looking indicator (the MacWhisper lying-hotkey bug and
   ChatGPT's silent transcription loss are the cautionary tales). Never discard audio: if
   transcription dies mid-utterance, keep what was typed so far in the draft.

5. **VAD-gate silence; treat auto-stop as an option, not a mode.** Use SpeechDetector/VAD so
   silence and keyboard noise can't emit text (the Whisper "thank you for watching" class of bug is
   reputationally fatal in a coding tool). Auto-stop after sustained silence is worth offering for
   hands-busy use, but with a generous default window and off by default, because thinking pauses
   are intrinsic to prompt dictation.

6. **Keep the mic reachable when the draft is non-empty, and support append.** Direct lesson from
   the ChatGPT threads (dictate button disappears once text exists; pause/resume removed). Users
   compose prompts in passes: type, dictate, edit, dictate again. T3's insert-at-cursor into the
   draft already supports this; preserve it as an invariant.

### Verdict: user-selectable WhisperKit / Parakeet engines?

**Not now; leave a seam, revisit on evidence.** Reasoning from the user data:

- What users actually value — sub-second latency, no cloud, live partials, jargon accuracy,
  honest indicators — is already delivered or deliverable on the Apple iOS 26-era stack, which
  independent tests place at or above whisper-large-v3-turbo speed with top on-device accuracy and
  140ms first-word latency, at zero bundle bytes. No user complaint in this survey is solved by
  swapping Apple's engine for WhisperKit; Whisper specifically _adds_ the silence-hallucination
  class of bug that VAD then has to fight.
- Parakeet v3 is the one engine users rave about by name ("stunningly fast", "10x faster, better
  accuracy"), and T3's audience overlaps heavily with the crowd saying it. But its observed wins
  over Apple's current models are speed on batch workloads and older-OS availability, not
  interactive dictation quality; it is English-plus-25-European-languages only and costs ~600MB of
  model distribution and a second inference path across three client surfaces.
- Where an engine option _would_ earn its keep: users on macOS versions predating the new speech
  stack, users whose accents or languages underperform on Apple's models (a real Apple weakness in
  the complaint record), and Windows/Linux clients if T3 desktop dictation ever runs there —
  Parakeet via sherpa-onnx is the community answer on those platforms. The cheap move now is to
  keep the transcriber behind the existing sidecar RPC interface so a Parakeet backend is additive
  later, and to collect accuracy complaints (per-locale) as the trigger. Offering model choice as a
  settings knob today would import Superwhisper's most-complained-about property — configuration
  overwhelm — for a benefit most users can't perceive.
