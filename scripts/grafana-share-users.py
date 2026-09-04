#!/usr/bin/env python3
"""Manage the two layers of access to the shared Grafana instance.

Cloudflare Access controls who can reach the hostname. Grafana invitations
control who can sign in after passing that gate. Credentials stay in macOS
Keychain and are read only for the lifetime of this process.
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


CF_API = "https://api.cloudflare.com/client/v4"
CF_ACCOUNT_ID = "9803821a7c6a638a2e69b8ffe8286cb5"
CF_APP_DOMAIN = "stats.t3play.dev"
CF_POLICY_NAME = "Team"
GRAFANA_API = "http://192.168.1.221:3000"
GRAFANA_PUBLIC = "https://stats.t3play.dev"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PROTECTED_EMAILS = {"saphid@gmail.com", "admin@localhost"}


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def keychain(service, account):
    try:
        return subprocess.check_output(
            [
                "security",
                "find-generic-password",
                "-s",
                service,
                "-a",
                account,
                "-w",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        fail(f"missing Keychain item: service {service}, account {account}")


def request(method, url, token, body=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if url.startswith(GRAFANA_API):
        headers.update(
            {
                "Host": urllib.parse.urlparse(GRAFANA_PUBLIC).netloc,
                "X-Forwarded-Proto": "https",
            }
        )
    req = urllib.request.Request(
        url,
        method=method,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"message": error.reason}
        message = payload.get("message")
        if not message and payload.get("errors"):
            message = "; ".join(item.get("message", "?") for item in payload["errors"])
        fail(f"{method} {url}: HTTP {error.code}: {message or error.reason}")


def cf_result(method, path, token, body=None):
    _, payload = request(method, f"{CF_API}{path}", token, body)
    if not payload.get("success"):
        fail(f"Cloudflare API did not report success for {method} {path}")
    return payload.get("result")


def cloudflare_policy(token):
    apps = cf_result("GET", f"/accounts/{CF_ACCOUNT_ID}/access/apps", token)
    app = next((item for item in apps if item.get("domain") == CF_APP_DOMAIN), None)
    if not app:
        fail(f"Cloudflare Access app for {CF_APP_DOMAIN} was not found")
    policies = cf_result(
        "GET", f"/accounts/{CF_ACCOUNT_ID}/access/apps/{app['id']}/policies", token
    )
    policy = next((item for item in policies if item.get("name") == CF_POLICY_NAME), None)
    if not policy:
        fail(f"Cloudflare policy {CF_POLICY_NAME} was not found")
    return app, policy


def cloudflare_policies(token, app):
    return cf_result(
        "GET",
        f"/accounts/{CF_ACCOUNT_ID}/access/apps/{app['id']}/policies?per_page=1000",
        token,
    )


def policy_emails(policy):
    return sorted(
        rule["email"]["email"].lower()
        for rule in policy.get("include", [])
        if rule.get("email", {}).get("email")
    )


def policy_excluded_emails(policy):
    return sorted(
        rule["email"]["email"].lower()
        for rule in policy.get("exclude", [])
        if rule.get("email", {}).get("email")
    )


def policy_is_self_service(policy):
    return any("everyone" in rule for rule in policy.get("include", []))


def update_policy(token, app, policy, emails):
    body = {
        "name": policy["name"],
        "decision": policy["decision"],
        "precedence": policy["precedence"],
        "include": [{"email": {"email": email}} for email in sorted(emails)],
        "exclude": policy.get("exclude", []),
        "require": policy.get("require", []),
    }
    return cf_result(
        "PUT",
        f"/accounts/{CF_ACCOUNT_ID}/access/apps/{app['id']}/policies/{policy['id']}",
        token,
        body,
    )


def update_self_service_exclusions(token, app, policy, emails):
    body = {
        "name": policy["name"],
        "decision": policy["decision"],
        "precedence": policy["precedence"],
        "include": policy["include"],
        "exclude": [{"email": {"email": email}} for email in sorted(emails)],
        "require": policy.get("require", []),
    }
    return cf_result(
        "PUT",
        f"/accounts/{CF_ACCOUNT_ID}/access/apps/{app['id']}/policies/{policy['id']}",
        token,
        body,
    )


def grafana_state(token):
    _, users = request("GET", f"{GRAFANA_API}/api/org/users", token)
    _, invites = request("GET", f"{GRAFANA_API}/api/org/invites", token)
    return users, invites


def invite_url(invite):
    url = invite.get("url") or f"/invite/{invite['code']}"
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or f"/invite/{invite['code']}"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return f"{GRAFANA_PUBLIC}/{path.lstrip('/')}"


def add(email, name, role, cf_token, grafana_token):
    app, policy = cloudflare_policy(cf_token)
    users, invites = grafana_state(grafana_token)
    user = next((item for item in users if item.get("email", "").lower() == email), None)
    invite = next((item for item in invites if item.get("email", "").lower() == email), None)
    created_invite = None

    if not user and not invite:
        request(
            "POST",
            f"{GRAFANA_API}/api/org/invites",
            grafana_token,
            {
                "loginOrEmail": email,
                "email": email,
                "name": name or "",
                "role": role,
                "sendEmail": False,
            },
        )
        _, invites = request("GET", f"{GRAFANA_API}/api/org/invites", grafana_token)
        created_invite = next(
            (item for item in invites if item.get("email", "").lower() == email), None
        )
        if not created_invite:
            fail("Grafana accepted the invitation but did not return it in the pending list")
        invite = created_invite

    emails = set(policy_emails(policy))
    excluded = set(policy_excluded_emails(policy))
    if (policy_is_self_service(policy) and email in excluded) or (
        not policy_is_self_service(policy) and email not in emails
    ):
        try:
            if policy_is_self_service(policy):
                update_self_service_exclusions(
                    cf_token, app, policy, excluded - {email}
                )
            else:
                update_policy(cf_token, app, policy, emails | {email})
        except SystemExit:
            if created_invite:
                request(
                    "PATCH",
                    f"{GRAFANA_API}/api/org/invites/{created_invite['code']}/revoke",
                    grafana_token,
                    {},
                )
            raise

    print(f"access: allowed {email}")
    if user:
        print(f"grafana: existing user ({user.get('role', 'unknown role')})")
    else:
        print(f"grafana: pending {invite.get('role', role)} invitation")
        print(f"invite_url: {invite_url(invite)}")


def remove(email, cf_token, grafana_token):
    if email in PROTECTED_EMAILS:
        fail(f"refusing to remove protected owner account: {email}")
    app, policy = cloudflare_policy(cf_token)
    if policy_is_self_service(policy):
        excluded = set(policy_excluded_emails(policy))
        update_self_service_exclusions(cf_token, app, policy, excluded | {email})
    else:
        emails = set(policy_emails(policy))
        if email in emails:
            update_policy(cf_token, app, policy, emails - {email})
    for enrolled_policy in cloudflare_policies(cf_token, app):
        enrolled_emails = set(policy_emails(enrolled_policy))
        if enrolled_policy["id"] == policy["id"] or email not in enrolled_emails:
            continue
        if enrolled_emails == {email}:
            cf_result(
                "DELETE",
                f"/accounts/{CF_ACCOUNT_ID}/access/apps/{app['id']}/policies/{enrolled_policy['id']}",
                cf_token,
            )
        else:
            update_policy(
                cf_token, app, enrolled_policy, enrolled_emails - {email}
            )

    users, invites = grafana_state(grafana_token)
    for invite in invites:
        if invite.get("email", "").lower() == email:
            request(
                "PATCH",
                f"{GRAFANA_API}/api/org/invites/{invite['code']}/revoke",
                grafana_token,
                {},
            )
    for user in users:
        if user.get("email", "").lower() == email:
            request(
                "DELETE", f"{GRAFANA_API}/api/org/users/{user['userId']}", grafana_token
            )
    print(f"removed: {email}")


def list_users(cf_token, grafana_token):
    app, policy = cloudflare_policy(cf_token)
    users, invites = grafana_state(grafana_token)
    print("Cloudflare Access:")
    if policy_is_self_service(policy):
        print("  any email verified by One-time PIN")
        for email in policy_excluded_emails(policy):
            print(f"  blocked: {email}")
    else:
        emails = {
            email
            for enrolled_policy in cloudflare_policies(cf_token, app)
            for email in policy_emails(enrolled_policy)
        }
        for email in sorted(emails):
            print(f"  {email}")
    print("Grafana users:")
    for user in sorted(users, key=lambda item: item.get("email", "")):
        print(f"  {user.get('email') or user.get('login')} ({user.get('role')})")
    print("Pending Grafana invitations:")
    for invite in sorted(invites, key=lambda item: item.get("email", "")):
        print(f"  {invite.get('email')} ({invite.get('role')})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list")
    add_parser = subparsers.add_parser("add")
    add_parser.add_argument("email")
    add_parser.add_argument("--name", default="")
    add_parser.add_argument("--role", choices=("Viewer", "Editor"), default="Viewer")
    remove_parser = subparsers.add_parser("remove")
    remove_parser.add_argument("email")
    args = parser.parse_args()

    email = getattr(args, "email", "").strip().lower()
    if email and not EMAIL_RE.fullmatch(email):
        fail(f"invalid email address: {email}")

    cf_token = keychain("cloudflare-t3play-agent-tools", "saphid")
    grafana_token = keychain("grafana-share-inviter", "stats.t3play.dev")
    if args.command == "list":
        list_users(cf_token, grafana_token)
    elif args.command == "add":
        add(email, args.name, args.role, cf_token, grafana_token)
    else:
        remove(email, cf_token, grafana_token)


if __name__ == "__main__":
    main()
