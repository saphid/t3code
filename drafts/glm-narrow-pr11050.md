Finish upstream PR #11050 in the existing worktree `/Users/aus-m5p-as/projects/t3code-codex-413`, branch `agent/codex-413-payload`, using GLM-5.3 Flash through AI Enablers. The user already authorized the PR and follow-up pushes.

The pushed commit `58906da61e` contains two ideas. Keep only the proven one: Codex image attachments use `{ type: "localImage", path }` instead of base64 data URLs. Remove the automatic HTTP 413 compact-and-retry behavior because two reviewers correctly found that compaction is asynchronous, and a safe waiter would require deeper notification coordination. This PR should prevent new oversized image rollouts, not add recovery machinery for already-bloated provider histories.

The worktree also has an uncommitted, unsafe attempt to consume `serverNotifications` while the existing background stream consumes the same queue. Discard that partial waiter. Restore unrelated `pnpm-lock.yaml` changes and delete only the stray `.collab-script.json` and `.collab-script.json.requests` files under `apps/server/src/provider/testFixtures` if present.

Concretely:

- Keep the `localImage` changes and their adapter/runtime parameter tests.
- Revert all PR changes in `CodexCollabRuntime.integration.test.ts` and `codexCollabMockPeer.mjs` to `upstream/main` because they exist only for the removed retry.
- In `CodexSessionRuntime.ts`, keep the `localImage` attachment input type but restore the normal single `client.raw.request("turn/start", params)` behavior. Remove retry-only imports and comments.
- Confirm `CodexSessionRuntime.test.ts` retains only the localImage shape update.
- Update the PR body so it no longer claims automatic compaction or recovery of already-oversized histories.

Run the focused adapter and session-runtime tests plus server typecheck. Review the diff against upstream/main. Commit the cleanup as a follow-up commit, push to origin, and reply to Macroscope comment 3976338548 and CodeRabbit comment 3976386456 that the risky retry was removed, with test evidence. Do not use sleep polling. Use Bugler for CI waits if available; otherwise make one direct final status fetch and stop. Report the new commit and current PR status.
