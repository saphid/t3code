#!/usr/bin/env python3
"""Validate a promtool t3perf dump against npm release timestamps."""

from __future__ import annotations

import datetime
import json
import re
import sys
from pathlib import Path


LINE = re.compile(r"^\{(.*)\}\s+([^ ]+)\s+(\d+)$")
LABEL = re.compile(r'(\w+)="((?:\\.|[^"\\])*)"')


def main() -> int:
    times = json.loads(Path(sys.argv[1]).read_text())["time"]
    count = 0
    bad = []
    builds = set()
    hosts = set()
    for line in sys.stdin:
        match = LINE.match(line.rstrip())
        if match is None:
            continue
        labels = {
            key: json.loads(f'"{encoded}"')
            for key, encoded in LABEL.findall(match.group(1))
        }
        build = labels.get("build")
        host = labels.get("host")
        timestamp = int(match.group(3))
        if build not in times:
            bad.append(("missing registry", build))
            continue
        expected = int(
            datetime.datetime.fromisoformat(times[build].replace("Z", "+00:00")).timestamp()
            * 1000
        )
        if abs(timestamp - expected) > 1:
            bad.append(("timestamp", build, timestamp, expected))
        if not host:
            bad.append(("host missing", build))
        for field in ("label", "build", "scenario"):
            if host and host in labels.get(field, ""):
                bad.append(("host embedded", field, labels.get(field)))
        count += 1
        builds.add(build)
        hosts.add(host)

    now = datetime.datetime.now(datetime.timezone.utc)
    recent = sorted(
        datetime.datetime.fromisoformat(times[build].replace("Z", "+00:00"))
        for build in builds
        if datetime.datetime.fromisoformat(times[build].replace("Z", "+00:00"))
        >= now - datetime.timedelta(days=7)
    )
    gaps = [(end - start, start, end) for start, end in zip(recent, recent[1:])]
    max_gap = max(gaps, default=(datetime.timedelta(0), None, None))
    print(
        json.dumps(
            {
                "samples": count,
                "builds": len(builds),
                "hosts": sorted(hosts),
                "timestampOrLabelErrors": len(bad),
                "recentBuilds": len(recent),
                "maxRecentGapHours": round(max_gap[0].total_seconds() / 3600, 2),
                "maxGapStart": max_gap[1].isoformat() if max_gap[1] else None,
                "maxGapEnd": max_gap[2].isoformat() if max_gap[2] else None,
            }
        )
    )
    if count == 0:
        print("no samples received", file=sys.stderr)
        return 1
    if bad:
        print(bad[:10], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
