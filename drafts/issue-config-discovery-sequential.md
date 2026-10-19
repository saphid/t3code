### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

### Area

apps/server

### Steps to reproduce

1. Run a server on a loaded machine, where spawning processes and walking PATH are slow.
2. Connect a client. Every connect (and reconnect) calls `server.getConfig` / `subscribeServerConfig`, which is built by `loadServerConfig` in `apps/server/src/ws.ts`.

### Expected behavior

The config snapshot a client waits on to connect does not wait on host discovery that has already succeeded recently, and independent discoveries do not add up.

### Actual behavior

`loadServerConfig` runs editor discovery, then file-manager reveal discovery, then remote open target discovery (sshd and tailscale probes), one after another. Each has its own 5 second timeout (`CONFIG_DISCOVERY_TIMEOUT`), so the snapshot can wait up to 15 seconds on discovery alone, which is the client's whole connect budget. Editor discovery is cached for 60 seconds, but after expiry the next connect waits for a full rescan. File-manager and remote-target discovery are not cached at all and run on every connect.

During an incident on a loaded machine, editor PATH probing hit its 5 second timeout inside `subscribeServerConfig` while clients were timing out their connections.

### Impact

Major degradation or frequent failure

### Version or commit

upstream/main @ 0cf482b08bc (`apps/server/src/ws.ts` `loadServerConfig`, `apps/server/src/process/externalLauncher.ts`, `apps/server/src/environment/RemoteOpenTargets.ts`).

### Environment

macOS 26 (Darwin 25.5), background service, load average 30 to 40 at the time.

### Logs or stack traces

Server trace spans inside `subscribeServerConfig`: `resolveAvailableEditors` ending at its 5 s timeout during the reconnect loop.

### Workaround

None on the client side.
