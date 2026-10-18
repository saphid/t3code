#!/usr/bin/env python3
"""Rotate the expiring self-service link for stats.t3play.dev."""

import argparse
import datetime
import json
import secrets
import subprocess
import sys


WORKER_DIR = "ops/grafana-invite-worker"
KEYCHAIN_SERVICE = "grafana-invite-cloudflare-token"
KEYCHAIN_ACCOUNT = "stats.t3play.dev"


def keychain():
    try:
        return subprocess.check_output(
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
        print(
            "error: Keychain item grafana-invite-cloudflare-token / "
            "stats.t3play.dev is missing",
            file=sys.stderr,
        )
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=168)
    args = parser.parse_args()
    if not 1 <= args.hours <= 24 * 30:
        parser.error("--hours must be between 1 and 720")

    token = secrets.token_urlsafe(24)
    expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        hours=args.hours
    )
    secret_values = json.dumps(
        {
            "CF_API_TOKEN": keychain(),
            "INVITE_TOKEN": token,
            "INVITE_EXPIRES_AT": str(int(expires.timestamp() * 1000)),
        }
    )
    subprocess.run(
        ["wrangler", "secret", "bulk", "--cwd", WORKER_DIR],
        input=secret_values,
        text=True,
        check=True,
    )
    print(f"invite_url: https://stats.t3play.dev/join?invite={token}")
    print(f"expires_at: {expires.isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
