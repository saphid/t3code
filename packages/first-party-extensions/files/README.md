# @t3tools/extension-files

First-party Files panel as an installable extension package. This is the P05-A
skeleton slice: it renders the workspace tree and read-only text through public
contracts only — `t3.workspace/tree` (snapshot stream) and `t3.workspace/files`
(`listEntries`/`readText`) — and provides `t3.file/presentation` so the
ordinary Files open path can select it.

Build and check with the SDK CLI (`npm run build`, `npm run check`), then
install the generated `.t3-extension/` directory through the normal installer.
The audit (`npm run audit`, shared script at `../scripts/audit-imports.mjs`)
proves the shipped bundle has no app-private imports.

Out of scope for this slice (later P05 slices / deferred F1 rows): editing and
save, search, media/resource refs, preview renderers, theme/preferences,
composer integration, and full native-size editing (deferred blocker #19).
