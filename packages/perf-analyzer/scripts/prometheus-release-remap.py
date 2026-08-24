#!/usr/bin/env python3
"""Re-emit archived Prometheus samples at authoritative release timestamps."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path


METRICS = {
    "t3perf_wall_ms": ("t3perf.wall_ms", "ms"),
    "t3perf_gpu_ms_per_s": ("t3perf.gpu_ms_per_s", "ms/s"),
    "t3perf_gpu_process_cpu_ms_per_s": ("t3perf.gpu_process_cpu_ms_per_s", "ms/s"),
    "t3perf_script_ms": ("t3perf.script_ms", "ms"),
    "t3perf_js_heap_bytes": ("t3perf.js_heap_bytes", "By"),
    "t3perf_layout_count": ("t3perf.layout_count", "1"),
    "t3perf_runs": ("t3perf.runs", "1"),
}
LINE = re.compile(r"^\{(.*)\}\s+([^ ]+)\s+(\d+)$")
LABEL = re.compile(r'(\w+)="((?:\\.|[^"\\])*)"')


def parse_labels(raw: str) -> dict[str, str]:
    return {
        key: json.loads(f'"{encoded}"')
        for key, encoded in LABEL.findall(raw)
    }


def unix_nano(iso: str) -> str:
    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return str(int(parsed.timestamp() * 1_000_000_000))


def attributes(labels: dict[str, str]) -> list[dict]:
    return [
        {"key": key, "value": {"stringValue": value}}
        for key, value in sorted(labels.items())
    ]


def send(endpoint: str, points: list[tuple[str, str, float, str, dict[str, str]]]) -> None:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for name, unit, value, timestamp, labels in points:
        grouped[(name, unit)].append(
            {
                "attributes": attributes(labels),
                "timeUnixNano": timestamp,
                "asDouble": value,
            }
        )
    payload = {
        "resourceMetrics": [
            {
                "resource": {
                    "attributes": [
                        {
                            "key": "service.name",
                            "value": {"stringValue": "t3-perf-analyzer"},
                        }
                    ]
                },
                "scopeMetrics": [
                    {
                        "scope": {"name": "t3perf-release-remap"},
                        "metrics": [
                            {
                                "name": name,
                                "unit": unit,
                                "gauge": {"dataPoints": data_points},
                            }
                            for (name, unit), data_points in sorted(grouped.items())
                        ],
                    }
                ],
            }
        ]
    }
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/v1/metrics",
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"OTLP returned HTTP {response.status}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump-gzip", required=True, type=Path)
    parser.add_argument("--registry-json", required=True, type=Path)
    parser.add_argument("--host", required=True)
    parser.add_argument("--otlp")
    parser.add_argument("--state-file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.otlp:
        parser.error("--otlp is required unless --dry-run is used")

    registry = json.loads(args.registry_json.read_text())
    release_times = registry.get("time", {})
    exported = set()
    if args.state_file is not None and args.state_file.exists():
        exported = set(json.loads(args.state_file.read_text()).get("exported", []))
    deduplicated: dict[
        tuple[str, tuple[tuple[str, str], ...], str],
        tuple[str, str, float, str, dict[str, str]],
    ] = {}
    skipped = 0
    skipped_exported = 0
    with gzip.open(args.dump_gzip, "rt") as source:
        for line in source:
            match = LINE.match(line.rstrip())
            if match is None:
                skipped += 1
                continue
            labels = parse_labels(match.group(1))
            metric = METRICS.get(labels.pop("__name__", ""))
            build = labels.get("build")
            if metric is None or labels.get("host") != args.host or build not in release_times:
                continue
            labels.pop("job", None)
            labels["time_basis"] = "release"
            timestamp = unix_nano(release_times[build])
            value = float(match.group(2))
            key = (metric[0], tuple(sorted(labels.items())), timestamp)
            deduplicated[key] = (metric[0], metric[1], value, timestamp, labels)

    pending: dict[str, tuple[str, str, float, str, dict[str, str]]] = {}
    for key, point in deduplicated.items():
        fingerprint = hashlib.sha256(
            json.dumps(key, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        if fingerprint in exported:
            skipped_exported += 1
            continue
        pending[fingerprint] = point
    points = list(pending.values())
    if not args.dry_run:
        for start in range(0, len(points), 2_000):
            send(args.otlp, points[start : start + 2_000])
        if args.state_file is not None and pending:
            args.state_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = args.state_file.with_suffix(args.state_file.suffix + ".new")
            temporary.write_text(
                json.dumps({"version": 1, "exported": sorted(exported | pending.keys())}) + "\n"
            )
            temporary.replace(args.state_file)
    versions = sorted({point[4]["build"] for point in points})
    print(
        json.dumps(
            {
                "host": args.host,
                "points": len(points),
                "versions": len(versions),
                "skippedMalformed": skipped,
                "skippedAlreadyExported": skipped_exported,
                "dryRun": args.dry_run,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
