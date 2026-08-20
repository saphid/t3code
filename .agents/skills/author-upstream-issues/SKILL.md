---
name: author-upstream-issues
description: Draft upstream T3 Code issues and Ideas discussion posts in the established house style, routing bug reports through the upstream bug template and feature proposals to Ideas discussions, with short surface-prefixed titles and minimal-scope bodies that map one-to-one to a planned PR. Use when reporting a T3 Code bug upstream, proposing a desktop, web, or server improvement, or preparing the issue or discussion a planned PR will reference.
---

# Author Upstream Issues

Use this skill to draft the upstream artifact a planned PR will reference. Upstream reserves issues for bug reports; feature requests and proposals belong in [Ideas discussions](https://github.com/pingdotgg/t3code/discussions/categories/ideas), and blank issues are disabled. Nothing gets posted without the maintainer's explicit go-ahead: the deliverable of this skill is a staged draft.

## Route the request

- Broken behavior, regression, crash, or reliability problem → **bug issue** via `.github/ISSUE_TEMPLATE/bug_report.yml`.
- Anything additive or opinion-shaped (new capability, UX improvement, perf idea without a measured regression) → **Ideas discussion**.
- Non-trivial changes get a discussion first even when a bug technically exists; upstream asks for discussion before bigger work.

## Scope to one PR

One issue or discussion maps to exactly one planned PR, and its body must make that PR extractable: name the smallest useful scope, and push everything beyond it into explicit non-goals or follow-ups. Record the planned branch name (see `contribute-desktop-server` for naming) so the artifact and the PR reference each other.

## Title

Start with the surface, then the problem or outcome, present tense, no trailing period. Surfaces mirror upstream's commit scopes: `Desktop:`, `Web:`, `Server:` (and `Desktop/Web:` when the change lives in the hosted web client but is desktop-visible).

- Bug issue (the template prepends `[Bug]: `): `[Bug]: Desktop: window forgets its size after quit`
- Ideas discussion: `Server: settle orphaned provider sessions on startup`

## Bug issue body

Follow the template's fields exactly; it renders as a form, so a `gh` submission must carry the same sections as markdown headings: Before submitting, Area, Steps to reproduce, Expected behavior, Actual behavior, Impact, Version or commit, Environment, Logs or stack traces, Workaround.

- Pin the repro to a commit: `upstream/main @ <sha>` plus OS, app build, and provider where relevant.
- Make the steps deterministic and isolated: reproduce against a scratch home (`pnpm dev --home-dir "$PWD/.t3"` or a `mktemp -d` path), never against a live `~/.t3`.
- Trim logs to the relevant lines and redact tokens and paths that identify the machine.

## Ideas discussion body

Use these sections, each one short:

1. **Problem or use case** — the concrete friction, with the surface and situation.
2. **Proposed solution** — behavior, not implementation detail.
3. **Why this matters** — who benefits and how often.
4. **Smallest useful scope** — the slice the first PR delivers.
5. **Alternatives considered** — and why they lose.
6. **Risks or tradeoffs** — including perf and multi-surface implications.
7. **References** — related issues, discussions, or PRs.
8. **Contribution** — state willingness to implement.

## Stage, then post on go-ahead

1. Write the draft to a file the maintainer can read (for example `.t3/drafts/issue-<slug>.md`) and hand it over in the reply.
2. Only after an explicit go-ahead, post it:
   - Bug: `gh issue create --repo pingdotgg/t3code --title "[Bug]: ..." --body-file <draft>` (labels `bug`, `needs-triage` are applied by the template; add them explicitly when creating via CLI).
   - Idea: discussions need GraphQL. Look up ids once, then create:

     ```bash
     gh api graphql -f query='query { repository(owner: "pingdotgg", name: "t3code") { id discussionCategories(first: 20) { nodes { id name } } } }'
     gh api graphql -f query='mutation($r: ID!, $c: ID!, $t: String!, $b: String!) { createDiscussion(input: {repositoryId: $r, categoryId: $c, title: $t, body: $b}) { discussion { url } } }' -f r=<repo-id> -f c=<ideas-category-id> -f t="<title>" -f b="$(cat <draft>)"
     ```

3. Record the created number so the PR body can say `Fixes #NNN` (bugs) or `Proposed in discussion #NNN` (ideas).
