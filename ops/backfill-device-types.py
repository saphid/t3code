#!/usr/bin/env python3
"""Re-emit archived Prometheus samples with a separate device_type label."""

from __future__ import annotations

import argparse
import gzip
import json
import re
import urllib.request
from collections import defaultdict
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
DEVICE_TYPES = {
    "lxso1": "Linux i7-8700 worker",
    "lxso2": "Linux i7-8700 worker",
    "lxso3": "Linux i7-8700 worker",
    "AUS-M5P-AS": "MacBook Pro",
}
LINE = re.compile(r"^\{(.*)\}\s+([^ ]+)\s+(\d+)$")
LABEL = re.compile(r'(\w+)="((?:\\.|[^"\\])*)"')


def parse_labels(raw: str) -> dict[str, str]:
    return {key: json.loads(f'"{encoded}"') for key, encoded in LABEL.findall(raw)}


def attributes(labels: dict[str, str]) -> list[dict]:
    return [
        {"key": key, "value": {"stringValue": value}}
        for key, value in sorted(labels.items())
    ]


def send(endpoint: str, points: list[tuple[str, str, float, str, dict[str, str]]]) -> None:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for name, unit, value, timestamp_ms, labels in points:
        grouped[(name, unit)].append(
            {
                "attributes": attributes(labels),
                "timeUnixNano": str(int(timestamp_ms) * 1_000_000),
                "asDouble": value,
            }
        )
    payload = {
        "resourceMetrics": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "t3-perf-analyzer"}}
                    ]
                },
                "scopeMetrics": [
                    {
                        "scope": {"name": "t3perf-device-type-backfill"},
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
    parser.add_argument("--otlp")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.dry_run and not args.otlp:
        parser.error("--otlp is required unless --dry-run is used")

    deduplicated: dict[
        tuple[str, tuple[tuple[str, str], ...], str],
        tuple[str, str, float, str, dict[str, str]],
    ] = {}
    skipped = 0
    unmapped_hosts: set[str] = set()
    with gzip.open(args.dump_gzip, "rt") as source:
        for line in source:
            match = LINE.match(line.rstrip())
            if match is None:
                skipped += 1
                continue
            labels = parse_labels(match.group(1))
            metric = METRICS.get(labels.pop("__name__", ""))
            if metric is None or labels.get("time_basis") != "release":
                continue
            host = labels.get("host", "")
            device_type = DEVICE_TYPES.get(host)
            if device_type is None:
                unmapped_hosts.add(host)
                continue
            labels.pop("job", None)
            labels["device_type"] = device_type
            timestamp_ms = match.group(3)
            key = (metric[0], tuple(sorted(labels.items())), timestamp_ms)
            deduplicated[key] = (metric[0], metric[1], float(match.group(2)), timestamp_ms, labels)

    if unmapped_hosts:
        raise RuntimeError(f"unmapped hosts: {sorted(unmapped_hosts)}")
    points = list(deduplicated.values())
    if not args.dry_run:
        for start in range(0, len(points), 2_000):
            send(args.otlp, points[start : start + 2_000])
    print(
        json.dumps(
            {
                "points": len(points),
                "versions": len({point[4].get("build", "") for point in points}),
                "hosts": sorted({point[4]["host"] for point in points}),
                "deviceTypes": sorted({point[4]["device_type"] for point in points}),
                "skippedMalformed": skipped,
                "dryRun": args.dry_run,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
