# T3 Code source-based whimsy review

## Review frame

This is a source-only design review. “Source-observed” below means the behavior
is represented in the inspected revision; timing, visual quality, focus
continuity, assistive-technology output, and cross-device behavior remain
runtime hypotheses until separately authorized verification.

| Item                     | Review target                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository / project     | `saphid/t3code` worktree for `t3broken`                                                                                                                                                                                                                                |
| Revision                 | `d7462d29c3681b1dfd550096d7b31defb8e88e87` (`chore: share agent instructions with Claude`, 2026-08-30)                                                                                                                                                                 |
| Worktree / branch        | `/Users/saphid/.t3/worktrees/t3broken/t3code-c737aa28` / `t3code/catalog-apple-whimsy-examples`                                                                                                                                                                        |
| Pre-existing dirty files | Modified `docs/README.md`; untracked `docs/internals/whimsy-guide.md` and `docs/internals/whimsy-references.md`. They were treated as input and preserved.                                                                                                             |
| Clients in scope         | Shared web renderer (local, remote/relay, and tunnel modes), Electron shell, React Native iOS and Android, `packages/client-runtime`, and `packages/contracts`                                                                                                         |
| Out of scope             | Separate SwiftUI repositories; implementation; live state; browsers; Computer Use; simulators; dev servers; network/runtime verification                                                                                                                               |
| Method                   | Read the applicable agent policy, the [review guide](./whimsy-guide.md), its [reference companion](./whimsy-references.md), and the relevant components, styles, state reducers, and contracts. Traced proposed effects back to real state rather than provider prose. |

The repository has no upstream source-review capability registered in the local
Portfolio Control Plane; this document is therefore not a duplicate portfolio
member. That lookup did not change the review scope.

## Existing character to preserve

T3 is not starting from a blank personality system. Its strongest existing
language is a quiet **workbench at night**: precise status marks, a few tactile
objects, themed materials, and authored blueprint/starfield scenery outside the
reading canvas.

- **Authored stage worlds.** `SidebarStageBackdrop` selects Nightly starfield or
  Dev blueprint artwork from the actual environment stage and keeps the SVG
  decorative with `aria-hidden`; the artwork also reaches auth and primary
  composer controls. Preserve this original T3 vocabulary instead of adding a
  mascot or Apple-like asset. See
  [`resolveSidebarStageBackdropVariant` and `StageBackdropArt`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/SidebarStageBackdrop.tsx#L15)
  and the [theme-aware art palette](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/index.css#L508).
- **The draft-to-thread transition is already careful.** The mobile route uses a
  180 ms view transition only when the viewport, API, and motion preference
  allow it, awaits active animations, survives cancellation, and always runs the
  state update. The desktop composer uses a bounded transform-only FLIP and also
  bypasses reduced motion. Preserve and test these paths; do not replace them
  just to create a “magical” send. See
  [`runMobileComposerTransition`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/draftHeroTransition.ts#L40),
  [`useDraftHeroLayoutTransition`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/ChatView.tsx#L372),
  and the [route handoff](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/routes/_chat.draft.$draftId.tsx#L33).
- **The prompt stash is functional whimsy.** A bookmark-shaped shoulder tab
  gives one quiet, remounted acknowledgment when the saved count changes,
  preserves focus, exposes a descriptive label, and removes animation for
  reduced motion. Keep its object metaphor and restraint. See
  [`ComposerStashBadge`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/ComposerStashBadge.tsx#L7)
  and the [one-shot CSS](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/index.css#L2258).
- **Theme choice already feels like play with purpose.** Web and mobile both use
  shared, color-accurate glowing orbs; web also renders a miniature app rather
  than an abstract swatch. Selection remains a normal radio/button action. See
  [`ThemePreviewCircle`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/settings/ThemePreviewCircles.tsx#L98),
  [`ThemeWireframePane`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/settings/ThemeWireframe.tsx#L4),
  and mobile [`PreviewOrb`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx#L31).
- **Connection trouble stays calm and truthful.** The shared supervisor
  distinguishes available, offline, connecting, backoff, connected, and blocked
  states; web suppresses transient reconnect noise and mobile keeps status in a
  stable title/composer slot. Preserve the explicit text and recovery actions.
  See the [connection model](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/client-runtime/src/connection/model.ts#L58),
  [shared presentation](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/client-runtime/src/connection/presentation.ts#L58),
  web [reconnect banner](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/ChatView.tsx#L2074), and
  mobile [`WorkspaceConnectionTitle`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx#L80).
- **Mobile thread movement is already tactile.** Full-swipe actions use a spring,
  boundary overshoot, and a single medium haptic when the action arms; the
  command still waits for real success. Preserve this rather than layering on a
  second archive performance. See
  [`ThreadSwipeActionContainer`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/home/thread-swipe-actions.tsx#L260)
  and [`useThreadListActions`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/home/useThreadListActions.ts#L90).
- **Reading and recovery surfaces favor content.** The virtualized web timeline
  keeps stable rows, failures can be deliberately revealed, changed files sit on
  checkpoint summaries, and revert is explicit and destructive. Mobile stops
  auto-following once the reader moves into history. Keep transcripts, code,
  diffs, terminals, permissions, and failure messages free of decorative motion.
  See [`MessagesTimeline`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/MessagesTimeline.tsx#L546),
  [changed-file checkpoints](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/MessagesTimeline.tsx#L1613),
  [revert confirmation](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/ChatView.tsx#L4951), and
  mobile’s [live-follow latch](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/threads/ThreadFeed.tsx#L1302).

One existing treatment needs hardening rather than removal: Claude
“ultrathink” applies two perpetual 10-second chroma animations without a nearby
reduced-motion override. The provider gating is honest, but the continuous
repaint is inconsistent with the repository’s otherwise duty-cycled status
animations. See
[`resolveComposerProviderState`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/composerProviderState.tsx#L54)
and [the current ultrathink keyframes](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/index.css#L2300).

## Journey and client coverage

“Desktop” below means the Electron shell plus the shared web renderer. Source
inspection cannot prove parity in packaged builds or over real remote links.

| Journey             | Web: local and remote                                                                                                                                       | Electron shell                                                               | React Native mobile / shared state                                                                                              | Review result                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Connect and onboard | Inspected pairing, hosted pairing success/failure, connection dot, reconnect banner, and shared presentation.                                               | Renderer shares those flows; native Help/update shell inspected.             | Inspected QR/manual pairing, immediate success navigation, environment rows, home title, and composer status.                   | Opportunity W-02. Keep outage and expired/failed pairing copy calm.                                          |
| Choose a project    | Inspected draft hero, sidebar, command palette, settings, favicon load/fallback, create/open/switch paths.                                                  | Same renderer.                                                               | Inspected project favicon/cache and project list/new-task use.                                                                  | Opportunity W-01. No new wire state is needed.                                                               |
| Organize threads    | Inspected draft creation, pin ordering, settle/un-settle, snooze/wake, archive/restore, navigation-after-success, and list performance guards.              | Same renderer.                                                               | Inspected active/pending/snoozed/settled shelves, swipe actions, archive restore, and command guards.                           | W-06 is later; preserve mobile physics and quiet resting rows.                                               |
| Compose             | Inspected draft hero handoff, attachments, provider/model modes, stash, send/stop, keyboard-accessible controls, and reconnect state.                       | Same renderer and desktop keybindings.                                       | Inspected attachments, model picker, send/stop, queued messages, and connection pill.                                           | W-04 for the real mobile outbox. Existing draft and stash treatments stay.                                   |
| Run work            | Inspected normalized session/latest-turn state, sidebar status priority, start/work/input/failure/completion, and provider-specific ultrathink decoration.  | Same renderer.                                                               | Inspected mirrored presentation, work feed, Live Activity, stop/resume, and completion state.                                   | W-03; W-00 is a prerequisite. Do not infer success from assistant text or checkpoint availability.           |
| Inspect results     | Inspected tool/failure folds, reasoning/work groups, long virtualized messages, copy, code, changed files, diffs, and terminal-related surfaces.            | Same renderer; embedded-content focus adds risk.                             | Inspected feed virtualization/follow behavior, work log, code/diff review, and terminal presentation.                           | Leave calm. No shortlisted decoration inside content.                                                        |
| Save and recover    | Inspected checkpoint states, changed-file summaries, revert confirmation/failure, snooze undo, and canonical-state recovery after optimistic pin order.     | Same renderer; revert uses the desktop/local API boundary.                   | Inspected checkpoint review summaries and archive restore; no mobile checkpoint-revert action was found in the reviewed source. | Opportunity W-05, with read-only mobile semantics.                                                           |
| Configure           | Inspected appearance previews/editor, providers, connections, keybindings, command palette, version/update, diagnostics, and motion handling.               | Inspected native About metadata and Help/update menu.                        | Inspected appearance, environments, notifications/Live Activities, storage, legal, and version/update state.                    | Preserve theme play; W-00 closes a motion gap. No general sound preference exists in the inspected settings. |
| Return later        | Inspected reconnect projection, snapshot/reducer behavior, unseen completion, list lifecycle, cached favicon loading, and background activity presentation. | Same renderer; native update lifecycle inspected.                            | Inspected durable outbox load/drain, foreground title, notification/Live Activity settings, and empty/loading states.           | W-03 and W-04 explicitly avoid replay-on-mount. Remote/tunnel runtime remains a gap.                         |
| Discover            | Inspected web About/version/diagnostics, Electron About and Help, mobile App/version/legal, empty states, and authored stage art.                           | Native About carries app/version/commit; Help contains only update checking. | App section carries storage, legal, and version, with a hidden repeated-tap update check.                                       | W-07 is exploratory. Essential actions should not become easter eggs.                                        |

Supporting entry-point evidence includes the web command palette’s shared project
favicon and new-thread/project actions
([`projectFavicon`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/CommandPalette.tsx#L165),
[`handleNewThread`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/CommandPalette.tsx#L965)), the
project-search keybinding mapping
([`projectSearch.toggle`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/CommandPalette.tsx#L385)),
and the normalized thread lifecycle contract
([`OrchestrationThread`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/contracts/src/orchestration.ts#L378)).

## Ranked opportunities

The ranking favors truthful orientation and repeated identity over spectacle.
“First batch” is a design recommendation, not implementation authorization.

| Rank | ID   | Priority                 | Opportunity and tradeoff                                                                                                                                                                                                                                                                |
| ---: | ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | W-01 | First batch              | **Project workshop marks:** a deterministic, theme-aware fallback identity where projects now share a generic folder. High exposure, nearly zero motion, and strong cross-client reuse; needs careful collision/contrast design.                                                        |
|    2 | W-02 | First batch              | **Connection clasp:** two small endpoints visibly join on the direct success of adding an environment, then remain a static connected glyph. It improves non-color status meaning and gives onboarding one deserved acknowledgment without celebrating reconnects.                      |
|    3 | W-03 | First batch              | **Turn completion tick:** the affected status mark resolves once from working to completed on a live normalized state transition. Useful orientation, but frequent enough that it must remain tiny, silent, and replay-safe.                                                            |
|    4 | W-00 | First-batch prerequisite | **Make ultrathink settle:** preserve the Claude-specific spectrum but replace perpetual motion with one bounded activation sweep and a static resting frame. This removes a motion/performance inconsistency before adding more expression.                                             |
|    5 | W-04 | Later                    | **Outbox folded note:** give mobile’s durable queued-message count a small familiar-object mark tied to actual enqueue/delivery. Valuable when offline, but mobile-only and secondary to making project/connection state coherent.                                                      |
|    6 | W-05 | Later                    | **Checkpoint bookmarks:** make a ready checkpoint read as a saved place, while missing/error states and mobile’s view-only behavior remain explicit. It aids recovery but needs semantic care so “saved” is not mistaken for “tests passed.”                                            |
|    7 | W-06 | Later                    | **Shelf transit on web:** after confirmed settle/archive, let only the affected row make a short positional handoff toward its destination shelf. It explains location, but list virtualization and active-thread navigation make it costlier. Mobile already has the better treatment. |
|    8 | W-07 | Exploratory              | **Makers’ blueprint:** a deliberate, static About/credits panel that carries the workbench art and open-source authorship. Warm and low risk, but less useful than the state-linked details above.                                                                                      |

## Full specifications

### W-01 / Project workshop marks / First batch

**Journey and clients / entry points.** Choose a project and return later; web
sidebar, project picker, command palette, chat header, Settings, Electron’s
renderer, and mobile project/thread/archive/new-task rows.

**Current behavior and source evidence.** Source-observed at the target revision:
both clients load `faviconPath`, hide the image until it is ready, and fall back
to a generic folder after absence or load failure. Web uses an empty image alt;
mobile gives the fallback a project accessibility label and bounds its image
cache. See web [`ProjectFavicon`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/ProjectFavicon.tsx#L14),
mobile [`ProjectFavicon`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/components/ProjectFavicon.tsx#L21),
and [`projectFaviconCache`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/components/projectFaviconCache.ts#L11).
The project shell already carries stable ID, title, root, repository identity,
and optional favicon path
([`OrchestrationProjectShell`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/contracts/src/orchestration.ts#L433)).

**User need and intended feeling.** A person scanning many projects needs quicker
recognition and a modest sense that each workspace is “their place.” The feeling
should be collected tools on one bench, not gamified avatars.

**Mechanism / Apple reference.** Personal identity and tiny functional detail.
The transferable lesson from [colorful and coordinated iMacs](./whimsy-references.md#identity-authorship-and-history)
is to let color and form travel together across an object family, without
copying Apple’s shapes or palette.

**Proposed trigger and behavior.** Before: `faviconPath` is absent, still loading,
or has failed. Interaction: no extra interaction is introduced. Settled state:
render an original compact “workshop mark”—a folder/tab silhouette plus one of a
small set of interior line geometries—derived deterministically from the scoped
environment/project ID and colored from existing theme tokens. When a real
favicon successfully loads, it replaces the mark exactly as it replaces today’s
folder; while loading, retain the cached previous source to avoid flicker.

**Subtle / expressive / recommendation.** Subtle: only vary the folder tab accent.
Expressive: a bespoke illustrated project “world.” Recommend the middle: static
two-tone geometry with enough silhouette variation to scan at 16–24 px, no
background scene and no animation.

**Frequency and replay/reconnect.** It may appear hundreds of times, so it is
pure rendering with no mount animation, timer, storage write, or network call.
The same scoped project must resolve identically on remount, reconnect, search,
and another client. Environment scope prevents same-ID collisions across hosts.

**Failure, interruption, reverse, unknown.** Invalid/missing identity or a hash
failure falls back to the current generic folder. Adding a favicon reverses the
fallback; removing it restores the deterministic mark. A late failed image must
not erase a newer successful source.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Existing
row/button hit targets and focus stay unchanged. The mark is static, silent, and
decorative: web keeps it out of the accessibility tree; mobile should avoid a
redundant image announcement when the adjacent project title already names it.
Use theme tokens with a high-contrast monochrome outline fallback and do not rely
on color alone to distinguish marks. Mirror interior geometry for RTL only when
it has directional meaning; the recommended abstract geometry does not.

**Rendering / performance / dependencies.** One tiny SVG/native vector per
visible row. Compute a small descriptor once per scoped ID; do not rasterize,
animate, add backend events, or weaken list `content-visibility`/virtualization.
No contract change is necessary.

**Reuse and likely implementation scope.** A shared pure descriptor in
`packages/client-runtime` or `packages/shared`, rendered by the existing web and
mobile `ProjectFavicon` components. Electron inherits web. All consumers then
receive the identity without entry-point-specific work.

**Acceptance and focused verification.** Unit-test determinism, environment
scoping, bounded variants, malformed input, theme contrast choices, and favicon
override/failure races. Component-test accessible names and cached-source
behavior. With later runtime authorization, inspect dense web/mobile lists at
100% and zoomed/high-contrast sizes and verify no scroll regression.

**Confidence / unresolved.** High source confidence; visual collision rate and
small-size legibility require design samples and runtime review.

### W-02 / Connection clasp / First batch

**Journey and clients / entry points.** Connect and onboard, configure, and
return later; web hosted/manual pairing and connection dots, Electron renderer,
mobile QR/manual pairing, environment rows, home title, and composer status.

**Current behavior and source evidence.** Web’s hosted pairing has explicit
`pairing`, `paired`, and `error` states, moves to `paired` only after
`connectPairingEnvironment` succeeds, and guards replay in the current route
([`HostedPairingRouteSurface`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/auth/PairingRouteSurface.tsx#L166)).
Mobile immediately replaces/goes back after its successful pairing command
([`ConnectionsNewRouteScreen`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx#L150)).
The web status dot maps shared phases mainly to color and a transitional ping
([`ConnectionStatusDot`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/ConnectionStatusDot.tsx#L6));
mobile environment rows retain explicit status text and recovery controls
([`ConnectionEnvironmentRow`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx#L65)).

**User need and intended feeling.** First pairing is a meaningful, infrequent
moment: two machines have found each other. Normal reconnect is operational and
should feel dependable, not celebratory.

**Mechanism / Apple reference.** Tiny functional detail plus restrained first-use
acknowledgment. The [Happy Mac and working-icon examples](./whimsy-references.md#character-and-useful-detail)
show how a small mark can explain state and carry character.

**Proposed trigger and behavior.** Before: two separated endpoint shapes beside
the existing “Pairing” text. Interaction: submit/scan remains unchanged. On the
direct success result of that pairing command—not merely socket connection—the
endpoints join with one bounded stroke/translation and settle as a static clasp
beside “Environment saved” or the destination receipt. Web can use its existing
paired state. Mobile must navigate immediately as today and show the receipt on
the destination; the effect must not delay navigation. Normal connection rows
reuse static shape states (separate/approaching/joined/broken) alongside text.

**Subtle / expressive / recommendation.** Subtle: replace the round dot with
shape-coded states. Expressive: a full-screen handshake celebration. Recommend
shape-coded status plus a single 180–240 ms direct-pair join confined to the
icon. Timing is a hypothesis for later runtime tuning.

**Frequency and replay/reconnect.** The join plays once per user-initiated pairing
command success in that client. Snapshot hydration, remount, foregrounding,
multi-device observation, and routine reconnect render the settled static glyph.
Rapid duplicate submits remain blocked by existing in-flight guards.

**Failure, interruption, reverse, unknown.** Failure leaves endpoints separate
and preserves exact error/retry UI; expired tokens get no character performance.
Cancellation or navigation settles immediately. Deleting an environment simply
removes it; reconnect shows approaching/joined state but no first-pair effect.
Unknown phases use a neutral outlined glyph plus text, never a success pose.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Pairing
controls and focus order do not change. Reduced motion jumps to the joined frame.
Glyphs are decorative beside the existing status text; icon-only placements need
the existing tooltip/accessibility label. Shapes, not just red/yellow/green,
distinguish phases. No sound or haptic is recommended.

**Rendering / performance / dependencies.** A small SVG/native-symbol-sized
component with transform/stroke animation only during direct success. Suspend or
finish it when hidden. Use existing pairing `AsyncResult` and normalized
connection supervisor state; add no server event, timer-driven truth, or polling.

**Reuse and likely implementation scope.** Shared phase-to-shape descriptor in
`packages/client-runtime`, with web/native renderers. Web and Electron share the
pairing receipt; mobile needs client-local navigation receipt plumbing. Behavior
is provider-independent: Codex, Claude, Cursor, Grok, OpenCode, and unknown
drivers all connect through the environment layer.

**Acceptance and focused verification.** Tests must prove the join occurs only
after a successful direct pairing command; not on error, initial connected
snapshot, reconnect, or remount; immediate mobile navigation remains; every
phase retains text/action; reduced motion is static; and unknown phases are safe.
Later runtime checks should cover expired tokens, local/relay/tunnel links,
keyboard pairing, screen readers, and background/foreground on iOS and Android.

**Confidence / unresolved.** High confidence in the triggers; the best mobile
destination receipt and native reduced-motion behavior need runtime validation.

### W-03 / Turn completion tick / First batch

**Journey and clients / entry points.** Run work and return later; web/desktop
sidebar and chat status, command-palette thread results, mobile thread lists/feed,
and Live Activity where enabled.

**Current behavior and source evidence.** The contract distinguishes session
`starting/running/ready/interrupted/stopped/error` and latest-turn
`running/interrupted/completed/error`
([`OrchestrationSessionStatus` and `OrchestrationLatestTurn`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/contracts/src/orchestration.ts#L288)).
The reducer treats the session leaving running as authoritative, explicitly does
not settle on an assistant message, and allows a completed turn even when a
checkpoint is missing
([`threadReducer`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/client-runtime/src/state/threadReducer.ts#L381),
[`settledTurnStateForSessionStatus`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/client-runtime/src/state/threadReducer.ts#L613)).
Web presents working/connecting/approval/error/plan-ready and unseen “Completed”
without idle noise
([`resolveThreadStatusPill`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/Sidebar.logic.ts#L638));
mobile similarly returns no presentation for quiescent state
([`resolveThreadPresentation`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/threads/threadPresentation.ts#L44)).

**User need and intended feeling.** A tiny moment of closure helps a person
monitor many agents without turning completion into a reward loop. It should
feel like a pencil tick finishing a workbench note.

**Mechanism / Apple reference.** A tiny stateful icon, not an award. The
[working Clock/Calendar icon lesson](./whimsy-references.md#character-and-useful-detail)
supports making the status mark explain actual state; the
[Activity-award lesson](./whimsy-references.md#sound-play-expression-and-surroundings)
also warns that celebration belongs to rarer, verified milestones.

**Proposed trigger and behavior.** Before: the existing affected-object working
indicator. Interaction: none; the user may keep navigating/typing. On a live
observed transition for the same turn from `running` to `completed`, its small
status mark draws/resolves into a check for about 160–200 ms, remains legible
briefly, then settles to the current quiet state. If the completion happened
while unseen, retain the existing static “Completed” pill until seen; do not play
the stroke later.

**Subtle / expressive / recommendation.** Subtle: immediate dot-to-check swap.
Expressive: confetti, sound, haptic, or an award object. Recommend one short
stroke/opacity transition confined to the status mark, silent by default.

**Frequency and replay/reconnect.** Heavy users may see it many times per hour.
Play only when a mounted client observes the same turn change live. Initial
snapshots, history replay, virtualization remount, reconnect, duplicate events,
and another client opening later render settled state. Key suppression by
environment/thread/turn ID, not by a global timeout.

**Failure, interruption, reverse, unknown.** `error`, `interrupted`, and `stopped`
never pass through the completion tick; keep their explicit copy/actions.
Resuming creates a new running turn or state and cancels any old visual locally.
Out-of-order/unknown state jumps settle without animation. A missing checkpoint
does not change the completion mark and is reported separately where relevant.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** It adds no
target and never moves focus. Reduced motion swaps frames without drawing.
Screen readers hear the existing status text/announcement, not decorative SVG.
Use current semantic status colors plus a shape change; high contrast gets an
outlined check. No sound or haptic in this batch: the inspected settings expose
notification/Live Activity controls, not a universal opt-in completion-sound
preference.

**Rendering / performance / dependencies.** One compositor-friendly local
animation on the visible status mark, never the transcript or entire row. No
continuously mounted timer, new network traffic, backend animation event, or
provider-prose parsing. The normalized contract is the sole truth source.

**Reuse and likely implementation scope.** A shared transition predicate keyed
by turn identity plus platform renderers in existing status components. Common
behavior for Codex, Claude, Cursor, Grok, OpenCode, and external drivers because
all are normalized into the same session/latest-turn contract; adapter timing
still needs provider-focused tests.

**Acceptance and focused verification.** Reducer/presentation tests cover every
session end state, duplicate/out-of-order events, missing checkpoints, resume,
hydration, reconnect, and remount. Component tests prove scope, suppression, and
reduced motion. Later integrated checks should run one completion and one
failure per built-in provider where available and inspect web, Electron, iOS,
Android, foreground, background, and multiple clients.

**Confidence / unresolved.** High confidence in normalized state semantics;
provider-by-provider timing and screen-reader announcement cadence are unverified.

### W-00 / Make ultrathink settle / First-batch prerequisite

**Journey and clients / entry points.** Compose and configure; Claude composer
frame/model-picker treatment in the web renderer and Electron. Mobile has no
matching class in the inspected source.

**Current behavior and source evidence.** `resolveComposerProviderState` enables
the frame and chroma classes only for the Claude driver when actual prompt
injection state is `ultrathink`
([source](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/composerProviderState.tsx#L74)).
Both CSS effects currently run linearly and infinitely for ten seconds per cycle
([source](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/index.css#L2300)). Nearby web motion patterns commonly
use `motion-reduce` or `prefers-reduced-motion`, but this block does not.

**User need and intended feeling.** Preserve a distinctive, earned “extra
thinking” mode while ensuring it does not become ambient GPU work or motion the
user cannot disable.

**Mechanism / Apple reference.** Expressive color with bounded intensity. The
[Rainbow Apple identity lesson](./whimsy-references.md#identity-authorship-and-history)
supports recognizable color; the [Messages-effects lesson](./whimsy-references.md#sound-play-expression-and-surroundings)
says intensity should follow intent and context.

**Proposed trigger and behavior.** Before: ordinary frame. When the prompt state
enters Claude ultrathink, run at most one short spectrum sweep, then settle to a
static gradient rim and static chroma icon for as long as the mode remains.
Removing/changing the prompt or provider returns immediately to the ordinary
frame. This is a safety correction to existing personality, not a new provider
claim.

**Subtle / expressive / recommendation.** Subtle: static gradient only.
Expressive: current perpetual cycle. Recommend one bounded 400–600 ms activation
sweep plus a good static endpoint; if paint cost is not demonstrably cheap,
choose static-only.

**Frequency and replay/reconnect.** It occurs whenever a Claude prompt uses the
mode. Animate only on a user-visible transition into the state, not every render,
route remount, restored draft, reconnect, or tab foreground. Repeated toggles may
replay only after the state genuinely left and re-entered.

**Failure, interruption, reverse, unknown.** Provider change, prompt edit,
unmount, or hidden document cancels and settles immediately. Unknown provider or
option state gets the ordinary composer. No error state uses the spectrum.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Same controls
and labels; the rim is decorative. Reduced motion and high-contrast/forced-color
present a static border/icon with existing text. Color is not the only indication
of the selected mode. No audio.

**Rendering / performance / dependencies.** Limit work to composer pseudo-element
and icon; avoid continuously changing gradient backgrounds. Prefer opacity or
transform over repainted background position and stop when hidden. No new state
contract or server work.

**Reuse and likely implementation scope.** Existing provider-state helper and
CSS only, with a small component transition guard if CSS cannot distinguish a
live activation from hydration. Claude: supported. Codex, Cursor, Grok, OpenCode,
and unknown drivers: intentionally unsupported because their option contracts do
not assert Claude prompt injection.

**Acceptance and focused verification.** CSS/component tests verify one bounded
run, static reduced-motion/forced-color output, cancellation, provider switch,
restored draft, and no class for other providers. Later profile paint/composite
cost and background-tab activity in Chromium/Electron.

**Confidence / unresolved.** High source confidence that the current animation
is perpetual and lacks a local motion gate; actual GPU cost is unmeasured.

### W-04 / Outbox folded note / Later

**Journey and clients / entry points.** Compose and return later; React Native
existing-thread and queued-creation composers. Web/Electron have no equivalent
durable client outbox in the inspected paths, so this is intentionally mobile-only.

**Current behavior and source evidence.** The outbox publishes queued state
synchronously, persists it behind that feedback, and rolls the entry back if the
durable write fails
([`enqueue`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/state/thread-outbox-manager.ts#L91)). Delivery
waits for connection/shell truth and removes already-delivered or vanished
entries according to explicit rules
([`resolveThreadOutboxDeliveryAction`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/state/thread-outbox-model.ts#L149)).
The composer currently fades in plain text saying how many messages will send
automatically
([queue count](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/threads/ThreadComposer.tsx#L897)).

**User need and intended feeling.** Offline send should feel intentionally held,
not lost. A familiar folded note makes the durable waiting state easier to spot
without pretending delivery occurred.

**Mechanism / Apple reference.** Familiar object and tiny functional detail. The
[Dashboard object-identity lesson](./whimsy-references.md#physical-behavior-and-material)
supports keeping one object recognizable through waiting and delivery states.

**Proposed trigger and behavior.** Before: normal send arrow. On successful
client-local enqueue, the arrow/note makes one short tuck toward the existing
queue-count line; settled state is a static folded-note icon plus exact count and
“will send automatically.” Only actual outbox removal after confirmed delivery
may remove the note. Loaded persisted entries render static immediately.

**Subtle / expressive / recommendation.** Subtle: static note beside the count.
Expressive: the send control flies across the composer. Recommend the static
mark plus an optional 140–180 ms opacity/translation confined inside the send
control/count region; never traverse content.

**Frequency and replay/reconnect.** Normally rare but can repeat rapidly during
an outage. A burst coalesces to one acknowledgment while the numeric count is
authoritative. Storage hydration, reconnect, retry, remount, and foregrounding
never replay enqueue motion.

**Failure, interruption, reverse, unknown.** Persistence failure uses the current
rollback and error path; the mark/count disappears with the rolled-back entry.
Delete/edit retains existing controls. Delivery failure leaves the note queued;
successful removal settles without a success celebration. Unknown storage state
uses text/spinner, not an empty outbox claim.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Send and
queued-message actions keep their targets. Reduced motion uses the static note.
The icon is decorative; screen readers get the exact live count/status without
duplicate announcements. Use outline plus text, not color alone. No haptic or
sound for each queued message.

**Rendering / performance / dependencies.** One icon and at most one bounded
local transform; the existing atom and persistence lifecycle are sufficient.
No interval, network call, queue schema, or server event.

**Reuse and likely implementation scope.** Mobile `ThreadComposer` plus a small
outbox presentation helper. Common across providers because the outbox sends the
normalized thread command; queued-creation payload differences remain unchanged.

**Acceptance and focused verification.** Tests cover enqueue success/rollback,
burst coalescing, hydration, retry, confirmed delivery, deletion, thread missing,
new-thread shell synchronization, reduced motion, and accessibility count text.
Later run offline/reconnect on iOS and Android against local and remote environments.

**Confidence / unresolved.** High source confidence; visual behavior and the
best live-region cadence remain runtime questions.

### W-05 / Checkpoint bookmarks / Later

**Journey and clients / entry points.** Inspect results and save/recover; web and
Electron message timeline/revert, mobile review checkpoint list and diff viewer.

**Current behavior and source evidence.** Checkpoints explicitly carry
`ready`, `missing`, or `error`, file changes, turn identity, and completion time
([`OrchestrationCheckpointSummary`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/contracts/src/orchestration.ts#L311)).
Web changed-file summaries open diffs and remember expansion
([`ChangedFilesCheckpoint`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/chat/MessagesTimeline.tsx#L1613));
revert is unavailable while work runs and confirms that newer messages will be
discarded
([`handleRevertToCheckpoint`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/ChatView.tsx#L4951)).
Mobile titles ready review items by turn/file count
([`createCheckpointReviewItem`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/review/reviewModel.ts#L131));
no mobile revert action was found in the reviewed source.

**User need and intended feeling.** A checkpoint should read as a saved place a
person can inspect or return to, not as a generic success badge.

**Mechanism / Apple reference.** Familiar object and consistent spatial identity.
The [Dashboard reverse-side lesson](./whimsy-references.md#physical-behavior-and-material)
supports an object whose presentation changes while its identity remains clear.

**Proposed trigger and behavior.** When checkpoint status becomes `ready`, add a
small static bookmark tab to its existing changed-files/turn card. Opening files
does not alter it. Web’s explicit Revert acts on that saved place; after a
successful revert, canonical history determines which later bookmarks disappear.
Mobile renders the same bookmark as “saved point available for review,” never as
an interactive restore affordance.

**Subtle / expressive / recommendation.** Subtle: bookmark notch in the existing
checkpoint icon. Expressive: a card folds/flips into a bookmark. Recommend a
static notch/tab and at most a one-shot opacity reveal on a live `ready` event;
no flip in the transcript.

**Frequency and replay/reconnect.** Potentially every turn, so existing records
are always static. If used, the reveal occurs only for a live status transition
for that checkpoint ID, never on history load, reconnect, expansion, remount, or
virtualization reuse.

**Failure, interruption, reverse, unknown.** `missing` and `error` get distinct
outlined/broken shapes plus current text, not a bookmark. Revert cancel changes
nothing; revert failure retains history and displays the error; success follows
server/canonical state. Turn completion without a ready checkpoint remains a
completed turn, not a saved bookmark.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Existing
diff/revert targets and destructive confirmation remain. Static for reduced
motion. The decorative notch is hidden from assistive tech; accessible text says
checkpoint availability and file count. Shape and label survive forced colors,
zoom, and RTL. No audio.

**Rendering / performance / dependencies.** Tiny CSS/SVG/native-vector change on
existing checkpoint rows; no extra list wrappers, timers, assets, or state. Use
checkpoint status and ID only.

**Reuse and likely implementation scope.** Shared status-to-presentation helper,
web timeline icon, mobile review item icon. Common for all providers because
checkpointing is orchestration state; mobile restore remains unsupported rather
than implied.

**Acceptance and focused verification.** Tests cover ready/missing/error,
completion-with-missing, loaded history, duplicate status, diff expansion,
revert cancel/failure/success, mobile view-only semantics, reduced motion, and
screen-reader labels. Later test very long histories and keyboard focus through
web revert.

**Confidence / unresolved.** High on web semantics and contract; mobile’s exact
checkpoint status visibility and cross-device revert refresh need runtime checks.

### W-06 / Shelf transit on web / Later

**Journey and clients / entry points.** Organize threads; web/desktop thread
menus and sidebar shelves for settle/un-settle, archive/restore, and snooze/wake.
Mobile is preserve-only because its existing swipe spring and haptic already
provide location/boundary feedback.

**Current behavior and source evidence.** Web settle waits for command success
before planned navigation, and a user navigation during the await wins
([`handleSettleThread`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/Sidebar.tsx#L2437)). The
shared action hook blocks invalid states and refreshes after archive before
navigating an active archived thread
([`archiveThread`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/hooks/useThreadActions.ts#L209)); snooze’s
menu result offers Undo
([`useThreadActionMenu`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/hooks/useThreadActionMenu.ts#L140)).
Rows keep creation order rather than jumping on activity, and status stays on
the card
([`buildSidebarThreadItems`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/Sidebar.logic.ts#L534)).

**User need and intended feeling.** A brief positional handoff can explain “this
thread moved to Settled/Archive” without another toast. It should feel like
putting a note on a nearby shelf.

**Mechanism / Apple reference.** Playful physics that explains destination. The
[Genie minimization lesson](./whimsy-references.md#physical-behavior-and-material)
is location continuity, not the literal distortion effect.

**Proposed trigger and behavior.** Before: row in its current shelf. Interaction:
the command starts with existing disabled/in-flight state. Only after success,
measure old and canonical destination positions and let a lightweight row proxy
translate/fade toward the new shelf for roughly 180 ms while the real destination
row is already available. Settled state is the canonical list. Reverse actions
use the same restrained handoff in the opposite direction. Active-thread route
navigation is never delayed.

**Subtle / expressive / recommendation.** Subtle: destination shelf flashes a
small insertion marker. Expressive: distorted flight across the full sidebar.
Recommend starting with the insertion marker; graduate to a short FLIP proxy only
if runtime testing proves it improves orientation and remains cheap.

**Frequency and replay/reconnect.** User-invoked and moderate. Animate only the
initiating client’s confirmed action. Server refresh, another device, reconnect,
history hydration, search/filter change, bulk changes, or expired snooze update
the canonical list without motion. Rapid actions cancel the older proxy and
never queue animations.

**Failure, interruption, reverse, unknown.** Command failure leaves the row and
uses existing error UI. Cancellation/unmount snaps to canonical state. Undo/wake/
unsettle/unarchive are explicit reverse commands, not reverse animation alone.
If destination is filtered, collapsed, or offscreen, use the static insertion/
status acknowledgment and do not invent coordinates.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Menus,
keyboard invocation, focus, and navigation remain immediate. Reduced motion uses
canonical placement plus a static insertion marker. Announce the existing action
result/shelf name; the proxy is `aria-hidden`. Focus never follows a visual clone.
Use shape/contrast, no sound.

**Rendering / performance / dependencies.** One transform/opacity proxy outside
the virtualized row flow, destroyed on settle. Do not animate height, reorder on
activity, force full-list layout, or add server state. Existing action receipt
and canonical shelf classification are dependencies.

**Reuse and likely implementation scope.** Web sidebar/action hook only;
Electron inherits it. Mobile retains current swipe action. Provider-independent
thread lifecycle behavior, including unknown drivers.

**Acceptance and focused verification.** Tests cover success-only start,
failure, user navigation racing the command, filtered/offscreen/collapsed
destinations, rapid repeat, undo/reverse, reconnect, reduced motion, focus, and
large lists. Runtime profiling is mandatory before implementation ships.

**Confidence / unresolved.** Medium. State semantics are strong; value and list
cost cannot be judged from source alone, which is why this is later.

### W-07 / Makers’ blueprint / Exploratory

**Journey and clients / entry points.** Discover/configure; web General/About,
Electron app About and Help menus, mobile App settings.

**Current behavior and source evidence.** Web About exposes version/update and
diagnostics
([`AboutVersionSection`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/settings/SettingsPanels.tsx#L214),
[About section](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/web/src/components/settings/SettingsPanels.tsx#L2382)).
Electron’s native About receives app name, version, and commit hash
([`DesktopAppIdentity.configure`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/desktop/src/app/DesktopAppIdentity.ts#L120));
its Help submenu only checks for updates
([`DesktopApplicationMenu`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/desktop/src/window/DesktopApplicationMenu.ts#L213)).
Mobile’s App section has storage, Legal, and a deliberately quiet version/update
row
([`AppSettingsSection`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/settings/SettingsRouteScreen.tsx#L587)).

**User need and intended feeling.** A deliberately opened About surface is a safe
place to show that this open-source tool was made by people and to let long-term
users discover an original detail.

**Mechanism / Apple reference.** Authorship and discovery. The
[signatures inside the original Macintosh](./whimsy-references.md#identity-authorship-and-history)
demonstrate optional evidence of makers; the lesson is authorship, not secret or
copied signatures.

**Proposed trigger and behavior.** Add an explicit “About T3 Code” entry where
missing. Opening it shows a static original blueprint-style assembly of T3’s
connection/thread/project marks, a short “made in the open” statement, version
and commit/build identity when available, and clearly labeled repository/credits/
license links. The settled surface is just that readable panel; network access
occurs only after a person activates an external link.

**Subtle / expressive / recommendation.** Subtle: one small maker’s stamp beside
existing version. Expressive: a hidden game or animated scene. Recommend the
explicit static panel with one authored illustration; no repeated-tap secret and
no hidden essential feature.

**Frequency and replay/reconnect.** Rare and user-initiated. It renders static on
every open, survives offline use with packaged content, and does not vary by
time, streak, telemetry, reconnect, or provider.

**Failure, interruption, reverse, unknown.** Close/back returns normally.
Unavailable commit metadata says “unknown” as Electron already does. External
link failure stays an ordinary platform error; no network call is made on open.

**Keyboard, touch, reduced motion, screen reader, contrast, audio.** Full normal
navigation, visible link labels, logical heading order, scalable text, decorative
art hidden from assistive tech, theme/forced-color variants, static reduced-motion
presentation, and no audio. Credits text must localize and wrap; names remain
proper nouns.

**Rendering / performance / dependencies.** One small bundled vector and text;
no dynamic scene, remote asset, timer, analytics trigger, or background work.
Reuse already available app version/commit metadata and existing external-link
handling.

**Reuse and likely implementation scope.** A shared content definition and
platform-native surface/renderers. Electron can keep its native About metadata
while adding a Help/About route to the richer renderer. Provider-independent.

**Acceptance and focused verification.** Verify offline rendering, version/commit
fallback, every external link requiring an explicit action, keyboard/back/focus,
screen-reader order, localization wrapping, high contrast, and no network request
on open. Runtime visual review is needed for all clients before shipping.

**Confidence / unresolved.** High on the current sparse surfaces; contributor
scope, wording ownership, and canonical links require maintainer decisions.

## Recommended first batch

Establish a **T3 workbench notation** family:

1. W-00 first removes perpetual motion from existing ultrathink while preserving
   its spectrum as a static identity.
2. W-01 introduces reusable project marks: small, static, theme-aware line forms.
3. W-02 reuses the line language as two endpoints that join only on real pairing
   success and then become an ordinary shape-coded connection state.
4. W-03 reuses the same stroke weight for a tiny live completion tick driven by
   normalized turn state.

The character is original T3 rather than retro imitation: blueprint-like line
geometry, current theme accents, and small marks that **assemble, connect, and
settle**. Static frames do most of the work. Motion is bounded to the affected
object, never delays an action, and always has an equally clear static state.
Projects feel personal, first connection feels acknowledged, and completed work
gets closure without making productivity performative.

Dependencies should stay small: one shared pure mark descriptor, one shared
phase/transition predicate where state is genuinely common, platform renderers,
and no new wire events. Do not create a general animation framework. W-01 can
ship independently; W-02 and W-03 should share only tokens (stroke, accent,
timing), not a coupled state machine.

Focused verification for an eventual implementation should be staged:

1. Pure/unit tests for deterministic marks, normalized state transitions,
   hydration/replay suppression, failures, unknown providers, and reduced motion.
2. Focused component tests for every entry point, accessibility names, forced
   colors, RTL/wrapping, and immediate navigation.
3. With explicit runtime authorization, one integrated web/Electron pass and one
   iOS/Android pass using populated data; include local and remote/reconnect,
   dense lists, long history, background/foreground, and multiple clients.
4. Profile the ultrathink frame and completion status in Chromium/Electron and
   list scrolling on representative mobile hardware. Any sustained repaint,
   remount replay, or dropped-frame regression rejects the effect.

## Rejected or deferred directions

- **Replace the draft hero transition:** rejected. It already has real-route
  continuity, cancellation handling, transform-only desktop movement, and
  reduced-motion bypass. Runtime verification may find bugs, but source does not
  support replacement.
- **Passbook-style shredding for archive/delete:** rejected. Archive, settle,
  snooze, and delete have different reversibility and risk; a theatrical ending
  would blur them. W-06’s location cue is the maximum appropriate treatment.
- **More mobile archive physics:** rejected for now. The existing swipe spring,
  overshoot, haptic boundary, and success-gated command already express the action.
- **Completion sound or per-turn haptic:** deferred indefinitely. Sound must be
  opt-in, no general completion-audio preference was found, and frequent cues
  would compete with notification/Live Activity behavior across devices.
- **Mascot reactions to permissions, outages, quota, or failures:** rejected.
  Those moments need facts, consequence, and recovery without blame or cheer.
- **Confetti, streaks, productivity awards, or “tests passed” celebration:**
  rejected. T3 can prove a turn ended; it cannot infer value or passing tests
  from provider prose. Meaningful milestones need a separately defined source of
  truth and explicit user intent.
- **Dynamic/seasonal scenery in the chat canvas:** rejected. The stage artwork
  already places a little world at the edge of work. Time-based animation or
  decorative chat backgrounds would add timers/repaint and reduce reading calm.
- **Animation in streamed text, code, diffs, terminal, approvals, or destructive
  confirmations:** rejected. These surfaces should remain stable and literal.
- **A hidden About game or repeated-tap essential action:** rejected. W-07 keeps
  discovery deliberate, accessible, offline, and visibly labeled.

## Honest coverage gaps

- No UI was launched. Visual polish, motion feel, layout at zoom, focus continuity,
  screen-reader announcements, platform Reduce Motion behavior, and haptics were
  not verified.
- Local, LAN, relay, tunnel, reconnect, and multi-device paths were traced through
  shared source but not exercised. Packaged Electron and background mobile behavior
  remain unverified.
- Provider decisions use the normalized orchestration contract and the five
  built-in identifiers (Codex, Claude, Cursor, Grok, OpenCode). This review did
  not exhaustively replay every adapter’s event stream; unknown/fork drivers must
  degrade through the open provider registry rather than crash
  ([provider-instance compatibility invariant](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/contracts/src/providerInstance.ts#L16),
  [built-in display names](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/packages/contracts/src/model.ts#L219)).
- Mobile uses several Reanimated `FadeIn`/`FadeOut` transitions without an
  explicit local `ReduceMotion.System` declaration in the reviewed components,
  while the workspace-pane helper does specify it
  ([`WORKSPACE_PANE_TRANSITION`](https://github.com/saphid/t3code/blob/d7462d29c3681b1dfd550096d7b31defb8e88e87/apps/mobile/src/features/layout/workspace-pane-animation.ts#L1)).
  Platform/library behavior is therefore a runtime question, not an assumption
  that every existing mobile transition is noncompliant.
- The reviewed mobile source exposes checkpoint inspection but no checkpoint
  revert; that is recorded as a surface difference, not a request to add the
  feature.
- Separate SwiftUI repositories were intentionally not inspected.

## Review conclusion

The best additions are not larger illustrations or more motion. They are a
small, reusable family of honest marks attached to project identity, first
connection, and live completion. They extend details T3 already does well—the
blueprint stage, bookmark stash, theme orbs, calm status model, and tactile
mobile shelves—while leaving typing, permissions, failures, long-running work,
transcripts, code, diffs, and terminals clear and quiet.
