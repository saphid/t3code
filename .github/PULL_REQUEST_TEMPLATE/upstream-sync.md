## Exact upstream revision

- Upstream repository: `pingdotgg/t3code`
- Upstream ref: `refs/heads/main`
- Upstream commit: `<full 40-character SHA>`
- Product base commit: `<full 40-character SHA>`
- Receipt: `docs/upstream-sync/receipts/<date>-<short-sha>.json`

## Review boundary

- [ ] The branch is named `sync/upstream-YYYYMMDD-<short-sha>`.
- [ ] The exact upstream commit is a merge parent; product history was not rebased.
- [ ] The receipt passes `node scripts/verify-project-isolation.mjs --receipts`.
- [ ] Relevant focused checks passed for every changed server, contract, client, generated, and fixture path.
- [ ] Existing T3 Personal, Nightly, SwiftUI, fleet, release, app, and runtime identities were not changed.
- [ ] No deployment, installation, runtime mutation, or automatic merge is included.

## Evidence

Describe the imported delta, focused checks, collision result, and reviewer findings.

Created with GPT-5.6 Sol high in the Codex harness.
