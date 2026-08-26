# Conflict resolution for our open upstream PRs

Authority: all head branches of saphid-authored PRs are ours to modify at
will. The inviolable boundary is other people's changes: integration must
preserve upstream-side behavior exactly; we adapt OUR code to theirs, never
the reverse, and we never touch files whose conflicting hunks are purely
upstream work except to accept the upstream side.

Per conflicted PR, one Sol worker, one pass:

1. Fetch the current target branch; rebase our branch onto it (or merge the
   target in when the branch has review history worth preserving - pick one
   per PR and say which in the body).
2. Resolve every conflict by keeping upstream behavior and re-expressing our
   change on top. If our change no longer applies (upstream superseded it),
   shrink or close the PR rather than force it.
3. Rerun the affected focused checks (tests, lint, types for changed files).
   A head change invalidates prior proof: refresh screenshots/video for
   UI-affecting PRs per the evidence rules, or add the explicit Known-gaps
   line if capture must wait for a proof lane.
4. Update the nine-part body to the new head, keep the title current, and
   re-request review only when checks and evidence match the head.
5. Force-push only our own branch (--force-with-lease). Never push to any
   branch we do not own; never resolve someone else's review thread.

Ship rule: as long as a resolution changes only our PR's branch and
preserves everyone else's committed behavior, proceed without asking.
Anything that would require altering another contributor's change stops and
is reported as a maintainer-decision item.
