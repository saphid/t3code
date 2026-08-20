---
name: contribute-desktop-server
description: Plan, branch, verify, and stage small single-purpose upstream pull requests for the T3 Code desktop app, the web client it hosts, and the Node server, including branching off upstream/main with house naming, focused typecheck and test runs, before/after screenshot capture from the Electron app or web client in an isolated environment, fork-hosted PR media, and PR bodies in the house template. Use when preparing or staging an upstream PR that touches apps/desktop, apps/web, or apps/server, when capturing desktop or web UI evidence for a PR, or when splitting a larger change into extractable single-concern PRs.
---

# Contribute Desktop & Server

Use this skill to take one desktop, web, or server change from plan to a staged upstream PR. Upstream is not actively accepting contributions: small bug, reliability, and performance fixes have the best odds, and feature work needs an Ideas discussion first. Draft the issue or discussion with the sibling [`author-upstream-issues`](../author-upstream-issues/SKILL.md) skill; every PR maps 1:1 to one issue or discussion, and every issue or discussion maps to one planned PR.

Never push to `upstream` and never open a PR or post an issue without the maintainer's explicit go-ahead. Stage everything on the fork (`origin`) and hand over drafts.

## Plan one PR

1. State the change as one concern. If the description needs "also", split it and run this skill once per PR.
2. Find or draft the matching upstream issue (bugs) or Ideas discussion (features) and record its number.
3. Write the PR title as a conventional commit using the scopes upstream's history already uses — `fix(desktop)`, `feat(desktop)`, `fix(web)`, `fix(server)`, `perf(...)` — with a plain-language, user-visible outcome: `fix(desktop): window restores to its last position`.

## Branch off upstream/main

1. `git fetch upstream`. Base every branch on `upstream/main`; fork `main` is stale and force-updated.
2. Name the branch `fix/issueNNN-<slug>` or `feat/issueNNN-<slug>` when issue NNN exists, otherwise `agent/<surface>-<slug>`. When extracting the minimal upstreamable slice of a larger local branch, append `-extracted` or `-upstream`.
3. Push work branches to `origin` only.

## Verify

- `pnpm tc` for typecheck, then focused tests for the packages you touched, e.g. `cd apps/server && pnpm exec vp test run <files>`. Desktop and web expose the same `vp test run` via their package `test` scripts.
- Server behavior changes ship with focused tests. The server is event-sourced: wait on typed receipts and worker drains, never on sleeps.
- Run every dev server against an isolated home. This standalone clone is not a linked worktree, so always pass `--home-dir "$PWD/.t3"` (or a `mktemp -d` path) and read real ports from the `[dev-runner]` output line. Never point anything at `~/.t3`.

## Capture evidence

Server changes need no screenshots: paste the focused test output, receipt traces, or benchmark numbers into the PR body's Verification section instead.

UI changes need before/after images; motion or timing needs a short video (MP4, with a GIF fallback for inline preview). Capture the "before" set on the merge-base before implementing — or afterwards from a temporary linked worktree at the merge-base, which gets its own `.t3` by default.

- **Web client:** follow [`test-t3-app`](../test-t3-app/SKILL.md) for the isolated environment and pairing, then screenshot the controlled browser.
- **Desktop app:** start the stack with a DevTools port, wait for the `main window created` log line, and capture over CDP. The desktop window authenticates over loopback automatically; no pairing is involved.

  ```bash
  T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT=9223 pnpm dev:desktop --home-dir "$PWD/.t3"
  node .agents/skills/contribute-desktop-server/scripts/capture-electron.mjs 9223 before.png
  ```

An empty database is a bad "after" screenshot. Seed the isolated home with realistic fixtures first (see `test-t3-app` → SQLite fixtures).

## Host media on the fork

1. Put the final files under `pr-media/<slug>/` with descriptive names (`window-restore-before.png`, `window-restore-after.png`, `window-restore.mp4`).
2. Commit them as `docs:` commits on a dedicated `agent/pr-media-<slug>` branch and push it to `origin`.
3. Embed commit-pinned raw URLs in the PR body so links survive branch movement: `https://raw.githubusercontent.com/<fork-owner>/t3code/<media-commit-sha>/pr-media/<slug>/<file>`. Read `<fork-owner>` from `git remote get-url origin`.

## Stage the PR

1. Write the body from [references/pr-body-template.md](references/pr-body-template.md): What Changed, Why, Verification, UI Changes, Checklist, and a closing line naming the model and harness that did the work.
2. Save it where the maintainer can read it (for example `.t3/drafts/<branch>.md`, inside the gitignored state dir) and hand it over in the reply together with the branch name.
3. Only after an explicit go-ahead: `gh pr create --repo pingdotgg/t3code --head <fork-owner>:<branch> --title "<conventional title>" --body-file <draft>`. External PRs are auto-labeled `vouch:*` and `size:*`; keeping the diff small is what keeps `size:*` honest.
