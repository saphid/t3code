# Installed package assets: acceptance evidence

Work spine: saphid/personal-ops#128. Integration repository: /home/saphid/projects/t3-extensions-integration on lxso2. Both Luna medium workers use the explicit second-account route. This records one capability slice, not complete panel replacement.

## Implemented contract

Format 4 packages declare bounded immutable binary assets. Install/update validates size and SHA-256; enable, rollback and client activation verify complete packages. Per-asset delivery verifies identity, availability, dependencies and cancellation. The client receives bytes through public ClientHost.readAsset bound to its plugin and environment; it receives no credential or asset URL. Legacy formats 1/2/3 retain their hash semantics.

The authenticated binary endpoint uses the existing prepared connection and authentication path. HTTP read scope is sufficient for static package data. At most four asset reads per installation and sixteen per environment are admitted; excess requests fail immediately. Assets are data, not revocable resource authority. Trusted JavaScript remains trusted code, not a security sandbox.

## Verification at the frozen source

Artifacts below live under /home/saphid/artifacts/t3-extensions-health-rounds-20260909/package-assets/.

- secondary-workers/builder-final.md and builder-freeze-final.sha256: SDK/runtime builds exit 0; SDK focused 5/5; runtime asset focused 10/10; owned lint exit 0. Runtime cases include exact concurrency admission/recovery, corruption, genuine legacy hash fixtures, leaf/ancestor symlinks, and acquired-read barriers across committed update/remove.
- sdk-tests-v5-exit.json: public SDK suite 34/34. runtime-tests-v5-exit.json: 94/94 including actual Electron worker execution at that checkpoint; later changes strengthened focused asset tests without changing production source.
- published-consumer-v5-exit.json: actual npm tarball installed into an independent consumer, public types compiled, packaged WASM bytes validated.
- transport-v3-exit.json: 26/26 for binary transport/authentication, including cookie, bearer and simulated DPoP renewal with exact method/origin binding.
- web-assets-v5-exit.json: 26/26 installed controller and asset lifecycle tests. server-assets-v6-exit.json: 18/18 scoped server/HTTP/MCP tests.
- server-types-v4-exit.json and web-types-v5-exit.json: relevant package typechecks exit 0. build-v15-exit.json: production build exit 0.
- lint-v7-exit.json: fresh lint over every changed executable file exit 0 after import fixes. Earlier failures remain retained.

installed-proof-v15-r2/evidence.json and exit.json show six actual installed-path checks, exit 0: independent published package installs; authenticated exact binary delivery; actual client executes its own WASM through readAsset; page reload restores the surface; disable/enable/update/stale hash/rollback preserve identity; uninstall denies access. Anonymous, insufficient scope and undeclared/traversal requests fail. Parent visually inspected asset-panel.png: “Installed WASM returned 42.” The owned example was uninstalled after proof.

regressions-v15-complete.json records exit 0 for existing installed Files, session-root authority, Terminal metadata and Terminal output proofs. Older baseline receipts remain alongside the candidate.

## Review and agent readiness

A direct independent-provider review was attempted with /usr/local/bin/claude --print --model claude-opus-5 --effort high --tools "" --no-session-persistence --output-format json. review/exit.json records exit 1: OAuth expired before any model participated. No Claude review is claimed. No nearest or primary-worktree CODING_STANDARDS.md was present in the inspected locations.

The builder/monitor loop caught framework errors (missing fallback adapter, format negotiation, lifecycle checks and complete snapshot distinction), test errors (uncommitted update races and weak concurrency assertions), and evidence errors (stale reports and hand-transcribed hashes). Final summaries must derive hashes from files, identify exact test commands and retain real exit status. Monitoring is useful but the parent must verify the monitor too.

## Limits

The published example is a 38-byte WASM returning 42. Its success alone says nothing about large renderer asset performance. A separate real Ghostty/font fixture and installed comparison passed before and after an actual server restart; see renderer-assets-trial.md. It does not prove complete renderer performance parity.

The read-only Files replacement is API-driven and reachable from the ordinary Files entry. It does not yet replace full file editing, media, tree and attachment behavior. Terminal metadata/output examples are independent public-API consumers; they are not a live VT terminal. Browser, Diff, Version Control and Agents remain incompletely migrated. There is no clean bill for all six panels.

Remote relay/tunnel, both native mobile clients and V2 execution remain unproven at this checkpoint. Simulated DPoP and direct HTTP evidence cannot substitute for those modes. No PR, push, deployment or wholesale panel replacement is included.
