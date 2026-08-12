#!/usr/bin/env python3
"""Deterministic control plane for the personal SwiftUI Dev/Test stream."""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
MANIFEST_PATH = SCRIPT_DIR / "stream.json"
APPROVAL_STATES = {"in-test", "needs-you"}
VALID_DELIVERY = {"direct", "chain", "blocked", "local-only"}
APPROVED_OR_LATER = {
    "approved", "in-dev", "upstream-validation", "needs-pr", "upstream-pr", "landed"
}


def pr_number(url: str | None) -> int | None:
    match = re.search(r"/pull/(\d+)$", url or "")
    return int(match.group(1)) if match else None


def delivery_for(url: str | None) -> tuple[str | None, list[int]]:
    number = pr_number(url)
    if number is None:
        return None, []
    value = load_json(REPO_ROOT / manifest_path_value("prDelivery"))
    record = next(
        (item for item in value.get("pullRequests", []) if item.get("number") == number),
        None,
    )
    if record is None:
        return None, []
    return record["delivery"], record.get("dependsOn", [])


def delivery_state_for(url: str | None) -> str | None:
    number = pr_number(url)
    if number is None:
        return None
    value = load_json(REPO_ROOT / manifest_path_value("prDelivery"))
    record = next(
        (item for item in value.get("pullRequests", []) if item.get("number") == number),
        None,
    )
    return record.get("state") if record else None


def fail(message: str) -> None:
    print(f"[swiftui-stream] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.expanduser().read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {path}: {error}")


def manifest_path_value(key: str) -> str:
    value = load_json(MANIFEST_PATH)
    path = value.get(key)
    if not isinstance(path, str) or not path:
        fail(f"stream.json is missing {key}")
    return path


def manifest() -> dict[str, Any]:
    value = load_json(MANIFEST_PATH)
    validate_manifest(value)
    return value


def validate_manifest(value: dict[str, Any]) -> None:
    if value.get("schemaVersion") != 1:
        fail("stream.json schemaVersion must be 1")
    states = value.get("lifecycle", [])
    if len(states) != len(set(states)) or not states:
        fail("lifecycle states must be non-empty and unique")
    current_build = value.get("currentTestBuild", {}).get("build")
    if not isinstance(current_build, int) or current_build < 1:
        fail("currentTestBuild.build must be a positive integer")
    ids: set[str] = set()
    for feature in value.get("features", []):
        feature_id = feature.get("id")
        if not feature_id or feature_id in ids:
            fail(f"feature id is missing or duplicated: {feature_id}")
        ids.add(feature_id)
        if feature.get("state") not in states:
            fail(f"{feature_id} has invalid state {feature.get('state')}")
        delivery = feature.get("delivery")
        if delivery is not None and delivery not in VALID_DELIVERY:
            fail(f"{feature_id} has invalid delivery {delivery}")
        if delivery == "chain" and not feature.get("dependsOn"):
            fail(f"{feature_id} is a chain PR without dependsOn")
        if feature.get("state") in APPROVED_OR_LATER and not any(
            feature.get(key)
            for key in ("approvedBy", "approvedAt", "approvedInThread", "approvalEvidence", "legacy")
        ):
            fail(f"{feature_id} reached {feature.get('state')} without human approval evidence")
        if feature.get("state") in APPROVED_OR_LATER and not feature.get("legacy"):
            receipt_path = feature.get("approvalReceipt")
            if not isinstance(receipt_path, str) or not receipt_path:
                fail(f"{feature_id} reached {feature.get('state')} without an approval receipt")
            receipt_file = Path(receipt_path).expanduser()
            receipt_root = Path(
                os.environ.get(
                    "SWIFTUI_STREAM_APPROVALS_DIR",
                    str(Path.home() / ".t3/swiftui-stream/approvals"),
                )
            ).expanduser()
            if receipt_root.exists():
                receipt = load_json(receipt_file)
                if receipt.get("featureId") != feature_id or not receipt.get("humanConfirmation"):
                    fail(f"{feature_id} approval receipt does not match confirmed human approval")


def validate_delivery_inventory(value: dict[str, Any], states: list[str]) -> None:
    records = value.get("pullRequests", [])
    numbers = [item.get("number") for item in records]
    if any(not isinstance(number, int) for number in numbers) or len(numbers) != len(set(numbers)):
        fail("PR delivery inventory numbers must be present and unique")
    for item in records:
        delivery = item.get("delivery")
        dependencies = item.get("dependsOn", [])
        if delivery not in VALID_DELIVERY - {"local-only"}:
            fail(f"PR {item['number']} has invalid delivery {delivery}")
        if delivery == "chain" and not dependencies:
            fail(f"PR {item['number']} is a chain without dependencies")
        if delivery == "direct" and dependencies:
            fail(f"direct PR {item['number']} cannot have dependencies")
        if item.get("state") not in states:
            fail(f"PR {item['number']} has invalid state {item.get('state')}")

    legacy = load_json(REPO_ROOT / manifest_path_value("legacyManifest"))
    referenced = {
        number
        for group in ("features", "candidates")
        for item in legacy.get(group, [])
        if (number := pr_number(item.get("pullRequest"))) is not None
    }
    missing = sorted(referenced - set(numbers))
    if missing:
        fail(f"PR delivery inventory is missing legacy PRs: {', '.join(map(str, missing))}")


def normalize(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def legacy_features(value: dict[str, Any]) -> list[dict[str, Any]]:
    path = REPO_ROOT / value["legacyManifest"]
    if not path.exists():
        return []
    legacy = load_json(path)
    records: list[dict[str, Any]] = []
    for index, item in enumerate(legacy.get("features", []), 1):
        delivery, dependencies = delivery_for(item.get("pullRequest"))
        delivery_state = delivery_state_for(item.get("pullRequest"))
        records.append({
            "id": f"legacy-approved-{index}",
            "name": item["name"],
            "aliases": [item.get("sourceBranch", "")],
            "state": delivery_state or "upstream-validation",
            "sourceCommit": item.get("reviewCommit"),
            "integratedCommit": item.get("integratedCommit"),
            "pullRequest": item.get("pullRequest"),
            "delivery": delivery,
            "dependsOnPullRequests": dependencies,
            "legacy": True,
        })
    for index, item in enumerate(legacy.get("candidates", []), 1):
        has_pr = bool(item.get("pullRequest"))
        delivery, dependencies = delivery_for(item.get("pullRequest"))
        delivery_state = delivery_state_for(item.get("pullRequest"))
        records.append({
            "id": f"legacy-candidate-{index}",
            "name": item["name"],
            "aliases": [item.get("sourceBranch", "")],
            "state": delivery_state if has_pr and delivery_state else "upstream-validation",
            "sourceCommit": item.get("sourceCommit"),
            "integratedCommit": item.get("integratedCommit"),
            "pullRequest": item.get("pullRequest"),
            "delivery": delivery,
            "dependsOnPullRequests": dependencies,
            "approvedBy": legacy.get("approvedBy"),
            "approvedAt": legacy.get("approvedAt"),
            "legacy": True,
        })
    return records


def upstream_pr_features(value: dict[str, Any], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    path = REPO_ROOT / value["prDelivery"]
    delivery = load_json(path)
    existing_numbers = {pr_number(item.get("pullRequest")) for item in existing}
    records = []
    for item in delivery.get("pullRequests", []):
        if item["number"] in existing_numbers:
            continue
        records.append({
            "id": f"upstream-pr-{item['number']}",
            "name": item["name"],
            "state": item["state"],
            "pullRequest": f"https://github.com/pingdotgg/t3code/pull/{item['number']}",
            "delivery": item["delivery"],
            "dependsOnPullRequests": item.get("dependsOn", []),
            "validatedAgainst": delivery.get("validatedAgainst"),
            "legacy": True,
        })
    return records


def relevant_thread(title: str, branch: str | None) -> bool:
    value = normalize(f"{title} {branch or ''}")
    explicit = (
        "swiftui", "swift ui", "ios share", "ios live activity", "iphone app",
        "iphone environment", "mobile thread", "new thread list", "dev banner",
        "thread size prefix", "header clearance", "xcode login", "bonjour discovery",
    )
    return any(token in value for token in explicit)


def thread_records(known: list[dict[str, Any]]) -> list[dict[str, Any]]:
    db = Path.home() / ".t3/userdata/state.sqlite"
    if not db.exists():
        return []
    known_threads = {
        feature.get("approvedInThread") or feature.get("sourceThread")
        for feature in known
    }
    connection = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """SELECT thread_id, title, branch, archived_at
               FROM projection_threads
               WHERE deleted_at IS NULL
               ORDER BY created_at, thread_id"""
        ).fetchall()
    finally:
        connection.close()
    records = []
    for thread_id, title, branch, archived_at in rows:
        if thread_id in known_threads or not relevant_thread(title, branch):
            continue
        records.append({
            "id": f"thread-{thread_id.lower()}",
            "name": title,
            "aliases": [branch or ""],
            "state": "blocked" if archived_at else "developing",
            "sourceThread": thread_id,
            "sourceBranch": branch,
            "blockedReason": "migration-triage-required" if archived_at else None,
            "projectionOnly": True,
        })
    return records


def catalog(include_threads: bool = True) -> list[dict[str, Any]]:
    value = manifest()
    records = [dict(feature) for feature in value["features"]]
    records.extend(legacy_features(value))
    records.extend(upstream_pr_features(value, records))
    if include_threads:
        records.extend(thread_records(records))
    return records


def approval_list() -> list[dict[str, Any]]:
    current = manifest().get("currentTestBuild", {})
    build = current.get("build")
    pending = [
        feature for feature in catalog(False)
        if feature.get("state") in APPROVAL_STATES
    ]
    stale = [feature for feature in pending if feature.get("testBuild") != build]
    if stale:
        print(
            f"[swiftui-stream] anomaly: {len(stale)} pending approval record(s) "
            f"do not match current Test build {build}; excluded",
            file=sys.stderr,
        )
    eligible = [feature for feature in pending if feature.get("testBuild") == build]
    return sorted(
        eligible,
        key=lambda feature: (
            feature.get("order", 1_000_000),
            normalize(feature["name"]),
            feature["id"],
        ),
    )


def command_list(args: argparse.Namespace) -> None:
    items = approval_list()
    if args.json:
        print(json.dumps(items, indent=2, sort_keys=True))
        return
    if not items:
        print("No Test features are waiting for approval.")
        return
    for index, feature in enumerate(items, 1):
        build = feature.get("testBuild")
        print(f"{index}. {feature['name']} [Test build {build}]")


def score(query: str, feature: dict[str, Any]) -> float:
    target = " ".join([feature["name"], feature["id"], *feature.get("aliases", [])])
    query_words = set(normalize(query).split())
    target_words = set(normalize(target).split())
    overlap = len(query_words & target_words) / max(1, len(query_words))
    ratio = difflib.SequenceMatcher(None, normalize(query), normalize(target)).ratio()
    exact_bonus = 0.5 if normalize(query) in normalize(target) else 0.0
    return overlap * 0.65 + ratio * 0.35 + exact_bonus


def command_match(args: argparse.Namespace) -> None:
    ranked = sorted(
        ((score(args.query, item), item) for item in approval_list()),
        key=lambda pair: (-pair[0], normalize(pair[1]["name"]), pair[1]["id"]),
    )
    shortlist = [
        {"score": round(value, 3), **item}
        for value, item in ranked[: args.limit]
        if value >= 0.2
    ]
    print(json.dumps(shortlist, indent=2, sort_keys=True))


def command_status(args: argparse.Namespace) -> None:
    items = catalog(args.threads)
    states: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        states.setdefault(item["state"], []).append(item)
    if args.json:
        print(json.dumps({"states": states, "total": len(items)}, indent=2, sort_keys=True))
        return
    for state in manifest()["lifecycle"]:
        group = states.get(state, [])
        if not group:
            continue
        print(f"{state}: {len(group)}")
        if args.verbose:
            for item in group:
                print(f"  - {item['name']} ({item['id']})")


def git(*arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments], cwd=REPO_ROOT, text=True, capture_output=True
    )
    if result.returncode:
        fail(result.stderr.strip() or f"git {' '.join(arguments)} failed")
    return result.stdout.strip()


def command_verify_branches(_: argparse.Namespace) -> None:
    refs = manifest()["branches"]
    resolved = {}
    for name in ("theo", "dev", "test"):
        ref = refs[name]
        resolved[name] = git("rev-parse", "--verify", f"{ref}^{{commit}}")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", resolved["theo"], resolved["dev"]],
        cwd=REPO_ROOT,
    ).returncode:
        fail("Theo is not an ancestor of Dev")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", resolved["dev"], resolved["test"]],
        cwd=REPO_ROOT,
    ).returncode:
        fail("Dev is not an ancestor of Test")
    print(json.dumps(resolved, indent=2, sort_keys=True))


def command_validate_pr(args: argparse.Namespace) -> None:
    text = Path(args.body).read_text() if args.body else sys.stdin.read()
    fields = {
        "Delivery": r"(?mi)^Delivery:\s*(direct|chain|blocked)\s*$",
        "Validated against Theo commit": r"(?mi)^Validated against Theo commit:\s*([0-9a-f]{7,40})\s*$",
        "Depends on": r"(?mi)^Depends on:\s*.+$",
        "Merge order": r"(?mi)^Merge order:\s*.+$",
        "Validation status": r"(?mi)^Validation status:\s*.+$",
    }
    missing = [name for name, pattern in fields.items() if not re.search(pattern, text)]
    if missing:
        fail(f"PR delivery block is missing or invalid: {', '.join(missing)}")
    delivery = re.search(fields["Delivery"], text).group(1)
    validated_commit = re.search(fields["Validated against Theo commit"], text).group(1)
    depends_on = re.search(fields["Depends on"], text).group(0).split(":", 1)[1].strip()
    merge_order = re.search(fields["Merge order"], text).group(0).split(":", 1)[1].strip()
    dependencies = [int(number) for number in re.findall(r"#(\d+)", depends_on)]
    ordered = [int(number) for number in re.findall(r"#(\d+)", merge_order)]
    if delivery == "direct" and (depends_on.lower() != "none" or dependencies):
        fail("a direct PR must say 'Depends on: none'")
    if delivery == "direct" and merge_order.lower() != "this pr only":
        fail("a direct PR must say 'Merge order: this PR only'")
    if delivery == "chain" and not dependencies:
        fail("a chain PR must name at least one dependency")
    if delivery == "chain" and ordered[: len(dependencies)] != dependencies:
        fail("a chain PR merge order must begin with its dependencies in declared order")
    if delivery == "blocked" and depends_on.lower() == "none":
        fail("a blocked PR must name its blocker in Depends on")
    if args.number is not None:
        inventory = load_json(REPO_ROOT / manifest_path_value("prDelivery"))
        expected = next(
            (item for item in inventory.get("pullRequests", []) if item["number"] == args.number),
            None,
        )
        if expected is None:
            fail(f"PR {args.number} is absent from the delivery inventory")
        if delivery != expected["delivery"] or dependencies != expected.get("dependsOn", []):
            fail(
                f"PR {args.number} body does not match inventory delivery/dependencies"
            )
    theo = git("rev-parse", manifest()["branches"]["theo"])
    resolved = git("rev-parse", validated_commit)
    if resolved != theo:
        fail(f"validated Theo commit {resolved} is not the current Theo tip {theo}")
    print("PR delivery block valid")


def queue_items(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    value = load_json(path)
    return value if isinstance(value, list) else value.get("queue", [])


def command_queue(args: argparse.Namespace) -> None:
    items = queue_items(Path(args.path).expanduser())
    item_ids = [item.get("id") for item in items]
    if any(not item_id for item_id in item_ids) or len(item_ids) != len(set(item_ids)):
        fail("promotion queue ids must be present and unique")
    by_id = {item["id"]: item for item in items}
    unknown = sorted({
        dependency
        for item in items
        for dependency in item.get("dependsOn", [])
        if dependency not in by_id
    })
    if unknown:
        fail(f"promotion queue has unresolved dependencies: {', '.join(unknown)}")
    pending = set(by_id)
    ordered: list[dict[str, Any]] = []
    while pending:
        ready = [
            by_id[item_id] for item_id in pending
            if all(dep not in pending for dep in by_id[item_id].get("dependsOn", []))
        ]
        ready.sort(key=lambda item: (item.get("approvedAt", ""), normalize(item["id"])))
        if not ready:
            fail("promotion queue contains a dependency cycle")
        for item in ready:
            pending.remove(item["id"])
            ordered.append(item)
    if args.json:
        print(json.dumps(ordered, indent=2, sort_keys=True))
    else:
        for index, item in enumerate(ordered, 1):
            print(f"{index}. {item['id']}")


def command_validate(_: argparse.Namespace) -> None:
    value = manifest()
    validate_delivery_inventory(load_json(REPO_ROOT / value["prDelivery"]), value["lifecycle"])
    records = catalog(False)
    if len({item["id"] for item in records}) != len(records):
        fail("catalog contains duplicate ids")
    for item in records:
        if item.get("state") not in value["lifecycle"]:
            fail(f"catalog record {item['id']} has invalid state {item.get('state')}")
        if item.get("delivery") is not None and item.get("delivery") not in VALID_DELIVERY:
            fail(f"catalog record {item['id']} has invalid delivery {item.get('delivery')}")
    print(f"stream manifest valid: {len(records)} durable feature records")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.set_defaults(func=command_validate)
    status = commands.add_parser("status")
    status.add_argument("--json", action="store_true")
    status.add_argument("--verbose", action="store_true")
    status.add_argument("--no-threads", dest="threads", action="store_false")
    status.set_defaults(func=command_status, threads=True)
    listing = commands.add_parser("approval-list")
    listing.add_argument("--json", action="store_true")
    listing.set_defaults(func=command_list)
    matching = commands.add_parser("match")
    matching.add_argument("query")
    matching.add_argument("--limit", type=int, default=5)
    matching.set_defaults(func=command_match)
    verify = commands.add_parser("verify-branches")
    verify.set_defaults(func=command_verify_branches)
    pr = commands.add_parser("validate-pr-body")
    pr.add_argument("--body")
    pr.add_argument("--number", type=int)
    pr.set_defaults(func=command_validate_pr)
    queue = commands.add_parser("queue-order")
    queue.add_argument("--path", default="~/.t3/swiftui-stream/promotion-queue.json")
    queue.add_argument("--json", action="store_true")
    queue.set_defaults(func=command_queue)
    return result


if __name__ == "__main__":
    arguments = parser().parse_args()
    arguments.func(arguments)
