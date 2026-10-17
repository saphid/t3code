# Voice dictation on iPhone

Build `apps/swift-ios/T3Code.xcodeproj` with the `T3Code` scheme in Xcode
and run the `FeatureTests` suite. The microphone requires iOS 26 and a
supported device. These native checks require an Apple SDK and cannot run
on Linux.

## Verify on a device

1. Open a thread and tap its microphone button. Required speech assets
   download before the microphone permission prompt.
2. Record a short message, then tap Stop. The transcript replaces the
   captured selection in the draft after transcription finishes.
3. Speak project terms from the current thread, such as `ChatComposer`
   and `worktree`. Vocabulary is rebuilt from the draft, recent messages,
   thread title and project name for each recording.
4. In Settings, choose Dictation or General speech. Dictation receives
   contextual vocabulary; both models apply learned terms as corrections.
   The microphone visibility and keyboard preferences are device-local.
5. Cancel a recording, navigate to another thread or background the app.
   The microphone must stop and a late result must not change another draft.
6. Change model traits and confirm the current traits picker still works.

Recordings stop automatically after five minutes. Audio stays on the device
and temporary recordings are removed after transcription or cancellation.
