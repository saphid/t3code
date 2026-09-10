# Installed read-only API authority evidence

An authenticated reader can now use the same installed public APIs as a reader in the native app without needing extension-management write authority. The existing invocation endpoint, SDK and package schemas are unchanged. This prerequisite was found during the Agents migration audit; it does not implement an Agents API or replace that panel.

## Behavior

The HTTP adapter selects authority from the verified environment principal. Existing access:write callers retain their write-capable root, including sessions without orchestration:read. Otherwise orchestration:read creates a read-only root. Neither scope is denied. The broker rejects write methods beneath a read-only root and also prevents a read method under a write-capable root from obtaining nested write authority. Installation/project/capability grants remain independent.

Root/session/grant/provider-generation revalidation still surrounds asynchronous work. Registering a plugin API does not grant control. Trusted package code is not an operating-system sandbox.

## Baseline and exact proof

All work and evidence are on lxso2. Repository baseline b49d45cc41cf5145c8436ecd22b6a349722c2308 includes upstream main b7b3ef1e6fcb5c22a9790d2578fe8af7ce396835. Artifact root: /home/saphid/artifacts/t3-extensions-health-rounds-20260909/agents-public-api.

baseline-build18 retains 8,807 hashed production files and a consistent read-only snapshot of isolated proof state. read-authority-baseline-r2-exit.json exits0: the original server rejects an installed Files read API with HTTP403/EnvironmentScopeRequiredError for a reader, while preserving write-only calls and refusing unauthorized writes.

Final parent receipts, all exit0:

- http-session-tests-v2: 11 tests in two files, including actual HTTP middleware routing. Its mocked operation proves root construction, not handler enforcement.
- root-authority-tests-v2: nine real broker/runtime root tests.
- nested-read-tests-v2: one focused independent-worker nested-write test.
- server-types-v2 and lint-v2: scoped typecheck and lint, zero lint errors/warnings.
- build-v29: production build; recorded source hashes were identical before/after and match the final executable source. The artifact label is build-v29.
- read-authority-candidate-r5: eight real installed-path checks, no errors.

The unchanged independently installed Files package has content hash d86e96568422b8e0a3b416ca05f96c91ce2838e00371157d973a727512f0c7a0. A fresh login with only orchestration:read opens the ordinary right-panel Files card, receives the package-owned renderer through t3.file/presentation, lists and reads actual workspace data through t3.workspace/files, and retains the selected file across full reload. Parent inspected readonly-installed-files.png in the final candidate directory: the exact text is visible without clipping or an overlay.

An independently installed probe package outside the checkout, hash 8b0c408fd2dbc6e744a5ca11721654ea1bc8cd7f98fbce229e577a83fac00def, defines its own namespaced API and calls a separate installed provider. Positive controls prove a declared write under a write-only root can reach that provider; read-root writes and read-method-to-write calls do not execute the counter handler. A real file-event barrier holds a plugin handler while the parent revokes its authenticated session or installation grant; the result is withheld. Another installed reader remains usable. The probe, owned login sessions and gate files are cleaned up.

The isolated candidate is proof/server-14 on port8196, with its exact PID/start identity retained in proof/server-14-child.json. Live T3 userdata was not used as server test state. No push, PR or deployment was performed.

## Corrections and review

The Luna builder found the unnecessary write-authority prerequisite and implemented a compatible adapter change. Parent typecheck caught an unbranded EnvironmentId in the new test; it was corrected before final checks. A worker check used the wrong lock and inconsistent timestamp metadata; its historical receipt is retained, and parent independently reran the final focused checks under the canonical shared lock.

The separate Luna monitor found two weaknesses in the parent's proof: arbitrary non-200 responses were insufficient denial evidence, and gate files needed cleanup. Final proof requires the structured status/type/reason and removes only its owned files. First browser attempts assumed an existing tab layout; the fresh login uses the empty surface launcher. A later assertion omitted the broker's actual “API configuration changed” cancellation reason. Those failures remain beside the final result. Parent also dismissed an unrelated update toast locally before capturing unobstructed panel evidence.

A direct /usr/local/bin/claude --print --model claude-opus-5 --effort high --tools "" --no-session-persistence --output-format json review attempt exited1 because OAuth could not refresh. modelUsage was empty: no Claude review occurred. Inspected repository/primary-worktree locations had no CODING_STANDARDS.md; paths are recorded in review/standards.json.

## Limits

This proves installed read invocation and the existing read/open Files scope. It does not prove full Files editing/media behavior, Agents/Browser/Diff/Version Control/full Terminal replacement, native mobile renderers, Electron packaging, relay/tunnel/DPoP journeys, sustained throughput, general simultaneous API-version support or V2 execution. The same wire contract continues to use existing authenticated transports; unchanged transport code is not an executed proof for every mode. Model-facing typed API discovery/invocation through MCP remains a separate gap.
