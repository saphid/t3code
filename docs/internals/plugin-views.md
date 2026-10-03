# Plugin views

A plugin with the `views` capability ships UI as views: one script, and optionally one stylesheet, per view, declared under `views` in `t3-plugin.json`. Views are plugin code running on the user's client, so they get none of the client's authority. The contract lives in [pluginViews.ts](../../packages/contracts/src/pluginViews.ts). The server half is [PluginViews.ts](../../apps/server/src/plugins/PluginViews.ts) and the shared host half is under [client-runtime/src/pluginViews](../../packages/client-runtime/src/pluginViews/).

## Delivery and revocation

- Bytes travel only over the authenticated environment RPC (`pluginViews.readBundle`). No URL, lease or second hostname exists, so local, LAN, Tailscale and T3 Connect all reach views the same way.
- The server reads a view's files once per installation generation. It reads them after consent and then takes a fresh digest of the whole directory, which must still equal the consented digest. A mismatch serves nothing and makes the catalogue disable the installation.
- The installation generation is the revocation epoch. Disable, remove, a byte change or a re-enable ends it, and the server refuses fetches and calls for an ended generation. Clients tear down a mount when its `(installationId, generation, viewId)` leaves the views snapshot.
- Code that is already running stops only at teardown, and bytes already fetched are not recalled.

## Isolation

- Each view runs in a sandboxed `srcdoc` frame without `allow-same-origin`. That frame sits inside a script-free wrapper frame, and the view document's CSP lists exactly two scripts by SHA-256: the host bootstrap and the view.
- The browser checks those hashes against the text it parses. That is the integrity check, so hosts do not hash anything themselves and views need no secure context.
- Script text must avoid CR, NUL, `<!--`, `<script` and `</script`, because the HTML parser would change it. The server refuses such bytes instead of escaping them.
- A frame's own CSP cannot stop the frame navigating itself. Each host therefore needs an embedding-side policy:
  - Web: the wrapper's `default-src 'none'` refuses network and `data:` navigations.
  - Desktop: also veto view-frame navigations in the main process (`will-frame-navigate`).
  - iOS: the host is a dedicated WebView whose main frame is a trusted host page ([pluginViewHostPage.ts](../../apps/mobile/src/features/plugins/views/pluginViewHostPage.ts)); the page creates the wrapper and relays the view's port to the bridge in React Native. The `react-native-webview` patch, enabled only on that WebView by `t3RestrictSubframes`, decides subframe navigations from `WKFrameInfo` and drops script messages that do not come from the main frame. The message handler stays visible to subframes; the point is that it has no authority there. The patch marks the main frame. The page reports that marker as its first message, before any other frame exists, and React Native sends the view's document only after a positive report; a build without the patch never receives the view, and any later report revokes it. A marker read after the view has run would prove nothing, because without the patch every frame can post to native.
- Nothing on web or desktop stops a view replacing itself with an inert `about:blank`. Hosts must treat a missed ping as the view dying.
- Views inherit the app document's CSP and can only narrow it. Never widen the app CSP for views; a host page that forbids inline script or `srcdoc` frames cannot show them.
- Android is unsupported until its WebView passes the iOS-equivalent checks.

## Bridge

- The bridge is one MessagePort per mount, carrying JSON text messages only.
- Authority comes from the host's binding of the port (environment, installation, generation, view), never from message fields. A view's call reaches only its plugin's `view:<viewId>:<handler>` handlers, with `orchestration:operate`.
- Bounds, budgets, liveness, and cancellation on close are enforced in [viewBridge.ts](../../packages/client-runtime/src/pluginViews/viewBridge.ts).
- An iframe is not a process or CPU boundary: a view stuck in a loop can stall the client that hosts it.
