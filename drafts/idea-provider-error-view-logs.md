### Problem or use case

When a provider turn fails, the thread error banner tells the user to "check the provider setup and server logs". It does not say where those logs are, and nothing on the banner leads there. On desktop the logs are files under the T3 home. On a remote server (app.t3.codes, mobile, Tailscale, T3 Connect) the user may not have shell access to that machine at all.

The server already exposes these logs to clients. Settings > Diagnostics shows "Latest Failures" and "Span Logs" from the server trace over the WebSocket, including the full error cause. Users who don't know that page exists can't use it.

### Proposed solution

Add a **View logs** inline link to the thread error banner when the error came from the server. It opens Settings > Diagnostics with that thread's environment selected. It uses the same inline-link style as the provider status banner's "Open provider setup".

### Why this matters

Every provider failure banner asks the user to check logs. A link to them turns a dead end into one click, and it works for remote clients because Diagnostics reads through the server connection, not the local filesystem.

### Smallest useful scope

- Web and desktop thread error banner only. The link shows for server-reported errors other than usage limits.
- No new server API, contract, or log format. It reuses `/settings/diagnostics?machine=<environmentId>`.
- Non-goals: deep-linking to the matching log row, a mobile Diagnostics screen, or changing what gets logged.

### Alternatives considered

- **Print the log file path in the message.** This is useless for remote clients and leaks machine paths into the UI.
- **Add an "Open logs folder" action.** This only works when the client runs on the server's machine. Diagnostics already offers it there.
- **Show the full cause inline.** Raw causes can contain provider text and credentials. The server deliberately shows only adapter-written reasons (see the related PR below).

### Risks or tradeoffs

One extra link in an existing banner, with no performance cost. Mobile doesn't get it because it has no Diagnostics screen. If Diagnostics later moves, the link has to follow it.

### References

- Related: #16303 (server fix: provider failures name the adapter's reason)
- Related: #14969 (session-open failures show the provider's reason)

### Contribution

I have the change ready on a branch (`feat/provider-error-view-logs`, stacked on the PR above) and will open it once the direction is approved.
