---
name: babysit-upstream-pr
description: Babysit an open upstream T3 Code PR until the bots are green, polling CI checks and reviewer comments (Macroscope and other bots), verifying each finding against the source, pushing fixes for real ones, and dismissing false positives with a written reason. Use after opening a PR on pingdotgg/t3code, when new checks or bot reviews land on one, or when asked to check on or drive a PR to green.
---

# Babysit an upstream PR

Watch one open PR on `pingdotgg/t3code` from a fork branch and drive it to green. The maintainer's go-ahead for the PR covers follow-up pushes to the same branch and written replies on the PR; anything beyond that scope (a second PR, a force-push rewriting history someone reviewed, closing the PR) needs a fresh go-ahead.

## Loop

Each cycle, compare against the last push you made, not the last cycle:

1. Read state:
   - `gh pr checks <num> --repo pingdotgg/t3code` — check runs on the latest commit.
   - `gh pr view <num> --repo pingdotgg/t3code --json reviews,comments,latestReviews` — reviews and issue comments.
   - `gh api repos/pingdotgg/t3code/pulls/<num>/comments` — inline review comments (Macroscope posts here).
2. For each comment or review newer than your last push, triage it as a finding. Ignore what you have already answered or fixed.
3. Verify every finding against the source before acting — open the file at the referenced line and confirm the claim reproduces. Bots misread moved code and pre-existing behavior; a finding is only real once the source agrees with it.
4. Real finding: fix it in the PR branch, run the focused tests and typecheck for the touched scope, commit, push. One concern per commit, plain message.
5. False positive: reply on that comment thread with the specific reason it does not apply — name the line, the guard, or the test that refutes it. A dismissal without a stated reason is not a dismissal.
6. Failed check: read the log (`gh run view <run-id> --log-failed`), reproduce locally with the same command, fix, push. A check that failed on infrastructure (timeout, runner death) gets one re-run request before any code change.
7. Nothing new: stay quiet. Post no status comments, no "still waiting" notes.

Poll every few minutes while checks are running; back off to 15–30 minutes once checks are green and only reviewer responses are pending.

## Done

Stop when both hold on the latest commit: every check green, and every bot finding either fixed or answered. Report the final state — checks, findings handled with their resolutions, commits pushed — and hand back to the maintainer for the human-review wait. Merging is the maintainer's move, never yours.
