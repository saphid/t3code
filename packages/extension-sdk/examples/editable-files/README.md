# Editable files

Read and write plain text files in the project workspace through the frozen `t3.workspace/text-edits@1.0.0` contract: `readSnapshot` returns the complete bytes plus a SHA-256 revision, `save` replaces the file only if the revision still matches, and any validation, authority, or IO failure rejects instead of returning a result. Grant names: `t3.workspace/read-text` for reads, `t3.workspace/write-text` for saves (plus the session's `orchestration:read` / `orchestration:operate` scopes). Registering or installing this package grants nothing by itself.

Behavior under failure, on purpose:

- **Conflict**: the file changed since the snapshot. The draft stays in the textarea; the on-disk bytes are untouched by this save. Refresh to compare, then re-save if you still want your version.
- **Rejection after dispatch** (network drop, session revocation, transport error): the outcome is genuinely unknown — the bytes may or may not have landed. The example never reports "saved" in that case, keeps the draft, and asks for a manual refresh.
- **Not editable**: missing files, directories, symlinks, binary content, invalid UTF-8, and files above 24,000 UTF-8 bytes come back as explicit `not-editable` reasons. Reads are never truncated.

Saving is explicit only. There is no autosave, no journals, no force overwrite, and no encoding override. The host serializes writers per real path and preserves the previous file mode; a concurrent write by an unrelated process between the revision check and the replace can still win (documented compare/rename race — no universal compare-and-swap is implied).

Source contract: `textEditsApi` in the SDK catalogue. Binding: `bindApi`. Build and check with the SDK CLI (`npm run build`, `npm run check`), then install the generated `.t3-extension` directory and grant `t3.workspace/write-text` to the installation to enable the Save button's transport.
