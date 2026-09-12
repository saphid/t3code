# @t3tools/extension-diff

Skeleton of the first-party Diff panel (`t3.diff`) as an installable SDK
extension — P11-A, on the `t3.vcs/*` contracts (P09).

This is a read-oriented slice of the panel, not parity. It consumes only
the public read grant (`t3.vcs/read`):

- repository capability gate via `t3.vcs/repository.getCapabilities`
  (detected driver, per-operation support — no fabricated clean state),
- diff previews via `t3.vcs/diff.getPreview` — working-tree and
  branch-range sources with their delivered `diffHash` and `truncated`
  flags; truncation shows the native "preview limit" banner,
- per-file hunks parsed with the vendored `@pierre/diffs`
  `parsePatchFiles` (the same pure parser the native panel feeds — its
  React `CodeView` imports react-dom and cannot be bundled into an
  extension), rendered as package-owned unified rows,
- full-file context expansion via `t3.vcs/diff.getFileContents` for
  two-sided text changes; binary files are detected from the delivered
  patch's literal markers and named — never rendered as fake text.

Deferred slices: turn/checkpoint diffs (P12 orchestration boundary),
diff-line comments (`t3.messages/enrichment`), base-ref picker and
navigation chrome (B slice), mutations (none — this panel is read-only).

Known transport limit: the broker's 64KiB invoke envelope means a
`truncated: true` preview body (smallest slice ≥80KB) cannot cross the
single-shot invoke path — large diffs fail with the named payload-limit
error until the `t3.vcs/diff` stream surface lands (P09-B).

Per-row dispositions and native citations:
`docs/internals/extensions/vcs-diff-binding-disposition.md`.

```sh
pnpm --filter @t3tools/extension-diff test
pnpm --filter @t3tools/extension-diff build
pnpm --filter @t3tools/extension-diff check
pnpm --filter @t3tools/extension-diff audit
```
