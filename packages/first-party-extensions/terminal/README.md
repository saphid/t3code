# @t3tools/extension-terminal — interactive terminal panel

Interactive terminal plugin driven entirely by public contracts:

- `t3.terminal/sessions@^1.1.0` — `inspect` plus the `list` metadata stream
  (snapshot → upsert/remove) that drives the session tabs
- `t3.terminal/control@^1.0.0` — open (client-chosen id via
  `nextTerminalId`), attach (`restartIfNotRunning`), write, resize, clear,
  restart, close; all gated behind the distinct `t3.terminal/operate` grant
- `t3.terminal/output-events` `subscribe` — snapshot → chunked output →
  reset/exit/closed lifecycle frames, reassembled in `viewModel.ts` under the
  native 512 KiB retained-buffer cap

Package-side behavior: tabs reconcile with the strict-subset lag rule, input
queues while a session is starting, fit→resize is latest-wins per session,
destructive actions confirm inline, and a failed close falls back to an
`exit\n` write. Output streams resubscribe on `identity-changed` so restarts
show the new epoch. There is intentionally no VT (ghostty) rendering —
output stays a bounded text view.

- `pnpm run build` / `check` — pack and validate `.t3-extension/`
- `pnpm test` — view-model unit tests (no real PTY)
- `pnpm run audit` — Gate-4 private-import audit
