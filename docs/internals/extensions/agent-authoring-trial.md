# Extension authoring trial with Luna workers

This is an implementation-quality experiment, not a claim that all native panels can already
be replaced. The parent assigns a bounded slice to a fresh Luna medium builder and a separate
Luna medium monitor on lxso2. The monitor reports source and receipts; the parent validates
findings, decides architecture, integrates and runs installed proofs.

## What the experiment established

Independent packaged provider and consumer workers can use format-3 streams through declared
dependencies. Closing a view, dependency update/rollback/removal, grant revocation and
reinstallation were exercised through the installed app. A read-only Files presentation
replaces the ordinary Files entry through public workspace and presentation APIs.

An additional live test found that the existing authenticated WebSocket stayed authorized
after session revocation. The new extension-stream guard terminates a silent pending stream,
denies another subscription on the same open socket, and leaves a different login working.
A raw WebSocket was necessary to prove host enforcement independently of client logout.

## Observed mistakes and concrete changes

| Observation                                                                                                          | Correction                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A worker reported edits before the file changed.                                                                     | Require exact checkout, source hashes, command and real exit; prose is not evidence.                                           |
| A reviewer audited an older worker checkout and found already-fixed documentation gaps.                              | The monitor checks target identity before accepting any finding. Preserve rejected reports with their reason.                  |
| A reviewer inferred that Stream.toPull returns one event. The vendored API returns a nonempty chunk.                 | Read the installed/vendored signature and implementation before changing code based on remembered semantics.                   |
| The parent assumed creating a pull acquired the auth subscription. A removal between check and consumption was lost. | Add an explicitly acquired watch and a test that revokes inside admission.                                                     |
| An awaited consumer return resolved before provider cleanup.                                                         | Add bounded host/worker settlement acknowledgement and an independently queried consumer-status test.                          |
| Closing a stream killed shared producer state.                                                                       | Verify close/reopen against a stateful independently packaged provider, not only event receipt.                                |
| Provider update ended a stream but left the dependent view showing stale data.                                       | Include the transitive dependency/provider closure in client lifetime; retain unrelated viewers.                               |
| A Files retest assumed a saved Files tab existed in a counter-only layout.                                           | Open through the ordinary Add panel surface entry; verify actual public API responses and exact file bytes.                    |
| A worker looked for a checkout-local heavy-test lock and bypassed the shared lock.                                   | Give the absolute fleet lock path in every assignment; record the actual launcher.                                             |
| Long default test timeouts made an intentionally exposed race slow to diagnose.                                      | Use a bounded diagnostic timeout and a captured subprocess/supervisor; success still depends on receipts, never elapsed time.  |
| A Terminal proposal reused an attach method that can spawn/resize and a snapshot up to 8 MiB.                        | Require exact native signatures, domain scope, an existing-only seam and bounded no-gap snapshot chunks before implementation. |
| A root test counted validation calls and a stream root was captured only when iteration began.                       | Use provider-driven revocation state; capture authority before returning the iterable and test mutation in that gap.           |
| Monitor reports mixed historical failures with newer results.                                                        | Number receipts and keep one explicit final evidence manifest. Never erase useful failed attempts.                             |

## Required improvements to the authoring experience

Keep one public SDK entry guide with installable examples, exact tools/API handler parity,
client-versus-worker subscription signatures, lazy admission, bounds, awaited cleanup and
dependency invalidation. Examples should additionally demonstrate discovery/generation checks
and explicit reset/closed handling; the current counter is deliberately narrower.

A native-panel task must identify the callable APIs it needs before implementation. If an
operation is absent, report a concrete missing contract rather than importing private React
components or substituting a different engine. A package that installs but cannot perform
the domain operation is not an accepted replacement.

Future rounds need real Terminal/Browser resources, asset/native engine access, authenticated
root propagation, MCP lifetime, durable owner/epoch/lease identities and domain scopes.
Performance claims need comparable workloads and retained baselines. The small read-only
Files comparison is not evidence of full editing/media/tree or general performance parity.

## Current evidence

On lxso2, /home/saphid/artifacts/t3-extensions-health-rounds-20260909 contains
stream-v9-evidence.json and session-authority-evidence.json, plus source hashes and all
historical failures. Stream runtime: 71 tests including real Electron; published consumer: 2;
web stream/dependency: 21; SessionStore: 23; session guard: 8. The root-propagation addition
is now verified separately: runtime 80/80 (including nine root tests), server root 5/5,
forwarding 10/10 and HTTP 3/3; lint/types/build 0. Installed v11 proof verifies linked
consumer/provider audit identity, revocation and the existing Files replacement.
Artifacts: root-authority/, proof/auth-session-root-v11-candidate.json, proof/files-proof-v11.json.

## Terminal metadata authoring round

The fresh Luna builder repeatedly ended its turn with focused execution tests passing while
required cases, types or lint were still missing. The parent sent it back with exact remaining
gates. Executed JavaScript tests hid an unavailable vitest import, unbranded fixture IDs,
incomplete principal types and an unexported host provider type. Public HostApiProvider is now
an additive runtime type export; adapters must not reach into private broker modules.

The first provider returned null for a workspace mismatch and did not pass AbortSignal into
Effect.runPromise. Parent review required explicit unavailable errors and acquired/cleanup
receipts for cancellation. A scheduler yield and immediate abort are not settlement evidence.
Tests must mutate native/repository state, rather than depend on validation call counts.

The parent initially omitted the new example from the SDK package files list. A test installing
the actual tarball in an external directory caught the missing files; source-tree tests did not.
The fixed packaged test validates the included manifest/handler and compiles typed inspection,
including rejected control methods and cwd fields.

Monitor findings sometimes referred to source that had changed before delivery. The parent
checked current source and withdrew those findings. Future reports should include the exact
file hash and relevant excerpt. Evidence paths need the provided absolute location: the
builder initially chose a different date directory. Keep historical attempts and one canonical
final manifest. The installed v12c native proof now passes, including its view; a metadata view is not an
interactive terminal replacement. A failed UI attempt used the native Add panel menu instead
of Extensions; preserve it and point the monitor at the explicit final manifest.
