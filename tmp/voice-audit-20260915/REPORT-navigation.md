# REPORT-navigation: slow/stuck voice openThread

Worktree: /Users/aus-m5p-as/projects/t3code-voice-navigation (base 194db89fe5, shipped fork voice build)
Commits for integration:

- 67e97fe38d `test(voice): deterministic openThread loop for navigation latency audit`
- 69bf217724 `fix(voice): provenance-based missing-thread redirect reporting` (production fix)
  Model: OpenCode AI Enablers enablers/xlarge (served as glm-5.3-flash), single thread, no children.

## Outcome in one line

Two reproduced navigation defects in the post-acknowledgment redirect watch are fixed with explicit redirect provenance (no timer); the remaining perceived-slowness contributors are protocol and environment latency plus the serialized correction queue, documented below and not patched because the evidence does not support it.

## Evidence versus inference

Evidence (surviving artifacts):

- recovered-evidence.json is a second-hand summary written by the voice agent, not raw telemetry. It records: exact title searched, thread found, openThread returned environment status ok and acknowledged true, user perceived slow/stuck.
- captured-server-voice-spans.ndjson contains exactly one span: POST /api/voice/sessions/close, 0.6 ms. No span, mark, or client timing for the openThread interaction survives.
- window.txt and STATUS.md confirm the app build and that no transcript persists.

Inference (clearly marked): everything below about why the open felt slow is inference from the measured local loop plus code reading. No incident timing was available to confirm which contributor dominated.

## What was built (the measured deterministic loop)

apps/web/src/voice/openThread.loop.test.ts composes the real production pieces with only browser boundaries injected, per the existing harness pattern:

- real createVoiceLiveClient (fake RTCPeerConnection + data channel),
- real createCommandSession (fast-commands wrapper),
- real createNavigatingVoiceToolExecutor (the toolBridge),
- real createVoiceNavigator with the injected route driver from navigation.test.ts,
- fake tools executor with test-resolved deferred gates standing in for tools.ts network validation,
- fake broker `respond` with scripted releases,
- logical clock: one tick per recorded step; marks carry tick numbers.

No sleeps, no wall-clock assumptions; every wait is a deferred the test resolves. Four tests capture ordered timelines end to end.

## Measured results

### 1. Exact-title fast path ("open the thread called X") — correct and instant

Captured timeline (thread-2 = "Project Factory Icon Concepts"):

```
tools.openThread -> tools.openThreadValidated -> navigate -> navigateResolved
-> readPath:/env-1/thread-2 -> mark:navigation_acknowledged
-> command_result "Project Factory Icon Concepts is open." -> chime
```

Zero backend round trips, exactly one chime, one command_result, no errors, acknowledgment only after the route read-back resolves (route acknowledgement semantics verified). Marks: navigation_acknowledged only.

### 2. Backend path (client-delegation respond loop, what the evidence interaction used)

Captured timeline:

```
respond#1 (searchThreads call) -> search validated -> respond#2 (openThread call)
-> openThread validated -> navigate -> navigateResolved -> readPath
-> mark:navigation_acknowledged -> chime -> respond#3 -> command_result (model text)
```

Measured latency shape: two full model round trips plus two tool validations happen before the route even lands; the visible confirmation text waits for a third round trip. On this transport the live client's data-channel function-loop marks (function_call_received, tool_done, function_call_output_sent) never fire; the only mark is navigation_acknowledged. Exactly one chime (the command session's; the hypothesized double chime was disproven: the live client chimes only on the data-channel transport, the command session only on the respond/direct transports, and the broker routes client-delegation sessions exclusively through respond, apps/server/src/voice/broker.ts:514).

Throughout, speech output is suppressed by design (isUiCommandPrefix holds the model's audio; the final model confirmation is intentionally muted per the shipped test "chimes for model-selected navigation and suppresses its verbose confirmation"). So the user's only feedback during the whole chain is the in-flight indicator, then one chime.

### 3. Correction while an open is in flight (stale/superseded navigation)

Measured: the command session serializes executor actions (command-session.ts enqueueAction). A correction spoken mid-open does not begin until the first open's validation AND navigation fully complete; the stale navigation transiently lands (thread-1 shown, its navigation_acknowledged mark emitted), then the correction navigates. Final state is correct and the stale run's confirmation is correctly suppressed (one chime, one command_result, both for the corrected thread). Consequence: correction latency equals the full remaining first-open latency, and the navigator's own supersession path ("a newer request supersedes the older one", navigation.ts) is unreachable in the composed system because the queue prevents a second concurrent navigation.

### 4. Late-redirect watch (FIXED in 69bf217724)

Measured before the fix: after acknowledgment, ANY resolved path change to "/" inside the watch window (default 2 s) was reported as thread_not_found via onRedirectAfterAcknowledgment. The `_chat.index` route resolves to "/", so a user Home click within 2 s of a voice open showed "That thread could not be opened; it may have been deleted." — a false failure. Conversely, a real guard redirect landing after the 2 s window expired silently escaped validation: voice said the thread is open (acknowledged true, matching the evidence) and the UI bounced home with no failure reported.

Fix (event/state based, no timing): the thread route's guard now records explicit provenance — the exact thread it proved missing — at the moment it redirects (new `apps/web/src/missingThreadRedirects.ts`; recorded in `routes/_chat.$environmentId.$threadId.tsx`). The route driver (`useVoiceRuntime.ts`) delivers that event instead of raw path changes, and the navigator (`navigation.ts`) reports a failure only when the provenance matches the acknowledged destination. The watch arms at acknowledgment and stays armed until it fires, a newer navigation replaces it, or dispose; there is no timer left, so user navigation never reports and an actual missing destination can no longer be missed however late the guard verdict lands. `redirectWatchMs` and the path-change heuristic were removed from the driver contract.

## Why the remaining contributors were not patched

1. Backend-path latency (round trips + validation before the route lands): the latency lives in model round trips and tools.ts network validation, deliberately outside navigation.ts/command-session.ts; removing validation-before-navigation would contradict the shipped acknowledged-only-on-verified-landing contract. Not fixable within the owned files; not a defect.
2. Correction serialized behind the in-flight open: real and measured, but unqueueing navigation actions would break speech-order guarantees against mutating actions (startThread/continueThread) and draft opens, and the mutation queue semantics were explicitly kept unchanged; the recovered evidence contains no correction during the slow open. Changing queue semantics on this evidence would be invention.
3. Silence during command resolution (speech suppressed, chime only): deliberate, tested, shipped behavior.

## Precise unresolved condition

The incident's perceived slowness is most consistent with (inference): the request took the backend path (its signature, search then openThread, matches the evidence summary), incurring at least two model round trips plus network validation on a remote environment before the route landed, with speech suppressed and only a chime as feedback; or the thread view remained loading after the route acknowledged (visible readiness is not part of the acknowledgment contract, which covers the route, not ChatView data). No surviving artifact distinguishes these, and the incident latency is deliberately not inferred further. Neither is a client navigation defect; the two navigation defects that were reproducible (false failure on user navigation, silent escape of a late guard redirect) are fixed in 69bf217724.

Recommendations for the parent (not implemented):

- If faster feedback on the backend path is wanted, the product-level lever is emitting the local "X is open." command_result at acknowledgment (as the direct path does) instead of waiting for the model's third round trip; that changes shipped UX intent and tests, so it needs an explicit decision.
- If corrections should preempt a slow open, the navigator's supersession must become reachable; that requires an executor-level cancellation or staleness signal crossing command-session/toolBridge/live-client, a cross-file design change touching the mutation queue.

## Checks run

- vp test run apps/web/src/voice/ apps/web/src/missingThreadRedirects.test.ts : 13 files, 238 tests, all pass (loop tests updated to assert the fixed provenance semantics; new seam regression tests in navigation.test.ts and missingThreadRedirects.test.ts).
- apps/web typecheck (tsc --noEmit): no errors.
- vp lint on all touched files: clean. Pre-commit hook ran vp fmt.
- pnpm-lock.yaml drift from `vp i` was reverted; only the fix and tests are committed.

## Limitations

- No live microphone, browser, or dev server was used; the loop drives sendText, which exercises the same run() path as delegated speech for the command session.
- The tools executor in the loop is a stand-in for tools.ts validation (deferred-gated); real network validation latency is represented by the gate position, not its duration.
- The guard-to-driver wiring (record in the route effect, subscribe in useVoiceRuntime) is exercised through unit seams (navigation.test.ts, missingThreadRedirects.test.ts, loop test), not a mounted router; client verification is owned by the parent.
- The synthetic transcript events in command-session.ts sendText were not touched; mutation queue semantics unchanged.
