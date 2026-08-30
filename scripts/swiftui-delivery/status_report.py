"""Board status report for the SwiftUI delivery pipeline.

Reads every open issue in the work-item repository, extracts each
``swiftui-work-item-v2`` fenced block, and reports exactly where every piece
of work sits. GitHub, receipt roots, and the live T3 projection are read-only;
``--html`` writes only the requested self-contained snapshot.
"""

import argparse
import hashlib
import html
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import urlopen

PACKAGE_DIR = Path(__file__).resolve().parent
STAGE_ORDER = (
    "queued", "active", "proof-ready", "phone-test",
    "accepted", "pr-open", "landed", "cancelled", "superseded",
)
FENCE = re.compile(
    r"```swiftui-work-item-v2\s*\n(.*?)\n```", re.DOTALL)
GITHUB_URL = re.compile(
    r"https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/(issues|pull)/([1-9][0-9]*)")
SHORT_GITHUB_REF = re.compile(
    r"(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)#([1-9][0-9]*)")
GRAPHQL_ISSUES = """
query($owner:String!,$name:String!,$first:Int!,$cursor:String) {
  repository(owner:$owner,name:$name) {
    issues(first:$first,after:$cursor,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}) {
      nodes {
        number title url body createdAt updatedAt state
        labels(first:50) { nodes { name color description } }
        comments(last:100) { totalCount nodes { body createdAt url author { login } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""
GRAPHQL_CONTROLLER_ISSUES = """
query($owner:String!,$name:String!,$first:Int!,$cursor:String) {
  repository(owner:$owner,name:$name) {
    issues(first:$first,after:$cursor,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}) {
      nodes {
        number title url body createdAt updatedAt state
        labels(first:50) { nodes { name color description } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""
RECEIPT_KINDS = {
    "swiftui-launch-receipt",
    "swiftui-coordinator-dispatch-receipt",
    "swiftui-feature-worker-summary",
    "swiftui-generation-receipt",
    "swiftui-external-landing-receipt",
    "swiftui-uat-thread-receipt",
    "swiftui-proof",
    "swiftui-evidence-inspection",
    "swiftui-phone-acceptance-receipt",
}
RECEIPT_NAME_HINTS = (
    "launch-receipt", "dispatch-receipt", "worker-summary",
    "generation-receipt", "landing-receipt", "uat-thread",
    "proof", "inspection", "acceptance",
)
SCAN_PRUNE = {
    ".git", ".build", "Build", "DerivedData", "SourcePackages",
    "build-products", "test-products", "xcb-derived", "xcresult",
    "Pods", "node_modules",
}


def load_contract(path=None):
    contract_path = Path(path) if path else PACKAGE_DIR / "contract.json"
    return json.loads(contract_path.read_text())


def fetch_issues(repository, limit=1000, gh_runner=None, include_comments=True):
    run = gh_runner or (lambda cmd: subprocess.run(
        cmd, capture_output=True, text=True, timeout=120))
    parts = repository.split("/", 1)
    if len(parts) != 2:
        raise RuntimeError("repository must be owner/name")
    issues, cursor = [], None
    while True:
        remaining = limit - len(issues)
        if remaining <= 0:
            raise RuntimeError(
                "issue list hit the internal %d-item safety cap" % limit)
        cmd = [
            "gh", "api", "graphql", "-f", "query=%s" % (
                GRAPHQL_ISSUES if include_comments else GRAPHQL_CONTROLLER_ISSUES),
            "-f", "owner=%s" % parts[0], "-f", "name=%s" % parts[1],
            "-F", "first=%d" % min(100, remaining),
        ]
        if cursor:
            cmd.extend(["-f", "cursor=%s" % cursor])
        result = run(cmd)
        if result.returncode != 0:
            raise RuntimeError(
                "gh issue query failed (%d): %s" % (
                    result.returncode, result.stderr.strip()[:300]))
        try:
            connection = json.loads(result.stdout)["data"]["repository"]["issues"]
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError("gh issue query returned invalid JSON: %s" % error)
        for node in connection.get("nodes") or []:
            node["labels"] = (node.get("labels") or {}).get("nodes") or []
            comments = node.get("comments") or {}
            node["comments"] = comments.get("nodes") or []
            node["commentsTruncated"] = (comments.get("totalCount") or 0) > 100
            issues.append(node)
        page = connection.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            return issues
        cursor = page.get("endCursor")
        if not cursor:
            raise RuntimeError("gh issue query has another page but no cursor")


def extract_work_item(body):
    matches = FENCE.findall(body or "")
    if not matches:
        return None, None
    if len(matches) > 1:
        return None, "%d swiftui-work-item-v2 blocks; exactly one is allowed" \
            % len(matches)
    try:
        value = json.loads(matches[0])
        if not isinstance(value, dict):
            return None, "work-item JSON must be an object"
        return value, None
    except ValueError as error:
        return None, "invalid work-item JSON: %s" % error


def lane_labels(issue):
    return [l["name"] for l in issue.get("labels", [])
            if l["name"].startswith("lane:")]


def compact_markdown(value, limit=240):
    text = value or ""
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_`>|]", "", text)
    paragraphs = [re.sub(r"\s+", " ", part).strip()
                  for part in re.split(r"\n\s*\n", text)]
    generic = {"problem", "outcome", "update", "status", "progress"}
    summary = next((part for part in paragraphs
                    if part and part.lower() not in generic), "")
    if len(summary) > limit:
        summary = summary[:limit - 1].rstrip() + "…"
    return summary


def last_progress(issue):
    comments = issue.get("comments") or []
    if comments:
        comment = comments[-1]
        summary = compact_markdown(comment.get("body"))
        if summary:
            return {
                "text": summary,
                "at": comment.get("createdAt"),
                "url": comment.get("url"),
                "author": (comment.get("author") or {}).get("login"),
                "source": "comment",
            }
    summary = compact_markdown(issue.get("body"))
    return ({
        "text": summary,
        "at": issue.get("updatedAt"),
        "url": issue.get("url"),
        "author": None,
        "source": "issue",
    } if summary else None)


def github_ref(repository, kind, number):
    path = "pull" if kind == "pull" else "issues"
    return {
        "repository": repository,
        "kind": kind,
        "number": int(number),
        "url": "https://github.com/%s/%s/%s" % (repository, path, number),
    }


def upstream_refs(issue, item, work_repository):
    refs, seen = [], set()

    def add(repository, kind, number):
        if not isinstance(repository, str) or kind not in ("issue", "pull"):
            return
        key = (repository.lower(), kind, int(number))
        if repository.lower() == (work_repository or "").lower() or key in seen:
            return
        counterpart = (repository.lower(),
                       "issue" if kind == "pull" else "pull", int(number))
        if kind == "issue" and counterpart in seen:
            return
        if kind == "pull" and counterpart in seen:
            seen.remove(counterpart)
            refs[:] = [ref for ref in refs if not (
                ref["repository"].lower() == repository.lower()
                and ref["number"] == int(number)
                and ref["kind"] == "issue")]
        seen.add(key)
        refs.append(github_ref(repository, kind, number))

    raw_classification = item.get("classification")
    recorded_value = (raw_classification.get("upstream")
                      if isinstance(raw_classification, dict) else None)
    recorded = recorded_value if isinstance(recorded_value, list) else []
    for value in recorded:
        if not isinstance(value, dict):
            continue
        reference = value.get("reference")
        kind = value.get("kind")
        match = SHORT_GITHUB_REF.fullmatch(
            reference if isinstance(reference, str) else "")
        if match:
            add("%s/%s" % (match.group(1), match.group(2)),
                kind, match.group(3))
    source = issue.get("body") or ""
    for comment in issue.get("comments") or []:
        source += "\n" + (comment.get("body") or "")
    for match in GITHUB_URL.finditer(source):
        add("%s/%s" % (match.group(1), match.group(2)),
            "pull" if match.group(3) == "pull" else "issue", match.group(4))
    refs.sort(key=lambda ref: (ref["repository"], ref["number"], ref["kind"]))
    return refs


def issue_identity_url(value):
    match = SHORT_GITHUB_REF.fullmatch(value if isinstance(value, str) else "")
    if not match:
        return None
    return "https://github.com/%s/%s/issues/%s" % match.groups()


def responsibility(stage, hold, thread_state=None, waiting=None):
    if hold:
        return {"owner": "SwiftUI orchestra", "reason": "Resolve hold: %s" % hold}
    if waiting and stage in ("queued", "active"):
        return {"owner": "SwiftUI orchestra", "reason": waiting}
    if stage == "active":
        if thread_state and thread_state.get("state") == "running":
            return {
                "owner": thread_state.get("title") or "Bound worker",
                "reason": "Worker turn is running",
            }
        return {
            "owner": "SwiftUI orchestra",
            "reason": "Start, wake, or advance the worker",
        }
    owners = {
        "queued": ("SwiftUI orchestra", "Pull into an open implementation slot"),
        "proof-ready": ("SwiftUI orchestra", "Publish the next Test generation"),
        "phone-test": ("Alex", "Accept or reject the installed phone build"),
        "accepted": ("SwiftUI orchestra", "Prepare the authorized upstream handoff"),
        "pr-open": ("PR babysitter + upstream maintainer", "Keep the PR current and reviewed"),
        "landed": ("No active owner", "Landed"),
        "cancelled": ("No active owner", "Cancelled"),
        "superseded": ("No active owner", "Superseded"),
    }
    owner, reason = owners.get(stage, ("SwiftUI orchestra", "Reconcile unknown stage"))
    return {"owner": owner, "reason": reason}


def dashboard_shape_problems(item, categories, surfaces):
    problems = []
    if item.get("classification") is not None and not isinstance(
            item.get("classification"), dict):
        problems.append("classification must be an object")
    classification = item.get("classification")
    if isinstance(classification, dict):
        category = classification.get("category")
        if not isinstance(category, str) or category not in categories:
            problems.append("classification.category is invalid")
        surface = classification.get("surface")
        if not isinstance(surface, str) or surface not in surfaces:
            problems.append("classification.surface is invalid")
        upstream = classification.get("upstream")
        if not isinstance(upstream, list):
            problems.append("classification.upstream must be an array")
        elif isinstance(upstream, list):
            for index, reference in enumerate(upstream):
                if not isinstance(reference, dict):
                    problems.append(
                        "classification.upstream[%d] must be an object" % index)
                    continue
                if reference.get("kind") not in ("issue", "pull"):
                    problems.append(
                        "classification.upstream[%d].kind is invalid" % index)
                if not isinstance(reference.get("reference"), str) or not \
                        SHORT_GITHUB_REF.fullmatch(reference.get("reference") or ""):
                    problems.append(
                        "classification.upstream[%d].reference is invalid" % index)
    if item.get("hold") is not None and not isinstance(item.get("hold"), dict):
        problems.append("hold must be an object")
    acceptance = item.get("acceptance")
    if acceptance is not None and (not isinstance(acceptance, list) or not all(
            isinstance(point, str) for point in acceptance)):
        problems.append("acceptance must be an array of strings")
    dependencies = item.get("dependencies")
    if dependencies is not None and (not isinstance(dependencies, list) or not all(
            isinstance(dependency, dict) for dependency in dependencies)):
        problems.append("dependencies must be an array of objects")
    if item.get("binding") is not None and not isinstance(item.get("binding"), dict):
        problems.append("binding must be an object")
    binding = item.get("binding")
    if isinstance(binding, dict):
        for field, value in binding.items():
            if field.endswith("Sha256") and value is not None and not isinstance(value, str):
                problems.append("binding.%s must be a string" % field)
    if item.get("stage") is not None and not isinstance(item.get("stage"), str):
        problems.append("stage must be a string")
    return problems


def build_report(issues, contract, evidence=None, thread_states=None,
                 runtime_diagnostics=None):
    flow = contract.get("flowPolicy", {})
    limits = flow.get("wipLimits", {})
    repository = contract.get("workItemRepository")
    classification_policy = contract.get("workItemClassification", {})
    if not isinstance(classification_policy, dict) or not isinstance(
            classification_policy.get("categories"), list) or not isinstance(
                classification_policy.get("surfaces"), list):
        raise ValueError(
            "contract workItemClassification must define categories and surfaces arrays")
    categories = set(classification_policy["categories"])
    surfaces = set(classification_policy["surfaces"])
    evidence = evidence or {}
    thread_states = thread_states or {}
    rows, legacy, drift = [], [], []
    ledger_issue = None
    for issue in issues:
        identity = "%s#%d" % (repository, issue["number"])
        if identity == contract.get("orchestraLedgerIssue"):
            ledger_issue = issue
        item, error = extract_work_item(issue.get("body"))
        labels = lane_labels(issue)
        if item is not None and repository:
            expected = "%s#%d" % (repository, issue["number"])
            if item.get("issue") != expected:
                drift.append({
                    "issue": issue["number"], "title": issue["title"],
                    "problem": "block identity %r does not match %s"
                               % (item.get("issue"), expected),
                })
        if item is None:
            if labels or error:
                drift.append({
                    "issue": issue["number"], "title": issue["title"],
                    "problem": error or (
                        "has %s but no swiftui-work-item-v2 block"
                        % ", ".join(labels)),
                })
            if labels:
                legacy_stage = labels[0].split(":", 1)[1]
                legacy.append({
                    "issue": issue["number"],
                    "title": issue["title"],
                    "url": issue.get("url"),
                    "stage": legacy_stage,
                    "lane": "legacy",
                    "createdAt": issue.get("createdAt"),
                    "updatedAt": issue.get("updatedAt"),
                    "category": "SwiftUI",
                    "surface": "?",
                    "commentsTruncated": bool(issue.get("commentsTruncated")),
                    "lastProgress": last_progress(issue),
                    "upstream": upstream_refs(
                        issue, {}, repository),
                    "responsibility": responsibility(
                        legacy_stage, None),
                    "legacy": True,
                })
            continue
        for problem in dashboard_shape_problems(item, categories, surfaces):
            drift.append({
                "issue": issue["number"], "title": issue["title"],
                "problem": problem,
            })
        raw_stage = item.get("stage")
        stage = raw_stage if isinstance(raw_stage, str) and raw_stage else "unknown"
        item_evidence = evidence.get(issue["number"], {})
        thread = thread_states.get(issue["number"])
        current_thread = item_evidence.get("currentThread")
        if current_thread:
            merged = dict(thread or {})
            merged.update(current_thread)
            thread = merged
        raw_classification = item.get("classification")
        item_classification = (raw_classification
                               if isinstance(raw_classification, dict) else {})
        raw_category = item_classification.get("category")
        category = (raw_category if isinstance(raw_category, str)
                    and raw_category in categories
                    else "SwiftUI")
        raw_surface = item_classification.get("surface")
        surface = (raw_surface if isinstance(raw_surface, str)
                   and raw_surface in surfaces else "?")
        raw_hold = item.get("hold")
        hold = raw_hold.get("reason") if isinstance(raw_hold, dict) else None
        waiting = (item_evidence.get("waiting") or {}).get("reason")
        row = {
            "issue": issue["number"],
            "title": issue["title"],
            "url": issue.get("url"),
            "lane": item.get("laneId", "?"),
            "stage": stage,
            "hold": hold,
            "rank": item.get("rank"),
            "createdAt": issue.get("createdAt"),
            "updatedAt": issue.get("updatedAt"),
            "category": category,
            "surface": surface,
            "classificationRecorded": (
                category in categories and surface in surfaces
                and isinstance(item_classification.get("upstream"), list)),
            "commentsTruncated": bool(issue.get("commentsTruncated")),
            "upstream": upstream_refs(
                issue, item, repository),
            "lastProgress": last_progress(issue),
            "responsibility": responsibility(stage, hold, thread, waiting),
            "waiting": item_evidence.get("waiting"),
            "workerThread": thread,
            "boundThread": item_evidence.get("boundThread"),
            "uat": item_evidence.get("uat"),
            "receipts": item_evidence.get("receipts", {}),
            "unresolved": item_evidence.get("unresolved", []),
            "acceptance": (item.get("acceptance")
                           if isinstance(item.get("acceptance"), list) else []),
            "dependencies": (item.get("dependencies")
                             if isinstance(item.get("dependencies"), list) else []),
            "binding": (item.get("binding")
                        if isinstance(item.get("binding"), dict) else {}),
            "legacy": False,
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
    # An active item with a recorded waiting reason is implemented work sitting
    # in a buffer, not a worker occupying the station. The controller already
    # reads `waiting` this way when it decides whether a lane is stalled;
    # counting it as occupancy here would report a permanent phantom overrun.
    parked = [row for row in rows
              if row["stage"] == "active" and (row.get("waiting") or {}).get("reason")]
    stations = {
        "activeImplementation": {
            "occupied": counts.get("active", 0) - len(parked),
            "limit": limits.get("activeImplementation"),
            "parked": [{"issue": row["issue"],
                        "reason": row["waiting"]["reason"]} for row in parked],
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
        "legacyItems": sorted(legacy, key=lambda row: row["issue"]),
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
        "unclassified": (sum(
            1 for row in rows if not row["classificationRecorded"])
            + len(legacy)),
        "orchestra": ({
            "issue": ledger_issue["number"],
            "title": ledger_issue["title"],
            "url": ledger_issue.get("url"),
            "updatedAt": ledger_issue.get("updatedAt"),
            "lastProgress": last_progress(ledger_issue),
            "responsible": "SwiftUI orchestra coordinator",
        } if ledger_issue else {
            "issue": None,
            "title": "SwiftUI delivery orchestra",
            "url": issue_identity_url(contract.get("orchestraLedgerIssue")),
            "updatedAt": None,
            "lastProgress": None,
            "responsible": "SwiftUI orchestra coordinator",
        }),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"),
        "runtimeDiagnostics": list(runtime_diagnostics or []),
    }


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_receipts(roots, max_bytes=512 * 1024):
    by_hash, by_kind = {}, {}
    for raw_root in roots:
        root = Path(raw_root).expanduser()
        if not root.is_dir():
            continue
        for current, directories, files in os.walk(str(root)):
            directories[:] = [name for name in directories
                              if name not in SCAN_PRUNE]
            for name in files:
                lowered = name.lower()
                path = Path(current) / name
                lowered_path = str(path).lower()
                if not lowered.endswith(".json") or not any(
                        hint in lowered_path for hint in RECEIPT_NAME_HINTS):
                    continue
                try:
                    if path.stat().st_size > max_bytes:
                        continue
                    value = json.loads(path.read_text())
                except (OSError, ValueError):
                    continue
                kind = value.get("kind") if isinstance(value, dict) else None
                if kind not in RECEIPT_KINDS:
                    continue
                record = {"path": str(path), "value": value}
                record["sha256"] = file_sha256(path)
                by_hash[record["sha256"]] = record
                by_kind.setdefault(kind, []).append(record)
    return {"byHash": by_hash, "byKind": by_kind}


def t3_thread_url(origin, environment_id, thread_id):
    if not origin or not environment_id or not thread_id:
        return None
    if str(thread_id).startswith("collaboration:"):
        return None
    return "%s/%s/%s" % (
        origin.rstrip("/"), quote(str(environment_id), safe=""),
        quote(str(thread_id), safe=""))


def read_runtime_origin(path=None):
    runtime_path = Path(path).expanduser() if path else \
        Path.home() / ".t3/userdata/server-runtime.json"
    try:
        return json.loads(runtime_path.read_text()).get("origin")
    except (OSError, ValueError):
        return None


def read_runtime_environment(origin):
    if not origin:
        return None
    try:
        with urlopen(origin.rstrip("/") + "/.well-known/t3/environment",
                     timeout=2) as response:
            return json.loads(response.read()).get("environmentId")
    except (OSError, ValueError):
        return None


def build_evidence(issues, _contract, receipt_index, t3_origin=None,
                   t3_environment_id=None):
    by_hash = receipt_index.get("byHash", {})
    by_kind = receipt_index.get("byKind", {})
    evidence = {}
    dispatches = sorted(
        by_kind.get("swiftui-coordinator-dispatch-receipt", []),
        key=lambda record: record["value"].get("recordedAt") or "")
    uat_receipts = sorted(
        by_kind.get("swiftui-uat-thread-receipt", []),
        key=lambda record: record["value"].get("createdAt") or "")
    origin = t3_origin
    for issue in issues:
        item, _ = extract_work_item(issue.get("body"))
        if item is None:
            continue
        number = issue["number"]
        raw_binding = item.get("binding")
        binding = raw_binding if isinstance(raw_binding, dict) else {}
        result = {"receipts": {}, "unresolved": []}
        for field, value in binding.items():
            if not isinstance(field, str) or not field.endswith("Sha256") or \
                    not isinstance(value, str) or not value:
                continue
            record = by_hash.get(value)
            if record:
                result["receipts"][field] = {
                    "path": record["path"], "sha256": value,
                    "kind": record["value"].get("kind"),
                }
            else:
                result["unresolved"].append({"field": field, "sha256": value})
        launch_hash = binding.get("launchReceiptSha256")
        if not isinstance(launch_hash, str):
            launch_hash = None
        launch = by_hash.get(launch_hash, {}).get("value") if launch_hash else None
        if launch and launch.get("kind") == "swiftui-launch-receipt":
            result["boundThread"] = {
                "environmentId": launch.get("environmentId"),
                "projectId": launch.get("projectId"),
                "threadId": launch.get("threadId"),
                "branch": launch.get("branch"),
                "worktree": launch.get("worktree"),
                "launchedAt": launch.get("launchedAt"),
                "url": t3_thread_url(origin, launch.get("environmentId"),
                                     launch.get("threadId")),
            }
        identity = item.get("issue")
        for dispatch in dispatches:
            value = dispatch["value"]
            slot = next((slot for slot in value.get("slots") or []
                         if slot.get("issue") == identity), None)
            waiting = next((entry for entry in value.get("waiting") or []
                            if entry.get("issue") == identity), None)
            if slot:
                result.pop("waiting", None)
                bound = result.get("boundThread") or {}
                result["currentThread"] = {
                    "environmentId": value.get("environmentId") or bound.get("environmentId"),
                    "projectId": slot.get("projectId") or bound.get("projectId"),
                    "threadId": slot.get("threadId"),
                    "mode": slot.get("mode"),
                    "recordedAt": value.get("recordedAt"),
                    "url": t3_thread_url(
                        origin, value.get("environmentId") or bound.get("environmentId"),
                        slot.get("threadId")),
                }
            elif waiting:
                result.pop("currentThread", None)
                result["waiting"] = {
                    "reason": waiting.get("reason"),
                    "recordedAt": value.get("recordedAt"),
                }
        for record in uat_receipts:
            value = record["value"]
            entries = value.get("entries") or {}
            included = (entries.get("freshVerdict") or []) + \
                (entries.get("installedCarry") or [])
            if number in included:
                historical = item.get("stage") not in (
                    "phone-test", "accepted", "pr-open", "landed")
                result["uat"] = {
                    "build": value.get("build"),
                    "channel": value.get("channel"),
                    "status": value.get("installedStatus"),
                    "threadId": value.get("threadId"),
                    "projectId": value.get("projectId"),
                    "createdAt": value.get("createdAt"),
                    "historical": historical,
                    "url": t3_thread_url(
                        origin, t3_environment_id,
                        value.get("threadId")),
                }
        evidence[number] = result
    return evidence


def read_thread_states(evidence, database_path=None, diagnostics=None):
    diagnostics = diagnostics if diagnostics is not None else []
    path = Path(database_path).expanduser() if database_path else \
        Path.home() / ".t3/userdata/state.sqlite"
    wanted = {}
    for issue, item in evidence.items():
        if item.get("waiting") and not item.get("currentThread"):
            continue
        thread = item.get("currentThread") or item.get("boundThread")
        if thread and thread.get("threadId"):
            wanted[thread["threadId"]] = issue
    if not wanted:
        return {}
    if not path.is_file():
        diagnostics.append("T3 projection unavailable: state database is missing")
        return {}
    placeholders = ",".join("(?)" for _ in wanted)
    query = """
    WITH wanted(thread_id) AS (VALUES %s),
    latest AS (
      SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.thread_id ORDER BY p.requested_at DESC, p.row_id DESC
      ) AS row_number
      FROM projection_turns p
      JOIN wanted w ON w.thread_id=p.thread_id
    )
    SELECT t.thread_id,t.title,t.project_id,t.model_selection_json,t.updated_at,
           l.state,l.requested_at,l.started_at,l.completed_at
      FROM projection_threads t
      JOIN wanted w ON w.thread_id=t.thread_id
      LEFT JOIN latest l ON l.thread_id=t.thread_id AND l.row_number=1
     WHERE t.deleted_at IS NULL
    """ % placeholders
    try:
        connection = sqlite3.connect("file:%s?mode=ro" % quote(str(path)), uri=True)
        connection.row_factory = sqlite3.Row
        rows = connection.execute(query, list(wanted)).fetchall()
        connection.close()
    except sqlite3.Error as error:
        diagnostics.append("T3 projection unavailable: %s" % error)
        return {}
    result = {}
    for row in rows:
        issue = wanted[row["thread_id"]]
        thread = dict((evidence[issue].get("currentThread") or
                       evidence[issue].get("boundThread") or {}))
        try:
            selection = json.loads(row["model_selection_json"] or "{}")
        except ValueError:
            selection = {}
        thread.update({
            "threadId": row["thread_id"],
            "projectId": row["project_id"],
            "title": row["title"],
            "state": row["state"],
            "model": selection.get("model"),
            "provider": selection.get("instanceId") or selection.get("provider"),
            "updatedAt": row["updated_at"],
            "turnRequestedAt": row["requested_at"],
            "turnStartedAt": row["started_at"],
            "turnCompletedAt": row["completed_at"],
        })
        result[issue] = thread
    return result


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
        for entry in s.get("parked") or []:
            out.append("    parked #%s: %s" % (entry["issue"], entry["reason"]))
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


def render_html(report, repository):
    escape = lambda value: html.escape(str(value or ""), quote=True)

    def anchor(label, url, css=""):
        if not url:
            return '<span class="muted">%s</span>' % escape(label)
        if urlparse(str(url)).scheme not in ("http", "https", "file"):
            return '<span class="muted">%s</span>' % escape(label)
        class_name = ' class="%s"' % escape(css) if css else ""
        return '<a%s href="%s">%s</a>' % (
            class_name, escape(url), escape(label))

    def timestamp(value):
        if not value:
            return "unknown"
        return str(value).replace("T", " ")[:19] + " UTC"

    def ref_links(row):
        if not row.get("upstream"):
            return '<span class="muted">No upstream reference</span>'
        return " ".join(anchor(
            "%s #%s" % ("PR" if ref["kind"] == "pull" else "Issue",
                          ref["number"]), ref["url"], "ref-link")
            for ref in row["upstream"])

    def thread_block(label, thread):
        if not thread:
            return '<div class="detail-row"><dt>%s</dt><dd class="muted">Not bound</dd></div>' % label
        state = thread.get("state") or thread.get("mode") or "recorded"
        title = thread.get("title") or thread.get("threadId") or "Thread"
        detail = anchor(title, thread.get("url"), "thread-link")
        detail += ' <span class="thread-state state-%s">%s</span>' % (
            escape(state), escape(state))
        if thread.get("model"):
            detail += '<small>%s · updated %s</small>' % (
                escape(thread["model"]), escape(timestamp(thread.get("updatedAt"))))
        return '<div class="detail-row"><dt>%s</dt><dd>%s</dd></div>' % (
            escape(label), detail)

    def card(row):
        card_orchestra = report.get("orchestra") or {}
        progress = row.get("lastProgress") or {}
        searchable = " ".join(str(value or "") for value in (
            row.get("issue"), row.get("title"), row.get("lane"),
            row.get("stage"), row.get("category"), row.get("surface"),
            progress.get("text"), row.get("responsibility", {}).get("owner"),
        )).lower()
        chips = (
            '<span class="chip category">%s</span>' % escape(row.get("category") or "?") +
            '<span class="chip surface surface-%s">%s</span>' % (
                escape(row.get("surface") or "unknown"),
                escape(row.get("surface") or "?"))
        )
        issue_link = anchor("#%s" % row["issue"], row.get("url"), "issue-number")
        progress_html = (anchor(progress.get("text"), progress.get("url"), "progress")
                         if progress else '<span class="muted">No progress note</span>')
        acceptance = "".join("<li>%s</li>" % escape(point)
                             for point in row.get("acceptance") or [])
        dependencies = " ".join(anchor(
            dependency.get("issue"), issue_identity_url(dependency.get("issue")),
            "ref-link") for dependency in row.get("dependencies") or []
            if isinstance(dependency, dict)
            and isinstance(dependency.get("issue"), str))
        receipts = []
        for name, receipt in sorted((row.get("receipts") or {}).items()):
            try:
                url = Path(receipt["path"]).as_uri()
            except (KeyError, ValueError):
                url = None
            receipts.append("<li>%s <code>%s</code></li>" % (
                anchor(name, url), escape((receipt.get("sha256") or "")[:12])))
        unresolved = "".join(
            "<li>%s <code>%s…</code></li>" % (
                escape(value.get("field")), escape(str(value.get("sha256") or "")[:12]))
            for value in row.get("unresolved") or [])
        uat = row.get("uat")
        uat_html = ""
        if uat:
            uat_label = "UAT history" if uat.get("historical") else "Phone/UAT"
            history_note = " · predates the current stage" if uat.get("historical") else ""
            uat_html = '<div class="detail-row"><dt>%s</dt><dd>%s · build %s · %s%s</dd></div>' % (
                escape(uat_label),
                anchor("UAT thread", uat.get("url")), escape(uat.get("build")),
                escape(uat.get("status")), escape(history_note))
        return """
<article class="card stage-%(stage)s" data-search="%(search)s" data-category="%(category)s" data-surface="%(surface)s" data-classified="%(classified)s">
  <div class="card-top"><span>%(issue)s</span><span class="stage-mark">%(stage_label)s</span></div>
  <h3>%(title)s</h3>
  <div class="chips">%(chips)s</div>
  <div class="lane"><span>LANE</span> %(lane)s</div>
  <div class="owner"><span>NOW</span><strong>%(owner)s</strong><small>%(reason)s</small></div>
  <div class="progress-wrap">%(progress)s<time>Updated %(updated)s</time></div>
  <details>
    <summary>Open record</summary>
    <dl>
      <div class="detail-row"><dt>Created</dt><dd>%(created)s</dd></div>
      <div class="detail-row"><dt>Last update</dt><dd>%(updated_full)s</dd></div>
      <div class="detail-row"><dt>Upstream</dt><dd>%(refs)s</dd></div>
      <div class="detail-row"><dt>Orchestra</dt><dd>%(orchestra)s</dd></div>
      %(bound_thread)s
      %(worker_thread)s
      %(uat)s
      <div class="detail-row"><dt>Dependencies</dt><dd>%(dependencies)s</dd></div>
    </dl>
    %(acceptance_block)s
    %(receipt_block)s
    %(unresolved_block)s
    %(coverage_block)s
  </details>
</article>
""" % {
            "stage": escape(row.get("stage")),
            "search": escape(searchable),
            "category": escape(row.get("category") or "?"),
            "surface": escape(row.get("surface") or "?"),
            "classified": "true" if row.get("classificationRecorded") else "false",
            "issue": issue_link,
            "stage_label": escape(row.get("stage")),
            "title": escape(row.get("title")),
            "chips": chips,
            "lane": escape(row.get("lane")),
            "owner": escape((row.get("responsibility") or {}).get("owner")),
            "reason": escape((row.get("responsibility") or {}).get("reason")),
            "progress": progress_html,
            "created": escape(timestamp(row.get("createdAt"))),
            "updated": escape(timestamp(row.get("updatedAt"))),
            "updated_full": escape(timestamp(row.get("updatedAt"))),
            "refs": ref_links(row),
            "orchestra": anchor(
                card_orchestra.get("title") or "Orchestra ledger",
                card_orchestra.get("url"), "ref-link"),
            "bound_thread": thread_block("Launch binding", row.get("boundThread")),
            "worker_thread": thread_block("Current worker", row.get("workerThread")),
            "uat": uat_html,
            "dependencies": dependencies or '<span class="muted">None</span>',
            "acceptance_block": ('<section class="details-list"><h4>Acceptance</h4><ol>%s</ol></section>' % acceptance
                                 if acceptance else ""),
            "receipt_block": ('<section class="details-list"><h4>Resolved receipts</h4><ul>%s</ul></section>' % "".join(receipts)
                              if receipts else ""),
            "unresolved_block": ('<section class="details-list warning"><h4>Unresolved receipt hashes</h4><ul>%s</ul></section>' % unresolved
                                 if unresolved else ""),
            "coverage_block": ('<section class="details-list warning"><h4>Reference coverage</h4><p>Upstream links cover the newest 100 comments; older comments were not scanned.</p></section>'
                               if row.get("commentsTruncated") else ""),
        }

    all_rows = report.get("workItems") or []
    legacy_rows = report.get("legacyItems") or []
    categories = sorted(set(
        row.get("category") or "?" for row in all_rows + legacy_rows))
    category_options = "".join(
        '<option value="%s">%s</option>' % (escape(value), escape(value))
        for value in categories)
    surface_values = sorted(set(
        row.get("surface") for row in all_rows + legacy_rows
        if row.get("surface") not in (None, "?")))
    surface_options = "".join(
        '<option value="%s">%s</option>' % (escape(value), escape(value))
        for value in surface_values)
    columns = []
    rendered_stages = list(STAGE_ORDER)
    for stage in sorted(set(row.get("stage") for row in all_rows)
                        - set(rendered_stages), key=str):
        rendered_stages.append(stage)
    for stage in rendered_stages:
        stage_rows = [row for row in all_rows if row.get("stage") == stage]
        columns.append("""
<section class="column stage-column-%s" data-column aria-label="%s lane">
  <header><span>%s</span><strong data-count>%d</strong></header>
  <div class="column-cards">%s</div>
</section>""" % (escape(stage), escape(stage), escape(stage), len(stage_rows),
                  "".join(card(row) for row in stage_rows)))
    columns.append("""
<section class="column stage-column-legacy" data-column aria-label="Needs migration lane">
  <header><span>needs migration</span><strong data-count>%d</strong></header>
  <div class="column-cards">%s</div>
</section>""" % (len(legacy_rows), "".join(card(row) for row in legacy_rows)))
    orchestra = report.get("orchestra") or {}
    orchestra_update = orchestra.get("lastProgress") or {}
    runtime_diagnostics = report.get("runtimeDiagnostics") or []
    runtime_warning = ("<aside class=\"runtime-warning\">%s</aside>" %
                       escape(" · ".join(runtime_diagnostics))
                       if runtime_diagnostics else "")
    station = report.get("stations", {}).get("activeImplementation", {})
    phone = report.get("stations", {}).get("phoneVerification", {})
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SwiftUI delivery control</title>
<style>
:root{--ink:#f2f0e7;--muted:#9aa4a8;--panel:#161d20;--panel2:#202a2e;--line:#344247;--blue:#69a7d1;--amber:#e3a34f;--red:#db6b60;--green:#73b18a;--paper:#0c1113;--shadow:0 12px 32px #0008}
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Avenir Next","IBM Plex Sans","Helvetica Neue",sans-serif;background-image:linear-gradient(#ffffff05 1px,transparent 1px),linear-gradient(90deg,#ffffff04 1px,transparent 1px);background-size:32px 32px}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}button,input,select{font:inherit}.shell{min-height:100vh}.masthead{padding:34px 40px 24px;border-bottom:1px solid var(--line);background:#0c1113;position:sticky;top:0;z-index:10}.eyebrow{font:700 11px/1.2 "SFMono-Regular",monospace;letter-spacing:.18em;color:var(--amber);text-transform:uppercase}.mast-row{display:flex;align-items:end;justify-content:space-between;gap:24px}.masthead h1{font-size:clamp(30px,4vw,58px);line-height:.96;margin:10px 0 0;letter-spacing:-.045em;max-width:750px}.generated{color:var(--muted);font:12px/1.5 "SFMono-Regular",monospace;text-align:right}.control-grid{display:grid;grid-template-columns:minmax(300px,1.5fr) repeat(4,minmax(130px,1fr));gap:12px;padding:18px 40px}.orchestra,.metric{background:var(--panel);border:1px solid var(--line);min-height:118px;padding:17px;box-shadow:var(--shadow);min-width:0;overflow-wrap:anywhere}.orchestra{border-left:4px solid var(--amber)}.orchestra h2{font-size:17px;margin:4px 0 7px;overflow-wrap:anywhere}.orchestra p{color:var(--muted);font-size:13px;margin:0;max-width:70ch}.metric span{display:block;color:var(--muted);font:700 10px/1.2 "SFMono-Regular",monospace;letter-spacing:.1em;text-transform:uppercase}.metric strong{display:block;font:700 30px/1.2 "SFMono-Regular",monospace;margin-top:12px}.toolbar{display:flex;gap:10px;padding:0 40px 18px}.toolbar input,.toolbar select{background:var(--panel);color:var(--ink);border:1px solid var(--line);padding:10px 12px;min-height:42px}.toolbar input{flex:1;min-width:220px}.toolbar select{min-width:150px}.runtime-warning{margin:0 40px 18px;border:1px solid var(--red);color:var(--red);padding:10px 12px;font:12px/1.4 "SFMono-Regular",monospace}.board{display:flex;gap:13px;overflow-x:auto;padding:0 40px 40px;scroll-snap-type:x proximity}.column{flex:0 0 310px;scroll-snap-align:start}.column>header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;background:#101719;border:1px solid var(--line);border-bottom:3px solid var(--blue);padding:12px 14px;text-transform:uppercase;font:700 11px/1 "SFMono-Regular",monospace;letter-spacing:.1em}.column>header strong{border:1px solid var(--line);padding:5px 8px}.column-cards{display:grid;gap:10px;padding-top:10px}.card{background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--blue);padding:14px;box-shadow:0 7px 20px #0005}.card[hidden]{display:none}.stage-active{border-top-color:var(--amber)}.stage-phone-test{border-top-color:var(--red)}.stage-landed{border-top-color:var(--green)}.card-top{display:flex;justify-content:space-between;align-items:center;font:700 11px/1.2 "SFMono-Regular",monospace}.issue-number{font-size:14px}.stage-mark{color:var(--muted);text-transform:uppercase}.card h3{font-size:17px;line-height:1.2;letter-spacing:-.01em;margin:13px 0 10px}.chips{display:flex;gap:5px;flex-wrap:wrap}.chip{font:700 9px/1 "SFMono-Regular",monospace;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);padding:5px 7px;color:var(--muted)}.surface-ui{color:var(--green)}.surface-non-ui{color:var(--amber)}.lane{margin:14px 0 10px;font:12px/1.4 "SFMono-Regular",monospace;overflow-wrap:anywhere}.lane span,.owner>span{color:var(--muted);font-size:9px;letter-spacing:.12em;margin-right:6px}.owner{border-left:2px solid var(--amber);padding:8px 9px;background:var(--panel2)}.owner strong{display:block;font-size:13px;margin:4px 0}.owner small{display:block;color:var(--muted);line-height:1.3}.progress-wrap{margin-top:12px}.progress{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;color:var(--ink);font-size:13px;line-height:1.45}.progress-wrap time{display:block;color:var(--muted);font:10px/1.3 "SFMono-Regular",monospace;margin-top:7px}details{border-top:1px solid var(--line);margin-top:13px;padding-top:10px}summary{cursor:pointer;color:var(--blue);font:700 11px/1.3 "SFMono-Regular",monospace;text-transform:uppercase;letter-spacing:.08em}dl{margin:12px 0}.detail-row{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;border-top:1px solid #ffffff0c;padding:8px 0}.detail-row dt{color:var(--muted);font-size:11px}.detail-row dd{margin:0;font-size:12px;overflow-wrap:anywhere}.detail-row small{display:block;color:var(--muted);margin-top:4px}.thread-state{font:700 9px/1 "SFMono-Regular",monospace;text-transform:uppercase;padding:3px 5px;border:1px solid var(--line);margin-left:4px}.state-running{color:var(--green)}.details-list h4{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.details-list li{font-size:12px;line-height:1.4;margin:5px 0}.warning{color:var(--amber)}.muted{color:var(--muted)}code{font-family:"SFMono-Regular",monospace}.empty{color:var(--muted);padding:20px}.stage-column-phone-test>header{border-bottom-color:var(--red)}.stage-column-active>header{border-bottom-color:var(--amber)}.stage-column-landed>header{border-bottom-color:var(--green)}.stage-column-legacy>header{border-bottom-color:var(--red)}
@media(max-width:900px){.masthead{padding:24px 18px 18px;position:static}.mast-row{display:block}.generated{text-align:left;margin-top:12px}.control-grid{grid-template-columns:1fr 1fr;padding:14px 18px}.orchestra{grid-column:1/-1}.toolbar{padding:0 18px 14px;flex-wrap:wrap}.toolbar input{flex-basis:100%%}.board{padding:0 18px 28px}.column>header{top:0}.column{flex-basis:290px}}
</style>
</head>
<body><div class="shell">
<header class="masthead"><div class="eyebrow">T3 Code · native delivery</div><div class="mast-row"><h1>SwiftUI delivery control</h1><div class="generated">%(repository)s<br>Snapshot %(generated)s</div></div></header>
<section class="control-grid">
  <article class="orchestra"><div class="eyebrow">Who keeps this moving</div><h2>%(orchestra_link)s</h2><p>%(orchestra_owner)s. %(orchestra_progress)s</p></article>
  <article class="metric"><span>Open items</span><strong>%(open_count)s</strong></article>
  <article class="metric"><span>Implementation</span><strong>%(active)s/%(active_limit)s</strong></article>
  <article class="metric"><span>Phone verdict</span><strong>%(phone)s/%(phone_limit)s</strong></article>
  <article class="metric"><span>Unclassified</span><strong>%(unclassified)s</strong></article>
</section>
<section class="toolbar" aria-label="Board filters"><input id="search" type="search" aria-label="Search board" placeholder="Search issue, lane, owner or progress"><select id="category" aria-label="Filter by category"><option value="">All categories</option>%(category_options)s</select><select id="surface" aria-label="Filter by UI scope"><option value="">All UI scopes</option>%(surface_options)s<option value="__unclassified">Unclassified</option></select></section>
%(runtime_warning)s
<main class="board">%(columns)s</main>
</div>
<script>
const search=document.querySelector('#search');const category=document.querySelector('#category');const surface=document.querySelector('#surface');
function filter(){const q=search.value.trim().toLowerCase();document.querySelectorAll('.card').forEach(card=>{const surfaceMismatch=surface.value==='__unclassified'?card.dataset.classified==='true':Boolean(surface.value&&card.dataset.surface!==surface.value);card.hidden=Boolean((q&&!card.dataset.search.includes(q))||(category.value&&card.dataset.category!==category.value)||surfaceMismatch);});document.querySelectorAll('[data-column]').forEach(column=>{const count=[...column.querySelectorAll('.card')].filter(card=>!card.hidden).length;column.querySelector('[data-count]').textContent=count;});}
[search,category,surface].forEach(control=>control.addEventListener('input',filter));
</script></body></html>""" % {
        "repository": escape(repository),
        "generated": escape(timestamp(report.get("generatedAt"))),
        "orchestra_link": anchor(orchestra.get("title") or "Orchestra ledger", orchestra.get("url")),
        "orchestra_owner": escape(orchestra.get("responsible")),
        "orchestra_progress": escape(orchestra_update.get("text") or "Owns station liveness, publication, and handoff."),
        "open_count": len(all_rows) + len(legacy_rows),
        "active": station.get("occupied", 0),
        "active_limit": station.get("limit") if station.get("limit") is not None else "?",
        "phone": phone.get("occupied", 0),
        "phone_limit": phone.get("limit") if phone.get("limit") is not None else "?",
        "unclassified": report.get("unclassified", 0),
        "category_options": category_options,
        "surface_options": surface_options,
        "runtime_warning": runtime_warning,
        "columns": "".join(columns),
    }


def write_html(path, report, repository):
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_html(report, repository), encoding="utf-8")
    return target


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--json", action="store_true", dest="as_json")
    output.add_argument("--html", metavar="PATH",
                        help="write a self-contained visual board")
    output.add_argument(
        "--controller-json", action="store_true",
        help="write the bounded machine liveness projection (no comments, receipts, or board)")
    parser.add_argument("--repo", default=None,
                        help="override workItemRepository")
    parser.add_argument("--contract", default=None)
    args = parser.parse_args(argv)
    contract = load_contract(args.contract)
    repository = args.repo or contract.get(
        "workItemRepository", "saphid/t3code-personal")
    issues = fetch_issues(repository, include_comments=not args.controller_json)
    if args.controller_json:
        report = build_report(issues, contract)
        report["projection"] = "controller-liveness"
    else:
        roots = [contract.get("stateRoot"), contract.get("buildStore")]
        receipt_index = scan_receipts([root for root in roots if root])
        runtime_origin = read_runtime_origin()
        runtime_environment = read_runtime_environment(runtime_origin)
        evidence = build_evidence(
            issues, contract, receipt_index, t3_origin=runtime_origin,
            t3_environment_id=runtime_environment)
        runtime_diagnostics = []
        thread_states = read_thread_states(
            evidence, diagnostics=runtime_diagnostics)
        report = build_report(
            issues, contract, evidence=evidence, thread_states=thread_states,
            runtime_diagnostics=runtime_diagnostics)
    if args.as_json or args.controller_json:
        print(json.dumps(report, indent=2))
    elif args.html:
        target = write_html(args.html, report, repository).resolve()
        print("SwiftUI delivery dashboard: %s" % target)
    else:
        print(render_text(report, repository))
    # Drift belongs to the human audit projection. The controller projection
    # reports it as data but must remain a usable heartbeat while cleanup work
    # is pending.
    return 1 if report["drift"] and not args.controller_json else 0


if __name__ == "__main__":
    sys.exit(main())
