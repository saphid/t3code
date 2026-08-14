# Deterministic PR/proof video post-processing

Date: 2026-08-13 (Australia/Sydney)

## Recommendation

Build the shared proof-video skill around a small, versioned **evidence manifest** and a deterministic **FFmpeg/ffprobe renderer**. Capture one untouched master, record the automation actions and assertions as structured data, calculate one edit decision list (EDL), and render three artifacts:

1. `raw.*` — the unchanged capture, retained for audit;
2. `clean.mp4` — the pacing edit only, with no gesture or explanatory graphics; and
3. `annotated.mp4` — the exact same pacing edit, plus gesture animations and captions.

This avoids an LLM making frame-by-frame editing decisions on every run. The test driver supplies facts; fixed code and templates turn them into media. For web capture, current Playwright should be used directly where possible because its screencast API was built for this use case. For mobile, keep native capture and post-production separate so the clean and annotated results come from the same source.

## Why this shape

- **One EDL keeps the pair honest.** Clean and annotated outputs must have identical duration, frame rate, dimensions, and source-to-output time mapping. Only the annotation layer differs.
- **The original must remain truly unadulterated.** Calling a trimmed result “clean” is ambiguous, so retain `raw` as well as `clean`.
- **Action metadata is safer than visual guessing.** A tap, swipe, assertion, explicit wait, and test-step boundary are already known by the automation layer. W3C WebDriver Actions represent pointer coordinates, movement duration, pauses, and multi-touch as timed action ticks, so the same information can drive overlays without computer vision ([W3C WebDriver Actions](https://www.w3.org/TR/webdriver2/#actions)). Appium can also expose command start and finish times ([Appium event timings](https://appium.io/docs/en/latest/guides/event-timing/)).
- **Static UI is not necessarily dead time.** FFmpeg's `freezedetect` finds near-identical frames and `silencedetect` finds quiet audio, but neither can know whether a wait proves correct behavior ([FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#freezedetect)). Use them only to propose idle ranges; explicit test events and protected settle windows decide what may be shortened.

## Evidence manifest

A minimal JSON contract should contain:

```json
{
  "schemaVersion": 1,
  "capture": { "path": "raw.mov", "width": 1206, "height": 2622 },
  "segments": [
    { "inStartMs": 0, "inEndMs": 1800, "rate": 1 },
    { "inStartMs": 1800, "inEndMs": 7200, "rate": 4 },
    { "inStartMs": 7200, "inEndMs": 10000, "rate": 1 }
  ],
  "events": [
    {
      "atMs": 900,
      "kind": "tap",
      "point": { "x": 0.5, "y": 0.82 },
      "action": "Tap Connect",
      "expected": "The environment list opens"
    },
    {
      "atMs": 8100,
      "durationMs": 650,
      "kind": "swipe",
      "from": { "x": 0.5, "y": 0.78 },
      "to": { "x": 0.5, "y": 0.28 },
      "action": "Swipe up",
      "expected": "Older messages become visible"
    }
  ]
}
```

Coordinates should be normalized to the captured content rectangle, not the simulator window. Store source-clock timestamps from one monotonic clock. After cuts and speed changes, map every event through the EDL before generating overlays.

Use fixed, reviewable policies rather than generated prose:

- protect at least the complete gesture plus pre-action and post-action settle windows;
- never speed through a tap pulse, swipe path, transition, assertion, or failure state;
- shorten only explicit waits or idle candidates outside those windows, with a conservative speed cap;
- derive captions from test-step names, accessibility labels, and assertions: `Action: …`, `Expected: …`, and optionally `Next: …`;
- render a 450–650 ms expanding/fading ring for taps and a moving dot plus traced path for swipes; and
- place captions in a consistent safe-area-aware band, moving them only when a manifest override says the relevant UI occupies that band.

## Tool choices

| Tool | Use | Decision |
| --- | --- | --- |
| **FFmpeg + ffprobe** | Probe streams as JSON; trim, retime, concatenate, and overlay assets | **Universal core.** `ffprobe` is designed to produce machine-readable stream/container data, including JSON ([ffprobe documentation](https://ffmpeg.org/ffprobe.html)). FFmpeg supplies `trim`, `setpts`, `concat`, `overlay`, `freezedetect`, and audio tempo filters ([filter documentation](https://ffmpeg.org/ffmpeg-filters.html)). Generate one filter graph from the EDL and encode the clean and annotated outputs from the same normalized master. |
| **ImageMagick** | Pre-render reusable transparent tap/swipe sprites and wrapped caption cards | **Practical companion on this Mac.** Its CLI supports transparent images, text annotation, and drawing, while `caption:` performs width-constrained word wrapping ([command options](https://imagemagick.org/command-line-options/), [text handling](https://usage.imagemagick.org/text/)). This avoids requiring optional FFmpeg text/subtitle filters. |
| **Playwright 1.61+ screencast / Playwright CLI** | Web proof capture with animated action cursor, highlighted targets, action titles, chapter cards, and arbitrary HTML overlays | **Use directly for web.** `page.screencast.showActions()`, `showChapter()`, `showOverlay()`, and precise `start()`/`stop()` are first-party APIs explicitly documented for agentic video receipts. The base screencast/annotation API arrived in 1.59; animated pointer decoration is documented from 1.61 ([Screencast API](https://playwright.dev/docs/api/class-screencast), [1.59 release notes](https://playwright.dev/docs/release-notes#version-159)). The official Playwright CLI skill already recommends a scripted “hero” run with deliberate pauses and annotations ([official skill reference](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/references/video-recording.md)). Still emit or retain a clean source if two variants are required. |
| **Apple `simctl`** | Raw iOS Simulator video and screenshots | **Capture only.** Apple documents `xcrun simctl io booted recordVideo …` and `screenshot` ([Simulator guide](https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/InteractingwiththeiOSSimulator/InteractingwiththeiOSSimulator.html)). The cited capture interface does not document a touch-overlay channel, so gesture metadata should come from the automation wrapper and be added after capture. |
| **Android `adb screenrecord` / Show taps** | Raw Android capture; optional recording-time tap confirmation | **Capture, not the dual-output renderer.** `screenrecord` is scriptable but has a three-minute maximum, no audio, and rotation limitations ([ADB documentation](https://developer.android.com/tools/adb#screenrecord)). Android's Show taps displays a circle that follows the touch and is intended to act as a pointer in recordings ([developer options](https://developer.android.com/studio/debug/dev-options#input)). Because it burns the pointer into the capture, leave it off for the canonical raw/clean master and use it only as a diagnostic fallback. |
| **Maestro recording** | Flow-scoped mobile capture | **Viable capture adapter.** `startRecording`/`stopRecording` create MP4 evidence inside a declarative flow ([Maestro startRecording](https://docs.maestro.dev/api-reference/commands/startrecording), [stopRecording](https://docs.maestro.dev/api-reference/commands/stoprecording)). A wrapper still needs to timestamp action/expectation metadata for universal annotations. |
| **Auto-Editor** | Suggest cuts/speeds from audio, motion, or subtitles; represent an editable timeline | **Optional analysis only.** It can classify timeline ranges and apply `cut`, `speed`, or other actions, and its v3 JSON-like nonlinear timeline can be generated and rendered ([Actions](https://auto-editor.com/docs/actions), [v3 format](https://auto-editor.com/docs/v3)). Its v3 stability is only partial, and content analysis cannot distinguish an important static proof state from wasted time. Do not make it the source of truth. |
| **LosslessCut** | Manual rough cut or importing/exporting EDLs | **Do not use as pipeline core.** It is a fast FFmpeg GUI and can import/export cut lists, but its own batch guide says it was not designed as a fully automated batch toolkit and points users back to scripted FFmpeg ([README](https://github.com/mifi/lossless-cut), [batch guide](https://github.com/mifi/lossless-cut/blob/master/docs/batch.md)). |
| **Remotion** | Rich, React-authored motion graphics and complex data-driven overlays | **Optional second-stage renderer, not the baseline.** It can render videos programmatically and has first-party guidance for captions, timing, sequencing, trimming, and animations ([project](https://github.com/remotion-dev/remotion), [official agent skill](https://github.com/remotion-dev/skills/blob/main/skills/remotion/SKILL.md)). It adds a browser/React rendering stack and has a special license that may require a company license, so FFmpeg plus pre-rendered overlay assets is the smaller default. |
| **VHS** | Deterministic terminal demos | **Terminal-only specialization.** Tape files can script timing and produce MP4/WebM/GIF/frames, but VHS drives a virtual terminal rather than an app UI ([VHS](https://github.com/charmbracelet/vhs)). |

## Local capability check

On this Mac, the current binaries are FFmpeg/ffprobe `8.1.2`, ImageMagick is present, and FFmpeg exposes the required `trim`, `setpts`, `concat`, `overlay`, `freezedetect`, and `silencedetect` filters. This FFmpeg build does **not** expose `drawtext`, `ass`, or `subtitles`. The skill should therefore probe filters at startup and either:

1. use ImageMagick-rendered RGBA caption/gesture assets with FFmpeg `overlay` (recommended portable path for the current machine); or
2. use ASS/libass only when the installed FFmpeg reports those filters.

Do not assume a Homebrew `ffmpeg` build contains every optional text renderer.

## Verification contract

The renderer should fail closed unless all of these pass:

- `ffprobe -of json -show_format -show_streams` can decode each result and reports the expected codec, dimensions, duration, and frame rate;
- clean and annotated outputs have identical duration/frame count and the same EDL digest;
- every action maps inside an included output segment;
- generated frame grabs immediately before, during, and after each action show the overlay only in the annotated result;
- the raw capture's digest is unchanged;
- captions fit inside the content bounds and contain no pairing token, credential, or other configured secret pattern; and
- a concise sidecar report records tool versions, source hash, manifest hash, EDL, output hashes, and real process exit statuses.

The key implementation seam is not sophisticated video generation. It is making the existing test skills emit a stable action/assertion manifest and then handing that manifest to one reusable, tested renderer.
