# @t3tools/extension-files

First-party Files panel as an installable extension package. It renders the
workspace tree, name and file-contents search, text editing with revisioned
autosave, media previews through the workspace resource lease, and a
package-owned rendered-markdown preview — all through public contracts only
(`t3.workspace/tree`, `t3.workspace/files`, `t3.workspace/search`,
`t3.workspace/text-edits`, `t3.resources/lease`). It also provides
`t3.file/presentation` so the ordinary Files open path can select it, and
exposes an "Open in…" file action that resolves through whichever provider
the host selected for that API (grant `t3.file/open`).

Build and check with the SDK CLI (`npm run build`, `npm run check`), then
install the generated `.t3-extension/` directory through the normal installer.
The audit (`npm run audit`, shared script at `../scripts/audit-imports.mjs`)
proves the shipped bundle has no app-private imports.

Known limits (named in the UI): the rendered markdown view is a deliberately
small CommonMark/GFM subset — no raw-HTML passthrough, tables, or workspace
image resolution; task checkboxes are read-only. Contents search reports the
contract's match lines and truncation verbatim but does not scroll to the
match line. "Open in…" resolves the presentation descriptor the selected
provider returns; mounting that surface is the host's concern.
