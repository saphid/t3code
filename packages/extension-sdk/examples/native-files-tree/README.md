# Native Files tree

Build and check with the SDK CLI, then install the generated .t3-extension directory and select this package for t3.file/presentation.

The example uses the same Pierre 1.0.0-beta.4 tree engine as the native panel. Source contracts: workspaceTreeApi and workspaceFilesApi in the SDK catalogue; bindings: bindStreamApi and bindApi. A finite snapshot sends bounded chunks and a completion marker. Refresh replaces the model only after completion, preserving expansion and selection.

This is a tree and read-only text slice. It does not replace the full Files panel. Automatic workspace mutation refresh, composer menu/drag actions, native theme/icons, editing, media, attachments and annotations remain missing. Index truncation is surfaced explicitly, matching the native index limit. No durable operation receipt or live filesystem observation is implied.

The [dated proof receipt](proof.json) identifies the tested sources, installed package and exact limits. It is historical evidence, not a substitute for testing a changed package.
