# PR body template

Fill every section; delete UI Changes only when nothing user-visible changed and say so in Verification. Keep the tone factual and specific — name the exact tests, counts, and commits. Do not tick a checklist box the PR does not earn.

```markdown
## What Changed

<!-- What the user or operator gets, in one or two short paragraphs.
     State the scope boundary explicitly: name the surfaces and layers this
     PR does NOT touch (other clients, providers, wire contracts). -->

## Why

<!-- The problem being solved and why this approach is the smallest correct
     one. Reference the upstream issue (bugs) or Ideas discussion (features)
     this PR maps to: "Fixes #NNN" / "Proposed in discussion #NNN". -->

## Verification

<!-- Bullet the exact checks with their results:
     - `pnpm tc`: passed.
     - `vp test run src/foo.test.ts` in apps/server: N passed, 0 failed.
     - For behavior changes: name the specific new tests.
     - For perf claims: before/after numbers and how they were measured. -->

## UI Changes

<!-- Before/after images, commit-pinned to the fork media branch:

Before — <one-line caption>:

![<alt>](https://raw.githubusercontent.com/<fork-owner>/t3code/<sha>/pr-media/<slug>/<name>-before.png)

After — <one-line caption>:

![<alt>](https://raw.githubusercontent.com/<fork-owner>/t3code/<sha>/pr-media/<slug>/<name>-after.png)

For motion: [<name> video (MP4)](...) · [GIF fallback](...) -->

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why
- [x] I included before/after screenshots for any UI changes
- [x] I included a video for animation/interaction changes

<!-- Closing line: the model and harness that did the work, e.g.
     "Implementation used <model> in T3 Code. Independent review used <model>." -->
```
