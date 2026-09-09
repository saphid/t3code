# Bounded terminal output snapshot

Status: frozen design before implementation, based on 752a3f66468cf125d61417899de9dc2cd69e90c5.
This is an explicit read of retained history for plugins and models. Live output streaming,
interactive rendering, replay cursors and resource leases remain separate work.

## Contract and authority

Add a separate catalogue API t3.terminal/output version 1.0.0 with readSnapshot.
Keep t3.terminal/sessions version 1.0.0 unchanged. Input is exactly terminalId, length 1..128.
Require a new grant t3.terminal/read-output. A plugin granted metadata inspection alone
must not acquire access to terminal contents after an update.

Return null if the in-memory session is absent; otherwise return exactly terminalId, contents,
retainedByteLength and truncated. contents is the longest complete-code-point suffix of the
native retained history that fits 8192 UTF-8 bytes (and at most 8192 UTF-16 units).
retainedByteLength is the UTF-8 byte count of that retained history before this tail limit,
a nonnegative safe integer. truncated means this response omitted a prefix of retained history.
The native history has its own line/byte retention and sanitization: false does not assert
that all output ever produced by the process is present. Empty existing history is distinct
from an absent session. Do not expose cwd, PID, launch environment or controls.

Native callbacks may temporarily retain an unmatched UTF-16 surrogate between split appends.
For this new UTF-8 observation, normalize unmatched surrogates in the selected bounded tail
to U+FFFD, matching Node's UTF-8 encoding of those native code units. Do not mutate retained
history: a later low-surrogate append can still repair the source pair. This normalization
does not change the maintained UTF-8 byte count, and valid pairs remain intact. Test the
intermediate unmatched read and the later repaired read separately.

The fixed byte cap leaves room for worst-case JSON escaping within the existing 64 KiB
API result bound. Test ASCII, multibyte, surrogate-pair boundaries and escaped controls.
This is a replaceable point-in-time observation of the current logical terminal ID. It is
not a resource handle, durable identity, replay cursor or authorization for a later action.
A later explicit read may observe a restarted/reopened terminal with that same ID.
Clients replace displayed text; they must not append successive snapshots as live output.

Host provider t3.host-terminal-output opts into requiresRootAuthority and requires the
verified login's AuthTerminalOperateScope independently of the new plugin grant.
Require a thread and matching environment/project/thread/workspace scope, matching native
cwd/worktree mapping, and revalidate scope before and after reading. Preserve cancellation
and sanitized errors. HTTP retains access:write transport authority. Rootless access fails.

## Native read seam

Add TerminalManager.readOutput({threadId,terminalId}) as an existing-only in-memory read,
returning the bounded tail and host-only scope fields needed by the adapter. Never call open,
attachStream, launch resolution, restart, resize, persisted-history restoration or process I/O.
Exited sessions remain exited. Capture the contents and metadata synchronously from the same
session reference after lookup; do not reconstruct a session or pretend this allocates a lease.

Add a bounded tail accessor to BoundedTerminalHistory. Traverse only the tail chunks/code
points needed for the limit and use its maintained total byte count. Do not join, encode or
scan the entire retained 8 MiB history for each small read. Preserve existing append, trim,
value and native retention behavior. Test split surrogate-pair appends and trim/clear state.

## Ownership and proof

Luna builder owns Manager.ts/tests, SDK catalogue types/schema/tests, and a separate
terminalOutputApi.ts/provider test. Parent owns EnvironmentExtensions registration/fixtures,
independently packaged output consumer, published-package verification and installed proof.
A separate Luna monitor watches actual source/evidence and reports current hashes and gaps.
All code/tests/builds remain on lxso2 under the shared heavy-check lock.

Tests compare exact tail bytes against the existing native snapshot, prove no process create/
restart/resize/history mutation, and cover missing, exited, reopened and cleared sessions.
Provider tests deny missing domain scope/root, metadata-only grant in the broker consumer,
wrong environment/thread/workspace, extra fields, invalid bounds, late scope changes and
cancellation. Tail tests use real retained history and meaningful boundary cases; an
instrumented forbidden value() call proves the new accessor does not flatten all history.

The independently installed package must call its own namespaced worker API, then the public
host provider, and show the actual bounded output with explicit read controls. Grant removal,
missing terminal permission and close must produce denied/absent states; no polling, terminal
input or silent reopen. Compare native and public results and retain timings without claiming
interactive performance parity. Keep the existing metadata package and v13 proof as baseline.

The source-backed stream research remains relevant: attachStream can mutate a PTY, buffers
without a bound while awaiting listeners, and does not establish all control/output ordering
or session-reuse cases. This unary slice does not solve or conceal those stream requirements.
Native Terminal remains a wrapper until output/input/resources/assets and all parity gates
are implemented and proven.

## Verified snapshot slice

The independently installed example.terminal-output package now reads an actual native PTY
through its own namespaced worker API and the selected public host provider. Exact Unicode
tail contents, retained byte count, PID and unchanged native history matched. Metadata-only
plugin grants were denied, as was an otherwise granted plugin whose login lacked terminal
permission. Revocation denied another read; regrant restored it; close remained absent.
The installed UI supports keyboard submission and displays the exact returned text. Delivered
client bytes match the independently packaged source. This text view preserves ANSI escape
sequences; it is not a terminal engine. The fixture shell's missing-completion startup warning
appears in both native and plugin history and was not changed by this work.

Verification on lxso2: 129 focused server tests (90 native Manager and 10 new output-provider
tests), 32 SDK tests, 87 runtime tests including real Electron, published external consumer
2/2, server typecheck and v14 production build passed. Scoped lint has zero new warnings;
the native Manager test file retains one pre-existing warning. Installed v14 Files,
metadata and root-session proofs also passed. All child/process exits and source hashes are
retained in terminal-output/evidence.json and LATEST.json under
/home/saphid/artifacts/t3-extensions-health-rounds-20260909.

The Luna monitor found no actionable findings in the corrected bounded source and installed
proof. A direct Claude Opus 5 high launcher exited 1 before any model ran because OAuth could
not refresh. Earlier weak test setups and the Unicode traversal defect are retained in the
authoring observations. Full native Terminal replacement remains explicitly unproven.
