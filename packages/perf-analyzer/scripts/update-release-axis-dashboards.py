#!/usr/bin/env python3
"""Keep Grafana's release-axis dashboards dimensionally honest."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "observability/grafana/dashboards"
ANALYZER_METRICS = (
    "t3perf_wall_ms",
    "t3perf_gpu_ms_per_s",
    "t3perf_gpu_process_cpu_ms_per_s",
    "t3perf_script_ms",
    "t3perf_js_heap_bytes",
    "t3perf_layout_count",
    "t3perf_runs",
)
TEST_DIMENSIONS = ("host", "scenario", "surface", "size", "network")
VECTOR_MATCH = re.compile(r"\b(by|on)\s*\(([^)]*)\)")


def preserve_dimensions(match: re.Match[str]) -> str:
    labels = [label.strip() for label in match.group(2).split(",") if label.strip()]
    labels.extend(dimension for dimension in TEST_DIMENSIONS if dimension not in labels)
    return f"{match.group(1)} ({', '.join(labels)})"


def legend_for(expression: str) -> str:
    labels = list(TEST_DIMENSIONS)
    grouped_labels = {
        label.strip()
        for aggregation in re.findall(r"\bby\s*\(([^)]*)\)", expression)
        for label in aggregation.split(",")
    }
    for identifier in ("build", "label"):
        if identifier in grouped_labels:
            labels.insert(0, identifier)
    return " / ".join(f"{{{{{label}}}}}" for label in labels)


def update_dashboard(path: Path) -> None:
    dashboard = json.loads(path.read_text())
    for panel in dashboard.get("panels", []):
        description = panel.get("description")
        if isinstance(description, str) and "run timestamp" in description:
            panel["description"] = (
                "One bar group per release at its npm publication time. "
                "Host, scenario, surface, size, and network remain separate so unlike tests "
                "are never merged."
            )
        for target in panel.get("targets", []):
            expression = target.get("expr")
            if not isinstance(expression, str) or not any(
                metric in expression for metric in ANALYZER_METRICS
            ):
                continue
            target["expr"] = VECTOR_MATCH.sub(preserve_dimensions, expression)
            target["legendFormat"] = legend_for(target["expr"])
    path.write_text(json.dumps(dashboard, indent=2) + "\n")


def main() -> int:
    for path in sorted(ROOT.glob("*.json")):
        update_dashboard(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
