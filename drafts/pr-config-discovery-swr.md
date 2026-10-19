## Problem

Every client connect builds the server config snapshot (`loadServerConfig` in `apps/server/src/ws.ts`). Building it runs editor discovery, then file-manager reveal discovery, then remote open target discovery (sshd and tailscale probes), one after another, each with a 5 second timeout. On a loaded host the snapshot can wait up to 15 seconds on discovery alone, the client's whole connect budget. Editor discovery is cached for 60 seconds but rescans inline after expiry. The other two run on every connect. Fixes #14517.

## Change

- New `makeStaleWhileRevalidate` (`apps/server/src/environment/staleWhileRevalidate.ts`). The first call computes inline. After that, callers get the last good value immediately. Once it is older than the TTL, one background refresh replaces it.
  - Only successes are stored, so an interrupted caller cannot poison the cache. This is the same reason the old editor cache avoided `Effect.cachedWithTTL`.
  - Refreshes are forked into the layer's scope, so shutdown interrupts them. Each is capped at 30 seconds.
  - Claiming a refresh and forking it happen in one uninterruptible step.
- Editor discovery, file-manager reveal discovery and remote open targets use it with a 60 second TTL. That is the existing editor TTL, so discovery runs no more often than today.
- `loadServerConfig` runs the editors-then-file-manager chain and remote target discovery concurrently.

Result: a cold first connect waits at most 10 seconds on discovery instead of 15. After the first success, connects do not wait on discovery at all. A newly installed editor shows up within one TTL, as before.

## Scope and approval

Fixes triaged bug #14517. Server-only: no contract or client changes. The snapshot shape is unchanged.

## Verification

- New `server.test.ts` case "runs editor and remote open target discovery side by side for server config". Each discovery finishes only after the other has started, so a sequential `loadServerConfig` never resolves. On main it times out. Here it returns the expected editors, file-manager kind and targets.
- New `staleWhileRevalidate.test.ts` (5 tests):
  - it computes inline once, then answers from memory until the TTL lapses;
  - it serves the stale value while one background refresh replaces it;
  - an interrupted first computation is not cached;
  - a hung refresh is abandoned, so a later call can start another;
  - closing the owning scope interrupts a background refresh.
- `externalLauncher.test.ts`: the editor cache test now checks that a call after expiry still returns the cached editors immediately, while a background rescan runs.
- `vp test run src/environment/staleWhileRevalidate.test.ts src/process/externalLauncher.test.ts src/environment/RemoteOpenTargets.test.ts src/server.test.ts` in apps/server: 260 passed, 1 skipped. `apps/server` typecheck clean; lint and format clean on the changed files.
- Not measured against a live loaded host. The 15 s and 10 s figures are the sums of the existing 5 s timeouts.

Implemented and tested by Claude Sonnet 5.5 and Claude Opus 5.5 in Claude Code, running inside T3 Code. Reviewed by GPT-6 Astra.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
