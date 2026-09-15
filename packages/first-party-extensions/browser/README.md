# @t3tools/extension-browser

First-party Browser panel (`t3.browser`) as an installable SDK extension —
P08-A skeleton, P08-D presentation lease.

The panel renders through public contracts only:

- `t3.browser/sessions` (brokered, `requires`) opens/navigates/drives the
  session; the `events` stream is the only source of engine and navigation
  truth — receipts are dispatch records, never load confirmations.
- `t3.browser/surface` (host capability on `ClientHost.browserSurface`,
  reached through `useBrowserSurfaceSlot`) composites the native webview
  into the plugin-owned slot element. Both `t3.browser/sessions` and
  `t3.browser/surface` installation grants are required; denials and
  unsupported clients (`desktop-required`) render as named states, never
  silence.
- `t3.file/presentation.open` routes browser-previewable files
  (`.html`/`.htm`/`.pdf`) to `t3.browser/view`.

Chrome row + navigation state stay panel-local (`viewModel.ts`, pure and
tested); the persisted URL history lives in `historyStore.ts`; addresses
normalize with the same `normalizePreviewUrl` the native panel uses
(`@t3tools/shared/preview`).

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
