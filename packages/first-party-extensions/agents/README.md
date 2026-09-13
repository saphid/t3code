# @t3tools/extension-agents — Agents panel skeleton

The sixth first-party package: the `t3.agents` side-panel surface plus the one
Agents row that shipped contracts can serve today — running checked-in
`t3.json` project scripts through a real terminal.

- `t3.agents/view` — `side-panel`, `thread` scope, `web`/`desktop` clients,
  null-only restore state. Same surface registration as the native manifest.
- `t3.workspace/files@^1.0.0` `readText` — reads the checked-in `t3.json` under
  the `t3.workspace/read-text` grant and lists its `scripts[]` entries.
  Settings-owned project scripts (machine defaults, per-project overrides) have
  no public read contract; the panel says so instead of pretending.
- `t3.terminal/control@^1.0.0` `attach`/`open`/`write` — under the
  `t3.terminal/operate` grant, Run attaches the script's dedicated
  `t3-agents-<name>` terminal (spawning on first use, respawning when stopped),
  overflows to a numbered client-chosen id when it is busy, then writes
  `command + "\r"` with the native script env (`T3CODE_PROJECT_ROOT`,
  `T3CODE_WORKTREE_PATH`). Output appears in the terminal surface.

Everything else the native fleet view shows — roster, status, metrics,
workflows, actions, checkpoints — rides the unshipped `t3.orchestration/*`
contract family (P12-gated). The panel renders each of those as a named
deferred section, not a loading state.

- `pnpm run build` / `check` — pack and validate `.t3-extension/`
- `pnpm test` — view-model unit tests (script parsing, terminal-id allocation,
  run state machine)
- `pnpm run audit` — Gate-4 private-import audit
