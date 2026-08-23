# Sharing the t3-perf Grafana with the remote team

The perf-harness Grafana (the `observability` compose stack, dashboard at
`http://192.168.1.221:3000` on the LAN) is being exposed to remote teammates
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

Remaining (account side, needs a Cloudflare-authenticated machine):

1. Register the domain (decision: `t3stats.dev`, ~US$12/yr, confirmed
   available) via dash.cloudflare.com -> Domain Registration.
2. Mint a custom API token (My Profile -> API Tokens -> Create Custom Token)
   named `grafana-share-agent` with: Zone/DNS/Edit (all zones),
   Account/Access: Organizations, Identity Providers, and Groups/Edit,
   Account/Access: Apps and Policies/Edit, Account/Cloudflare Tunnel/Edit.
   Save it as `~/.cloudflare-grafana-share.env`
   (`CLOUDFLARE_API_TOKEN=...`, chmod 600). Never commit it.
3. Run the finisher:

   ```sh
   DOMAIN=t3stats.dev scripts/grafana-share-finish.py
   ```

   It is idempotent: DNS CNAME to the tunnel, Zero Trust org (team `saphid`,
   free plan), One-time PIN login, Access app for `grafana.t3stats.dev`
   allowing only `saphid@gmail.com`, tunnel ingress to `localhost:3000`, then
   an end-to-end check that the hostname lands on the Access login wall.

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
