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
- `t3.ui/theme@^1.0.0` (`t3.ui/theme.read` grant) — `getTokens` resolves the
  host's effective theme (stored preference, session overlay, or painted
  preview, folded by the provider) and `subscribeState` re-reads it on every
  transition; `subscribeTerminalAppearance` carries the real terminal colors
  and font. Both republish as `--t3-terminal-*` custom properties ahead of
  the legacy `var()` fallbacks, so a host without the contract renders the
  pre-adoption chain unchanged
- `t3.ui/keybindings@^1.0.0` — per-view `toggle`/`new`/`close` commands
  (default keys mirror the native `mod+j`/`mod+n`/`mod+w` chords; the host's
  user/native precedence decides who claims them), plus a staged
  installation-scoped `toggle` with a bottom-dock `activation` fallback for
  cold open (`t3.ui/keybindings.global` + `t3.ui/panels` grants). All actions
  are bound per view through `ViewSession.bindCommands` and stay panel-local
- `t3.ui/panels@^1.0.0` — the dispatched `toggle` closes the hosting surface
  via `closeSurface`; failures surface on the panel status row

`t3.ui/notifications` is deliberately not adopted: the native terminal only
toasts on link-preview failure, and this panel has no link-activation path —
its inline status rows match native usage. Split chords
(`terminal.split`/`splitVertical`) and the Ghostty-level editing intercepts
(clear, word-nav, delete) stay deferred with VT rendering.

Package-side behavior: tabs reconcile with the strict-subset lag rule, input
queues while a session is starting, fit→resize is latest-wins per session,
destructive actions confirm inline, and a failed close falls back to an
`exit\n` write. Output streams resubscribe on `identity-changed` so restarts
show the new epoch. There is intentionally no VT (ghostty) rendering —
output stays a bounded text view.

- `pnpm run build` / `check` — pack and validate `.t3-extension/`
- `pnpm test` — view-model unit tests (no real PTY)
- `pnpm run audit` — Gate-4 private-import audit
