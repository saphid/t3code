# @t3tools/extension-files

First-party Files panel as an installable extension package. It renders the
workspace tree, name and file-contents search, text editing with revisioned
autosave, media previews through the workspace resource lease, and a
package-owned rendered-markdown preview — all through public contracts only
(`t3.workspace/tree`, `t3.workspace/files`, `t3.workspace/search`,
`t3.workspace/text-edits`, `t3.resources/lease`). It also provides
`t3.file/presentation` so the ordinary Files open path can select it, and
exposes an "Open in…" file action that resolves through whichever provider
the host selected for that API (grant `t3.file/open`). Breadcrumbs over the
tree snapshot, workspace link resolution in rendered markdown, centered line
reveals for search hits and `#L…`/`path:line` targets, and composer-mention
drags are package-owned (F1 #23); the drag payload uses the MIME the host
composer already claims, so no composer contract is needed.

Build and check with the SDK CLI (`npm run build`, `npm run check`), then
install the generated `.t3-extension/` directory through the normal installer.
The audit (`npm run audit`, shared script at `../scripts/audit-imports.mjs`)
proves the shipped bundle has no app-private imports.

Known limits (named in the UI): the rendered markdown view is a deliberately
small CommonMark/GFM subset — no raw-HTML passthrough, tables, or workspace
image resolution; task checkboxes are read-only. Contents search reports the
contract's match lines and truncation verbatim. The breadcrumb root is
labeled "Workspace" — no contract reports the project title to this view —
and crumbs are non-navigable when the selected path is host-absolute.
"Open in…" resolves the presentation descriptor the selected
provider returns; mounting that surface is the host's concern.
