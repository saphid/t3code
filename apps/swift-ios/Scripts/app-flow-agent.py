#!/usr/bin/env python3

"""Typed exploration ledger for promoting agent-driven Simulator work to XCTest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
CATALOG = SCRIPT_DIR / "app-flow-catalog.json"
APP_FLOW = SCRIPT_DIR / "app-flow.py"


def fail(message: str) -> None:
    raise ValueError(message)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_hash() -> str:
    return subprocess.run(
        ["python3", str(APP_FLOW), "source-hash"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.strip()


def write_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_session(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"could not read exploration session: {error}")
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        fail("invalid exploration session")
    if payload.get("sourceContentSha256") != source_hash():
        fail("source changed during exploration; start a new session")
    if payload.get("catalogSha256") != sha256_file(CATALOG):
        fail("catalog changed during exploration; start a new session")
    if payload.get("finishedAt"):
        fail("exploration session is already finished")
    return payload


def command_prepare(args: argparse.Namespace) -> int:
    if args.session.exists():
        fail(f"session already exists: {args.session}")
    subprocess.run(["python3", str(APP_FLOW), "check"], check=True, stdout=subprocess.DEVNULL)
    payload = {
        "schemaVersion": 1,
        "createdAt": now(),
        "sourceContentSha256": source_hash(),
        "catalogSha256": sha256_file(CATALOG),
        "simulatorId": args.simulator_id,
        "plan": args.plan,
        "events": [],
        "artifacts": [],
        "promotions": [],
    }
    write_atomic(args.session, payload)
    print(args.session)
    return 0


def append_event(args: argparse.Namespace, phase: str) -> int:
    payload = read_session(args.session)
    event_id = f"event-{len(payload['events']) + 1}"
    event = {"id": event_id, "phase": phase, "at": now()}
    for key in ("observation", "selector", "action", "postcondition", "action_id", "result"):
        value = getattr(args, key, None)
        if value is not None:
            event[key.replace("_", "")] = value
    payload["events"].append(event)
    write_atomic(args.session, payload)
    print(event_id)
    return 0


def command_collect(args: argparse.Namespace) -> int:
    payload = read_session(args.session)
    if not args.artifact.is_file():
        fail(f"artifact does not exist: {args.artifact}")
    payload["artifacts"].append(
        {
            "kind": args.kind,
            "name": args.artifact.name,
            "bytes": args.artifact.stat().st_size,
            "sha256": sha256_file(args.artifact),
            "collectedAt": now(),
        }
    )
    write_atomic(args.session, payload)
    return 0


def command_promote(args: argparse.Namespace) -> int:
    payload = read_session(args.session)
    actions = [event for event in payload["events"] if event["phase"] == "act"]
    assertions = [event for event in payload["events"] if event["phase"] == "assert"]
    if not actions:
        fail("promotion needs at least one typed action")
    for action in actions:
        matches = [
            assertion
            for assertion in assertions
            if assertion.get("actionid") == action["id"]
            and assertion.get("result") == "passed"
        ]
        if not matches:
            fail(f"action has no passed postcondition assertion: {action['id']}")
    if not payload["artifacts"]:
        fail("promotion needs at least one content-addressed artifact")
    draft = {
        "schemaVersion": 1,
        "kind": "exploration-to-xctest-draft",
        "generatedAt": now(),
        "sourceContentSha256": payload["sourceContentSha256"],
        "catalogSha256": payload["catalogSha256"],
        "journeyId": args.journey_id,
        "testMethod": args.test_method,
        "events": payload["events"],
        "artifacts": payload["artifacts"],
        "gateStatus": "draft-only; implement and replay through app-flow.py before acceptance",
    }
    canonical = json.dumps(draft, sort_keys=True, separators=(",", ":")).encode()
    draft["seal"] = {"algorithm": "sha256", "canonicalPayloadSha256": hashlib.sha256(canonical).hexdigest()}
    write_atomic(args.output, draft)
    payload["promotions"].append(
        {"journeyId": args.journey_id, "testMethod": args.test_method, "draft": args.output.name}
    )
    write_atomic(args.session, payload)
    return 0


def command_finish(args: argparse.Namespace) -> int:
    payload = read_session(args.session)
    if not payload["promotions"]:
        fail("finish requires a promoted replay draft")
    if args.cleanup_status != "passed":
        fail("finish requires successful cleanup")
    payload["cleanupStatus"] = args.cleanup_status
    payload["finishedAt"] = now()
    write_atomic(args.session, payload)
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--session", type=Path, required=True)
    prepare.add_argument("--simulator-id", required=True)
    prepare.add_argument("--plan", required=True)
    prepare.set_defaults(run=command_prepare)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--session", type=Path, required=True)
    inspect.add_argument("--observation", required=True)
    inspect.set_defaults(run=lambda args: append_event(args, "inspect"))
    act = commands.add_parser("act")
    act.add_argument("--session", type=Path, required=True)
    act.add_argument("--selector", required=True)
    act.add_argument("--action", required=True)
    act.add_argument("--postcondition", required=True)
    act.set_defaults(run=lambda args: append_event(args, "act"))
    assertion = commands.add_parser("assert")
    assertion.add_argument("--session", type=Path, required=True)
    assertion.add_argument("--action-id", required=True)
    assertion.add_argument("--result", choices=["passed", "failed"], required=True)
    assertion.add_argument("--observation", required=True)
    assertion.set_defaults(run=lambda args: append_event(args, "assert"))
    collect = commands.add_parser("collect")
    collect.add_argument("--session", type=Path, required=True)
    collect.add_argument("--artifact", type=Path, required=True)
    collect.add_argument("--kind", choices=["screenshot", "accessibility-tree", "log"], required=True)
    collect.set_defaults(run=command_collect)
    promote = commands.add_parser("promote")
    promote.add_argument("--session", type=Path, required=True)
    promote.add_argument("--output", type=Path, required=True)
    promote.add_argument("--journey-id", required=True)
    promote.add_argument("--test-method", required=True)
    promote.set_defaults(run=command_promote)
    finish = commands.add_parser("finish")
    finish.add_argument("--session", type=Path, required=True)
    finish.add_argument("--cleanup-status", choices=["passed", "failed"], required=True)
    finish.set_defaults(run=command_finish)
    return result


def main() -> int:
    try:
        args = parser().parse_args()
        return args.run(args)
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"app-flow-agent: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    import sys

    raise SystemExit(main())
