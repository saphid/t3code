#!/usr/bin/env python3
"""Deterministic command runner for the private SwiftUI delivery pipeline."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
STREAM = REPO_ROOT / "scripts/swiftui-stream/stream.py"
BUILD_READY = REPO_ROOT / "scripts/swiftui-stream/build-ready.sh"
PHONE_WATCH = REPO_ROOT / "scripts/swiftui-stream/phone-watch.py"
NATIVE_TEST = REPO_ROOT / "apps/swift-ios/Scripts/ci-test.sh"
APP_FLOW_TEST = REPO_ROOT / "apps/swift-ios/Scripts/ci-app-flow-test.sh"
SCHEMA_PATH = SCRIPT_DIR / "receipt.schema.json"
DEFAULT_RECEIPT_ROOT = REPO_ROOT / ".t3/swiftui-private-ci-artifacts"
DEFAULT_LOCK_ROOT = Path.home() / ".t3/locks/swiftui-private-ci"
RECEIPT_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class Stage:
    commands: tuple[tuple[str, ...], ...]
    resources: tuple[str, ...]
    github_allowed: bool = False


STAGES: dict[str, Stage] = {
    "candidate-verification": Stage(
        commands=(
            (str(STREAM), "validate"),
            (str(STREAM), "verify-branches"),
        ),
        resources=("native-build",),
    ),
    "candidate-simulator": Stage(
        commands=(
            ("env", "T3_SWIFT_XCODE_TEST_PLAN=Focused", str(NATIVE_TEST)),
            (
                "env",
                "T3_SWIFT_XCODE_TEST_PLAN=CandidateJourneys",
                "T3_APP_FLOW_PLAN=pr",
                str(APP_FLOW_TEST),
            ),
        ),
        resources=("native-build", "simulator"),
    ),
    "test-train": Stage(
        commands=(
            (str(STREAM), "validate"),
            (str(STREAM), "verify-branches"),
            ("env", "T3_SWIFT_XCODE_TEST_PLAN=TestTrain", str(NATIVE_TEST)),
            (
                "env",
                "T3_SWIFT_XCODE_TEST_PLAN=TestTrain",
                "T3_APP_FLOW_PLAN=regression",
                str(APP_FLOW_TEST),
            ),
        ),
        resources=("native-build", "simulator"),
    ),
    "test-phone-build": Stage(
        commands=((str(BUILD_READY), "test"),),
        resources=("native-build", "signing", "simulator"),
    ),
    "test-phone-install": Stage(
        commands=((sys.executable, str(PHONE_WATCH)),),
        resources=("test-phone",),
    ),
    "dev-promotion": Stage(
        commands=(
            (str(STREAM), "require-installed-test-receipt"),
            (str(STREAM), "queue-order", "--json"),
            (str(STREAM), "validate"),
            (str(STREAM), "verify-branches"),
        ),
        resources=("native-build",),
    ),
    "dev-phone-build": Stage(
        commands=((str(BUILD_READY), "dev"),),
        resources=("native-build", "signing", "simulator"),
    ),
    "dev-phone-install": Stage(
        commands=((sys.executable, str(PHONE_WATCH)),),
        resources=("dev-phone",),
    ),
    "upstream-handoff": Stage(
        commands=(
            (str(STREAM), "validate"),
            (str(STREAM), "verify-branches"),
        ),
        resources=("native-build",),
        github_allowed=True,
    ),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def environment_for_stage(stage: Stage) -> dict[str, str]:
    environment = dict(os.environ)
    if stage.github_allowed:
        return environment
    for key in tuple(environment):
        upper = key.upper()
        if upper.startswith("GH_") or upper.startswith("GITHUB_"):
            environment.pop(key)
    disabled_config = REPO_ROOT / ".t3/swiftui-private-ci-no-github"
    disabled_config.mkdir(parents=True, exist_ok=True)
    environment["GH_CONFIG_DIR"] = str(disabled_config)
    environment["T3_SWIFT_GITHUB_ALLOWED"] = "0"
    return environment


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact(path: Path, kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "path": str(path.resolve()),
        "sha256": sha256(path),
        "sizeBytes": path.stat().st_size,
    }


def git_value(*arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *arguments],
        text=True,
        capture_output=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def parse_fake_command(value: str | None) -> tuple[str, ...] | None:
    if value is None:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError(f"fake command is not valid JSON: {error}") from error
    if not isinstance(parsed, list) or not parsed or not all(
        isinstance(item, str) and item for item in parsed
    ):
        raise ValueError("fake command must be a non-empty JSON array of strings")
    return tuple(parsed)


def command_plan(
    stage_name: str,
    fake_command: tuple[str, ...] | None,
    pr_body: str | None,
    pr_number: int | None,
) -> list[tuple[str, ...]]:
    stage = STAGES[stage_name]
    if fake_command:
        return [fake_command]
    commands = list(stage.commands)
    if stage_name == "upstream-handoff":
        if not pr_body or pr_number is None:
            raise ValueError("upstream-handoff requires --pr-body and --pr-number")
        commands.append(
            (
                str(STREAM),
                "validate-pr-body",
                "--number",
                str(pr_number),
                "--body",
                str(Path(pr_body).resolve()),
            )
        )
    return commands


def load_json_file(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def stage_artifact_paths(stage_name: str) -> list[tuple[Path, str]]:
    state_root = Path.home() / ".t3/swiftui-stream"
    paths: list[tuple[Path, str]] = []
    channel = "test" if stage_name.startswith("test-phone") else "dev"
    if stage_name.endswith("phone-build"):
        pointer_path = state_root / "ready" / f"{channel}.json"
        paths.append((pointer_path, "ready-pointer"))
        pointer = load_json_file(pointer_path)
        if pointer and isinstance(pointer.get("zipPath"), str):
            paths.append((Path(pointer["zipPath"]), "signed-app-archive"))
    if stage_name.endswith("phone-install"):
        paths.append(
            (state_root / "device-receipts" / f"{channel}.json", "device-receipt")
        )
    return paths


def validate_receipt(value: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = {
        "schemaVersion": int,
        "pipeline": str,
        "stage": str,
        "runId": str,
        "status": str,
        "startedAt": str,
        "finishedAt": str,
        "exitStatus": int,
        "dryRun": bool,
        "githubAllowed": bool,
        "approvalReceiptReference": (str, type(None)),
        "resources": list,
        "repository": dict,
        "commands": list,
        "artifacts": list,
    }
    for key, expected_type in required.items():
        if key not in value:
            errors.append(f"missing {key}")
        elif not isinstance(value[key], expected_type):
            expected_name = (
                " or ".join(item.__name__ for item in expected_type)
                if isinstance(expected_type, tuple)
                else expected_type.__name__
            )
            errors.append(f"{key} must be {expected_name}")
    if errors:
        return errors
    if value["schemaVersion"] != RECEIPT_SCHEMA_VERSION:
        errors.append("unsupported schemaVersion")
    if value["pipeline"] != "swiftui-private-ci":
        errors.append("unexpected pipeline")
    if value["stage"] not in STAGES:
        errors.append("unknown stage")
    if value["status"] not in {"passed", "failed", "planned"}:
        errors.append("invalid status")
    if value["exitStatus"] < 0:
        errors.append("exitStatus must be non-negative")
    stage = STAGES.get(value["stage"])
    if stage and value["githubAllowed"] != stage.github_allowed:
        errors.append("githubAllowed does not match stage policy")
    if stage and sorted(value["resources"]) != sorted(stage.resources):
        errors.append("resources do not match stage policy")
    approval_reference = value["approvalReceiptReference"]
    if value["stage"] == "dev-promotion" and not value["dryRun"]:
        if not isinstance(approval_reference, str) or not approval_reference.strip():
            errors.append("dev-promotion requires an approval receipt reference")
    elif value["stage"] != "dev-promotion" and approval_reference is not None:
        errors.append("approval receipt reference is only valid for dev-promotion")
    repository = value["repository"]
    for key in ("root", "commit", "branch", "dirty"):
        if key not in repository:
            errors.append(f"repository missing {key}")
    for index, command in enumerate(value["commands"]):
        if not isinstance(command, dict):
            errors.append(f"commands[{index}] must be an object")
            continue
        for key in ("argv", "status", "exitStatus", "stdoutPath", "stderrPath"):
            if key not in command:
                errors.append(f"commands[{index}] missing {key}")
        if not isinstance(command.get("argv"), list) or not command.get("argv"):
            errors.append(f"commands[{index}].argv must be a non-empty array")
        exit_status = command.get("exitStatus")
        if exit_status is not None and not isinstance(exit_status, int):
            errors.append(f"commands[{index}].exitStatus must be an integer or null")
    for index, item in enumerate(value["artifacts"]):
        if not isinstance(item, dict):
            errors.append(f"artifacts[{index}] must be an object")
            continue
        if set(("kind", "path", "sha256", "sizeBytes")) - set(item):
            errors.append(f"artifacts[{index}] is incomplete")
        digest = item.get("sha256")
        if not isinstance(digest, str) or len(digest) != 64:
            errors.append(f"artifacts[{index}].sha256 must be a SHA-256 digest")
    return errors


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


@contextmanager
def resource_leases(resources: tuple[str, ...], lock_root: Path):
    """Hold every local resource in stable order for the full stage run."""
    lock_root.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        handles = []
        for resource in sorted(resources):
            handle = stack.enter_context((lock_root / f"{resource}.lock").open("a+"))
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handles.append(handle)
        try:
            yield
        finally:
            for handle in reversed(handles):
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def run_stage(args: argparse.Namespace) -> int:
    approval_reference = (
        args.approval_receipt_reference
        or os.environ.get("T3_SWIFT_APPROVAL_RECEIPT_REFERENCE")
    )
    if (
        args.stage == "dev-promotion"
        and not args.dry_run
        and (not approval_reference or not approval_reference.strip())
    ):
        print(
            "[swiftui-private-ci] dev-promotion requires "
            "--approval-receipt-reference",
            file=sys.stderr,
        )
        return 2
    try:
        fake_command = parse_fake_command(args.fake_command_json)
        commands = command_plan(
            args.stage, fake_command, args.pr_body, args.pr_number
        )
    except ValueError as error:
        print(f"[swiftui-private-ci] {error}", file=sys.stderr)
        return 2

    stage = STAGES[args.stage]
    started_at = utc_now()
    run_id = args.run_id or os.environ.get("BUILDKITE_BUILD_ID") or (
        f"local-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}"
    )
    receipt_dir = Path(args.receipt_dir).expanduser().resolve()
    log_dir = receipt_dir / "logs" / run_id / args.stage
    log_dir.mkdir(parents=True, exist_ok=True)
    command_receipts: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    exit_status = 0

    lock_root = Path(
        os.environ.get("T3_SWIFT_PIPELINE_LOCK_ROOT", str(DEFAULT_LOCK_ROOT))
    ).expanduser()
    with resource_leases(stage.resources, lock_root):
        for index, argv in enumerate(commands, start=1):
            command_started = utc_now()
            stdout_path = log_dir / f"{index:02d}.stdout.log"
            stderr_path = log_dir / f"{index:02d}.stderr.log"
            if args.dry_run:
                stdout_path.write_text("planned; command was not executed\n")
                stderr_path.write_text("")
                command_status = "planned"
                command_exit: int | None = None
            else:
                result = subprocess.run(
                    list(argv),
                    cwd=REPO_ROOT,
                    env=environment_for_stage(stage),
                    text=True,
                    capture_output=True,
                    check=False,
                )
                stdout_path.write_text(result.stdout)
                stderr_path.write_text(result.stderr)
                command_exit = result.returncode
                command_status = "passed" if result.returncode == 0 else "failed"
                if result.returncode != 0:
                    exit_status = result.returncode
            command_receipts.append(
                {
                    "argv": list(argv),
                    "startedAt": command_started,
                    "finishedAt": utc_now(),
                    "status": command_status,
                    "exitStatus": command_exit,
                    "stdoutPath": str(stdout_path),
                    "stderrPath": str(stderr_path),
                }
            )
            artifacts.extend(
                (
                    artifact(stdout_path, "command-stdout"),
                    artifact(stderr_path, "command-stderr"),
                )
            )
            if exit_status != 0:
                break

    if not args.dry_run and exit_status == 0:
        for path, kind in stage_artifact_paths(args.stage):
            if path.is_file():
                artifacts.append(artifact(path, kind))

    value: dict[str, Any] = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "pipeline": "swiftui-private-ci",
        "stage": args.stage,
        "runId": run_id,
        "status": "planned" if args.dry_run else ("passed" if exit_status == 0 else "failed"),
        "startedAt": started_at,
        "finishedAt": utc_now(),
        "exitStatus": exit_status,
        "dryRun": args.dry_run,
        "githubAllowed": stage.github_allowed,
        "approvalReceiptReference": approval_reference,
        "resources": list(stage.resources),
        "repository": {
            "root": str(REPO_ROOT),
            "commit": git_value("rev-parse", "HEAD"),
            "branch": git_value("branch", "--show-current"),
            "dirty": bool(git_value("status", "--porcelain")),
        },
        "commands": command_receipts,
        "artifacts": artifacts,
    }
    errors = validate_receipt(value)
    if errors:
        print("[swiftui-private-ci] invalid receipt: " + "; ".join(errors), file=sys.stderr)
        return 70
    receipt_path = receipt_dir / "receipts" / run_id / f"{args.stage}.json"
    atomic_json(receipt_path, value)
    print(str(receipt_path))
    return exit_status


def validate_file(args: argparse.Namespace) -> int:
    try:
        value = json.loads(Path(args.path).read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"[swiftui-private-ci] cannot read receipt: {error}", file=sys.stderr)
        return 1
    if not isinstance(value, dict):
        print("[swiftui-private-ci] receipt must be a JSON object", file=sys.stderr)
        return 1
    errors = validate_receipt(value)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("valid")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="run one deterministic stage")
    run.add_argument("stage", choices=sorted(STAGES))
    run.add_argument("--receipt-dir", default=str(DEFAULT_RECEIPT_ROOT))
    run.add_argument("--run-id")
    run.add_argument("--dry-run", action="store_true")
    run.add_argument("--fake-command-json")
    run.add_argument("--pr-body")
    run.add_argument("--pr-number", type=int)
    run.add_argument("--approval-receipt-reference")
    run.set_defaults(func=run_stage)
    validate = commands.add_parser("validate-receipt")
    validate.add_argument("path")
    validate.set_defaults(func=validate_file)
    return result


def main() -> int:
    args = parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
