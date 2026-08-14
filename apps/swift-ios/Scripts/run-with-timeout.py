#!/usr/bin/env python3

"""Run one command with a process-group wall-clock deadline."""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys


def signal_process_group(process_id: int, signal_number: signal.Signals) -> None:
    try:
        os.killpg(process_id, signal_number)
    except ProcessLookupError:
        # The child won the race and already exited. The timeout verdict remains
        # 124; there is no process group left to reclaim.
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    if args.seconds <= 0 or not command:
        parser.error("a positive timeout and command are required")

    process = subprocess.Popen(command, start_new_session=True)
    try:
        return process.wait(timeout=args.seconds)
    except subprocess.TimeoutExpired:
        print(
            f"[swift-ios-app-flow] error: command exceeded {args.seconds}s wall-clock deadline",
            file=sys.stderr,
        )
        signal_process_group(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            signal_process_group(process.pid, signal.SIGKILL)
            process.wait()
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
