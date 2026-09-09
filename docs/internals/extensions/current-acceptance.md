# What the extension system currently proves

This is an acceptance record, not a completion announcement. Implementation and evidence live
on lxso2 in /home/saphid/projects/t3-extensions-integration. Latest verified slice: host-operation authority, based on checkpoint
e1593b07e754776b3fd0f87f6876799b20d3f962; exact final hashes and commit receipt are in
operation-authority/evidence.json and commit.json under the evidence root below.

## Plain-English status

An installed plugin can define its own API, call another plugin or an authorized host API,
and render an independent view. Versions, dependencies, provider selection, grants and
lifecycle are enforced. The Files entry can show an installed read-only Files implementation.
A separate installed Terminal status package can inspect a real existing terminal. Those are
working examples, not proof that every existing panel has been replaced.

| Surface         | Proven installed behavior                                                                                                            | What still prevents full replacement                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files           | Ordinary Files entry uses public file presentation and workspace APIs; exact text and selection survive reload.                      | Editing/save recovery, full tree/media/Markdown/comments/attachments/editor actions and large-file parity.                                                      |
| Diff            | Existing native panel remains available.                                                                                             | Its data and renderer bindings have not been replaced by an installable public API consumer.                                                                    |
| Version control | Existing native panel remains available.                                                                                             | Public source-control operations, authorization/receipts and an independent replacement are still missing.                                                      |
| Browser         | Existing native panel remains available.                                                                                             | Public browser/native-engine resources, connection ownership, lifecycle and renderer parity remain unimplemented.                                               |
| Terminal        | An independently installed status view calls its own worker API, then a native metadata provider; real PTY identity stays unchanged. | Interactive output/input, resize/restart/close, durable resources, attachment leases and packaged Ghostty assets. The native Terminal panel is still a wrapper. |
| Agents          | Existing native panel remains available.                                                                                             | Public orchestration/harness status and authorized control APIs, receipts and an independent renderer are still missing.                                        |

## Framework and authority evidence

The installed stream provider and consumer survive ordinary open/close, grant revocation,
provider update/rollback/uninstall/reinstall, and dependency-driven view replacement.
Counters deliberately reset after server restart; they do not demonstrate durable plugin
domain state. Installations, grants, package hashes and compatible view restoration are separate.

Authenticated HTTP/WS API calls retain immutable root identity through nested plugin calls.
Revoked/expired sessions are rejected; a silent extension stream is stopped on revocation
without relying on UI logout. A different login remains usable. Native Terminal metadata
additionally requires the login's terminal permission, independently of the plugin grant.
Legacy tool/MCP roots and native resource authority are not fully implemented.

The host-operation callback now rechecks authority before a native side effect and expires
when its call closes. Seven focused cases prove its lifetime and revocation behavior.
File editing remains a
proposal until revision checks, safe replacement and recoverable operation receipts are proven.
A socket or API name is never counted as native-panel parity.

## Retained evidence and limits

Canonical root: /home/saphid/artifacts/t3-extensions-health-rounds-20260909.
Use operation-authority/evidence.json and LATEST.json for the latest slice, together with
proof/terminal-metadata-v13.json, proof/files-proof-v13.json and
proof/auth-session-root-v13-candidate.json. terminal-metadata/evidence.json and
proof/terminal-installed-source.json retain the earlier native adapter and delivered-package proof.
Historical failed attempts remain beside final receipts; do not mistake them for the latest run.

Verification retained from the Terminal checkpoint: 112 focused server tests and 32 SDK tests.
The latest host callback runs 87 runtime tests including real Electron, seven operation cases,
published external consumer tests, scoped lint, server typecheck,
production build and the installed proofs. A ten-sample metadata comparison measured roughly
13 ms through HTTP/nested plugins versus 1 ms for the native lookup; transports/payloads differ
and this is not an interactive terminal performance claim.

The Luna builder/monitor process found real bugs and missing validation gates. Parent review
and exact command exits were necessary; worker completion prose alone was unreliable.
Direct Claude Opus 5 high review attempts exited 1 before any model ran because OAuth could
not refresh. No independent Claude review is claimed.

Remote work was performed on lxso2. Browser-origin portability does not establish relay/tunnel
or multi-environment parity. Web and server tests do not establish React Native mobile,
SwiftUI mobile, Windows, macOS native engines or Orchestra V2 parity. No PR, push or deployment
has been performed for these checkpoints.
