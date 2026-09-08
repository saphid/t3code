#!/usr/bin/env python3
"""Finish the t3-perf Grafana remote-sharing setup on Cloudflare.

Everything server-side is already done (see docs/operations/grafana-remote-sharing.md):
the Grafana box is hardened and the `grafana-share` tunnel connector is running.
This script performs the remaining account-side steps, idempotently, so it can be
re-run safely:

  1. DNS   - upsert the proxied CNAME <hostname> -> <tunnel>.cfargotunnel.com
  2. Access - enable the Zero Trust org (team name) if needed
  3. Access - ensure the One-time PIN identity provider exists
  4. Access - ensure the self-hosted app for <hostname> with an email allowlist policy
  5. Tunnel - point the tunnel ingress at http://localhost:3000
  6. Verify - confirm the hostname redirects to the Access login wall

Run it from a machine holding a scoped API token (never commit the token):

  export CLOUDFLARE_API_TOKEN=...   # or keep it in ~/.cloudflare-grafana-share.env
  DOMAIN=t3stats.dev scripts/grafana-share-finish.py

Token permissions needed: Zone/DNS/Edit, Account/Access: Organizations, Identity
Providers, and Groups/Edit, Account/Access: Apps and Policies/Edit, and ideally
Account/Cloudflare Tunnel/Edit. If the token lacks the tunnel permission, step 5
falls back to the local wrangler OAuth session when one exists.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"

ACCOUNT_ID = os.environ.get("ACCOUNT_ID", "9803821a7c6a638a2e69b8ffe8286cb5")
TUNNEL_ID = os.environ.get("TUNNEL_ID", "062b931a-1366-491c-bbea-46ca5cd7d775")
TEAM_NAME = os.environ.get("TEAM_NAME", "saphid")
ALLOW_EMAILS = [e.strip() for e in os.environ.get("ALLOW_EMAILS", "saphid@gmail.com").split(",") if e.strip()]
ORIGIN_SERVICE = os.environ.get("ORIGIN_SERVICE", "http://localhost:3000")
KEYCHAIN_SERVICE = os.environ.get("CLOUDFLARE_KEYCHAIN_SERVICE", "cloudflare-t3play-agent-tools")
KEYCHAIN_ACCOUNT = os.environ.get("CLOUDFLARE_KEYCHAIN_ACCOUNT", "saphid")


def fail(msg):
    print(f"  ✗ {msg}")
    sys.exit(1)


def load_token():
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        env_file = os.path.expanduser("~/.cloudflare-grafana-share.env")
        if os.path.exists(env_file):
            for line in open(env_file):
                if line.startswith("CLOUDFLARE_API_TOKEN="):
                    token = line.split("=", 1)[1].strip()
    if not token:
        try:
            token = subprocess.check_output(
                [
                    "security",
                    "find-generic-password",
                    "-s",
                    KEYCHAIN_SERVICE,
                    "-a",
                    KEYCHAIN_ACCOUNT,
                    "-w",
                ],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except (FileNotFoundError, subprocess.CalledProcessError):
            pass
    if not token:
        fail(
            "set CLOUDFLARE_API_TOKEN, create ~/.cloudflare-grafana-share.env, "
            f"or add the token to Keychain service {KEYCHAIN_SERVICE}"
        )
    return token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def wrangler_oauth_token():
    """Fallback credential for the tunnel-config step only."""
    path = os.path.expanduser("~/Library/Preferences/.wrangler/config/default.toml")
    if not os.path.exists(path):
        return None
    for line in open(path):
        if line.startswith("oauth_token"):
            return line.split('"')[1]
    return None


def cf(method, path, token, body=None, ok_errors=()):
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        data = json.load(e)
    if data.get("success"):
        return data.get("result")
    codes = {err.get("code") for err in data.get("errors", [])}
    if codes & set(ok_errors):
        return None
    messages = "; ".join(err.get("message", "?") for err in data.get("errors", []))
    fail(f"{method} {path}: {messages}")


def main():
    domain = os.environ.get("DOMAIN") or fail("set DOMAIN, e.g. DOMAIN=t3stats.dev")
    hostname = os.environ.get("HOSTNAME_OVERRIDE", f"grafana.{domain}")
    token = load_token()

    print(f"== 1/6 DNS: {hostname} -> {TUNNEL_ID}.cfargotunnel.com")
    zones = cf("GET", f"/zones?name={domain}", token)
    if not zones:
        fail(f"zone {domain} not found in the account (register it first)")
    zone_id = zones[0]["id"]
    record = {
        "type": "CNAME",
        "name": hostname,
        "content": f"{TUNNEL_ID}.cfargotunnel.com",
        "proxied": True,
        "ttl": 1,
    }
    existing = cf("GET", f"/zones/{zone_id}/dns_records?type=CNAME&name={hostname}", token)
    if existing:
        cf("PUT", f"/zones/{zone_id}/dns_records/{existing[0]['id']}", token, record)
        print("  ✓ updated existing record")
    else:
        cf("POST", f"/zones/{zone_id}/dns_records", token, record)
        print("  ✓ created")

    print(f"== 2/6 Zero Trust org (team '{TEAM_NAME}')")
    # 12130 = access.api.error.not_enabled
    org = cf("GET", f"/accounts/{ACCOUNT_ID}/access/organizations", token, ok_errors=(12130,))
    if org:
        print(f"  ✓ already enabled: {org.get('auth_domain')}")
    else:
        org = cf(
            "POST",
            f"/accounts/{ACCOUNT_ID}/access/organizations",
            token,
            {"name": TEAM_NAME, "auth_domain": f"{TEAM_NAME}.cloudflareaccess.com"},
        )
        print(f"  ✓ enabled: {org['auth_domain']}")

    print("== 3/6 One-time PIN identity provider")
    idps = cf("GET", f"/accounts/{ACCOUNT_ID}/access/identity_providers", token) or []
    if any(i["type"] == "onetimepin" for i in idps):
        print("  ✓ already present")
    else:
        cf(
            "POST",
            f"/accounts/{ACCOUNT_ID}/access/identity_providers",
            token,
            {"name": "One-time PIN", "type": "onetimepin", "config": {}},
        )
        print("  ✓ created")

    print(f"== 4/6 Access app for {hostname} (allow: {', '.join(ALLOW_EMAILS)})")
    apps = cf("GET", f"/accounts/{ACCOUNT_ID}/access/apps", token) or []
    app = next((a for a in apps if a.get("domain") == hostname), None)
    if app:
        print("  ✓ app already exists")
    else:
        app = cf(
            "POST",
            f"/accounts/{ACCOUNT_ID}/access/apps",
            token,
            {"name": "Grafana", "domain": hostname, "type": "self_hosted", "session_duration": "24h"},
        )
        print("  ✓ app created")
    policies = cf("GET", f"/accounts/{ACCOUNT_ID}/access/apps/{app['id']}/policies", token) or []
    if policies:
        print(f"  ✓ policy already present ({policies[0]['name']})")
    else:
        cf(
            "POST",
            f"/accounts/{ACCOUNT_ID}/access/apps/{app['id']}/policies",
            token,
            {
                "name": "Team",
                "decision": "allow",
                "precedence": 1,
                "include": [{"email": {"email": e}} for e in ALLOW_EMAILS],
            },
        )
        print("  ✓ allow policy created")

    print(f"== 5/6 tunnel ingress -> {ORIGIN_SERVICE}")
    ingress = {
        "config": {
            "ingress": [
                {"hostname": hostname, "service": ORIGIN_SERVICE},
                {"service": "http_status:404"},
            ]
        }
    }
    # 10000 = authentication error; retry with the wrangler OAuth session, which
    # is known to hold tunnel scope on the personal MacBook.
    path = f"/accounts/{ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations"
    req = urllib.request.Request(
        f"{API}{path}",
        method="PUT",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps(ingress).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            done = json.load(r).get("success")
    except urllib.error.HTTPError as e:
        done = json.load(e).get("success")
    if done:
        print("  ✓ configured")
    else:
        fallback = wrangler_oauth_token()
        if not fallback:
            fail("token lacks Cloudflare Tunnel Edit and no wrangler session found")
        cf("PUT", path, fallback, ingress)
        print("  ✓ configured (via wrangler OAuth fallback)")

    print(f"== 6/6 verify https://{hostname} redirects to the Access login")
    opener = urllib.request.build_opener(NoRedirect)
    for attempt in range(12):
        try:
            # Cloudflare's bot checks reject urllib's default Python user agent
            # before Access can issue its login redirect.
            req = urllib.request.Request(
                f"https://{hostname}/",
                method="GET",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with opener.open(req) as r:
                landed = r.headers.get("Location", "")
        except urllib.error.HTTPError as e:
            landed = e.headers.get("Location", "")
        except urllib.error.URLError:
            landed = ""
        if "cloudflareaccess.com" in landed:
            print(f"  ✓ login wall is up: {landed.split('?')[0]}")
            print("\nAll done. Share https://" + hostname + " with the team;")
            print("they log in with an emailed one-time PIN.")
            return
        time.sleep(10)
    fail("hostname did not reach the Access login wall after 2 minutes; DNS/cert may still be propagating - re-run this script")


if __name__ == "__main__":
    main()
