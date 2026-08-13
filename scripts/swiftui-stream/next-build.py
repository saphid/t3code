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
args = parser.parse_args()

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
    floor = max(
        int(counters.get(args.channel, 0)),
        int(ready.get("build", 0)),
        args.minimum,
    )
    if args.requested is not None:
        if args.requested <= floor:
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
