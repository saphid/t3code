# Voice input

Transcription edits a composer draft. It does not submit an agent turn. Audio is
temporary client input, and only normal message submission sends the resulting
text. The current implementation transcribes locally on supported iOS devices;
environment-backed transcription is not implemented.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Live transcription owns microphone capture and streams complete hypotheses into
the captured selection. Each hypothesis replaces the preceding one. Native events
can outrun React renders, so writes go through the synchronous draft store rather
than component state; the controller re-reads the draft after each write, and any
other text or ownership change invalidates the session.

React Native iOS feeds the same audio to two on-device modules in one
`SpeechAnalyzer`: `DictationTranscriber` provides frequent provisional words and
`SpeechTranscriber` provides newer-model corrections during recording. The newer
transcript replaces the corresponding prefix while the fast recognizer supplies
the remaining tail. Alignment handles spelling changes and compounds such as
"time out" becoming "timeout". Results replace passages by audio range, including
when the next passage implicitly finalizes the previous one.

Preparation resolves and downloads both engines' language assets before microphone
capture begins. Languages unsupported by the fast module use the newer module
alone. Confirm drains both result streams and uses only the newer model's final
transcript. There is no periodic forced finalization or second recording replay.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results, and a live session
releases the audio session only after native capture has stopped.

If live capture is unavailable or startup fails before producing text, the
controller falls back to recording a temporary audio file, transcribing it
on-device, and deleting it during cleanup.

## Focused native verification

On macOS 26 with Xcode 26, compile the production transcription and merge code
with its standalone regression tests:

```sh
xcrun swiftc -O -parse-as-library \
  apps/mobile/modules/t3-native-controls/ios/VoiceTranscript.swift \
  apps/mobile/modules/t3-native-controls/ios/VoiceTranscription.swift \
  apps/mobile/scripts/voice-transcription-tests.swift \
  -o /tmp/t3-voice-transcription-tests
/tmp/t3-voice-transcription-tests
```

Pass a local speech audio file to replay it at speaking speed through the actual
production recognizers. The output includes composer updates, initial feedback
time, finalization time, and the final transcript. Add `--expect <text-file>` for
an assertion that the final words match the fixture and at least 90% of its prefix
was visible before Finish. Add `--cancel` to verify that
cancelling during recognition suppresses late text. Review the live transcript
against the spoken fixture as well as the final output; fast first feedback alone
does not establish usable dictation. Mac replay does not measure iPhone latency
or verify its microphone capture.
