# @t3tools/extension-diff

First-party Diff panel (`t3.diff`) as an installable SDK extension —
P11-A skeleton + P11-B stream adoption and B-slice parity, plus the
P12 turn/checkpoint mode, on `t3.vcs/*` and `t3.orchestration/*`.

This is a read-oriented panel. It consumes `t3.vcs/read` plus the
`t3.file/open` grant (open-in-editor resolution):

- repository capability gate via `t3.vcs/repository.getCapabilities`
  (detected driver, per-operation support — no fabricated clean state),
- diff previews via `t3.vcs/diff`: unary `getPreview` for the common
  case, `streamPreview` once the broker's 64KiB invoke envelope rejects
  the result — the same envelope rejection is the sticky verdict that
  sends later refreshes of a large diff straight to the stream. Streamed
  payloads are reassembled manifest → ordered chunks → terminal frame
  and rendered only after the sha256 checks pass (per-source
  `diffHash`/byte lengths, then the whole-payload `payloadSha256`);
  unverified bytes never reach the parser,
- per-file hunks parsed with the vendored `@pierre/diffs`
  `parsePatchFiles` (the same pure parser the native panel feeds — its
  React `CodeView` imports react-dom and cannot be bundled into an
  extension), rendered as package-owned unified rows in collapsible
  per-file sections,
- full-file context expansion via `getFileContents` /
  `streamFileContents` (same unary-first policy; per-side sha256) for
  two-sided text changes; binary files are detected from the delivered
  patch's literal markers and named — never rendered as fake text,
- `truncated` previews render honestly at last — the stream transport
  is what makes a `truncated:true` body deliverable at all,
- B-slice chrome: grouped file tree with directory collapse, collapse/
  expand-all, reveal-in-file (select → uncollapse → scroll), copy path,
  open-in-editor via `t3.file/presentation.open` (reports the resolved
  surface — mounting it awaits the unshipped `t3.ui/surfaces` contract),
  base-ref picker over `t3.vcs/refs.list`, ignore-whitespace and
  word-wrap toggles,
- freshness via `t3.vcs/status.subscribe`: one refresh per distinct
  local-status fingerprint (never per frame, never polled), bounded
  resubscribe on `closed`, honest "stream ended" fallback to manual
  Refresh,
- a Turns mode over `t3.orchestration/status` (`t3.orchestration/read`
  grant): `subscribeAgents` feeds the checkpoint picker (newest first,
  baseline turn excluded), `getTurnDiff`/`getThreadDiff` deliver
  turn-scoped or whole-thread diffs through the same sha256-verified
  stream collector as large workspace previews. Selection reconciles
  when a revert removes checkpoints, and a stale turn falls back to the
  newest survivor — nothing is fabricated when the projection has no
  checkpoints yet,
- checkpoint revert via `t3.orchestration/control`
  (`t3.orchestration/operate` grant): the button only appears when
  `getCapabilities` advertises `checkpoint.revert`, asks for
  confirmation, and reports pending/accepted/rejected/invoke-failure
  honestly. An accepted receipt means the decider recorded the request;
  it does not claim the filesystem restore finished,
- turn-mode expansion is disabled on purpose: checkpoint commits are
  root commits, so `getFileContents`'s merge-base path cannot expand
  turn sources — the panel says so instead of issuing requests that
  cannot resolve.

Deferred slices: split view + Pierre renderer features (react-dom is
bundler-banned), diff-line comments (`t3.messages/enrichment`),
repo-root→workspace path remapping for open (no public repo-root
contract).

Per-row dispositions and native citations:
`docs/internals/extensions/vcs-diff-binding-disposition.md`.

```sh
pnpm --filter @t3tools/extension-diff test
pnpm --filter @t3tools/extension-diff build
pnpm --filter @t3tools/extension-diff check
pnpm --filter @t3tools/extension-diff audit
```
