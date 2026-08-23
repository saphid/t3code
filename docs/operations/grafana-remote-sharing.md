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
- Anonymous access (previously org role Admin) disabled. Self-service sign-up
  is enabled in
  `~/t3-perf/observability/docker-compose.yml`; Grafana upgraded 11.3.0 ->
  13.2.0 and pinned. New accounts are automatically assigned Viewer. The
  pre-self-service compose backup is
  `docker-compose.yml.pre-self-signup-20260823`; earlier compose and data
  backups are in `~/backups/` on the box, stamp `20260823-0433`.
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
- One-time PIN login is enabled. The Access app `Grafana` allows enrolled email
  addresses. A more-specific `stats.t3play.dev/join` Access app accepts anyone
  who proves control of an email address, after which the invite Worker checks
  the expiring link and enrolls that verified address.
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
enters their email at Cloudflare, completes the emailed One-time PIN, and is
then added to the main Grafana Access allowlist. They use Grafana's **Sign up**
link to create a Viewer account. The bare stats URL does not enroll new people.

The Worker source and Wrangler configuration live in
`ops/grafana-invite-worker`. Its Cloudflare API token, invite token, and expiry
are Worker secrets. Deploy code changes with:

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

`add` puts the address on the Access allowlist and creates a Viewer invite.
Grafana email delivery is not assumed, so it prints a one-time invitation URL.
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
- **Remove access**: run `scripts/grafana-share-users.py remove EMAIL`. Their
  current Access session may remain valid until expiry; revoke it immediately
  from the app's Sessions view when needed.
- **Rollback sharing entirely**: delete the DNS record and Access app, then
  `sudo cloudflared service uninstall` on the box. Grafana keeps working on
  the LAN.
- **Grafana rollback**: restore the compose file and data tarball from
  `~/backups/` on the box, `docker compose up -d grafana`.
