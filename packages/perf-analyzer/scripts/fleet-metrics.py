#!/usr/bin/env python3
"""Export the fleet scheduler's SQLite projection as current OTLP gauges."""

from __future__ import annotations

import json
import sqlite3
import time
import urllib.request
from datetime import datetime
from pathlib import Path


DB = Path.home() / "t3-perf-fleet/control/fleet.sqlite"
OTLP = "http://127.0.0.1:4318/v1/metrics"
JOB_STATES = ("completed", "queued", "leased", "external", "failed")


def attributes(labels: dict[str, str]) -> list[dict]:
    return [
        {"key": key, "value": {"stringValue": value}}
        for key, value in sorted(labels.items())
    ]


def metric(name: str, points: list[tuple[float, dict[str, str]]], timestamp: str) -> dict:
    return {
        "name": name,
        "unit": "1",
        "gauge": {
            "dataPoints": [
                {
                    "attributes": attributes(labels),
                    "timeUnixNano": timestamp,
                    "asDouble": value,
                }
                for value, labels in points
            ]
        },
    }


def main() -> int:
    connection = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    observed_counts = dict(connection.execute("SELECT state, count(*) FROM jobs GROUP BY state"))
    state_counts = {state: observed_counts.get(state, 0) for state in JOB_STATES}
    completed_by_worker = connection.execute(
        "SELECT worker_id, count(*) AS count FROM jobs "
        "WHERE state='completed' AND worker_id IS NOT NULL GROUP BY worker_id"
    ).fetchall()
    workers = connection.execute(
        "SELECT worker_id, status, current_version, last_seen_at FROM workers ORDER BY worker_id"
    ).fetchall()
    connection.close()

    timestamp = str(time.time_ns())
    metrics = [
        metric(
            "t3perf.fleet.jobs",
            [(float(count), {"state": state}) for state, count in sorted(state_counts.items())],
            timestamp,
        ),
        metric(
            "t3perf.fleet.worker.completed",
            [(float(row["count"]), {"host": row["worker_id"]}) for row in completed_by_worker],
            timestamp,
        ),
        metric(
            "t3perf.fleet.worker.heartbeat.unixtime",
            [
                (
                    float(
                        datetime.fromisoformat(
                            row["last_seen_at"].replace("Z", "+00:00")
                        ).timestamp()
                    ),
                    {"host": row["worker_id"]},
                )
                for row in workers
            ],
            timestamp,
        ),
        metric(
            "t3perf.fleet.worker.busy",
            [
                (
                    1.0 if row["status"] == "busy" else 0.0,
                    {
                        "host": row["worker_id"],
                        "version": row["current_version"] or "idle",
                    },
                )
                for row in workers
            ],
            timestamp,
        ),
    ]
    payload = {
        "resourceMetrics": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "t3-perf-fleet"}}
                    ]
                },
                "scopeMetrics": [
                    {"scope": {"name": "t3-perf-fleet-state"}, "metrics": metrics}
                ],
            }
        ]
    }
    request = urllib.request.Request(
        OTLP,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"OTLP returned HTTP {response.status}")
    print(json.dumps({"states": state_counts, "workers": len(workers)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
