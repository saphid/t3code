#!/usr/bin/env python3

"""Run a read-only xcodebuild metadata query with a hard deadline."""

import argparse
import datetime as dt
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


INSPECTION_FLAGS = {
    "-list": "list",
    "-showBuildSettings": "show-build-settings",
    "-showdestinations": "show-destinations",
}
DISALLOWED_ACTIONS = {
    "analyze",
    "archive",
    "build",
    "build-for-testing",
    "clean",
    "install",
    "test",
    "test-without-building",
}


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def validate_xcode_arguments(arguments):
    operations = [INSPECTION_FLAGS[value] for value in arguments if value in INSPECTION_FLAGS]
    if len(operations) != 1:
        raise ValueError("pass exactly one of -list, -showBuildSettings, or -showdestinations")
    disallowed = [value for value in arguments if value in DISALLOWED_ACTIONS]
    if disallowed:
        raise ValueError("inspection wrapper refuses action: {}".format(disallowed[0]))
    if "-derivedDataPath" in arguments:
        raise ValueError("inspection wrapper refuses -derivedDataPath")
    return operations[0]


def acquire_hygiene_lock(lock_dir):
    lock_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock_dir.mkdir()
    except FileExistsError:
        marker = lock_dir / "mcp-derived-data"
        if marker.exists():
            if sorted(item.name for item in lock_dir.iterdir()) != ["mcp-derived-data"]:
                return False, "unresolved-hygiene-lock"
            try:
                leased_value = marker.read_text(encoding="utf-8").strip()
            except OSError:
                return False, "unresolved-hygiene-lock"
            if leased_value and Path(leased_value).exists():
                return False, "xcodebuildmcp-lease-active"
            try:
                marker.unlink()
                lock_dir.rmdir()
                lock_dir.mkdir()
            except OSError:
                return False, "unresolved-hygiene-lock"
        else:
            owner_path = lock_dir / "owner-pid"
            if sorted(item.name for item in lock_dir.iterdir()) != ["owner-pid"]:
                return False, "unresolved-hygiene-lock"
            try:
                owner_pid = int(owner_path.read_text(encoding="utf-8").strip())
            except (OSError, ValueError):
                return False, "unresolved-hygiene-lock"
            try:
                os.kill(owner_pid, 0)
            except ProcessLookupError:
                try:
                    owner_path.unlink()
                    lock_dir.rmdir()
                    lock_dir.mkdir()
                except OSError:
                    return False, "stale-hygiene-lock-needs-review"
            except PermissionError:
                pass
            else:
                return False, "direct-native-lease-active"
    try:
        (lock_dir / "owner-pid").write_text(
            "{}\n".format(os.getpid()), encoding="utf-8"
        )
    except OSError:
        try:
            lock_dir.rmdir()
        except OSError:
            pass
        raise
    return True, None


def release_hygiene_lock(lock_dir):
    owner_path = lock_dir / "owner-pid"
    try:
        owner_pid = int(owner_path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False
    if owner_pid != os.getpid():
        return False
    try:
        owner_path.unlink()
        lock_dir.rmdir()
    except OSError:
        return False
    return True


def terminate_process_group(process, grace_seconds):
    if process.poll() is not None:
        return "already-exited"
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return "already-exited"
    try:
        process.wait(timeout=grace_seconds)
        return "terminated"
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        return "killed"


def run_process(executable, arguments, timeout_seconds, grace_seconds):
    started_at = utc_now()
    started = time.monotonic()
    process_holder = {"process": None}
    termination = None
    timed_out = False
    interrupted_signal = None
    previous_handlers = {}

    def forward_signal(signum, _frame):
        nonlocal interrupted_signal
        interrupted_signal = signum
        process = process_holder["process"]
        if process is not None:
            terminate_process_group(process, grace_seconds)

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        previous_handlers[signum] = signal.signal(signum, forward_signal)

    try:
        process = subprocess.Popen(
            [executable] + list(arguments),
            start_new_session=True,
        )
        process_holder["process"] = process
        if interrupted_signal is not None:
            termination = terminate_process_group(process, grace_seconds)
        try:
            exit_code = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            termination = terminate_process_group(process, grace_seconds)
            exit_code = 124
        if interrupted_signal is not None:
            exit_code = 128 + interrupted_signal
            termination = termination or "terminated"
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)

    ended_at = utc_now()
    duration_ms = round((time.monotonic() - started) * 1000)
    return {
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": duration_ms,
        "exitCode": exit_code,
        "timedOut": timed_out,
        "termination": termination,
    }


def write_receipt(path, receipt):
    target = path.expanduser()
    if not target.is_absolute():
        target = Path.cwd() / target
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=target.name + ".", suffix=".tmp", dir=str(target.parent)
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(receipt, destination, indent=2, sort_keys=True)
            destination.write("\n")
        os.replace(temporary_name, target)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise
    return target


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description="Run one read-only xcodebuild metadata query with a hard deadline."
    )
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--grace-seconds", type=float, default=3.0)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("xcode_arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.xcode_arguments[:1] == ["--"]:
        args.xcode_arguments = args.xcode_arguments[1:]
    if not args.xcode_arguments:
        parser.error("pass xcodebuild arguments after --")
    if not 0 < args.timeout_seconds <= 300:
        parser.error("--timeout-seconds must be greater than 0 and at most 300")
    if not 0 < args.grace_seconds <= 30:
        parser.error("--grace-seconds must be greater than 0 and at most 30")
    return args


def main(argv=None):
    args = parse_arguments(argv or sys.argv[1:])
    try:
        operation = validate_xcode_arguments(args.xcode_arguments)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 64

    argument_hash = hashlib.sha256(
        "\0".join(args.xcode_arguments).encode("utf-8")
    ).hexdigest()
    lock_dir = (Path.home() / ".local" / "state" / "t3" /
                "swiftui-delivery" / "ios-build-hygiene.lock")
    acquired, deferred_reason = acquire_hygiene_lock(lock_dir)
    if not acquired:
        result = {
            "startedAt": utc_now(),
            "endedAt": utc_now(),
            "durationMs": 0,
            "exitCode": 75,
            "timedOut": False,
            "termination": None,
            "deferredReason": deferred_reason,
        }
    else:
        try:
            try:
                result = run_process(
                    "xcodebuild",
                    args.xcode_arguments,
                    args.timeout_seconds,
                    args.grace_seconds,
                )
            except FileNotFoundError:
                result = {
                    "startedAt": utc_now(),
                    "endedAt": utc_now(),
                    "durationMs": 0,
                    "exitCode": 127,
                    "timedOut": False,
                    "termination": None,
                }
        finally:
            if not release_hygiene_lock(lock_dir):
                print("warning: could not release owned hygiene lock", file=sys.stderr)

    receipt = {
        "schemaVersion": 1,
        "kind": "xcodebuild-inspection",
        "operation": operation,
        "argumentHash": argument_hash,
        **result,
    }
    if args.receipt:
        target = write_receipt(args.receipt, receipt)
        print("xcode inspection receipt: {}".format(target), file=sys.stderr)
    print(json.dumps(receipt, sort_keys=True), file=sys.stderr)
    return result["exitCode"]


if __name__ == "__main__":
    sys.exit(main())
