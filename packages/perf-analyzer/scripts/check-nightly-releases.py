#!/usr/bin/env python3
"""Discover t3 nightlies and keep the perf queue newest-first."""

from __future__ import annotations

import fcntl
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path.home() / "t3-perf"
QUEUE = ROOT / "batch-2w-versions.tsv"
STATE = ROOT / "nightly-check-state.json"
LOCK = ROOT / ".nightly-check.lock"
REGISTRY_URL = "https://registry.npmjs.org/t3"
PREFIX = "0.0."


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_registry() -> dict:
    request = Request(REGISTRY_URL, headers={"Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def main() -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        registry = fetch_registry()
        times = registry.get("time", {})
        latest = registry.get("dist-tags", {}).get("nightly")
        existing_lines = QUEUE.read_text().splitlines() if QUEUE.exists() else []
        existing_rows = [line.split("\t", 1) for line in existing_lines if "\t" in line]
        existing = {version for version, _ in existing_rows}
        latest_queued_at = max((timestamp for _, timestamp in existing_rows), default="")
        published = [
            (version, timestamp)
            for version, timestamp in times.items()
            if version.startswith(PREFIX)
            and "-nightly." in version
            and version not in existing
            and isinstance(timestamp, str)
            and timestamp > latest_queued_at
        ]

        merged_rows = sorted(existing_rows + published, key=lambda item: item[1], reverse=True)
        merged = [f"{version}\t{timestamp}" for version, timestamp in merged_rows]
        if merged != existing_lines:
            temporary = QUEUE.with_suffix(".tsv.new")
            temporary.write_text("\n".join(merged) + "\n")
            os.replace(temporary, QUEUE)

        discovered_newest_first = sorted(published, key=lambda item: item[1], reverse=True)
        state = {
            "checkedAt": utc_now(),
            "registryNightly": latest,
            "queueOrder": "published-newest-first",
            "discoveredCount": len(discovered_newest_first),
            "discoveredVersions": [version for version, _ in discovered_newest_first],
            "queueCount": len(merged_rows),
            "queueHead": merged_rows[0][0] if merged_rows else None,
        }
        temporary_state = STATE.with_suffix(".json.new")
        temporary_state.write_text(json.dumps(state, indent=2) + "\n")
        os.replace(temporary_state, STATE)
        print(json.dumps(state, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
