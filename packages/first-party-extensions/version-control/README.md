# @t3tools/extension-version-control

The first-party Version Control panel (`t3.version-control`) as an
installable SDK extension — P10-A reads + P10-B mutations + P10-C
repository ops, on the `t3.vcs/*` contracts (P09, repository at 1.1.0).

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
  are disabled by name),
- sync controls (`t3.vcs/repository` `pull`/`push`/`fetch`): Pull gates on
  an upstream with a fast-forwardable behind count; Push mirrors native's
  disabled reasons (detached HEAD, dirty tree, behind/diverged, no remote)
  and lands the driver's `push -u` publish path for an unpushed branch on a
  configured remote; Fetch runs per remote or all at once,
- repository init on the no-repository state (`t3.vcs/repository` `init`;
  the capability gate is re-read so the panel transitions on real
  detection),
- worktrees (`t3.vcs/repository` `createWorktree`/`removeWorktree`): a
  per-ref Worktree action, a new-branch worktree form with the host
  assigning the path, and per-worktree Remove with a force retry that only
  appears after a real refusal; the worktree list is derived from
  `refs.list` `worktreePath`, matching native's branch-selector data.

Remotes render from `t3.vcs/repository` `listRemotes` (a read-granted
call) — name, URL, and primary marker, with per-remote Fetch.

Every control renders only when `operations["<method>"]` is supported by
the detected driver; mutation rejections (grant denials,
`VcsUnsupportedOperationError`, git failures) surface by name in the
panel status line. Stage/unstage are index-only changes the status stream
does not fingerprint — the panel re-reads `changes.list`/`refs.list`
after each settled mutation instead of editing lanes locally.

The manifest requires `t3.vcs/repository` at `^1.0.0` — the frozen floor —
so the panel still loads against a 1.0.0 host; the 1.1.0 additions
(push/fetch/listRemotes) gate on `operations` keys a 1.0.0 host never
reports and simply hide.

Still deferred: publish/clone flows (no remote-creation contract —
`sourceControl.*` provisioning is host-side), pull-request UI (no
`pullRequests.*` contract), stash (no native binding exists to mirror),
branch rename/delete (internal driver methods only), diff rendering (P11),
AI commit text (no contract), discard/revert and checkpoint diffs (P12
orchestration boundary).

Per-row dispositions and native citations:
`docs/internals/extensions/vcs-diff-binding-disposition.md`.

```sh
pnpm --filter @t3tools/extension-version-control test
pnpm --filter @t3tools/extension-version-control build
pnpm --filter @t3tools/extension-version-control check
pnpm --filter @t3tools/extension-version-control audit
```
