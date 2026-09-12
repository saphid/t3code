# @t3tools/extension-version-control

Skeleton of the first-party Version Control panel (`t3.version-control`)
as an installable SDK extension — P10-A, on the `t3.vcs/*` contracts (P09).

This is a read-oriented slice of the panel, not parity. It consumes only
the public read grant (`t3.vcs/read`):

- repository capability gate via `t3.vcs/repository.getCapabilities`
  (detected driver, per-operation support — no fabricated clean state),
- branch/upstream/ahead-behind status via `t3.vcs/status`
  (`get`/`refresh`/`subscribe`; the stream drives freshness, no polling),
- staging lanes via `t3.vcs/changes.list` — the per-path
  staged/unstaged/untracked/conflicted state the private status payload
  drops, rendered as honest read-only lanes,
- refs via `t3.vcs/refs.list` (current/default/worktree/remote rows).

Mutations (stage/commit/branch/pull/init/worktrees) need `t3.vcs/mutate`
and are the B slice. Pull-request UI has no public contract yet (C slice).
Diff rendering is P11.

Per-row dispositions and native citations:
`docs/internals/extensions/vcs-diff-binding-disposition.md`.

```sh
pnpm --filter @t3tools/extension-version-control test
pnpm --filter @t3tools/extension-version-control build
pnpm --filter @t3tools/extension-version-control check
pnpm --filter @t3tools/extension-version-control audit
```
