# @t3tools/extension-browser

Skeleton of the first-party Browser panel (`t3.browser`) as an installable
SDK extension — P08-A.

This is a thin, honest slice, not a browser. No `t3.browser/*` contract
exists in the SDK catalogue yet; the native engine attachment is the
extraction blocker. The package therefore:

- owns the chrome row + navigation state machine + requested-targets
  history (`viewModel.ts`, pure and tested),
- normalizes addresses with the same `normalizePreviewUrl` the native panel
  uses (`@t3tools/shared/preview`),
- provides `t3.file/presentation.open` for browser-previewable files
  (`.html`/`.htm`/`.pdf`) so the ordinary open path can route to
  `t3.browser/view`,
- renders an explicit engine-unavailable notice where the page would be.

Package-owned helpers ported from the native panel (`historyStore.ts`,
`runtimeTabId.ts`, `previewAnnotation.ts`, `elementContext.ts`) — see the
binding-disposition doc for the row-by-row citations. One honesty note:
the persisted URL history is **per view record** (per thread), not
per-project like the native `byProjectKey` store. `session.save` cannot
aggregate across threads, so project-shared history is a named deferral
(P08-HISTORY-PERSISTENCE) — the stored list is provisional behavior for a
single surface, useful groundwork, not parity for that row.

Per-row dispositions and native citations:
`docs/internals/extensions/browser-binding-disposition.md`.

```sh
pnpm --filter @t3tools/extension-browser test
pnpm --filter @t3tools/extension-browser build
pnpm --filter @t3tools/extension-browser check
pnpm --filter @t3tools/extension-browser audit
```
