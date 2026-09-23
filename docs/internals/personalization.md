# Personalization

How users reshape the composer's control strip, sidebar thread rows, and the
floating thread details panel, and the rules every one of those editors shares.

## Principle

Users choose content, emphasis, and density; the app owns geometry. A
preference says which blocks exist and in what order — never pixel positions
or sizes. Each surface turns its preference into layout at render time, so a
preference saved on one client or window width still means something on
another.

## Absent means recommended

The three client-only keys are `threadDetailsSections`, `composerControls`,
and `sidebarThreadRowDensity` (plus `sidebarThreadRowFields`, whose `null`
means the app's default field set). Every one is a sparse override: a missing
key, missing entry, or unknown id keeps the app's recommendation. New built-in
blocks and fields therefore appear for everyone without a migration, and a
stale preference never blocks decoding. Editors write back only what the user
actually changed, so a surface that still looks recommended stores nothing.

## Merge policy

`personalization/orderedItems.ts` owns ordering. The user's order lists only
ids they explicitly placed; rendering merges it with the surface's designed
default order. Kept ids come first in user order; a new built-in is inserted
after the nearest preceding default neighbour the user kept (falling back to
the end), so shipped additions land where the design put them instead of
jumping to the top. Ids the user saved that the app no longer knows stay in
the stored preference but are never rendered.

## Drafts and dismissal

Every customize editor follows the thread details panel's session shape: the
draft lives in local component state while the editor is open, `Done` commits
one settings patch, and `Cancel`, Escape, and outside click all discard it.
`Reset to recommended` only edits the draft; the user still confirms with
`Done`. The shared frame is `personalization/CustomizeEditorShell.tsx`; do not
restate the footer or dismissal behaviour per editor.

## Reaching a surface

Keybinding commands (`composer.customize`, `sidebar.customizeThreadRows`,
`threadPanel.customize`) and the command palette do not own editor state.
They call `requestOpen` on the `useCustomizeSession` store; each surface
registers its availability on mount via `useRegisterCustomizeSurface` and
consumes a pending request addressed to it. A request for a surface that is
not mounted simply waits — nothing navigates or opens panels on its behalf.

## Plugin seam

Contributions will later join the same default lists with ids of the form
`plugin:<package>:<contribution>`. No host exists on this base yet, but the
merge policy and sparse-override rules above are already written so plugin
ids need no schema change: unknown ids decode, persist, and stay hidden until
the providing plugin is present again.
