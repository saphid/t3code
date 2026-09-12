# t3.resources/lease — promoted binary/media presentation contract (parent design)

Status: DRAFT v1 (monitor-authored, 2026-09-12). Blocks: P05 media slice, P08-B Browser engine
attachment, P16 Devices. Implements the "promoted binary/media lease channel" tranche item
(ROADMAP §3b) and the ResourceRef+lease requirement in browser-capability-plan.md:35-41.

## Key discovery: native already has 80% of this

The main repo ships a signed-token asset channel that IS the ResourceRef+lease pattern:

- **RPC** `WS_METHODS.assetsCreateUrl` (apps/server/src/ws.ts:1700, auth
  `AuthOrchestrationReadScope` at ws.ts:321) takes an `AssetResource` union and returns a
  signed URL.
- **ResourceRef** = `AssetResource` (packages/contracts): kinds `workspace-file`
  (thread-scoped → resolves project workspace root via projection),
  `workspace-file-exact`, `attachment` (resolveAttachmentPathById), `project-favicon`.
- **Lease** = HMAC-signed base64url claims `{version, kind, …, expiresAt}`, TTL 1h
  (`ASSET_TOKEN_TTL_MS`, AssetAccess.ts:44), key in ServerSecretStore, timing-safe verify.
- **Route** `GET /api/assets/*` (apps/server/src/http.ts:181): no session on the route —
  the signed token IS the auth, which is exactly what `<img>`/webviews need (they cannot
  set headers). Serve-time re-resolves the canonical path inside the workspace root
  (realpath both sides, rejects outside-root), `nosniff`, `Cache-Control: private`.
- **Stream-variant auth** already exists too: DeviceHubProxy.ts:84 authenticates `<img>`
  and WebSocket upgrades via cookie **or short-lived `wsTicket` minted over authenticated
  HTTP** — the upgrade authenticator doubles as the plain-request one.

So this contract does NOT invent a channel. It (a) exposes the existing mint over the
extension broker with per-kind grants, and (b) adds claim kinds when consuming slices ship.

## Contract proposal: `t3.resources/lease@1.0.0`

One method, one stream-free surface:

```
createPresentationUrl(resource: ResourceRef) → { url: string, expiresAt: number }
```

- **ResourceRef (v1)**: reuse the AssetResource union verbatim — `workspace-file`
  (threadId + path), `workspace-file-exact` (workspaceRoot + path), `attachment`
  (attachmentId), `project-favicon`. Host-generated opaque IDs where they exist
  (attachmentId); path-based refs stay path-based (native does the same).
- **Two lease classes**, distinguished by the claim kind, not by the method:
  - `http-asset` — 1h TTL, cacheable, for `<img>`/webview file presentation
    (workspace-file, attachment, favicon). This is today's behavior, unchanged.
  - `ws-stream` — one-shot, short-lived ticket bound to a single upgrade attempt
    (DeviceHubProxy wsTicket semantics). v1 ships NO ws-stream kinds; `browser-surface`
    arrives with P08-B, `device-stream` with P16, each with its own decision record.
- **Grant map (mint-time authority)**: each kind maps to exactly one extension grant —
  workspace-file → `t3.workspace/resources` read (the deferred P05-B contract; until it
  lands, workspace-file kinds are unavailable to plugins and the adapter fails closed);
  attachment → the messages/composer read grant when it exists. Mint-time is the only
  grant check; serve-time is token-only (documented, matches native, required by `<img>`).
- **Lease semantics** (from browser-capability-plan.md:37, now binding): a lease binds
  resource + resource epoch + rights to the authenticated principal and caller chain; a
  serialized handle alone grants nothing; renewal = call again; revocation = expiry, and
  installation replacement/revocation/owner failure invalidate affected leases (v1
  implements this as: tokens are not re-validated against installation state mid-TTL —
  recorded as an accepted gap with the 1h bound, matching native).

## What the host must add

1. Extension adapter `apps/server/src/extensions/resourcesLeaseApi.ts`: broker-exposed
   `t3.resources/lease.createPresentationUrl` wrapping `issueAssetUrl`, per-kind grant
   enforcement, thread→project→workspaceRoot resolution reused from ws.ts:1700.
2. Capability honesty: result includes which kinds this server build can mint
   (`supportedKinds`), so P08-B/P16 absence is a named state, not an error at call time.
3. (P08-B slice, later) `browser-surface` claim kind: binds engine session id + epoch +
   allowed command set; minted only by the browser sessions contract holder.
4. (P16 slice, later) `device-stream` claim kind: ws-stream class, one-shot.

## Explicit non-goals (v1)

- No persistence of browser/device resource metadata across server restart (native keeps
  it in-memory; a separate migration decision — capability-plan.md:37).
- No cross-provider ResourceRef identity transfer.
- No arbitrary-path minting: every kind resolves inside a workspace root, the attachment
  store, or a registered resource owner. Path kinds keep the native canonical-realpath
  containment check at serve time.
- No plugin-visible signing key, ever. Plugins hold URLs, not claims.

## Per-consumer proof obligations (gate 3 when each slice ships)

- **P05 media slice**: disposable runtime; plugin mints a workspace-file URL via the
  contract; independent consumer fetches it WITHOUT session headers and gets the bytes;
  expired/tampered token → 404/401 by name; outside-root path → rejected at mint.
- **P08-B engine attachment**: lease binds correct principal chain; a lease minted for
  session A cannot drive session B (epoch mismatch named, not silently re-bound).
- **P16 device stream**: one-shot wsTicket cannot be replayed after upgrade; hub exec
  route remains unexposed (Julius's invariant).

## Open questions for the implementing thread

1. Name: `t3.resources/lease` (recommended — spans files/attachments/browser/devices) vs
   `t3.workspace/resources` (narrower, but P05-B already used that name for the deferred
   workspace-media grant). If the narrower name is kept for the grant, the contract family
   still wants the broader name.
2. Does `workspace-file` minting require the thread to be alive (native resolves through
   projection getThreadShellById — dead thread = NotFound)? Recommend: match native.
3. TTL for ws-stream tickets: match DeviceHubProxy's existing value; do not invent a new one.
