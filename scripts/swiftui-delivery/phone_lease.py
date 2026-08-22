#!/usr/bin/env python3
"""Acquire, inspect, and release the exclusive SwiftUI phone publication lease."""

import argparse
import hashlib
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_LEASE = (Path.home() / ".local" / "state" / "t3" /
                 "swiftui-delivery" / "phone-publication.lock")
CONTRACT = json.loads(Path(__file__).with_name("contract.json").read_text())


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def read_owner(lease_dir):
    try:
        return json.loads((Path(lease_dir) / "owner.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None


def acquire(lease_dir, operation_id, actor, mode, scope_sha256):
    lease_dir = Path(lease_dir)
    lease_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        lease_dir.mkdir()
    except FileExistsError:
        return {"ok": False, "error": "phone publication lease is already held",
                "owner": read_owner(lease_dir)}
    token = secrets.token_hex(24)
    owner = {
        "schemaVersion": 1,
        "kind": "swiftui-phone-publication-lease",
        "operationId": operation_id,
        "actor": actor,
        "mode": mode,
        "scopeSha256": scope_sha256,
        "tokenSha256": token_hash(token),
        "acquiredAt": utc_now(),
    }
    try:
        (lease_dir / "owner.json").write_text(
            json.dumps(owner, indent=2, sort_keys=True) + "\n")
    except OSError:
        try:
            lease_dir.rmdir()
        except OSError:
            pass
        raise
    return {"ok": True, "lease": owner, "releaseToken": token,
            "leasePath": str(lease_dir)}


def release(lease_dir, token):
    lease_dir = Path(lease_dir)
    owner = read_owner(lease_dir)
    if not isinstance(owner, dict):
        return {"ok": False, "error": "phone publication lease owner is unreadable"}
    if owner.get("tokenSha256") != token_hash(token):
        return {"ok": False, "error": "release token does not own this lease",
                "owner": owner}
    contents = sorted(item.name for item in lease_dir.iterdir())
    if contents != ["owner.json"]:
        return {"ok": False, "error": "lease contains unexpected files; review manually",
                "owner": owner}
    (lease_dir / "owner.json").unlink()
    lease_dir.rmdir()
    return {"ok": True, "released": owner, "releasedAt": utc_now()}


def status(lease_dir):
    lease_dir = Path(lease_dir)
    if not lease_dir.exists():
        return {"ok": True, "held": False, "leasePath": str(lease_dir)}
    return {"ok": True, "held": True, "leasePath": str(lease_dir),
            "owner": read_owner(lease_dir)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lease-dir", default=str(DEFAULT_LEASE))
    commands = parser.add_subparsers(dest="command", required=True)
    get = commands.add_parser("acquire")
    get.add_argument("--operation-id", required=True)
    get.add_argument("--actor", choices=tuple(CONTRACT["humanActors"]), required=True)
    get.add_argument("--mode", choices=("publish-test", "publish-dev"), required=True)
    get.add_argument("--scope-sha256", required=True)
    free = commands.add_parser("release")
    free.add_argument("--token", required=True)
    commands.add_parser("status")
    args = parser.parse_args(argv)
    if args.command == "acquire":
        if len(args.scope_sha256) != 64 or any(
                character not in "0123456789abcdef" for character in args.scope_sha256):
            result = {"ok": False, "error": "scope SHA-256 must be 64 lowercase hex"}
        else:
            result = acquire(args.lease_dir, args.operation_id, args.actor,
                             args.mode, args.scope_sha256)
    elif args.command == "release":
        result = release(args.lease_dir, args.token)
    else:
        result = status(args.lease_dir)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("ok") else 75


if __name__ == "__main__":
    sys.exit(main())
