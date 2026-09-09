# Existing terminal metadata: bounded implementation slice

Status: frozen design before code, 2026-09-10. Extends terminal-capability-plan.md.
The generic stream/root prerequisites are now implemented; this slice intentionally proves
one real native read capability before output resources, leases or a terminal renderer.

## Public contract

Export the existing HostApiProvider type from the public runtime entry so adapters do not
import private broker modules. This is a type-only additive export.

Add catalogue API t3.terminal/sessions version 1.0.0, initially only inspect.
Grant t3.terminal/read is required. Input is exactly { terminalId: string }, length 1..128.
Thread/project/environment/workspace revision come from the validated ViewContext, not input.
Output is null for an absent live session, otherwise exactly terminalId, status
(starting/running/exited/error), label (max 128, matching native TerminalSummary), hasRunningSubprocess (boolean), exitCode
(integer or null), exitSignal (integer or null), updatedAt (string max 64).
These are bounded observations, not a durable resource handle or a control receipt.
Do not expose full history, cwd/worktree, pid, environment variables or process control.

Host provider t3.host-terminal opts into requiresRootAuthority. It additionally requires the
verified principal environment to match and scopes to contain AuthTerminalOperateScope,
including for reads. Generic orchestration:read does not authorize terminal access.
HTTP retains the conservative access:write transport requirement as well.
Plugin registration/grant alone never supplies terminal authority.

Resolve scope using the existing host project/thread resolver before and after the native
read. Require a thread. The native session's threadId/terminalId must match. For this first
local workspace adapter require its cwd to equal the resolved launch cwd and its worktreePath
to equal the validated thread worktree path (null preserved). A moved workspace or unsupported
provider launch mapping is unavailable, never guessed. Generic broker revocation/generation/
bounded result/cancellation checks remain in force.

## Native seam and implementation ownership

Expose TerminalManager.inspect({threadId,terminalId}) using the existing readTerminalMetadata
helper returning TerminalSummary|null. It only reads in-memory state. It must never invoke
open, attachStream, spawn, restart, resize, prepare environment, restore history or mutate a PTY.
Missing/exited sessions remain missing/exited. No new wire terminal RPC is needed.

The Luna builder owns the native seam and meaningful manager tests; typed SDK catalogue
definition; terminalApi.ts adapter and focused tests. Parent owns EnvironmentExtensions
registration/fixture integration, an independently packaged consumer example, installed
proofs and design decisions. A separate Luna monitor checks scope and reports defects.
All work/tests/evidence remain on lxso2; use the absolute shared heavy-test lock.

## Acceptance and limits

Manager tests compare metadata to native open/exit state and prove inspect never creates or
resizes a terminal. Provider tests check terminal domain scope, rootless/environment/thread/
project/workspace mismatch, missing session, unknown input fields, bounded output, post-read
scope changes and cancellation. The installed independent package must call the host API
through a declared dependency, with missing terminal scope denied before native access and a
properly scoped login returning actual native metadata. Compare against an existing native
terminal snapshot; verify PID/process state unchanged through observation in the host test.

Full Terminal output, input, resize, restart, close, resources/epochs, attachment ownership,
assets/Ghostty packaging, multi-client behavior and native-panel replacement remain unproven.
A metadata consumer is not a terminal replacement. Native RPCs remain intact; no private
component wrapping is added. Future observation streams need bounded UTF-8-safe snapshot
chunks, a no-gap sequence boundary and explicit cursor reset semantics; attachStream's
existing implicit spawn/restart/resize modes cannot be reused unchanged.

## Verified slice

On lxso2 the installed example calls its own namespaced worker API, which consumes the
selected t3.terminal/sessions host provider. A login without terminal:operate was denied
despite the plugin grant; a properly scoped login observed actual native terminal metadata.
The native PTY PID stayed the same, absent/closed sessions remained absent, and the visible
status view worked through the Extensions menu. Keyboard activation and empty-input disabled
state passed. The example uses its own semantic controls; no private app component is imported.

Focused verification: 112 server tests (including 83 native TerminalManager tests and 11
provider tests), 32 SDK tests, external published-package consumer, server typecheck and v12
production build passed. Scoped lint had zero errors and one pre-existing native test warning.
The prior installed Files exact-content/reload and root session revocation proofs passed again.
Full native Terminal replacement and resource/stream/control parity remain outside this slice.

Evidence: /home/saphid/artifacts/t3-extensions-health-rounds-20260909/terminal-metadata,
proof/terminal-metadata-v12c.json and screenshot, proof/files-proof-v12.json,
proof/auth-session-root-v12-candidate.json. The original v12 menu timeout is retained; the
test used Add panel surface instead of the installed Extensions menu. v12b corrected the
route and v12c verified the updated installed example with readable spacing and keyboard use.

Ten local round-trip samples had medians around 1.3 ms for native existing-terminal open and
12.6 ms for HTTP plus nested plugin metadata inspection. They return different payloads and
use different transports, so these samples show adapter overhead, not general throughput or
interactive-terminal parity. No polling loop was introduced.

A direct Claude Opus 5 high read-only review launch exited 1 because OAuth was expired and
refresh failed; no Claude model ran. The Luna monitor independently reviewed current source
and proof evidence. All source/build/test work remained on lxso2.
