#!/usr/bin/env python3
"""Allocate independent monotonic SwiftUI Dev/Test build numbers."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("channel", choices=("dev", "test"))
parser.add_argument("--minimum", type=int, default=40)
parser.add_argument("--requested", type=int)
parser.add_argument("--peek", action="store_true")
parser.add_argument("--accept-reserved", action="store_true")
args = parser.parse_args()

if args.accept_reserved and args.requested is None:
    raise SystemExit("--accept-reserved requires --requested")

root = Path.home() / ".t3/swiftui-stream"
root.mkdir(parents=True, exist_ok=True)
path = root / "build-counters.json"
lock_path = root / "build-counters.lock"
with lock_path.open("a+") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        counters = json.loads(path.read_text()) if path.exists() else {}
    except json.JSONDecodeError:
        raise SystemExit("invalid build-counters.json")
    ready_path = root / "ready" / f"{args.channel}.json"
    try:
        ready = json.loads(ready_path.read_text()) if ready_path.exists() else {}
    except json.JSONDecodeError:
        raise SystemExit(f"invalid {ready_path}")
    counter = int(counters.get(args.channel, 0))
    ready_build = int(ready.get("build", 0))
    floor = max(counter, ready_build, args.minimum)
    if args.requested is not None:
        if args.accept_reserved:
            if args.requested != counter or args.requested <= max(
                ready_build, args.minimum
            ):
                raise SystemExit(
                    f"requested {args.channel} build {args.requested} is not the "
                    "current unbuilt reservation"
                )
        elif args.requested <= floor:
            raise SystemExit(
                f"requested {args.channel} build {args.requested} must be greater than {floor}"
            )
        number = args.requested
    else:
        number = floor + 1
    if not args.peek:
        counters[args.channel] = number
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(counters, indent=2, sort_keys=True) + "\n")
        os.replace(temporary, path)
print(number)
