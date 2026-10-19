Area: Server

Steps to reproduce:

```sh
git checkout dcaf4798460   # fix(server): fail V2 runs when provider sessions cannot open (#12790)
pnpm install --frozen-lockfile
cd apps/server
pnpm exec vp test run src/orchestration-v2/SelectionRestart.integration.test.ts
```

The suite fails the same way on the current `t3code/codex-turn-mapping` head (`2341c5a6800`). Bisected: the parent commit `c5b851fbb6f` passes 9/9; `dcaf4798460` fails 1/9. Verified on macOS arm64 (three clean checkouts) and twice in CI on Ubuntu.

Expected behavior:

`restarts selection as a new attempt and retries after old-session cleanup` pins the selection-restart lifecycle: the first attempt is superseded, the replacement attempt completes, no hard-interrupt items are projected, and the replacement provider session is freshly allocated. The fixture simulates a transient `ProviderAdapterOpenSessionError` on the first replacement-session open and expects the start path to recover.

Actual behavior:

Since #12790, a failed `providerSessions.open` during turn start settles the run as failed (`provider-session-open-failure`, turn item "Provider session failed to open"). The fixture's simulated transient failure now terminates attempt 2, and the test dies with "selection restart did not complete" (attempt 2 status `failed`, attempt 1 `superseded`, first provider turn `interrupted`).

Impact:

Test-only so far as observed: the branch's CI does not run the test suite (only PR Vouch/PR Size), so the break is invisible on the upstream branch itself. It blocks downstream consumers that gate releases on the suite (our fork's nightly assembler has failed on this test since the commit landed).

Version or commit:

`pingdotgg/t3code` branch `t3code/codex-turn-mapping` @ `dcaf4798460` and later (`2341c5a6800` verified). Parent `c5b851fbb6f` is green.

Environment:

macOS 15 (arm64) and Ubuntu 24.04 CI; Node 24; the repo's pinned toolchain via `vp test run`.

Logs or stack traces:

```
ERROR (#11): selection restart did not complete {
  attempts: [["run-attempt:...:attempt:1", "superseded"], ["run-attempt:...:attempt:2", "failed"]],
  providerTurns: [["provider-turn:...:attempt:1", "interrupted"]],
}
Unknown Error: selection restart did not complete
```

Workaround:

Downstream, we adapted the fixture to the new semantics (dropped the simulated transient open failure and kept the restart-lifecycle assertions) as a compatibility patch, since #12790's terminal-failure behavior is a deliberate change. If upstream would rather preserve a retry for a failed replacement open during selection restarts, the fix belongs in the start path; otherwise the test fixture needs the same alignment upstream. Happy to send either as a PR.
