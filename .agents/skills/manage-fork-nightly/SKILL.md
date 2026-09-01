---
name: manage-fork-nightly
description: Manage the saphid/t3code downstream Nightly patch stack. Use when adding, updating, removing, validating, or diagnosing a PR, commit, or branch that must be replayed on every upstream T3 Code Nightly release.
---

# Manage Fork Nightly

Maintain the custom release as a reproducible ordered patch stack. Work in the
`saphid/t3code` fork and treat `.github/downstream-nightly.json` as the source of
truth.

## Before editing

1. Read the repository instructions, `~/.config/model-routing.md`, and
   `~/.config/ai-usage-budget.md`.
2. Verify the worktree, branch, remotes, and untracked files. Preserve unrelated
   work.
3. Read these files:
   - `.github/downstream-nightly.json`
   - `.github/scripts/downstream-nightly.mjs`
   - `.github/scripts/downstream-nightly.test.mjs`
   - `.github/workflows/downstream-nightly.yml`
4. Fetch the exact upstream and fork state before choosing a pin.

## Choose the patch type

- Use `pull_request` when the complete ordered commit series from a GitHub PR is
  required. Record the repository, PR number, and current full `headSha`.
- Use `commit` for one immutable commit. Record the repository and full SHA.
- Use `ref` only when the pinned tip commit contains the complete patch. Record
  the repository, ref name, and full `expectedSha`.

The assembler applies exactly one commit for a `ref` entry. Never use `ref` as
shorthand for a multi-commit branch. Publish or refresh a PR and use
`pull_request` instead.

## Change the stack safely

1. Review the patch diff and its dependency order. Put prerequisite patches
   first.
2. Resolve every pin to a 40-character SHA through GitHub. Do not silently
   follow a moved PR head or ref.
3. Refresh stale branches onto the current fork base if the patch conflicts
   with current Nightly. Preserve current upstream UI and composer behavior.
4. Avoid draft, media, evidence, and generated branches unless the user asks
   for them explicitly.
5. Edit only the manifest and any directly related tests or documentation.
   Never edit `automation/downstream-nightly` by hand.

## Verify and activate

Run the focused assembler tests:

```bash
node --test .github/scripts/downstream-nightly.test.mjs
node --input-type=module -e 'import fs from "node:fs"; import { parseManifest } from "./.github/scripts/downstream-nightly.mjs"; parseManifest(fs.readFileSync(".github/downstream-nightly.json", "utf8"));'
```

Inspect the final diff and use `git diff --check`. Commit and push through a
reviewable branch. Merge the manifest change to fork `main` to activate it,
then dispatch `downstream-nightly.yml` or wait for its schedule. Use Bugler for
bounded waits instead of polling when a webhook event can signal completion.

Report the exact patch entry and pin, workflow result, generated release, and
any conflict or CI risk. A moved pin is an intentional review event, not an
automatic update.
