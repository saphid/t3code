<!--
Draft bug issue. Do not post without explicit go-ahead.
Title: [Bug]: Server: configured ACP authMethodId is ignored when the agent errors with -32603
Post with: gh issue create --repo pingdotgg/t3code --title "[Bug]: Server: configured ACP authMethodId is ignored when the agent errors with -32603" --body-file <this file> --label bug --label needs-triage
Planned branch: agent/server-acp-eager-authenticate (rename to fix/issueNNN-acp-eager-authenticate once this issue has a number)
-->

### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

### Area

apps/server

### Steps to reproduce

On branch `t3code/codex-turn-mapping` (PR #2829), against a scratch home:

1. Install Qwen Code v0.22.0 (`qwen --acp`) and set `OPENAI_API_KEY` in the environment, but do not complete Qwen's own interactive auth selection (fresh machine, no `.qwen/settings.json`).
2. Configure an `acpRegistry` provider instance with `agentId: "qwen-code"` and `authMethodId: "openai"`.
3. Start the server with a scratch home (`pnpm dev --home-dir "$PWD/.t3"`), create a thread on that instance, and dispatch a message.

### Expected behavior

Because `authMethodId` is explicitly configured, the server calls ACP `authenticate` with that method (eagerly after `initialize`, or at least in response to the session/new failure), then opens the session and runs the turn.

### Actual behavior

The turn never starts. `authenticate` is only attempted when the failed request carries the spec's auth-required error code: `isAcpAuthenticationRequired` matches only `AcpRequestError` with `code === -32000` (`apps/server/src/provider/acp/AcpSessionRuntime.ts:1053-1055`), and `authenticateAfterRequired` is invoked solely from that catch path (`AcpSessionRuntime.ts:1978-1983`). Qwen Code v0.22.0 rejects `session/new` with `-32603 "Internal error"` when unauthenticated, so the configured `authMethodId` (threaded in at `apps/server/src/orchestration-v2/Adapters/AcpRegistryAdapterV2.ts:92`) is never used and the session open just fails.

Confirmed empirically on 2026-08-23 on a sandbox running the PR branch.

### Impact

Major degradation or frequent failure

### Version or commit

`t3code/codex-turn-mapping @ 2d623ac6b` (PR #2829)

### Environment

macOS 15 (Darwin 25.5), server via `pnpm dev` against a scratch home, Qwen Code v0.22.0 in `--acp` mode

### Logs or stack traces

```shell
# session/new rejected while unauthenticated (summarized from provider event log):
# AcpRequestError method=session/new code=-32603 message="Internal error"
# No authenticate request is ever issued; the turn start retries and the thread hangs.
```

### Workaround

Pre-select the auth type in the project's `.qwen/settings.json` (`security.auth.selectedType`) so the agent starts already authenticated and never errors.

---

**Proposed fix (planned PR):** when `authMethodId` is explicitly configured on the instance, authenticate eagerly right after `initialize` instead of waiting for a `-32000` error. The `-32000` reactive path stays as is for agents that follow the spec. Non-goals: no heuristic retry on arbitrary error codes, no change to auth method selection for instances without a configured `authMethodId`.
