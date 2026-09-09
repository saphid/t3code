# Revision-checked workspace editing proposal

Status: design only. The installed Files replacement is still read-only. No write API is
advertised by this document. Preserve t3.workspace/files@1.0.0 unchanged; its canonical
contract is already consumed by independent plugins.

## Native behavior and the missing guarantees

WorkspaceFileSystem.writeFile resolves a lexical relative path, creates directories and
writes the target directly. It does not compare a revision, atomically replace the file or
persist an operation receipt. Its read path has stronger realpath checks than its write path.
The client save coordinator serializes one view's debounced saves, not other devices or
external editors. Wrapping that method would expose the same lost-update and path-race gaps
through a new public API.

Two different guarantees must remain explicit: atomic replacement prevents partial-file
visibility, while a revision check detects an already-changed file. Ordinary rename is not
a kernel compare-and-swap against arbitrary external writers. An implementation must not
claim that advisory host locking prevents an unrelated process changing the same file.

## Proposed public API and authority

Introduce a separate t3.workspace/text-edits@1.0.0 contract only after the native write
boundary and receipt model are proven. Its provider requires an authenticated root.
readSnapshot requires t3.workspace/read-text and the login's orchestration:read scope.
save requires t3.workspace/write-text, a write-capable invocation and the login's
orchestration:operate scope, matching native file-write authorization. HTTP keeps its
separate access:write transport requirement. Rootless legacy tool calls cannot write.

Inputs use only a bounded relative path, expected SHA-256 revision of the complete bytes,
new UTF-8 text, and an operation ID. Environment/project/thread/workspace revision comes from
validated context. Do not accept cwd, absolute paths, arbitrary encoding, mode, ownership,
force-overwrite, or callback fields from the package. Revalidate current authority at the
actual commit boundary using the host-only assertAuthority callback, and recheck workspace
scope there. The callback is a point-in-time guard, not transactional revocation.

readSnapshot must return complete editable UTF-8 bytes plus their lowercase SHA-256 revision.
A truncated read is never editable. Reject oversized JSON/UTF-8, binary data, directories,
special files and unsupported launch mappings clearly. The exact byte allowance should follow
a measured whole-JSON envelope, not only JavaScript character length.

save must distinguish confirmed current contents, conflict, and unknown outcome. A conflict
must retain the caller's draft and newer disk contents. Transport rejection or cancellation
after dispatch cannot mean that no write occurred: the client re-reads before any retry.
Do not automatically retry a blind overwrite or call a response a durable receipt until that
receipt is persisted and recoverable.

## Native boundary and durable receipts before an editor

Use a host-owned serialized revision-check path, shared for callers of the new API, rather
than the existing truncate/write method. Verify regular-file and ancestor identities; reject
symlinks, traversal and unsafe replacement mappings. Use exclusive temporary-file creation in
the validated target directory, preserve the supported file mode, and atomically replace only
after the final revision, scope and authority checks. Close handles and remove only captured
temporary files on every failure. Specify crash leftovers and recovery before shipping.

This still has a compare/rename window against noncooperating processes unless a stronger
platform primitive is used. Document the real guarantee and test observed external changes;
do not promise an impossible universal CAS. Mobile uses the host filesystem service rather
than implementing its own filesystem writes.

Persist an operation record before any potentially ambiguous mutation and settle it after
the actual file operation. Key it by scoped resource and caller ownership, with an input
fingerprint to reject reuse of an ID for different contents. Recovery must distinguish
pending, confirmed, conflict and unknown after host restart; plugin update/uninstall must not
reinterpret another provider's receipt. Define bounded retention and read authorization.
Re-reading matching contents can confirm current state, but cannot prove who wrote it.

## Proof order and independent renderer

First freeze and prove the authority, filesystem and receipt boundaries. Use real temporary
files and barriers to cover two host writers with one expected revision, an external edit,
ancestor replacement, scope/grant/session revocation before commit, cancellation at each
stage, worker failure, and host restart after prepared and committed journal states.
Verify exact bytes and absence of outside-workspace writes; failures must preserve evidence.

Then give the public contracts and a packaged SDK to a fresh Luna builder, watched by a
separate Luna monitor, to add an independent editable Files presentation. Keep drafts visible
through conflicts and unknown outcomes, persist restore state compatibly, and verify actual
save/reload/recovery through the ordinary Files entry. Compare to the retained native baseline.
Explicit save versus native autosave is a visible behavior difference requiring documentation;
it is not full parity merely because a textarea and button work.

Full tree/media/Markdown/comments/attachments/editor actions, large-file editing, provider
launch mappings, remote/relay/tunnel modes and both mobile clients remain separate acceptance
items. A conflict-free small fixture alone cannot establish durable editing or full Files parity.
