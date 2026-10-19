# Voice repair campaign, 2026-09-15

User requested all work threads use GLM 5.3 Flash. Selected OpenCode instance `opencode`, model `enablers/xlarge`; local AI Enablers catalog maps alias to `glm-5.3-flash`.

Base: fork shipped build `194db89fe5`, `/Users/aus-m5p-as/projects/t3code-oracle-settings-replay-v2`. Contribution checkout has unrelated modifications and lacks live voice code. Implementation workers use separate worktrees based on the shipped build.

| Work                                            | Thread                               | Worktree                                                | Status   |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------- | -------- |
| Ordered voice chat transcript and bounded panel | e84c14eb-819b-44cf-a28c-92fa30f82ac3 | /Users/aus-m5p-as/projects/t3code-voice-transcript-chat | Complete |
| Discover and activate interface buttons         | 8c9e4073-17f3-4f37-b56f-e2b3fb0548ce | /Users/aus-m5p-as/projects/t3code-voice-ui-controls     | Complete |
| Recover history and audit observed failures     | a13e9fbf-39e6-494b-894a-d6e5812fd2e1 | Read-only, contribution checkout                        | Complete |

Captured current Fork Nightly accessibility text in window.txt. Voice is Ended and no transcript is present. Second Amp fork window is unpaired. User has no remaining transcript and asked whether it is logged. Audit worker checking sources; never reconstruct utterances as fact without evidence.

Explicit evidence: controller appends input and output deltas into separate strings; UI renders only two paragraphs. Button request is new functionality, not an inferred historic failure. Earlier development conversation in prior-thread.json mentions long spoken navigation acknowledgments and mistakenly creating a new thread for a follow-up; those already had fixes in shipped build and are not established regressions in this session.

Constraints: no PR or publish requested; do not restart live app or write live database. User authorized inspecting current T3 window. User subsequently authorized launching and verifying an isolated client. Workers must provide focused tests, commits, report files. At most three workers at once, no recursive delegation. After reports, integrate fixes and verify together. Add separate persistence fix if audit confirms missing history. Ask for concrete examples only if no recovery source survives.

## Recovered session evidence

The voice-created investigation `6285911b-ca7b-525b-b61f-2baee76fffde` preserved a summary of the failed interaction, saved in recovered-evidence.json. It records wrong-project creation, a stale provider-session error after a follow-up was sent, and the user perceiving exact-title navigation as slow or stuck. It is a secondary summary written by the voice agent, not the full raw transcript. The user explicitly confirmed the wrong project in that thread. Normal work completed afterward, supporting a stale-status diagnosis but not proving the precise tool race yet.

End alone does not prove the transcript is erased. Reconnect resets it, and none of the inspected storage writes persist the conversation. The two most recent session boundaries were close at 01:22:15, reconnect 01:22:17, close 01:23:49 UTC.

The separate Amp app pairing screen is excluded as unrelated evidence. No claim of six independently witnessed voice failures is warranted.

## Additional repair threads

- Voice: report newly queued work accurately: `1a441949-6d5a-4a3c-9ec8-a5372ba97e04`, /Users/aus-m5p-as/projects/t3code-voice-resume. Complete.
- Voice: choose the correct project for new work: `f5dcaae3-6a97-4658-bca8-072d522df975`, /Users/aus-m5p-as/projects/t3code-voice-project. Complete.
- Voice: save conversation and tool outcome history: `554d4caa-8fcd-4c14-bcd2-b23b5980b0db`, /Users/aus-m5p-as/projects/t3code-voice-history. Complete.
- Voice: diagnose delayed thread opening: `2dfd0e52-d35c-4848-9ba7-f377ee888c9e`, /Users/aus-m5p-as/projects/t3code-voice-navigation. Complete.

## Integrated result

All eight campaign threads used OpenCode `enablers/xlarge`, the configured GLM 5.3 Flash alias. Integration thread: `04f207b0-da48-4b49-8e81-f17a701c154c`. Branch: `agent/voice-repairs-integrated` in `/Users/aus-m5p-as/projects/t3code-voice-repairs`. No installation, publication, PR, or live app restart.

- Transcript: chronological speaker-labeled utterances, streaming updates, latest 200 visible entries, bounded scrolling.
- Controls: discover and activate current web/desktop DOM controls, with stable IDs, contextual labels, disabled/hidden/stale refusals. Native mobile is explicitly unsupported.
- Resume status: accepted work no longer echoes unchanged stale provider-session errors.
- Destination project: prompt policy separates the project being discussed from the destination of a new task. This is model steering, not deterministic intent enforcement.
- Navigation: actual missing-thread guard provenance replaces a two-second path heuristic, including events arriving before acknowledgment. The original perceived delay could not be reconstructed or timed.
- History: bounded client-local text and tool-event persistence, session list, JSON export, delete and clear. Previous unsaved speech cannot be recovered. Reading full saved transcript content uses JSON export.

The primary verified production components in an isolated browser with scripted voice events: alternating transcript, 200-entry/256px bounds, preserved upward scroll, real sidebar toggle and Settings activation, persisted sessions across reload, exported JSON, individual deletion and clear across remount. This was not a live microphone/WebRTC call. The copied-data client had a baseline environment connection problem (primary Loading, no projects), so full thread actions and live voice were not verified end to end.

Combined automated checks: 43 focused files / 796 passing tests, web and server typechecks, scoped lint with only 11 baseline warnings. Browser export found a flat clickControl-result omission, fixed in final commit `2eed523ea6` with a regression test. Browser recheck confirmed successful Appearance activation and a disabled-button refusal both persist their actual outcome in exported JSON. Integration worker finished and worktree is clean. The owned isolated test server was stopped after verification. See REPORT-integration.md for final commits and check results.

Screenshot: `/Users/aus-m5p-as/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mu21yrls-a06815d7.png` (scripted production transcript components).
