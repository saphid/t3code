# Upstream integration evidence, 10 September 2026

The extension branch integrates upstream main b7b3ef1e6fcb5c22a9790d2578fe8af7ce396835 onto extension baseline 516061944452b31387bdd44cf8fb1f669b989e71. This preserves the installed public API paths while adopting upstream multi-PR threads, stacks/search, recent PR state, and model picker changes. Work spine: saphid/personal-ops#128.

## Decisions

Thirteen conflicted paths required reconciliation; twenty code/configuration paths differ from Git's automatic merge tree after necessary compile and integration fixes. Public extension descriptors remain compatible.

MCP sessions always expose the pull-request toolkit. Extensions retain their default grant, but an explicit capability list can exclude them. Preview requires both the preview request and inclusion in an explicit capability list when supplied. The resulting preview flag derives from the actual issued capabilities. A configured MCP server alone does not imply browser authority: Codex browser instructions require the explicit browser-tools flag. Failed issuance retains provider revocation and cleanup.

The monitor found two lower-level Codex helpers still defaulting omitted browser availability to true. Both now require explicit true, with omitted/false/true marker assertions in default and plan modes. The touched tests use the repository Effect test convention.

The existing native Version Control extension bridge supports the upstream linked-PR list and detail selection/back behavior. Detail identity includes environment, project, host, repository and PR number. This remains a private bridge and is not evidence of an independently installable PR replacement.

## Exact verification

Artifacts are on lxso2 under /home/saphid/artifacts/t3-extensions-health-rounds-20260909/upstream-integration.

- server-tests-v1-exit.json: exit 0, 224 tests in nine focused MCP, provider and extension files. Client-runtime type check exits 0. After the final runtime correction, server-types-v9-exit.json exits 0 and builder/codex-runtime-correction-tests-r3.exit.json records 94 passing runtime/adapter tests.
- web-tests-v5-exit.json: exit 0, 141 tests in eight relevant web files; web-types-v5-exit.json exit 0 after final import cleanup.
- lint-v7-exit.json: exit 0, no errors and 48 inherited React diagnostics. lint-comparison.json compares exact baseline, upstream and candidate snapshots using the same command/config: each has 48, with no new or changed diagnostics.
- build-v18-exit.json: production build exit 0. All 220 recorded changed-file SHA-256 values match the frozen v7 tree and the current files before this documentation update.
- Files, authenticated root authority, terminal metadata, terminal output snapshot and installed terminal live-output v18 regression receipts all exit 0.
- The live-output proof uses the exact premerge installed package, content hash 84feaeab243caf2278864db3513015d59d4f4b4958a23a1ee27c2e3449d425ef, from the SDK tarball. Ten installed checks pass.
- upstream-panel-v18-exit.json: exit 0. The ordinary Linked pull requests menu opens the singleton through the native extension registry and survives reload. Parent inspected the actual panel screenshot. This covers the empty list; populated GitHub/GHE detail journeys remain unproved here.

The runtime correction initially produced a test syntax failure, then targeted lint exposed an inherited manual Effect runtime call. Both were corrected and retested. A worker attempted a nonexistent root build:extensions task; that failed attempt is retained separately from the successful final server-types-v9 command. None of these failures is counted as a passing check.

The initial PR-panel proof failed because its selector guessed “Pull requests”; the enabled menu is “Linked pull requests”. The failed receipt is retained beside the corrected r2 receipt. The full-page fixture screenshot contains an old provider refresh error. fixture-provider-error-comparison.json proves the exact error and timestamp were already in the premerge database; the current authenticated extension checks succeed. The focused panel capture is upstream-linked-pr-panel-r2-detail.png.

baseline-build16 preserves the prior production server/web assets and 8,807 file hashes, plus a consistent read-only SQLite snapshot. The candidate runs in isolated proof/runtime on server13, port8196; live T3 userdata was never used for the test server. Full server/database rollback was not executed.

## Review and limits

A second-account Luna medium builder resolved the merge and a separate Luna medium monitor inspected the result. Parent independently ran the focused checks and installed proofs. Their canonical reports and raw command receipts are retained under builder/ and monitor/.

A direct Claude Opus 5 high review was attempted with /usr/local/bin/claude --print --model claude-opus-5 --effort high --tools "" --no-session-persistence --output-format json. Exit 1: the OAuth session could not refresh; modelUsage was empty. No Claude review occurred. No CODING_STANDARDS.md was present in the inspected repository/primary-worktree locations.

This is a bounded integration result, not completion of the extension system. The installed readonly Files scope is API-driven; Browser, Diff, Version Control, Agents and full interactive Terminal remain incomplete migrations. General model-facing API discovery/invocation is not yet implemented through MCP. Mobile, Electron packaging, relay/tunnel, full V2 execution, sustained terminal throughput and all inherited upstream mobile behavior were not independently exercised by these checks.
