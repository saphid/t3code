#!/usr/bin/env python3

"""Typed exploration ledger for promoting agent-driven Simulator work to XCTest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import time
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


def normalized_point(value: str) -> list[float]:
    try:
        point = [float(part) for part in value.split(",")]
    except ValueError as error:
        fail(f"invalid normalized point: {value}")
    if len(point) != 2 or any(coordinate < 0 or coordinate > 1 for coordinate in point):
        fail(f"normalized point must be x,y within 0..1: {value}")
    return point


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
    if phase == "act":
        point = getattr(args, "point", None)
        from_point = getattr(args, "from_point", None)
        to_point = getattr(args, "to_point", None)
        if point is not None:
            if from_point is not None or to_point is not None:
                fail("an action cannot combine --point with a swipe path")
            event["point"] = point
        elif from_point is not None or to_point is not None:
            if from_point is None or to_point is None:
                fail("a swipe action requires both --from-point and --to-point")
            if args.duration <= 0:
                fail("a swipe action requires a positive --duration")
            event["from"] = from_point
            event["to"] = to_point
            event["duration"] = args.duration
        recording = payload.get("recording")
        if isinstance(recording, dict) and recording.get("status") == "recording":
            if "point" not in event and "from" not in event:
                fail("recorded actions require --point or a complete swipe path")
            event["sourceat"] = round(
                (time.time_ns() - recording["startedEpochNs"]) / 1_000_000_000,
                6,
            )
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


def command_record(args: argparse.Namespace) -> int:
    payload = read_session(args.session)
    if payload.get("recording") is not None:
        fail("exploration session already has a recording")
    if args.video.exists():
        fail(f"raw recording already exists: {args.video}")
    driver = list(args.driver)
    if driver and driver[0] == "--":
        driver = driver[1:]
    if not driver:
        fail("record requires a driver command after --")
    args.video.parent.mkdir(parents=True, exist_ok=True)
    xcrun = os.environ.get("T3_SWIFT_XCRUN_COMMAND", "xcrun")
    subprocess.run(
        [xcrun, "simctl", "ui", payload["simulatorId"], "appearance", "dark"],
        check=True,
    )
    started_at = now()
    started_epoch_ns = time.time_ns()
    recorder = subprocess.Popen(
        [
            xcrun,
            "simctl",
            "io",
            payload["simulatorId"],
            "recordVideo",
            "--codec=h264",
            "--force",
            str(args.video.resolve()),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    payload["recording"] = {
        "status": "recording",
        "journeyId": args.journey_id,
        "appearance": "dark",
        "video": str(args.video.resolve()),
        "recordingStartedAt": started_at,
        "startedEpochNs": started_epoch_ns,
        "recorderPid": recorder.pid,
    }
    write_atomic(args.session, payload)
    driver_status = 1
    recorder_status = 1
    try:
        time.sleep(0.2)
        driver_status = subprocess.run(driver, check=False).returncode
    finally:
        if recorder.poll() is None:
            recorder.send_signal(signal.SIGINT)
        try:
            recorder_status = recorder.wait(timeout=10)
        except subprocess.TimeoutExpired:
            recorder.kill()
            recorder_status = recorder.wait(timeout=5)
    payload = read_session(args.session)
    recording = payload.get("recording")
    if not isinstance(recording, dict) or recording.get("status") != "recording":
        fail("recording state changed while the driver was active")
    recording.update(
        {
            "status": "complete" if driver_status == 0 and recorder_status == 0 else "failed",
            "driverStatus": driver_status,
            "recorderStatus": recorder_status,
            "recordingFinishedAt": now(),
        }
    )
    recording.pop("startedEpochNs", None)
    recording.pop("recorderPid", None)
    if args.video.is_file() and args.video.stat().st_size > 0:
        video_record = {
            "kind": "raw-video",
            "name": args.video.name,
            "path": str(args.video.resolve()),
            "bytes": args.video.stat().st_size,
            "sha256": sha256_file(args.video),
            "collectedAt": now(),
        }
        recording["artifact"] = video_record
        payload["artifacts"].append(video_record)
    write_atomic(args.session, payload)
    if driver_status != 0:
        fail(f"recording driver failed with status {driver_status}")
    if recorder_status != 0:
        fail(f"Simulator recorder failed with status {recorder_status}")
    if not args.video.is_file() or args.video.stat().st_size == 0:
        fail("Simulator recorder produced no raw video")
    return 0


def command_proof_map(args: argparse.Namespace) -> int:
    payload = read_session(args.session)
    recording = payload.get("recording")
    if not isinstance(recording, dict) or recording.get("status") != "complete":
        fail("proof-map requires one completed recording")
    actions = [event for event in payload["events"] if event.get("phase") == "act"]
    assertions = [event for event in payload["events"] if event.get("phase") == "assert"]
    if not actions:
        fail("proof-map requires at least one recorded action")
    mapped_actions = []
    for action in actions:
        if not any(
            assertion.get("actionid") == action["id"]
            and assertion.get("result") == "passed"
            for assertion in assertions
        ):
            fail(f"recorded action has no passed assertion: {action['id']}")
        if "sourceat" not in action:
            fail(f"action was not timed by the recorder: {action['id']}")
        mapped = {"action_id": action["id"], "at": action["sourceat"]}
        if "point" in action:
            mapped["point"] = action["point"]
        elif "from" in action and "to" in action:
            mapped.update(
                {
                    "from": action["from"],
                    "to": action["to"],
                    "duration": action["duration"],
                }
            )
        else:
            fail(f"recorded action has no visual geometry: {action['id']}")
        mapped_actions.append(mapped)
    result = {
        "version": 1,
        "title": args.title,
        "journey_id": recording["journeyId"],
        "appearance": recording["appearance"],
        "recording_started_at": recording["recordingStartedAt"],
        "raw_video": recording["artifact"],
        "actions": mapped_actions,
    }
    write_atomic(args.output, result)
    print(args.output)
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
    geometry = act.add_mutually_exclusive_group()
    geometry.add_argument("--point", type=normalized_point)
    geometry.add_argument("--from-point", type=normalized_point)
    act.add_argument("--to-point", type=normalized_point)
    act.add_argument("--duration", type=float, default=0.6)
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
    record = commands.add_parser("record")
    record.add_argument("--session", type=Path, required=True)
    record.add_argument("--journey-id", required=True)
    record.add_argument("--video", type=Path, required=True)
    record.add_argument("driver", nargs=argparse.REMAINDER)
    record.set_defaults(run=command_record)
    proof_map = commands.add_parser("proof-map")
    proof_map.add_argument("--session", type=Path, required=True)
    proof_map.add_argument("--output", type=Path, required=True)
    proof_map.add_argument("--title", required=True)
    proof_map.set_defaults(run=command_proof_map)
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
