---
name: babysit-pr
description: Shepherd an open GitHub pull request by watching its current head, CI, mergeability, and published review feedback; make and prove minimal branch fixes, push them, and resume watching. Use when asked to babysit, monitor, watch, or carry a PR through review without routine human checking.
---

# Babysit PR

Own the monitoring loop until the PR merges/closes, the user interrupts, or a genuine human-only blocker appears.

## Loop

1. Resolve the PR and its matching head-branch worktree. Read the repository instructions, confirm the worktree is clean, and fetch both the PR head and its live target branch.
2. Snapshot the head SHA, the live target-tip SHA, ahead/behind counts, checks, mergeability, and all published unresolved review feedback. Prove freshness with `git merge-base --is-ancestor <live-target-tip> <head>`; exit 0 means current. Resolve the target tip from the repository ref after the fetch. A PR object's cached base OID and GitHub's `CLEAN` or `MERGEABLE` values do not prove that the target tip is an ancestor of the head. Prefer the GitHub connector, then `gh`; use REST endpoints if GraphQL is unavailable.
3. Validate every failure or comment against the current head before acting:
   - When the live target is not an ancestor of the head, update the branch with the repository's required strategy, inspect the resulting range or tree diff, and rerun affected proof. If the only acceptable strategy rewrites published history or needs a force-push, obtain explicit authorization for that operation.
   - For a real branch defect, make the smallest isolated fix, add or adjust a focused regression test, run proportionate verification, obtain any review required by repository policy, commit, and push normally.
   - Treat the PR body's evidence as derived from the head: before pushing, re-read the body and refresh whatever the fix invalidates — recapture stale screenshots, GIFs, videos, and before/after pairs, and update prose or measured claims that no longer hold. Stale evidence counts as missing evidence, so recapture rather than drop it.
   - For unrelated infrastructure or stale/incorrect feedback, preserve evidence and report it; do not change product code merely to turn a check green.
4. After any push, fetch the live target again and repeat the ancestry proof. Confirm the refreshed PR body is live (re-read it, verify every media URL resolves and renders), reply to or resolve only feedback the user has authorized the agent to handle, then restart the loop on the new SHA.
5. While checks run, wait on their completion signal instead of launching duplicate jobs or polling noisily. When state is unchanged, continue watching and send only occasional concise heartbeats.

## Guardrails

- Work only on the PR head branch and preserve unrelated changes.
- Never force-push, rewrite history, merge, close, mark ready, or dismiss a human concern unless the user explicitly authorized that exact action.
- Do not retry a likely flaky job more than once without new evidence.
- Treat green, mergeable, and review-clean as a milestone, not a terminal state, while the PR remains open.
- Call a branch current or clean only when the latest fetched target tip is an ancestor of the remote PR head. Record both SHAs with the claim.
- Stop only for merged/closed, explicit interruption, missing authority or access, an ambiguous human decision, or a repeated failure that cannot be safely resolved.

## Handoff

Report the final/current SHA, live target-tip SHA, ancestry result, check summary, mergeability, fixes pushed, replies or resolutions made, and every remaining blocker. Never claim continued monitoring after the active watcher has stopped.
