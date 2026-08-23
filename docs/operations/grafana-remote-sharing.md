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
- Anonymous access (previously org role Admin) disabled and sign-up off in
  `~/t3-perf/observability/docker-compose.yml`; Grafana upgraded 11.3.0 ->
  13.2.0 and pinned. Pre-change backups (compose + data volume tarball) are in
  `~/backups/` on the box, stamp `20260823-0433`.
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
- One-time PIN login is enabled. The Access app `Grafana` allows only
  `saphid@gmail.com` and redirects unauthenticated requests to the Access login
  wall.
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

For this Grafana app, use the paired operator instead of editing either system
by hand:

```sh
scripts/grafana-share-users.py list
scripts/grafana-share-users.py add person@example.com --name "Person Name"
scripts/grafana-share-users.py remove person@example.com
```

`add` preserves the current Cloudflare allowlist and creates a Viewer invite in
Grafana. Grafana email delivery is not assumed: the command prints a one-time
invitation URL for the administrator to send to the person. They first pass
Cloudflare's emailed One-time PIN and then use that URL to choose their Grafana
password. The Grafana organization-scoped service token is stored in macOS
Keychain service `grafana-share-inviter`, account `stats.t3play.dev`. The server
administrator password remains separately stored under service
`grafana-192.168.1.221`, account `admin` and is not used by this operator.

## Day-2 operations

- **Add a teammate**: Zero Trust dashboard -> Access -> Applications ->
  Grafana -> policy `Team` -> add their email, or re-run the finisher with
  `ALLOW_EMAILS=a@x.com,b@y.com`. Give them a Grafana account too
  (Viewer role) - Access gates the door, Grafana still authenticates.
- **Remove access**: delete the email from the policy; their session dies at
  the next 24h expiry, or revoke immediately from the app's Sessions view.
- **Rollback sharing entirely**: delete the DNS record and Access app, then
  `sudo cloudflared service uninstall` on the box. Grafana keeps working on
  the LAN.
- **Grafana rollback**: restore the compose file and data tarball from
  `~/backups/` on the box, `docker compose up -d grafana`.
