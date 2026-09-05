# Electron whimsy opportunities: implementation handoff

These are **24 proposals, not implemented features**. They extend the existing project marks, hosted pairing clasp, completion tick, and settled ultrathink treatment. The machine-readable specifications are in [`apps/web/whimsy/opportunities.json`](../../apps/web/whimsy/opportunities.json).

The source-only feature review targets revision `5c659e068` in the `t3code-c737aa28` worktree and inspected the Electron-hosted web renderer plus relevant desktop connection sources. No proposed app interaction was run in a browser, server, simulator, or performance profile, so the experiential fit of these 24 ideas remains unverified. The separate [Electron and gallery verification record](./whimsy-electron-validation.md) covers the implemented treatments and atlas playback; it is not runtime proof for these proposals. Electron is the first implementation surface, and shared web behavior must remain valid in local and remote browser clients.

## Inventory

| Area                  | IDs and proposed treatments                                                          |
| --------------------- | ------------------------------------------------------------------------------------ |
| Composer              | EX-01 Send Capsule; EX-02 Stash Card Tuck; EX-03 Mode Tool Collar                    |
| Sidebar lifecycle     | EX-04 Archive Shelf Transit; EX-05 Snooze Envelope; EX-06 Pinned Tack Handoff        |
| Search and navigation | EX-07 Searchlight Aperture; EX-08 Palette Breadcrumb Bead; EX-09 Folder Hinge Peek   |
| Diffs and review      | EX-10 Diff Accordion Fold; EX-11 Review Margin Pin; EX-12 Split View Hinge           |
| Terminal              | EX-13 Terminal Tile Split; EX-14 Carbon Copy Clip; EX-15 Process Curtain Call        |
| Settings              | EX-16 Theme Sample Window; EX-17 Shortcut Keycap Jig                                 |
| Connection            | EX-18 Connection Target Tokens; EX-19 Connection Phase Socket                        |
| Attachments           | EX-20 Attachment Contact Sheet; EX-21 Preview Film Gate                              |
| Git                   | EX-22 Branch Railway Turnout; EX-23 Commit Press; EX-24 Push and Pull Counterweights |

## Shared implementation contract

Use actual command results or normalized state as the trigger. Keep status text, errors, recovery, selection, focus, and keyboard behavior authoritative. Every decorative transition must be local, bounded, cancellable, absent during hydration or replay, and static after settlement. `prefers-reduced-motion` must reach the same final state immediately. Do not add idle animation, backend events for decoration, or animation across terminal canvases, code lines, virtualized lists, or entire panels.

## Composer

**Exact scope:** EX-01 belongs to the accepted submit transition in `apps/web/src/components/chat/ComposerPrimaryActions.tsx`; EX-02 to a successful stash increment in `apps/web/src/components/chat/ComposerStashBadge.tsx`; EX-03 to explicit interaction/runtime mode selection in `apps/web/src/components/chat/ChatComposer.tsx`. Keep draft persistence, pending questions, plan follow-up, stop, send-disabled reasons, and provider capability fallback unchanged.

**Correctness tests:** Prove each effect fires only for its named local transition; exercise keyboard submit/stash/mode selection, double submit, pending image encoding, restore/delete, provider invalidation, reconnect, remount, narrow layout, and reduced motion. Assert no idle animation, lost composer focus, delayed send, duplicated submit, or new wire event.

## Sidebar lifecycle

**Exact scope:** EX-04 begins only after archive succeeds through `apps/web/src/hooks/useThreadActions.ts`; EX-05 begins after the `snoozeThread` command succeeds in that same hook, uses `apps/web/src/components/Sidebar.snooze.ts` only for wake-time formatting, and follows the shelf rendering in `apps/web/src/components/Sidebar.tsx`; EX-06 follows persisted pin state rendered by the sidebar. Animate only the affected visible row and its known destination section.

**Correctness tests:** Cover success, rejection, interruption, archive restore, manual/automatic wake, timezone changes, pin/unpin, sorting, active-thread navigation, remote updates, hydration, virtualization, and rapid commands. Reduced motion must reflow immediately. Assert no idle animation, replay on remount, stale row, focus loss, or client-owned lifecycle truth.

## Search and navigation

**Exact scope:** EX-07 decorates a resolved query in `apps/web/src/components/search/ProjectContentSearchDialog.tsx`; EX-08 marks real page/scope changes in `apps/web/src/components/CommandPaletteResults.tsx`; EX-09 attaches only to directory expansion in `apps/web/src/components/files/ProjectFilePicker.tsx`. Result selection and tree state remain the existing controls.

**Correctness tests:** Cover stale and superseded responses, empty/error states, keyboard traversal/back, deep and lazy trees, long paths, RTL, large result sets, close, and remount. Reduced motion must update instantly. Assert no idle animation, per-result timer, offscreen choreography, focus delay, or reordered result data.

## Diffs and review

**Exact scope:** EX-10 uses existing per-file and collapse-all state in `apps/web/src/components/DiffPanel.tsx`; EX-11 uses accepted inline comment state in `apps/web/src/components/diffs/DiffCommentAnnotation.tsx`; EX-12 uses the stacked/split toggle in `apps/web/src/components/DiffPanel.tsx`. Keep code, line selection, comments, filenames, statistics, warnings, and scroll state readable throughout.

**Correctness tests:** Cover one/all collapse, sticky headers, comments, submit/cancel/delete, stacked/split, raw and truncated patches, errors, long diffs, virtualization, scroll anchors, rapid toggles, keyboard, and reduced motion. Assert no idle animation, full-panel transform, line movement after settlement, premature comment success, or hidden warning.

## Terminal

**Exact scope:** EX-13 attaches to successful pane creation, EX-14 to the existing non-empty Add to chat selection action, and EX-15 to the accepted one-time synchronized exit transition in `apps/web/src/components/ThreadTerminalDrawer.tsx`. Never transform or repaint the Ghostty canvas for decoration.

**Correctness tests:** Cover horizontal/vertical splits, split limits, creation/WASM failure, resize and persisted groups, selection ranges, superseded menus, expired context, exit/close/crash, duplicate events, hidden drawers, focus, and scroll. Reduced motion must insert final UI directly. Assert no idle animation, cursor loop, buffer mutation, or replayed exit gesture.

## Settings

**Exact scope:** EX-16 is confined to the theme option preview in `apps/web/src/components/settings/ThemeSettings.tsx`; EX-17 is confined to recording, conflict, and reset states in `apps/web/src/components/settings/KeybindingsSettings.tsx`. Neither proposal changes theme tokens, shortcut parsing, when expressions, persistence, or global settings navigation.

**Correctness tests:** Cover preview/commit/cancel, custom and system themes, invalid tokens, high contrast, shortcut capture/cancel/conflict/reset, platform labels, when clauses, search, keyboard, screen readers, zoom, and reduced motion. Assert no idle animation, app-wide repeated transition, key logging outside recording, or decoration-only warning.

## Connection

**Exact scope:** EX-18 maps the existing `BearerConnectionTarget`, `RelayConnectionTarget`, and `SshConnectionTarget` tags rendered in saved environment rows in `apps/web/src/components/settings/ConnectionsSettings.tsx`; the separate primary environment section is outside this proposal. `relayManaged` adds T3 Connect metadata to Relay and is not another target. EX-19 maps the same renderer's `available`, `offline`, `connecting`, `reconnecting`, `connected`, and `error` phases. The hosted pairing clasp remains separate. Do not add a target, phase, transport inference, or desktop IPC dependency.

**Correctness tests:** Cover all three saved target tags, including `relayManaged` deriving true only for Relay, all six connection phases, error reason and trace ID, retry, removal, hydration, remote observation, duplicate transitions, narrow rows, and multiple windows. Reduced motion must swap static shapes. Assert no idle animation, extra primary or managed-tunnel target, false connected pose, missing recovery text, new IPC, or art-only event.

## Attachments

**Exact scope:** EX-20 begins after image validation/compression adds accepted files to composer draft state in `apps/web/src/components/chat/ChatComposer.tsx`; EX-21 follows explicit preview open/previous/next actions in `apps/web/src/components/chat/ExpandedImageDialog.tsx`. Preserve ordering, attachment limits, names, indices, removal, and send-race guards.

**Correctness tests:** Cover paste/select, mixed and partial batches, concurrent compression, over-limit/unreadable failures, restore/remove, preview open/close/wraparound, rapid navigation, decode failure, one image, keyboard, touch, zoom, and reduced motion. Assert no idle animation, autoplay, decorative prefetch, reordered images, or send race.

## Git

**Exact scope:** EX-22 follows successful checkout state in `apps/web/src/components/BranchToolbarBranchSelector.tsx`; EX-23 follows a successful commit for the selected files; EX-24 follows returned push/pull synchronization state in `apps/web/src/components/GitActionsControl.tsx`. Branch labels, changed files, provider terminology, ahead/behind counts, dialogs, toasts, and errors remain authoritative.

**Correctness tests:** Cover local/remote refs, worktrees, detached HEAD, checkout rollback, partial/all commit, hooks and identity errors, push/pull/up-to-date, ahead/behind/diverged, auth/conflict failures, retries, remote refresh, duplicate submits, keyboard, and reduced motion. Assert no idle animation, optimistic success decoration, hidden selection, or stale Git state.

## Suggested order

Start with EX-14, EX-08, EX-11, and EX-18: each has a narrow object, an explicit trigger, and a static resting state. Follow with EX-01, EX-04, EX-10, EX-13, and EX-22 after proving replay suppression and local rendering cost. Keep EX-15, EX-21, and EX-24 exploratory until their repeated-use tone is tested in Electron.

The intended family feels like a compact workbench: paper, clips, hinges, fitted tiles, route pieces, and rails. The objects explain where state went or how it changed, then get out of the way.
