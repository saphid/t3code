## What Changed

Right-clicking a file in the chat changed-files tree, the diff panel, or the workspace file browser now offers file actions instead of nothing:

- **Open** — opens the file with its default app.
- **Reveal in Finder / File Explorer / Files** — reveals and selects the file in the environment's file manager, using the same `shell.openInEditor` reveal support and `shellRevealInFileManager` config gate the chat file chips already use (wording comes from the server's `shellRevealInFileManagerKind`).
- **Open with** — a submenu of the environment's detected editors from `serverConfig.availableEditors`.

Web-only change: no wire contracts, server, desktop shell, provider, or mobile code is touched. Mobile already has no OS-level file actions by design.

## Why

The chat file chips got right-click open/reveal actions in #7140, but the surfaces where users actually review agent output — the changed-files card under a turn, the diff panel's file headers, and the file browser — still had no way to jump into Finder or an editor. Right-clicking a changed file there did nothing. This PR reuses the #7140 capability on those surfaces rather than adding a new one, so the menu only offers what the environment has already advertised it can do (reveal is hidden entirely when the server's `shellRevealInFileManager` flag is absent, and paths that cannot be resolved into the workspace offer no items at all). No upstream issue or discussion exists for this; this body carries the motivation.

## Verification

- `pnpm typecheck` in apps/web: passed (0 errors).
- `vp lint` on the touched files: passed.
- `npx vitest run` for `fileContextMenu.test.ts`, `diffFileActions.test.ts`, `changedFilesPresentation.test.ts`, `MessagesTimeline.logic.test.ts`, `ChatHeader.test.ts`: 112 passed, 0 failed. 7 tests are new, covering absolute-path resolution (workspace-relative, nested repository root, outside-workspace rejection) and menu-item construction (item set, reveal label, submenu ids, empty when the path cannot be resolved).
- Exercised in a running desktop dev client against an isolated home seeded with real data: right-clicked the `app.mjs` row in a thread's changed-files tree, the native menu opened with Open / Reveal in Finder / Open with, and clicking **Reveal in Finder** opened a Finder window targeting the thread's workspace folder (`.../.wt/ig-wp8`), confirming the full renderer → WS `openInEditor` → server launcher → `open -R` chain. The animated capture below shows the same flow, including the "Open with" submenu.

## UI Changes

Before — right-clicking a changed file row offers nothing:

![Before: changed-files card with a file row, no context menu](https://raw.githubusercontent.com/saphid/t3code/477ee6335470858d653a9eaa74cd3dd22e12b8a8/pr-media/file-context-menu/file-menu-before.png)

After — right-click offers Open, Reveal in Finder, and an Open with submenu; clicking Reveal in Finder opens the workspace folder:

![After: native context menu with Open, Reveal in Finder, and Open with items](https://raw.githubusercontent.com/saphid/t3code/477ee6335470858d653a9eaa74cd3dd22e12b8a8/pr-media/file-context-menu/file-menu-after.png)

Interaction — right-click, "Open with" submenu, then reveal in Finder (GIF):

![Right-click a changed file, open the Open with submenu, then Reveal in Finder opens the workspace folder](https://raw.githubusercontent.com/saphid/t3code/9adac629954eb3add5cc23d8024e909ccb46517a/pr-media/file-context-menu/file-menu.gif)

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why
- [x] I included before/after screenshots for any UI changes
- [x] I included a video for animation/interaction changes

Implementation used enablers/large in T3 Code (OpenCode harness).
