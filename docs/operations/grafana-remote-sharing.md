# Sharing the t3-perf Grafana with the remote team

The perf-harness Grafana (the `observability` compose stack, dashboard at
`http://192.168.1.221:3000` on the LAN) is exposed to remote teammates at
`https://stats.t3play.dev`
through a Cloudflare Tunnel with a Cloudflare Access login wall in front. No
inbound ports open; the tunnel terminates at Grafana's port only, so remote
users get the dashboard and nothing else on the network.

## State as of 2026-08-23

Done (server side, on the Grafana box `lxso2`):

- Admin password rotated off the default. It lives in the work Mac's keychain
  (`security find-generic-password -s grafana-192.168.1.221 -a admin -w`).
  Move it into 1Password if others need it.
- Anonymous access (previously org role Admin) and password self-sign-up are
  disabled in
  `~/t3-perf/observability/docker-compose.yml`; Grafana upgraded 11.3.0 ->
  13.2.0 and pinned. Grafana validates Cloudflare's signed Access JWT against
  the team JWKS, issuer, and main-app audience, then automatically provisions
  the verified email as Editor, so teammates can create and maintain their own
  dashboards. The local admin/password login remains as the
  recovery path. The pre-JWT compose backup is
  `docker-compose.yml.pre-cloudflare-jwt-20260823`; earlier compose and data
  backups are in `~/backups/` on the box.
- Cloudflare tunnel `grafana-share` created (id
  `062b931a-1366-491c-bbea-46ca5cd7d775`, account
  `9803821a7c6a638a2e69b8ffe8286cb5`). `cloudflared` runs on the box as a
  systemd service and shows healthy with redundant edge connections.
- The second Grafana on the same box (`network-grafana`, port 13000) is
  deliberately untouched and stays LAN-only.
- Cloudflare zone `t3play.dev` is active. `stats.t3play.dev` is a proxied CNAME
  to the tunnel and its tunnel ingress targets `http://localhost:3000`.
- Zero Trust Free is active (50 included seats; usage above the free limits is
  authorized against the account's saved payment method). Cloudflare assigned
  team domain `wandering-violet-a685.cloudflareaccess.com`.
- One-time PIN and Cloudflare-account login are enabled. New addresses must
  start at `stats.t3play.dev/join`: the token-gated Worker creates an OTP-only
  policy, then `/enroll` uses the Access-authenticated identity to add that
  exact address to the Cloudflare-login policy. A random Cloudflare account
  cannot self-enroll, and an invited person needs only the first emailed PIN;
  later visits can use their Cloudflare account. The more-specific `/join`
  Access app is the only bypass path.
- Main Org's home dashboard is `T3 perf / Overview` (`t3perf-overview`). Its
  top orientation panel explains what the suite measures, how to use the
  filters, and why each focused dashboard exists. The provisioned source is
  `~/t3-perf/observability/grafana/dashboards/overview.json` on `lxso2`; the
  pre-home-page backup is `overview.json.pre-home-20260823` beside it.
- The repository snapshots the complete provisioned dashboard set in
  `ops/grafana-dashboards/`. Treat those files as the durable source of truth:
  validate them, copy them to
  `~/t3-perf/observability/grafana/dashboards/` on `lxso2`, and retain a dated
  backup there before each rollout. File-provisioned dashboards stay
  maintainer-owned; Editors create separate dashboards in Grafana rather than
  editing the provisioned originals.
- Analytical dashboards use a separate `device_type` label: `lxso1`, `lxso2`,
  and `lxso3` are grouped as `Linux i7-8700 worker`; `AUS-M5P-AS` is grouped as
  `MacBook Pro`. The original `host` label remains available for worker
  drill-down and Batch status. GPU panels additionally retain `gpu_backend`,
  because AGX, DRM, NVIDIA estimates, and unavailable attribution are not
  interchangeable measurements. Future labels are applied by
  `ops/observability/otel-collector.yaml`; exact-timestamp history can be
  replayed idempotently with `ops/backfill-device-types.py`.
- Scoped user token `t3play-agent-tools-v2` has DNS Edit on all zones and Edit
  on Access organizations/identity/groups, Access apps/policies, and
  Cloudflare Tunnel. The token is in macOS Keychain under service
  `cloudflare-t3play-agent-tools`, account `saphid`; it is never committed.

The setup is complete. The finisher remains safe to re-run:

```sh
DOMAIN=t3play.dev HOSTNAME_OVERRIDE=stats.t3play.dev \
  scripts/grafana-share-finish.py
```

The script checks `CLOUDFLARE_API_TOKEN`, then
`~/.cloudflare-grafana-share.env`, then the Keychain entry above.

## Handoff to another agent session

Give the session this text:

> Cloudflare is authenticated on this Mac with a scoped token in macOS
> Keychain service `cloudflare-t3play-agent-tools`, account `saphid`. Account
> ID: `9803821a7c6a638a2e69b8ffe8286cb5`. Primary zone: `t3play.dev`. Retrieve
> the token only at execution time with `security find-generic-password -s
> cloudflare-t3play-agent-tools -a saphid -w`; never print, paste into chat, or
> commit it. Its current scope is DNS Edit on all zones plus Edit for Access
> organizations/identity/groups, Access apps/policies, and Cloudflare Tunnel.
> Ask before expanding permissions or making billable changes. Use Cloudflare's
> API or an existing repository tool, verify the exact resource changed, and
> report sanitized IDs and results only.

That credential can support DNS, Access, and Tunnel tools. It intentionally
cannot manage Workers, R2, billing, registrar settings, or unrelated products;
create a separately scoped credential if a future tool needs those powers.

Create a shareable link (seven days by default) from the repository root:

```sh
scripts/grafana-share-invite.py --hours 168
```

The command rotates the previous link and prints the new URL and UTC expiry.
The URL has the form `https://stats.t3play.dev/join?invite=...`. A visitor
enters their email in the token-gated Worker form. The Worker creates an Access
policy that requires One-time PIN, then sends the visitor to the protected
`/enroll` path. After that one PIN verifies the address, the Worker reads the
signed Access identity and enables Cloudflare-account login for the same exact
email. Grafana creates an Editor account automatically; it has no separate
password. On future visits the person may choose Cloudflare or One-time PIN.
The bare stats URL does not enroll new people. A link can add at most 25 new
addresses and enrollment survives link expiry, so rotate the link and remove
unwanted accounts if it leaks.

The Worker source and Wrangler configuration live in
`ops/grafana-invite-worker`. Its Cloudflare API token, invite token, and expiry
are Worker secrets. `CF_API_TOKEN` must be a dedicated token limited to Access
application and policy editing for this account; do not reuse the broader
operator token described above. Store it in macOS Keychain service
`grafana-invite-cloudflare-token`, account `stats.t3play.dev`; that is the exact
entry read by `scripts/grafana-share-invite.py`. Cloudflare request logs can retain the invite
query string for their retention period, so rotating a link invalidates its
value but does not erase the historical request URL. Deploy code changes with:

```sh
cd ops/grafana-invite-worker
npm install
npm run check
npx wrangler deploy
```

Use the paired operator to inspect users, pre-create an account invitation, or
block a person:

```sh
scripts/grafana-share-users.py list
scripts/grafana-share-users.py add person@example.com --name "Person Name"
scripts/grafana-share-users.py remove person@example.com
```

`add` puts the address on the Access allowlist and can still pre-create an Editor
invite for compatibility, but normal users should use the expiring enrollment
link and Cloudflare JWT provisioning.
`remove` deletes the Grafana user or pending invite and removes the address
from Access. A removed person cannot re-enroll after the shared link expires;
rotate the link immediately if they must be excluded before then.
The Grafana organization-scoped service token is stored in macOS
Keychain service `grafana-share-inviter`, account `stats.t3play.dev`. The server
administrator password remains separately stored under service
`grafana-192.168.1.221`, account `admin` and is not used by this operator.

## Day-2 operations

- **Add teammates**: rotate an expiring link with
  `scripts/grafana-share-invite.py --hours HOURS` and share the printed URL.
- **Change the home dashboard**: edit and validate the repository copy in
  `ops/grafana-dashboards/`, back up and deploy the complete set to `lxso2`,
  restart Grafana, and set Main Org's `homeDashboardUID` through
  `PATCH /api/org/preferences`. Keep the orientation copy concise and preserve
  links to all focused dashboards.
- **Backfill or remap device types**: take a `promtool tsdb dump` first, retain
  its SHA-256, run `ops/backfill-device-types.py --dry-run`, then replay through
  the local OTLP receiver. Verify the mapped series in Prometheus, not only the
  collector's HTTP response. The 2026-08-25 migration backup is
  `~/t3-perf/backups/device-type-20260825T025820Z/` on `lxso2`; it contains
  98,094 exact-timestamp samples and the pre-change collector/dashboard files.
- **Remove access**: run `scripts/grafana-share-users.py remove EMAIL`. Their
  current Access session may remain valid until expiry; revoke it immediately
  from the app's Sessions view when needed.
- **Login recovery**: if Cloudflare-account login fails, the enrolled address
  can still use One-time PIN. Do not remove the OTP policy after promotion: it
  is both the recovery method and the proof that the address was invited.
- **Rollback sharing entirely**: delete the DNS record and Access app, then
  `sudo cloudflared service uninstall` on the box. Grafana keeps working on
  the LAN.
- **Grafana rollback**: restore the compose file and data tarball from
  `~/backups/` on the box, `docker compose up -d grafana`.
