## What Changed

The sidebar thread list now supports touch swipe gestures on desktop and web, matching the mobile app's thread list. Swiping a row left reveals its lifecycle action (Settle, Un-settle, or Wake, depending on which shelf the row is on) with Snooze beside it where snoozing can succeed; a full swipe commits the lifecycle action outright. Swiping right reveals Pin or Unpin. Tapping a revealed action runs it; tapping the row closes the actions; only one row's actions are open at a time.

The gesture layer responds to touch and pen pointers only. Mouse behavior — hover-revealed quick actions, clicks, double-click rename, right-click menu, and drag-to-reorder pinned rows — is untouched. Rows without any capability-gated action render exactly as before.

## Why

On touch-screen laptops the desktop app's thread actions were unreachable: the quick actions are hover-revealed (no hover on touch) and everything else lives in the right-click menu. The mobile app already settled on a swipe vocabulary for the same rows, so this ports that vocabulary rather than inventing a new one: same primary-action logic (Settle on cards, Un-settle on settled rows, Wake on the snoozed shelf), snooze as the secondary, and full-swipe-to-commit.

No new dependencies: the swipeable is a small pointer-events component (`Sidebar.swipe.tsx`) that translates the row content with direct DOM writes during the drag, so a swipe never re-renders the row. `touch-action: pan-y` lets the list keep scrolling vertically while horizontal drags come to the component; a vertically dominant drag cancels the gesture. Snooze reuses the same preset menu the context menus use (`contextMenu.show`), so desktop gets the native menu and the browser gets the DOM fallback.

## Verification

- `tsc --noEmit` in apps/web: passed.
- `vp test run src/components/Sidebar.swipe.test.ts`: 10 passed — action resolution per shelf and capability gates, plus the release thresholds (commit / open / spring-back).
- `vp test run` on the existing sidebar suites (`Sidebar.pointer`, `Sidebar.drag`, `Sidebar.snooze`, `Sidebar.logic`, `Sidebar.motion`, `threadActionMenu.logic`): 260 passed.
- Exercised in the running desktop app via CDP `Input.dispatchTouchEvent` against real thread data, asserting on the DOM:
  - partial swipe left snapped open at the actions width, revealing Settle + Snooze;
  - the next tap closed the actions and was swallowed instead of navigating;
  - a full swipe left committed Settle — confirmed server-side by a persisted `thread.settled` event in the environment's event store (and the settle correctly cleared the row's pin with it);
  - a full swipe right persisted `thread.pinned`;
  - a vertically dominant drag did not open actions.

## UI Changes

Before — resting thread list:

![before](https://raw.githubusercontent.com/saphid/t3code/2808c90ed4153db0b403eef2b350795393de8d87/pr-media/thread-swipe/thread-swipe-before.png)

After — swipe left reveals Settle + Snooze (full swipe commits Settle):

![swipe left open](https://raw.githubusercontent.com/saphid/t3code/2808c90ed4153db0b403eef2b350795393de8d87/pr-media/thread-swipe/thread-swipe-left-open.png)

After — swipe right reveals Pin / Unpin:

![swipe right open](https://raw.githubusercontent.com/saphid/t3code/2808c90ed4153db0b403eef2b350795393de8d87/pr-media/thread-swipe/thread-swipe-right-open.png)

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why
- [x] I included before/after screenshots for any UI changes
- [ ] I included a video for animation/interaction changes

(A video of the gesture was captured during verification but the machine's screen locked before a clean take could be recorded; happy to add one.)

Implementation used enablers/large in T3 Code (OpenCode harness).
