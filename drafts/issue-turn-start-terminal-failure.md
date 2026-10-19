<!--
Draft bug issue. Do not post without explicit go-ahead.
Title: [Bug]: Server: a run whose provider session never opens spins forever instead of failing
Post with: gh issue create --repo pingdotgg/t3code --title "[Bug]: Server: a run whose provider session never opens spins forever instead of failing" --body-file <this file> --label bug --label needs-triage
Planned branch: agent/server-turn-start-terminal-failure (rename to fix/issueNNN-turn-start-terminal-failure once this issue has a number)
-->

### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

### Area

apps/server

### Steps to reproduce

On branch `t3code/codex-turn-mapping` (PR #2829), against a scratch home:

1. Configure an `acpRegistry` instance for an agent with no credentials on the machine (gemini or kimi both reproduce it).
2. Create a thread on that instance and dispatch a message.
3. Watch the `orchestration.subscribeThread` stream and the client UI.

### Expected behavior

After retries are exhausted, the run reaches a terminal failed state: a `run.updated` event with a failed status goes out on the subscription and the client shows the failure instead of an active spinner.

### Actual behavior

The `provider-turn.start` effect fails, the effect worker retries it up to the default `maxAttempts = 5` (`apps/server/src/orchestration-v2/EffectWorker.ts:365`; observed `attemptCount: 5` in the failure log at `EffectWorker.ts:521-527`), and then dead-letters it: the non-retryable carve-out applies only to `provider-turn.interrupt` (`EffectWorker.ts:50-63`), so the start effect falls through to `outbox.fail` (`EffectWorker.ts:534-537`), which only flips the outbox row to `status = 'failed'` (`apps/server/src/orchestration-v2/EffectOutbox.ts:583-600`). Nothing consumes dead-lettered rows, and no path writes a failed `run.updated` for the stuck run. Observed for over 240 seconds: no `run.updated` with a failed status on the `orchestration.subscribeThread` stream, thread showing a working state indefinitely. That is a lying spinner, which the project explicitly forbids.

Confirmed empirically on 2026-08-23 on a sandbox running the PR branch.

### Impact

Major degradation or frequent failure

### Version or commit

`t3code/codex-turn-mapping @ 2d623ac6b` (PR #2829)

### Environment

macOS 15 (Darwin 25.5), server via `pnpm dev` against a scratch home, acpRegistry agents gemini and kimi with no credentials

### Logs or stack traces

```shell
# Effect worker failure log (summarized), repeated until attemptCount: 5:
# "Orchestration effect execution failed" effectType=provider-turn.start attemptCount=5 nonRetryable=false
# Outbox row then set to status='failed'; no run.updated {status: failed} observed
# on orchestration.subscribeThread in >240s.
```

### Workaround

None from the client beyond manually interrupting the run; the thread otherwise shows a working state indefinitely.

---

**Proposed fix (planned PR):** when the worker dead-letters a `provider-turn.start` effect (final `outbox.fail`), also settle the run: emit the terminal failed `run.updated` / attempt / node events for the affected run so subscribers see the failure. Non-goals: no changes to retry counts or backoff, no generic dead-letter reprocessor, no handling for other effect types that already settle their own state.
