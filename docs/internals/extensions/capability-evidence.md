# Capability implementation evidence — 9 September 2026

Status: **in progress; full panel replacement is not complete**.

Worktree: /home/saphid/projects/t3-extensions-integration, branch feat/extensions-capabilities-20260909.
Preserved baseline: 967210389d2d5fb857baa05d3ba4c7d5c93d1d0c.
Upstream main verified: 6c583620ff7ad3235b135af7107c0543467eecfa.
All builds, worker execution and browser checks below ran on lxso2.

## What is demonstrated

- Format-2 packages define namespaced APIs and declare semver plugin/API dependencies. Shared descriptors enforce the same schemas, effects and grants for host and plugin providers.
- Deterministic dependency resolution, explicit provider choice/fallback, transactional install/update and rollback, scope/grant checks, cancellation, stale generations, bounded results and failure isolation are exercised by real worker tests.
- Read-only nested calls cannot obtain write authority. Host-generated call/parent IDs retain root and immediate caller identity in audit records without recording payload contents.
- A package copied outside the repository was installed through Settings → Integrations. Its renderer imports no private app components or state.
- The ordinary Files entry selects that installed provider, lists actual workspace entries and reads the exact bytes of new.txt through public APIs.
- A separately installed consumer calls the Files package's own example.files/info API.
- Selected file state survives reload, server restart, package update and rollback.
- A second client can disable, enable, roll back and update the package; the first client changes automatically from host catalogue receipts without manual refresh.

## Evidence locations

Artifacts are under /home/saphid/artifacts/t3-extensions-capabilities-20260909.

| Evidence                                                            | Result                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| runtime-scoped-final-receipt.json and runtime-scoped-final-test.log | 48 runtime tests passed, no skips, including actual Electron 44.1.0 worker execution |
| final-scope-audit-types.log                                         | Server package typecheck passed after scoped audit logger fix                        |
| final-scope-audit-tests.log                                         | 34 focused server tests passed                                                       |
| proof/install-proof.json                                            | Both independent packages installed through real Settings UI                         |
| proof/consumer-proof.json                                           | Independent consumer received public namespaced API result                           |
| proof/files-proof-2.json                                            | Ordinary Files entry and exact real file contents; reload restoration                |
| proof/update-proof.json                                             | Installed 1.0.0 → 1.0.1 update preserved selected file                               |
| proof/two-client-lifecycle.json                                     | Restart plus cross-client disable/enable/rollback/update passed; zero page errors    |
| proof/file-switch-comparison-final.json                             | 20 paired file switches per implementation, identical fixture text                   |
| proof/files-1.0.1.png                                               | Visually inspected installed renderer                                                |
| proof/baseline-files.png                                            | Original built-in renders the same fixture                                           |
| claude-review-receipt.json                                          | Direct Opus 5 high launch exited 1 before review because OAuth expired               |

The foreground comparison measured median 268 ms / p95 303 ms for the built-in and median 70 ms / p95 103 ms for the read-only plugin. This is browser automation wall time on two tiny fixture files, not a general performance or full feature parity claim. Each page was foregrounded before its sample. The original background-tab measurements are retained separately because browser throttling materially changed them.

The baseline comparison uses the same production source and separate state with no installed plugins. It does not claim the historical baseline commit was built for this comparison. Older wrapper parity artifacts remain historical evidence only and do not prove the new public API path.

## What remains unproven or impossible with current contracts

- Full Files replacement: editing/conflict receipts, full virtual tree/search/reveal-line UX, media/attachment leases, composer annotations and external editor integration.
- Browser, Terminal, Diff, Version Control and Agents are not yet independent public-API replacements. Their existing wrappers are not counted.
- Most shared APIs in the architecture catalogue remain planned, including orchestration mutations, generic resource streams/native engine attachment, composer enrichment and clipboard.
- Secure execution of untrusted JavaScript is not implemented. Packages currently execute as trusted Node/client code; broker grants do not sandbox ambient access.
- React Native and SwiftUI do not have equivalent plugin renderer hosts.
- Live relay/tunnel operation and complete V2 adapter parity are not established. V2 differences and unsupported settle operations are documented separately.
- Independent Astra reviews ran and found issues that were fixed. Claude did not perform a review; the direct launch failed authentication.

Final implementation includes explicit navigation identities, per-API presentation isolation, permission replacement and host invocation metadata. Generation tokens use a cryptographic 48-bit boot seed and fail closed before numeric exhaustion; they are temporary concurrency tokens and require rediscovery after restart. They are not durable resource identities. The final installed UI rerun is recorded separately from earlier source contexts.

The final comparison restarted both candidate and no-plugin baseline against the final production bundle. The final two-client test waits for successful public reads at the exact installed content hash after rollback/update. Permission and uninstall tests use actual Settings actions and observe the other clients without manual refresh. All passed with zero page errors. A failed final harness attempt selected an existing Settings page instead of the Files page; its timeout is preserved in proof/two-client-lifecycle-final-wrong-page.json, and the corrected target passed. Earlier stale workspace-context and background-throttling evidence is retained rather than substituted with final results.
