# @t3tools/extension-terminal — P07-A skeleton

Read-only terminal observer plugin. Attaches to terminal sessions that already
exist in the scoped thread (by terminal id) and renders their live output as
text through the public contracts only:

- `t3.terminal/sessions` `inspect` — per-session status/label rows
- `t3.terminal/output-events` `subscribe` — snapshot → chunked output →
  reset/exit/closed lifecycle frames, reassembled in `viewModel.ts` under the
  native 512 KiB retained-buffer cap

There is intentionally no input, spawn, resize, or VT (ghostty) rendering in
this slice. Session enumeration is not publicly available yet — ids come from
restored/persisted view state or manual entry. See
`docs/internals/extensions/terminal-binding-disposition.md` for the full
binding inventory and the deferred write path (`t3.terminal/control`).

- `pnpm run build` / `check` — pack and validate `.t3-extension/`
- `pnpm test` — view-model unit tests (no real PTY)
- `pnpm run audit` — Gate-4 private-import audit
