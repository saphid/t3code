"""Board status report for the SwiftUI delivery pipeline.

Reads every open issue in the work-item repository, extracts each
``swiftui-work-item-v2`` fenced block, and reports exactly where every piece
of work sits: its stage, its lane, and whether that stage is a WIP-limited
station or an unbounded buffer. Read-only; the only external call is ``gh``.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
STAGE_ORDER = (
    "queued", "active", "proof-ready", "phone-test",
    "accepted", "pr-open", "landed", "cancelled", "superseded",
)
FENCE = re.compile(
    r"```swiftui-work-item-v2\s*\n(.*?)\n```", re.DOTALL)


def load_contract(path=None):
    contract_path = Path(path) if path else PACKAGE_DIR / "contract.json"
    return json.loads(contract_path.read_text())


def fetch_issues(repository, limit=1000, gh_runner=None):
    run = gh_runner or (lambda cmd: subprocess.run(
        cmd, capture_output=True, text=True, timeout=120))
    result = run([
        "gh", "issue", "list", "-R", repository, "--state", "open",
        "--limit", str(limit), "--json", "number,title,labels,body",
    ])
    if result.returncode != 0:
        raise RuntimeError(
            "gh issue list failed (%d): %s" % (
                result.returncode, result.stderr.strip()[:300]))
    issues = json.loads(result.stdout)
    if len(issues) >= limit:
        raise RuntimeError(
            "issue list hit the %d cap; raise --limit so the report stays "
            "complete" % limit)
    return issues


def extract_work_item(body):
    match = FENCE.search(body or "")
    if not match:
        return None, None
    try:
        return json.loads(match.group(1)), None
    except ValueError as error:
        return None, "invalid work-item JSON: %s" % error


def lane_labels(issue):
    return [l["name"] for l in issue.get("labels", [])
            if l["name"].startswith("lane:")]


def build_report(issues, contract):
    flow = contract.get("flowPolicy", {})
    limits = flow.get("wipLimits", {})
    rows, drift = [], []
    for issue in issues:
        item, error = extract_work_item(issue.get("body"))
        labels = lane_labels(issue)
        if item is None:
            if labels or error:
                drift.append({
                    "issue": issue["number"], "title": issue["title"],
                    "problem": error or (
                        "has %s but no swiftui-work-item-v2 block"
                        % ", ".join(labels)),
                })
            continue
        stage = item.get("stage", "unknown")
        row = {
            "issue": issue["number"],
            "title": issue["title"],
            "lane": item.get("laneId", "?"),
            "stage": stage,
            "hold": (item.get("hold") or {}).get("reason"),
        }
        rows.append(row)
        terminal = stage in ("landed", "cancelled", "superseded")
        if len(labels) > 1:
            drift.append({
                "issue": issue["number"], "title": issue["title"],
                "problem": "multiple lane labels: %s" % ", ".join(labels),
            })
        elif not labels and not terminal:
            drift.append({
                "issue": issue["number"], "title": issue["title"],
                "problem": "block stage %s but no lane:* label" % stage,
            })
        elif labels and labels[0] != "lane:%s" % stage:
            drift.append({
                "issue": issue["number"], "title": issue["title"],
                "problem": "label %s disagrees with block stage %s"
                           % (labels[0], stage),
            })
    rows.sort(key=lambda r: (
        STAGE_ORDER.index(r["stage"]) if r["stage"] in STAGE_ORDER else 99,
        r["issue"]))
    counts = {}
    for row in rows:
        counts[row["stage"]] = counts.get(row["stage"], 0) + 1
    stations = {
        "activeImplementation": {
            "occupied": counts.get("active", 0),
            "limit": limits.get("activeImplementation"),
        },
        "phoneVerification": {
            "occupied": counts.get("phone-test", 0),
            "limit": limits.get("phoneVerification"),
        },
        "simulatorProof": {
            "occupied": None,
            "limit": limits.get("simulatorProof"),
            "note": "not derivable from issue state; see simulator-lane "
                    "lease receipts",
        },
    }
    backlog_floor = flow.get("backlog", {}).get("minQueuedReady")
    queued_unheld = sum(1 for r in rows
                        if r["stage"] == "queued" and not r["hold"])
    return {
        "workItems": rows,
        "stageCounts": counts,
        "stations": stations,
        "queuedReady": queued_unheld,
        "readinessBasis":
            "unheld queued items; dependency closure not evaluated here",
        "backlogFloor": backlog_floor,
        "backlogNeedsReplenish": (
            backlog_floor is not None
            and queued_unheld < backlog_floor),
        "drift": drift,
    }


def render_text(report, repository):
    out = []
    out.append("SwiftUI delivery board - %s" % repository)
    out.append("")
    if report["workItems"]:
        width = max(len(r["title"]) for r in report["workItems"])
        width = min(width, 52)
        for row in report["workItems"]:
            hold = "  [HOLD: %s]" % row["hold"] if row["hold"] else ""
            out.append("#%-5d %-*.*s  %-12s lane=%s%s" % (
                row["issue"], width, width, row["title"],
                row["stage"], row["lane"], hold))
    else:
        out.append("(no open issues carry a swiftui-work-item-v2 block)")
    out.append("")
    out.append("Stations (occupied/limit):")
    for name, s in report["stations"].items():
        limit = s["limit"] if s["limit"] is not None else "?"
        if s["occupied"] is None:
            out.append("  %-22s ?/%s (%s)" % (name, limit,
                                              s.get("note", "unavailable")))
            continue
        flag = ""
        if s["limit"] is not None and s["occupied"] > s["limit"]:
            flag = "  OVER LIMIT"
        out.append("  %-22s %s/%s%s" % (name, s["occupied"], limit, flag))
    out.append("Buffers: " + ", ".join(
        "%s=%d" % (stage, count)
        for stage, count in sorted(report["stageCounts"].items())
        if stage not in ("active", "phone-test")) or "Buffers: none")
    if report["backlogFloor"] is not None:
        state = ("REPLENISH (%d < floor %d)" % (
            report["queuedReady"], report["backlogFloor"])
            if report["backlogNeedsReplenish"]
            else "ok (%d >= floor %d)" % (
                report["queuedReady"], report["backlogFloor"]))
        out.append("Backlog: " + state)
    if report["drift"]:
        out.append("")
        out.append("DRIFT (%d):" % len(report["drift"]))
        for d in report["drift"]:
            out.append("  #%d %s - %s" % (
                d["issue"], d["title"][:40], d["problem"]))
    return "\n".join(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--repo", default=None,
                        help="override workItemRepository")
    parser.add_argument("--contract", default=None)
    args = parser.parse_args(argv)
    contract = load_contract(args.contract)
    repository = args.repo or contract.get(
        "workItemRepository", "saphid/t3code-personal")
    issues = fetch_issues(repository)
    report = build_report(issues, contract)
    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print(render_text(report, repository))
    return 1 if report["drift"] else 0


if __name__ == "__main__":
    sys.exit(main())
