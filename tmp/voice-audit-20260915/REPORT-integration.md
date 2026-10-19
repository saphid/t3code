# Voice repair campaign: integration and verification pass (thread8)

Worker: opencode, enablers/xlarge (glm-5.3-flash), per Alex's routing. Checkout
`/Users/aus-m5p-as/projects/t3code-voice-repairs`, branch
`agent/voice-repairs-integrated`, base shipped fork `194db89fe5`. Bounded
integration pass; at most two review rounds; nothing pushed or published.

**STATUS: FINAL.** All worker commits integrated, including the navigation
fix and its follow-up event-order guard. Code and fixture are FROZEN for the
primary's single stable browser pass; no further edits from this worker.

## Exact commits on `agent/voice-repairs-integrated`

| Commit       | What                                                                         | Origin                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ced67ec977` | voice panel transcript renders as ordered speaker-labeled chat               | pre-integrated by parent (source `ced67ec977`/`2a7c3e7aa6`)                                                                     |
| `cd4357df95` | continueThread no longer echoes a stale pre-dispatch session error           | pre-integrated by parent (source `1fe161c3c7`)                                                                                  |
| `ffb238899f` | discover and activate the attached UI's controls (listControls/clickControl) | pre-integrated by parent (source `23959ff632`)                                                                                  |
| `b64b09695d` | stop startThread defaulting to the discussed thread's project                | cherry-pick of `04bdfb832e`                                                                                                     |
| `efae3d600d` | durable recoverable voice session history                                    | cherry-pick of `60de21447b` (REPORT-history.md; base `edac977131` NOT merged, its transcript commit is already integrated here) |
| `c007d7570f` | distinguish repeated controls by visible context and refuse changed targets  | this worker (review findings, below)                                                                                            |
| `a9e3e9a85b` | deterministic openThread loop for navigation latency audit                   | cherry-pick of `67e97fe38d` (REPORT-navigation.md)                                                                              |
| `052d39396a` | provenance-based missing-thread redirect reporting                           | cherry-pick of `69bf217724` (REPORT-navigation.md production fix)                                                               |
| `45e6d00e23` | guard against provenance lost while a navigation was pending                 | this worker (parent-flagged event-order edge, below)                                                                            |
| `8acfc13648` | compare listed control context exactly, exclude only structural non-content  | this worker (parent-flagged target-identity correction, below)                                                                  |
| `2eed523ea6` | record the real flat clickControl outcome in session history                 | this worker (defect found by the primary's stable browser pass, below)                                                          |

### Cherry-pick conflict resolution (b64b09695d)

`apps/server/src/voice/broker.ts` conflicted in
`DEFAULT_DELEGATION_INSTRUCTIONS`: HEAD carried the controls-honesty sentence
(clickControl success only on state "activated"), the incoming commit
qualified the UI-context reference resolution ("references **to existing
threads**") and appended `DESTINATION_PROJECT_POLICY`. Resolved to keep BOTH:
the controls sentence block and the qualified reference-resolution wording;
destination policy appends after both. `broker.test.ts` auto-merged and pins
the policy; all tests pass.

### This worker's fix commit (c007d7570f)

Findings from the combined review of controls + contracts + history + broker:

1. **Repeated buttons were indistinguishable.** A row action like "Settle
   thread" was listed with only an occurrence number, which is not enough to
   select the intended thread. `VoiceUiControl` gained an optional `context`
   field (additive contract change): visible text of the nearest container
   that adds context beyond the control's own name (for a row action, the row
   title), capped at 160 chars. The control's own name is stripped from
   container text so sibling instances never leak into each other's context
   (this exact failure mode was caught by the existing stale-sibling test
   during development); ancestor `textContent` is memoized per scan so the
   walk stays bounded.
2. **Stale ids could retarget after element reuse/label/context change.**
   Click resolution now revalidates the element against its listing: a
   changed accessible name or changed visible context refuses the click as
   `not_found` ("stale ... Call listControls") instead of activating what the
   model did not choose. Context comparison ignores digits and time
   separators, so ticking durations / relative timestamps between listing and
   click never cause a false refusal; a recycled row's new title does.
3. **Disabled ancestor fieldsets were not respected.** HTML's
   actually-disabled rule (fieldset[disabled] disables contained controls,
   first-legend exception) is now applied; the button/input `disabled` IDL
   does not reflect it.
4. **Inert/modal-background controls were activatable.** An `[inert]`
   ancestor now maps the control to `hidden` (excluded from default listing,
   click refused). Radix-style `aria-hidden` backgrounds were already
   covered.

Supporting text updated: broker `listControls` description and delegation
instruction (pick by listed visible context, not occurrence alone) - the
controls-honesty and destination-policy sentences are both preserved;
`docs/user/voice-controls.md` documents context and the changed-target
refusal.

Regression tests added (33 in the two domControls suites, all passing):
listing context for repeated row actions; context omitted when containers add
nothing; click refusal on label change and on context change (recycled row);
activation despite volatile context deltas (`04:12` -> `04:13`); disabled
fieldset with legend exception (and non-first legend correctly NOT exempt);
inert ancestor hidden + refused; recycled-row DOM flow (refuse, relist,
click). No duplicate tests were added for behavior already covered by the
integrated commits' suites.

### 45e6d00e23: pending-navigation provenance edge (parent-flagged)

The navigator arms its redirect watch only at acknowledgment, so a guard
provenance event recorded while `driver.navigate` was still pending reached
no listener; if the redirect's route transition then committed after the
post-navigate path read-back, the read-back still showed the thread route
and the missing-thread verdict was lost (silent bounce home after an
acknowledged open - the exact bug class `69bf217724` fixes, in a narrower
window). Guard: the provenance seam retains a bounded recent log (32) with a
monotonic sequence; the driver contract gains optional
`currentMissingThreadRedirectSeq`/`hasMissingThreadRedirectSince`
(`useVoiceRuntime.ts` implements them over the seam); the navigator
snapshots the sequence at navigation start and, after a successful-looking
path read-back, consults the query - an exact-identity redirect recorded
during the pending navigation outranks the transient read-back and fails
the navigation. No timers, no queue semantics changes. Tests: seam
retention/exact-identity query, and a navigator test where provenance is
recorded mid-`navigate` while the read-back still shows the thread path
(must fail with `thread_not_found`, no acknowledgment mark).

### 8acfc13648: exact context comparison (parent-flagged correction)

The first context comparison dropped digits and time separators to tolerate
ticking durations. That could retarget recycled rows whose titles differ
only numerically ("Phase 3.1" vs "Phase 3.2", "Task 123" vs "Task 124") with
the same control name and element. Context now compares EXACTLY: any change
is a safe stale refusal with a relist instruction. Volatility is excluded at
derivation instead, by structural identification only: `<time>`,
`[datetime]` and `aria-hidden="true"` subtrees are left out of container
text - which covers relative timestamps and the app's ticking duration spans
(the Sidebar renders `WorkingDuration` under `aria-hidden`) - without
weakening identity evidence. Tests: numeric-only title changes refuse in
both pure core and real DOM; changing `<time>`/`aria-hidden` text does NOT
refuse a legitimate click; listing context excludes those subtrees.

### 2eed523ea6: flat clickControl outcome dropped from history (found by the primary's browser pass)

The primary's stable browser pass verified listControls/clickControl against
real sidebar and Settings controls (transcript cap/scroll and history
export/recovery confirmed working) and found one production defect: the
exported history showed clickControl as ok with NO result. The sanitizer
read the outcome off `record.controls` or `record.control`, but the real
`VoiceClickControlOutput` is flat at top level
(`{controlId, name?, role?, state?, message?}`). The sanitizer now
synthesizes the single control entry from the flat shape, so both
activations (state "activated") and refusals (state + message) persist and
export. Regression test uses the real contract shape for success and
stale-refusal outputs; the field allowlist is unchanged. The throwaway
fixture helper `runClickByName` also called the nonexistent
`executor.execute` (VoiceToolExecutor exposes per-tool methods); fixed in
`.t3/fixture/voice-fixture.tsx` (not committed, gitignored) to call
`listControls` directly.

## Verification commands and results (scoped only, no repo-wide checks)

```
vp test run apps/web/src/voice apps/web/src/missingThreadRedirects.test.ts \
            apps/server/src/voice/broker.test.ts packages/contracts
  -> 43 files, 796 tests, all pass (after each cherry-pick and each fix)
vp lint apps/web/src/voice apps/web/src/missingThreadRedirects.ts \
        apps/web/src/routes/_chat.$environmentId.$threadId.tsx \
        packages/contracts/src/voice.ts apps/server/src/voice/broker.ts
  -> 11 warnings; identical to the pre-change baseline (stash-verified),
     all pre-existing (no-inline-schema-compile in broker, react(refs) in VoicePanel)
cd apps/web && bun x tsc --noEmit   -> no errors (pre-existing suggestions only)
cd apps/server && bun x tsc --noEmit -> no errors
```

`.t3/userdata` (the snapshot prepared for primary testing) was not touched;
the only `.t3` addition is the gitignored fixture directory below.

## Browser verification fixture (throwaway, gitignored, not product code)

File: `.t3/fixture/voice-fixture.tsx` (this worktree). It composes the REAL
production pipeline - `createVoicePanelController`, `VoiceControls`,
`VoiceTranscript`, `VoiceHistory`, `createVoiceHistoryRecorder`,
`exportVoiceHistory`, and `createVoiceToolExecutor` over the REAL
`createWebVoiceToolHost` - with an injected fake `VoiceLiveClient` that emits
the same event shapes the production live client emits. No OpenAI connection,
no microphone, no broker calls. It is NOT a parallel fake implementation and
NOT a real voice call; the fake client and scripted events are clearly labeled
in the panel header ("fake client, real pipeline").

Load it in the paired browser tab on the running dev server (verified HTTP
200 through the LIVE server on web7244, no restart performed):

```js
const m =
  await import("/@fs/Users/aus-m5p-as/projects/t3code-voice-repairs/.t3/fixture/voice-fixture.tsx");
m.mountVoiceFixture();
```

Panel appears bottom-left (the real voice panel, if shown, is bottom-right).
Then:

1. **Connect** (fake mic, fake mint; phase goes live). Session identity flows
   into the history recorder like production.
2. **Alternating utterances** button: 6 interleaved input/output utterances
   through the production controller folding (speaker-labeled, ordered).
3. **Flood 250**: pushes past the 200-utterance cap; demonstrates bounded
   list, bounded height, and follow-scroll only at bottom.
4. **listControls (real DOM)**: runs the production executor against the REAL
   DOM controls host on the REAL app document - Settings, toggle sidebar,
   thread rows with their `context` (row titles) visible in the narration.
5. **Click "Toggle sidebar" / Click "Settings"**: list-then-click through the
   production executor by real `controlId`; chime and honest refusal states
   (e.g. a hidden or disabled target) surface as produced.
6. **End, then History**: session appears in the production VoiceHistory
   section; use **Export JSON**, **Delete**, **Clear all**; then
   `window.__voiceFixture.remount()` and a full **reload** (F5) to show
   persistence and recovery from localStorage.
7. **Send test text**: the controller's `sendText` path into the fake client.

Console API: `window.__voiceFixture` exposes `mount/unmount/remount`,
`controller`, `client` (call `client.say/speak/runTool` directly),
`host` (the real tool host - e.g.
`await host.listControls({ includeHidden: true })`), and `demo` helpers.

Direct real-host check without the fixture UI (parent may prefer this via
preview_evaluate once the fixture module is imported):

```js
const { controls, host } = window.__voiceFixture;
(await host.listControls({})).controls.filter((c) => /settings|sidebar/i.test(c.name));
```

Because the fixture imports shared modules via `/src/...` URLs, they resolve
to the SAME Vite module instances the app uses (verified: the transformed
fixture imports `/src/voice/ui/VoiceControls.tsx`, the id the app itself
uses), so `createWebVoiceToolHost`'s atom-backed catalog is the app's live
catalog, and the DOM controls host scans the app's real document. The empty
catalog the parent observed affects thread/environment tools (they refuse
honestly), not listControls/clickControl, which are client-local by design.

## Outstanding limitations

- **Fixture v2, frozen.** Fixes applied after the primary's first mount
  attempt: the throwing pre-connect client accessor (the reported
  "Connect first" render crash) replaced with null-returning lazy access,
  self-healing re-mount after a crashed attempt, and the route driver
  updated to the new `subscribeMissingThreadRedirect` API (including the
  since-query methods). Verified serving (HTTP 200) through the running
  dev server; syntax-checked; not browser-run by this worker.
- **Context is exact by design**: any visible container change between
  listing and click refuses with a relist instruction. Only structurally
  identified non-content (`<time>`, `[datetime]`, `aria-hidden`) is
  excluded. If a row shows volatile text that is NOT structurally marked,
  clicks may refuse until relist - safe and recoverable, chosen over
  retargeting risk.
- **listControls narration/chime policy** (controls worker's cross-file
  follow-up: treat `listControls`/`clickControl` as non-substantive in
  `live-client.ts`/`command-session.ts` suppression lists, chime on
  successful clicks) was NOT applied: a UX nicety, not an interaction bug,
  and outside this pass's bug-fix scope.
- **Native `<dialog>` UA-inertness** (background inertness applied by
  `showModal()` without an attribute) is not detected; only the declarative
  `[inert]` attribute and `aria-hidden` are. T3's dialogs use aria-hidden
  backgrounds today.
- **`context` is a visible-text heuristic**: nearest container whose text
  adds something beyond the control's own name, capped at 160 chars; absent
  when no bounded ancestor qualifies. It is disambiguation context, never a
  click address.
- **Fixture**: scripted, bounded; "Click Settings" assumes a control with
  that accessible name in the current UI state (the parent should confirm
  the real label or pick another control via `host.listControls`). The
  fixture never exercises the real WebRTC/audio path; that remains gated by
  the live key as before. Baseline limitation (primary environment stuck
  Loading / copied projects absent after the isolated-server restart) is
  unrelated to the fixture and does not affect the controls/history demos.
- History is client-local per origin (per REPORT-history.md); nothing
  server-side to recover.
- Navigation recommendations deferred by the nav worker (emit command_result
  at acknowledgment on the backend path; reachable navigator supersession)
  need explicit product decisions and were not implemented.
