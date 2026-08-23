# Voice dictation: building and testing on the iPhone

The feature lives on branch `t3code/voice-swift-ios` (pushed to the fork),
one commit on top of `feat/issue110-reasoning-selector`. It was written and
statically checked on the MacBook Pro; the Air owns Xcode and the phone, so
the build and on-device test happen there.

## Option A: let an agent do it (recommended)

On the Air, open T3 Code in the t3code project and start a thread with:

> Fetch origin and check out branch `t3code/voice-swift-ios` in a worktree.
> Build apps/swift-ios (T3Code.xcodeproj, scheme T3Code) for my iPhone and
> run the FeatureTests suite. Then install to the connected phone. Report
> compile errors verbatim if any. The new files are
> Features/Chat/FeatureVoiceDictation.swift, FeatureVoiceDictationButton.swift,
> Features/Shared/FeatureVoiceVocabulary.swift, and edits to
> FeatureComposerView/ThreadDetailView/Info.plist.

## Option B: by hand

```bash
git fetch origin && git checkout t3code/voice-swift-ios
open apps/swift-ios/T3Code.xcodeproj   # build & run on the phone
```

## What to test on the phone (iOS 26 required for the mic button to appear)

1. Open a thread; the composer shows a mic icon next to send.
2. First tap: mic permission prompt (mic only; there is no speech-recognition
   prompt because everything is on-device), then possibly a short
   "downloading model" spinner on first ever use.
3. Speak project jargon: "add the worktree to the pnpm workspace and ask
   Fable to review the ChatComposer". Grey italic preview shows the live
   hypothesis; finalized text lands in the draft.
4. Words from the current thread (file names, branch names) should recognize
   noticeably better than cold jargon: the vocabulary is rebuilt from the
   draft plus the last 40 messages plus titles on every recording start.
5. Navigate away mid-recording: recording must stop (mic indicator clears).
6. On iOS 17 to 25 the button is hidden by design in v1.

## Giving the MacBook Pro direct control for next time

Any one of these lets the agent on the M5 Pro drive builds here directly:

- Enable Remote Login (SSH) on the Air and add the Pro's key
  (`~/.ssh/id_*.pub` from the Pro) to `~/.ssh/authorized_keys`.
- Or run `node apps/server/src/bin.ts pair --base-dir ~/.t3` on the Air's T3
  checkout and give the printed token to the agent on the Pro (the Air's
  T3 server port must be reachable over the LAN or a Tailscale share).
