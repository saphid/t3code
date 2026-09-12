# @t3tools/extension-version-control

The first-party Version Control panel (`t3.version-control`) as an
installable SDK extension — P10-A reads + P10-B mutations, on the
`t3.vcs/*` contracts (P09).

Reads consume the `t3.vcs/read` grant:

- repository capability gate via `t3.vcs/repository.getCapabilities`
  (detected driver, per-operation support — no fabricated clean state),
- branch/upstream/ahead-behind status via `t3.vcs/status`
  (`get`/`refresh`/`subscribe`; the stream drives freshness, no polling),
- staging lanes via `t3.vcs/changes.list` — the per-path
  staged/unstaged/untracked/conflicted state the private status payload
  drops,
- refs via `t3.vcs/refs.list` (current/default/worktree/remote rows).

Mutations need the `t3.vcs/mutate` grant at install time:

- per-row and per-lane Stage/Unstage (`t3.vcs/changes` `stage`/`unstage`),
- commit with a required message (`t3.vcs/changes` `commit`; staged set
  when a staged lane exists, all changes otherwise — conflicted lanes
  block the button outright),
- branch create-and-switch (`t3.vcs/refs` `create` with `switchRef`) and
  per-ref Switch (`t3.vcs/refs` `switch`; refs checked out in a worktree
  are disabled by name).

Every control renders only when `operations["<method>"]` is supported by
the detected driver; mutation rejections (grant denials,
`VcsUnsupportedOperationError`, git failures) surface by name in the
panel status line. Stage/unstage are index-only changes the status stream
does not fingerprint — the panel re-reads `changes.list`/`refs.list`
after each settled mutation instead of editing lanes locally.

Still deferred: pull/init/worktrees (mutate grant, no panel affordance
yet), pull-request UI (no `pullRequests.*` contract — C slice), diff
rendering (P11), AI commit text (no contract), discard/revert and
checkpoint diffs (P12 orchestration boundary).

Per-row dispositions and native citations:
`docs/internals/extensions/vcs-diff-binding-disposition.md`.

```sh
pnpm --filter @t3tools/extension-version-control test
pnpm --filter @t3tools/extension-version-control build
pnpm --filter @t3tools/extension-version-control check
pnpm --filter @t3tools/extension-version-control audit
```
