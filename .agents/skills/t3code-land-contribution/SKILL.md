---
name: t3code-land-contribution
description: Prepare or shepherd a contribution intended for pingdotgg/t3code by choosing a direct-PR, issue-first, or local-only lane, isolating one owned change, proving it proportionately, and reporting its real review and merge state. Use for T3 Code work that may be proposed, published, reviewed, or rescued upstream. Do not use for personal-only T3 configuration, ordinary Git help, or unrelated repositories.
---

# Land a T3 Code contribution

Aim for a small, understandable change that a maintainer can confidently accept.
Current repository policy and current maintainer direction outrank this skill.

## Establish the live state

Before planning or changing code:

1. Resolve the checkout, branch, dirty state, remotes, target branch, linked
   issue or PR, and current remote tip.
2. Read the root and nearest applicable `AGENTS.md`, `CONTRIBUTING.md`, pull
   request template, affected package documentation, and relevant workflows.
3. Check overlapping issues and pull requests, especially maintainer decisions.
4. State what is upstream-generic and what is personal, private, or local-only.

Do not infer permission or alignment from old examples, a self-authored issue,
or the existence of working code.

## Choose one lane

Record the lane and the evidence for it before publishing.

### Direct PR

Use for a narrow bug fix, performance or reliability improvement,
accessibility fix, or maintenance change whose product behavior and owner are
already clear. Keep it to one independently useful outcome.

### Issue first

Use when the work needs a product, architecture, protocol, schema, dependency,
entitlement, security, or cross-client decision. With user authority, file a
focused issue and wait for maintainer direction before treating the proposal as
aligned. A self-authored issue records the question; it does not answer it.

### Local-only or direction required

Keep personal topology, private infrastructure, signing identities, branding,
and user-specific workflow on personal branches. Ask for direction before
generalizing an unapproved owner or product decision upstream.

If live policy closes public contribution intake, stop at a local patch or
proposal unless a maintainer explicitly opens a path.

## Isolate one contribution

Start from the current target branch in a clean branch or worktree. Preserve
dirty or personal work as reference; do not make it the contribution base.

- Carry only files required for the chosen outcome.
- Exclude unrelated formatting, cleanup, dependency churn, generated build
  output, credentials, private hosts, and personal evidence.
- Split changes that can be reviewed, tested, or accepted independently.
- Re-check the diff after rebasing or moving code between branches.

Never overwrite or discard unrelated work to obtain a clean diff.

## Apply the scoped-owned-proven gate

### Scoped

- The change has one concrete outcome and explicit exclusions.
- Every changed file is necessary for that outcome.
- Each affected client, provider, contract, connection mode, reverse state,
  and documentation surface has an explicit decision.

### Owned

- The cause is fixed at the existing owner boundary.
- Existing services, components, helpers, error models, and naming are extended
  before new machinery is introduced.
- Invalid or incomplete states remain explicit failures; do not fabricate
  success with defaults, retries, caches, or fallbacks.
- Tests and contracts remain at least as strict as before.

### Proven

- Reproduce the original behavior when practical.
- Test the changed behavior and its important failure edges.
- Use the exact focused commands and integrated-client rules from the current
  repository guidance.
- Match evidence to the claim: performance claims need measurements, visible
  changes need visible proof when current policy requires it, and skipped or
  unavailable checks must be named as gaps.
- Verify review findings against the current diff before accepting or rejecting
  them. After a fix, rerun the affected proof.

Do not add proof machinery merely because this skill mentions proof. Use the
smallest evidence that establishes the actual claim.

## Prepare the review packet

Follow the live pull request template. Explain, in plain language:

- the problem and reproduction;
- the cause and owner boundary;
- the exact change and exclusions;
- focused commands and real results;
- integrated or visual proof required by current repository policy;
- risks, limitations, unavailable checks, and known follow-up work.

Use sanitized fixtures. Keep personal conversations, credentials, private
hosts, and unrelated local state out of code and evidence. Treat all evidence
as belonging to the current commit; refresh only what a later change
invalidates.

## Publish and shepherd with authority

Pushing, opening an issue or pull request, commenting, requesting review,
merging, and changing GitHub state are external actions. Perform only the
actions the user authorized.

After each authorized push:

1. Resolve the remote head and live target again.
2. Inspect checks, review feedback, mergeability, and base freshness.
3. Classify skipped, privileged, fork-authorization, and infrastructure jobs as
   gates—not successes and not automatically code failures.
4. Verify each finding, make only in-scope fixes, and repeat affected proof.
5. Record the next owner: agent, user, CI, reviewer, or maintainer.

Automated approval is not human maintainer approval. A conflict-free branch is
not necessarily current with its target.

## Report readiness truthfully

Use one of these states:

- **proposal only** — direction or authority is still required;
- **implementation ready** — the isolated change passes local proof but is not
  yet published or reviewed;
- **review ready** — authorized publication is current and the review packet is
  complete;
- **not merge-ready** — name each remaining gate and its owner;
- **merge-ready** — aligned lane, current base, required proof, required checks,
  and required human review are complete on the exact remote head.

Name the branch or PR, exact commit, proof run, unresolved gates, and next
action. Never report a model, reviewer, check, platform, or device that did not
actually participate.
