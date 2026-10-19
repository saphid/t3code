### Before submitting

- [x] I searched existing issues and did not find a duplicate.
- [x] I included enough detail to reproduce or investigate the problem.

### Area

apps/desktop

### Steps to reproduce

1. Connect a client (desktop, web or mobile; the logic is in `packages/client-runtime`) to a server that is slow to build its first config snapshot. In my case this was a server restarted cold with a 32.8 GB database on a loaded machine, where synchronous SQLite reads made `subscribeServerConfig` take longer than 15 seconds.
2. Watch the connection.

### Expected behavior

Once the websocket is open and the server is answering, the client waits for the first config snapshot instead of dropping the connection.

### Actual behavior

`EnvironmentSupervisor` gives each attempt one 15 second budget (`CONNECTION_ESTABLISHMENT_TIMEOUT`) that covers credentials, session creation, the socket open, and the first config snapshot. When the snapshot alone takes longer, the attempt times out, the working socket is torn down, and the client retries with backoff. The server is no faster on the next attempt, so the client loops: connect, socket up, timeout, retry. In my traces `ConnectionDriver.connect` was interrupted on every attempt for about 10 minutes, until the server warmed up.

### Impact

Blocks work completely

### Version or commit

Seen on a 0.0.42 nightly desktop build; `packages/client-runtime/src/connection/supervisor.ts` is unchanged on upstream/main @ 0cf482b08bc.

### Environment

macOS 26 (Darwin 25.5), desktop app connected to a local background service.

### Logs or stack traces

Client traces (`ConnectionDriver.connect` spans) showed `status.interrupted: true` for each attempt; server traces showed `subscribeServerConfig` and the discovery spans inside it (`resolveAvailableEditors` at its 5 s timeout, `ServerSecretStore.get` 8 s, a trivial `reportClientActivity` 9.8 s) while the event loop was blocked.

### Workaround

Wait for the server to warm up, or restart it when the machine is less loaded.
