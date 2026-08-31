"""Hermetic tests for status_report: fence parsing, WIP occupancy, drift."""

import json
import hashlib
import tempfile
import unittest
from pathlib import Path

import status_report


def issue(number, title, stage=None, lane="lane-a", labels=(), body=None,
          hold=None, classification=None, comments=()):
    if body is None and stage is not None:
        block = {"schemaVersion": 2, "issue": "example/repo#%d" % number,
                 "laneId": lane, "stage": stage}
        if hold:
            block["hold"] = {"reason": hold}
        if classification:
            block["classification"] = classification
        body = "intro\n```swiftui-work-item-v2\n%s\n```\n" % json.dumps(block)
    return {"number": number, "title": title, "body": body or "",
            "labels": [{"name": l} for l in labels],
            "url": "https://github.com/example/repo/issues/%d" % number,
            "createdAt": "2026-08-20T01:00:00Z",
            "updatedAt": "2026-08-21T02:00:00Z",
            "comments": list(comments)}


CONTRACT = {
    "workItemRepository": "example/repo",
    "repository": "upstream/product",
    "orchestraLedgerIssue": "example/repo#104",
    "workItemClassification": {
        "categories": ["defect", "feature", "parity", "process", "infrastructure"],
        "surfaces": ["ui", "non-ui"],
    },
    "flowPolicy": {
        "wipLimits": {"activeImplementation": 2, "phoneVerification": 1},
        "backlog": {"minQueuedReady": 3},
    },
}


class BuildReport(unittest.TestCase):
    def test_stages_stations_and_backlog(self):
        issues = [
            issue(1, "queued one", "queued", labels=["lane:queued"]),
            issue(2, "active one", "active", labels=["lane:active"]),
            issue(3, "active two", "active", labels=["lane:active"]),
            issue(4, "active three", "active", labels=["lane:active"]),
            issue(5, "on phone", "phone-test", labels=["lane:phone-test"]),
            issue(6, "held", "proof-ready", hold="needs decision",
                  labels=["lane:proof-ready"]),
        ]
        report = status_report.build_report(issues, CONTRACT)
        self.assertEqual(report["stageCounts"]["active"], 3)
        self.assertEqual(
            report["stations"]["activeImplementation"]["occupied"], 3)
        self.assertEqual(
            report["stations"]["activeImplementation"]["limit"], 2)
        self.assertTrue(report["backlogNeedsReplenish"])
        self.assertEqual(report["workItems"][0]["stage"], "queued")
        held = [r for r in report["workItems"] if r["hold"]][0]
        self.assertEqual(held["hold"], "needs decision")
        self.assertEqual(report["drift"], [])
        text = status_report.render_text(report, "example/repo")
        self.assertIn("OVER LIMIT", text)
        self.assertIn("REPLENISH", text)

    def test_card_metadata_links_progress_and_responsibility(self):
        latest = {
            "body": "Proof is frozen at the exact head. Next action is Test publication.",
            "createdAt": "2026-08-21T02:00:00Z",
            "url": "https://github.com/example/repo/issues/21#issuecomment-1",
            "author": {"login": "operator"},
        }
        body = """## Problem
Visible picker is wrong.

Upstream issue: https://github.com/upstream/product/issues/700
Upstream PR: https://github.com/upstream/product/pull/701

```swiftui-work-item-v2
%s
```
""" % json.dumps({
            "schemaVersion": 2,
            "kind": "swiftui-work-item",
            "issue": "example/repo#21",
            "laneId": "picker",
            "rank": 10,
            "stage": "proof-ready",
            "acceptance": ["The picker is visible."],
            "dependencies": [],
            "classification": {
                "category": "feature",
                "surface": "ui",
                "upstream": [{
                    "kind": "issue",
                    "reference": "upstream/product#700",
                }],
            },
            "binding": {},
        })
        report = status_report.build_report([
            issue(21, "Picker", body=body, labels=["lane:proof-ready"],
                  comments=[latest]),
        ], CONTRACT)
        row = report["workItems"][0]
        self.assertEqual(row["category"], "feature")
        self.assertEqual(row["surface"], "ui")
        self.assertEqual(row["responsibility"]["owner"], "SwiftUI orchestra")
        self.assertEqual(row["lastProgress"]["url"], latest["url"])
        self.assertIn("exact head", row["lastProgress"]["text"])
        self.assertEqual(
            {(ref["kind"], ref["number"]) for ref in row["upstream"]},
            {("issue", 700), ("pull", 701)},
        )

    def test_running_worker_owns_active_item(self):
        report = status_report.build_report([
            issue(22, "Active", "active", labels=["lane:active"]),
        ], CONTRACT, thread_states={22: {
            "threadId": "thread-22", "state": "running",
            "url": "http://t3.test/env/thread-22", "title": "Worker 22",
        }})
        row = report["workItems"][0]
        self.assertEqual(row["responsibility"]["owner"], "Worker 22")
        self.assertEqual(row["workerThread"]["state"], "running")

    def test_legacy_issue_is_visible_as_a_migration_card(self):
        report = status_report.build_report([
            issue(23, "Old lane", labels=["lane:ready-for-test"]),
        ], CONTRACT)
        self.assertEqual(report["legacyItems"][0]["issue"], 23)
        self.assertEqual(report["legacyItems"][0]["stage"], "ready-for-test")
        self.assertEqual(len(report["drift"]), 1)

    def test_malformed_dashboard_metadata_becomes_drift_not_a_crash(self):
        block = {
            "schemaVersion": 2, "kind": "swiftui-work-item",
            "issue": "example/repo#24", "laneId": "picker",
            "stage": "active", "classification": "feature",
            "dependencies": ["example/repo#23"], "binding": "missing",
        }
        malformed = issue(
            24, "Malformed", body="```swiftui-work-item-v2\n%s\n```" %
            json.dumps(block), labels=["lane:active"])
        report = status_report.build_report([malformed], CONTRACT)
        problems = [entry["problem"] for entry in report["drift"]]
        self.assertIn("classification must be an object", problems)
        self.assertIn("dependencies must be an array of objects", problems)
        self.assertIn("binding must be an object", problems)
        status_report.render_html(report, "example/repo")

    def test_non_object_work_item_is_reported_as_drift(self):
        malformed = issue(
            25, "Array block", body="```swiftui-work-item-v2\n[]\n```",
            labels=["lane:active"])
        report = status_report.build_report([malformed], CONTRACT)
        self.assertIn("work-item JSON must be an object",
                      report["drift"][0]["problem"])

    def test_malformed_nested_values_fail_soft_across_evidence_and_html(self):
        block = {
            "schemaVersion": 2, "kind": "swiftui-work-item",
            "issue": "example/repo#26", "laneId": "picker",
            "stage": 7,
            "classification": {"category": {"bad": "shape"},
                               "surface": 5, "upstream": 5},
            "dependencies": [{"issue": 5}],
            "binding": {"launchReceiptSha256": ["not-a-hash"]},
        }
        malformed = issue(
            26, "Nested malformed", body="```swiftui-work-item-v2\n%s\n```" %
            json.dumps(block), labels=["lane:active"])
        evidence = status_report.build_evidence(
            [malformed], CONTRACT, {"byHash": {}, "byKind": {}},
            t3_origin="http://t3.test")
        report = status_report.build_report(
            [malformed], CONTRACT, evidence=evidence)
        problems = [entry["problem"] for entry in report["drift"]]
        self.assertIn("classification.category is invalid", problems)
        self.assertIn("classification.surface is invalid", problems)
        self.assertIn("classification.upstream must be an array", problems)
        self.assertIn("binding.launchReceiptSha256 must be a string", problems)
        self.assertIn("stage must be a string", problems)
        self.assertIn("Nested malformed", status_report.render_html(
            report, "example/repo"))

    def test_bare_pr_reference_is_not_guessed_as_upstream(self):
        item = issue(
            27, "Local PR mention", "active", labels=["lane:active"],
            comments=[{"body": "See PR #19 for the acceptance contract."}])
        report = status_report.build_report([item], CONTRACT)
        self.assertEqual(report["workItems"][0]["upstream"], [])

    def test_non_github_shorthand_is_not_fabricated_as_upstream(self):
        item = issue(
            28, "Doc anchors", "active", labels=["lane:active"],
            comments=[{"body": "See docs/setup#3 and https://app.t3.codes/env/thread#42."}])
        report = status_report.build_report([item], CONTRACT)
        self.assertEqual(report["workItems"][0]["upstream"], [])

    def test_invalid_or_partial_classification_is_drift_and_unclassified(self):
        invalid = issue(
            29, "Invalid metadata", "active", labels=["lane:active"],
            classification={"category": "made-up", "surface": "sometimes-ui"})
        partial = issue(
            30, "Partial metadata", "queued", labels=["lane:queued"],
            classification={"category": "feature"})
        report = status_report.build_report([invalid, partial], CONTRACT)
        self.assertEqual(report["unclassified"], 2)
        invalid_row = next(row for row in report["workItems"]
                           if row["issue"] == 29)
        self.assertEqual(invalid_row["category"], "SwiftUI")
        self.assertEqual(invalid_row["surface"], "?")
        problems = [entry["problem"] for entry in report["drift"]]
        self.assertIn("classification.category is invalid", problems)
        self.assertIn("classification.surface is invalid", problems)

    def test_dashboard_classification_vocabulary_comes_from_contract(self):
        contract = dict(CONTRACT)
        contract["workItemClassification"] = {
            "categories": CONTRACT["workItemClassification"]["categories"] + ["docs"],
            "surfaces": CONTRACT["workItemClassification"]["surfaces"],
        }
        documented = issue(
            35, "Documentation", "queued", labels=["lane:queued"],
            classification={"category": "docs", "surface": "non-ui", "upstream": []})
        report = status_report.build_report([documented], contract)
        self.assertEqual(report["drift"], [])
        self.assertEqual(report["workItems"][0]["category"], "docs")
        self.assertEqual(report["unclassified"], 0)

    def test_missing_classification_policy_fails_loudly(self):
        contract = dict(CONTRACT)
        contract.pop("workItemClassification")
        with self.assertRaisesRegex(ValueError, "workItemClassification"):
            status_report.build_report([], contract)

    def test_present_classification_requires_all_contract_fields(self):
        partials = [
            {"category": "feature", "surface": "ui"},
            {"surface": "ui", "upstream": []},
            {"category": "feature", "upstream": []},
        ]
        report = status_report.build_report([
            issue(36 + index, "Partial %d" % index, "queued",
                  labels=["lane:queued"], classification=value)
            for index, value in enumerate(partials)
        ], CONTRACT)
        self.assertEqual(report["unclassified"], 3)
        problems = [entry["problem"] for entry in report["drift"]]
        self.assertIn("classification.upstream must be an array", problems)
        self.assertIn("classification.category is invalid", problems)
        self.assertIn("classification.surface is invalid", problems)

    def test_phone_test_owner_ignores_stale_implementation_wait(self):
        report = status_report.build_report([
            issue(34, "On phone", "phone-test", labels=["lane:phone-test"]),
        ], CONTRACT, evidence={34: {
            "waiting": {"reason": "implementation WIP is full"},
        }})
        self.assertEqual(report["workItems"][0]["responsibility"]["owner"], "Alex")

    def test_label_without_block_and_disagreement_are_drift(self):
        issues = [
            issue(7, "labeled but no block", labels=["lane:active"]),
            issue(8, "label disagrees", "queued", labels=["lane:active"]),
            issue(9, "no lane involvement"),
        ]
        report = status_report.build_report(issues, CONTRACT)
        problems = {d["issue"]: d["problem"] for d in report["drift"]}
        self.assertIn(7, problems)
        self.assertIn("no swiftui-work-item-v2 block", problems[7])
        self.assertIn(8, problems)
        self.assertIn("disagrees", problems[8])
        self.assertNotIn(9, problems)

    def test_invalid_json_block_is_drift(self):
        bad = issue(10, "broken block",
                    body="```swiftui-work-item-v2\n{not json\n```")
        report = status_report.build_report([bad], CONTRACT)
        self.assertEqual(len(report["drift"]), 1)
        self.assertIn("invalid work-item JSON", report["drift"][0]["problem"])

    def test_fetch_issues_uses_gh_and_fails_loudly(self):
        calls = []

        class Result:
            returncode = 0
            stdout = json.dumps({"data": {"repository": {"issues": {
                "nodes": [],
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            }}}})
            stderr = ""

        def runner(cmd):
            calls.append(cmd)
            return Result()

        status_report.fetch_issues("example/repo", gh_runner=runner)
        self.assertEqual(calls[0][:3], ["gh", "api", "graphql"])
        self.assertIn("comments(last:100)", calls[0][4])

        class Fail:
            returncode = 4
            stdout = ""
            stderr = "boom"

        with self.assertRaises(RuntimeError):
            status_report.fetch_issues(
                "example/repo", gh_runner=lambda cmd: Fail())



class StrictLabelAndReadiness(unittest.TestCase):
    def test_multiple_fences_are_an_error(self):
        first = json.dumps({"laneId": "a", "stage": "queued"})
        second = json.dumps({"laneId": "b", "stage": "active"})
        body = ("```swiftui-work-item-v2\n%s\n```\nmore\n"
                "```swiftui-work-item-v2\n%s\n```" % (first, second))
        item, error = status_report.extract_work_item(body)
        self.assertIsNone(item)
        self.assertIn("exactly one is allowed", error)

    def test_block_identity_must_match_containing_issue(self):
        block = {"schemaVersion": 2, "issue": "example/repo#999",
                 "laneId": "a", "stage": "queued"}
        bad = {"number": 16, "title": "identity mismatch",
               "labels": [{"name": "lane:queued"}],
               "body": "```swiftui-work-item-v2\n%s\n```"
                       % json.dumps(block)}
        report = status_report.build_report([bad], CONTRACT)
        self.assertTrue(any("does not match example/repo#16" in d["problem"]
                            for d in report["drift"]))

    def test_missing_label_on_nonterminal_stage_is_drift(self):
        report = status_report.build_report(
            [issue(11, "no label", "active")], CONTRACT)
        self.assertEqual(len(report["drift"]), 1)
        self.assertIn("no lane:* label", report["drift"][0]["problem"])

    def test_missing_label_on_terminal_stage_is_not_drift(self):
        report = status_report.build_report(
            [issue(12, "landed quietly", "landed")], CONTRACT)
        self.assertEqual(report["drift"], [])

    def test_duplicate_labels_are_drift(self):
        report = status_report.build_report(
            [issue(13, "two labels", "queued",
                   labels=["lane:queued", "lane:active"])], CONTRACT)
        self.assertEqual(len(report["drift"]), 1)
        self.assertIn("multiple lane labels", report["drift"][0]["problem"])

    def test_held_queued_items_do_not_count_as_ready(self):
        issues = [
            issue(14, "held q", "queued", hold="blocked on decision",
                  labels=["lane:queued"]),
            issue(15, "free q", "queued", labels=["lane:queued"]),
        ]
        report = status_report.build_report(issues, CONTRACT)
        self.assertEqual(report["queuedReady"], 1)
        self.assertTrue(report["backlogNeedsReplenish"])

    def test_issue_cap_fails_loudly(self):
        class Full:
            returncode = 0
            stderr = ""
            stdout = json.dumps({"data": {"repository": {"issues": {
                "nodes": [
                    {"number": i, "title": "t", "body": "",
                     "labels": {"nodes": []}, "comments": {"nodes": []}}
                    for i in range(3)],
                "pageInfo": {"hasNextPage": True, "endCursor": "next"},
            }}}})

        with self.assertRaises(RuntimeError) as ctx:
            status_report.fetch_issues(
                "example/repo", limit=3, gh_runner=lambda cmd: Full())
        self.assertIn("cap", str(ctx.exception))


class DashboardRendering(unittest.TestCase):
    def test_html_is_self_contained_and_links_cards(self):
        item = issue(
            31, "A visual item", "active", labels=["lane:active"],
            classification={"category": "defect", "surface": "ui",
                            "upstream": [{
                                "kind": "issue",
                                "reference": "upstream/product#900",
                            }]},
        )
        report = status_report.build_report([item], CONTRACT)
        html = status_report.render_html(report, "example/repo")
        self.assertIn("SwiftUI delivery control", html)
        self.assertIn("A visual item", html)
        self.assertIn("https://github.com/example/repo/issues/31", html)
        self.assertIn("https://github.com/upstream/product/issues/900", html)
        self.assertIn("https://github.com/example/repo/issues/104", html)
        self.assertIn("<details", html)
        self.assertNotIn("<script src=", html)

    def test_write_html_creates_the_requested_artifact(self):
        report = status_report.build_report([], CONTRACT)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "board.html"
            status_report.write_html(target, report, "example/repo")
            self.assertTrue(target.is_file())
            self.assertIn("SwiftUI delivery control", target.read_text())

    def test_unknown_stage_remains_visible_in_a_catch_all_column(self):
        item = issue(32, "Future stage", "future-stage",
                     labels=["lane:future-stage"])
        report = status_report.build_report([item], CONTRACT)
        html = status_report.render_html(report, "example/repo")
        self.assertIn("Future stage", html)
        self.assertIn("stage-column-future-stage", html)

    def test_missing_limits_and_column_accessibility_render_cleanly(self):
        contract = dict(CONTRACT)
        contract["flowPolicy"] = {"wipLimits": {}, "backlog": {}}
        report = status_report.build_report([
            issue(33, "Accessible", "active", labels=["lane:active"]),
        ], contract)
        html = status_report.render_html(report, "example/repo")
        self.assertIn("<strong>1/?</strong>", html)
        self.assertIn('aria-label="active lane"', html)
        self.assertNotIn('aria-live="polite"', html)

    def test_surface_filter_is_data_driven_and_unclassified_is_reconcilable(self):
        contract = dict(CONTRACT)
        contract["workItemClassification"] = {
            "categories": CONTRACT["workItemClassification"]["categories"],
            "surfaces": ["ui", "non-ui", "mixed"],
        }
        rows = [
            issue(40, "Mixed", "queued", labels=["lane:queued"],
                  classification={"category": "feature", "surface": "mixed",
                                  "upstream": []}),
            issue(41, "Incomplete", "queued", labels=["lane:queued"],
                  classification={"category": "feature", "surface": "ui"}),
        ]
        html = status_report.render_html(
            status_report.build_report(rows, contract), "example/repo")
        self.assertIn('<option value="mixed">mixed</option>', html)
        self.assertIn('<option value="__unclassified">Unclassified</option>', html)
        self.assertIn('data-classified="false"', html)
        self.assertIn("card.dataset.classified==='true'", html)


class ReceiptResolution(unittest.TestCase):
    def test_receipt_hint_in_directory_name_is_indexed(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt_dir = Path(directory) / "proofs"
            receipt_dir.mkdir()
            path = receipt_dir / "41.json"
            path.write_text(json.dumps({
                "kind": "swiftui-proof", "issue": "example/repo#41",
            }))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            index = status_report.scan_receipts([directory])
            self.assertEqual(index["byHash"][digest]["path"], str(path))

    def test_bound_and_current_worker_threads_resolve_without_a_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            launch_path = root / "launch-receipt.json"
            launch_path.write_text(json.dumps({
                "schemaVersion": 2,
                "kind": "swiftui-launch-receipt",
                "issue": "example/repo#41",
                "laneId": "picker",
                "environmentId": "env-1",
                "projectId": "project-1",
                "threadId": "bound-thread",
                "launchedAt": "2026-08-20T01:00:00Z",
            }))
            launch_hash = hashlib.sha256(launch_path.read_bytes()).hexdigest()
            (root / "dispatch-receipt.json").write_text(json.dumps({
                "schemaVersion": 1,
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-21T01:00:00Z",
                "environmentId": "env-1",
                "slots": [{
                    "issue": "example/repo#41",
                    "projectId": "project-2",
                    "threadId": "current-thread",
                    "mode": "redispatch",
                }],
            }))
            block = {
                "schemaVersion": 2, "kind": "swiftui-work-item",
                "issue": "example/repo#41", "laneId": "picker",
                "rank": 10, "stage": "active",
                "acceptance": ["Visible"], "dependencies": [],
                "binding": {"launchReceiptSha256": launch_hash},
            }
            work_issue = issue(
                41, "Picker", body="```swiftui-work-item-v2\n%s\n```" %
                json.dumps(block), labels=["lane:active"])
            index = status_report.scan_receipts([root])
            evidence = status_report.build_evidence(
                [work_issue], CONTRACT, index, t3_origin="http://t3.test")
            self.assertEqual(evidence[41]["boundThread"]["threadId"], "bound-thread")
            self.assertEqual(evidence[41]["currentThread"]["threadId"], "current-thread")
            self.assertEqual(
                evidence[41]["currentThread"]["url"],
                "http://t3.test/env-1/current-thread")
            self.assertEqual(evidence[41]["unresolved"], [])

    def test_newer_waiting_dispatch_clears_the_old_current_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dispatch-receipt-old.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-20T01:00:00Z",
                "environmentId": "env-1",
                "slots": [{"issue": "example/repo#43",
                           "threadId": "old-thread"}],
            }))
            (root / "dispatch-receipt-new.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-21T01:00:00Z",
                "environmentId": "env-1",
                "waiting": [{"issue": "example/repo#43",
                             "reason": "implementation WIP is full"}],
            }))
            block = {
                "schemaVersion": 2, "kind": "swiftui-work-item",
                "issue": "example/repo#43", "laneId": "picker",
                "rank": 10, "stage": "active", "acceptance": ["Visible"],
                "dependencies": [], "binding": {},
            }
            work_issue = issue(
                43, "Waiting", body="```swiftui-work-item-v2\n%s\n```" %
                json.dumps(block), labels=["lane:active"])
            index = status_report.scan_receipts([root])
            evidence = status_report.build_evidence(
                [work_issue], CONTRACT, index, t3_origin="http://t3.test")
            self.assertNotIn("currentThread", evidence[43])
            report = status_report.build_report(
                [work_issue], CONTRACT, evidence=evidence)
            self.assertEqual(
                report["workItems"][0]["responsibility"]["reason"],
                "implementation WIP is full")

    def test_issue_attachment_permission_gate_is_loud_and_owned_by_alex(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dispatch-receipt.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-31T09:53:56Z",
                "waiting": [{
                    "issue": "example/repo#44",
                    "reason": (
                        "GitHub issue-attachment gate: proof is valid but "
                        "browser UI was prohibited"),
                }],
            }))
            block = {
                "schemaVersion": 2, "kind": "swiftui-work-item",
                "issue": "example/repo#44", "laneId": "picker",
                "rank": 10, "stage": "active", "acceptance": ["Visible"],
                "dependencies": [], "binding": {},
            }
            work_issue = issue(
                44, "Needs upload", body="```swiftui-work-item-v2\n%s\n```" %
                json.dumps(block), labels=["lane:active"])
            evidence = status_report.build_evidence(
                [work_issue], CONTRACT, status_report.scan_receipts([root]),
                t3_origin="http://t3.test")
            report = status_report.build_report(
                [work_issue], CONTRACT, evidence=evidence)

            self.assertEqual(report["workItems"][0]["responsibility"]["owner"],
                             "Alex")
            self.assertEqual(report["humanActionRequired"], [{
                "issue": 44,
                "actor": "Alex",
                "capability": "github-issue-attachment-upload",
                "requiredAction": (
                    "Authorize browser/UI use to upload the validated proof "
                    "media to the owning GitHub issue"),
                "reason": (
                    "GitHub issue-attachment gate: proof is valid but "
                    "browser UI was prohibited"),
            }])
            text = status_report.render_text(report, "example/repo")
            self.assertLess(text.index("!!! ACTION REQUIRED FROM ALEX !!!"),
                            text.index("#44"))
            self.assertIn("github-issue-attachment-upload", text)
            html = status_report.render_html(report, "example/repo")
            self.assertLess(html.index("ACTION REQUIRED FROM ALEX"),
                            html.index("SwiftUI delivery orchestra"))

    def test_newer_worker_dispatch_clears_the_old_waiting_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dispatch-receipt-old.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-20T01:00:00Z",
                "environmentId": "env-1",
                "waiting": [{"issue": "example/repo#45",
                             "reason": "implementation WIP is full"}],
            }))
            (root / "dispatch-receipt-new.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-21T01:00:00Z",
                "environmentId": "env-1",
                "slots": [{"issue": "example/repo#45",
                           "threadId": "live-thread"}],
            }))
            block = {
                "schemaVersion": 2, "kind": "swiftui-work-item",
                "issue": "example/repo#45", "laneId": "picker",
                "rank": 10, "stage": "active", "acceptance": ["Visible"],
                "dependencies": [], "binding": {},
            }
            work_issue = issue(
                45, "Running", body="```swiftui-work-item-v2\n%s\n```" %
                json.dumps(block), labels=["lane:active"])
            evidence = status_report.build_evidence(
                [work_issue], CONTRACT, status_report.scan_receipts([root]),
                t3_origin="http://t3.test")
            self.assertNotIn("waiting", evidence[45])
            self.assertEqual(evidence[45]["currentThread"]["threadId"],
                             "live-thread")

    def test_newer_evidence_publication_clears_old_attachment_waiting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dispatch-receipt-old.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-20T01:00:00Z",
                "waiting": [{
                    "issue": "example/repo#46",
                    "reason": "GitHub issue-attachment gate",
                }],
            }))
            publication_path = root / "issue-publication-receipt.json"
            publication_path.write_text(json.dumps({
                "kind": "swiftui-issue-evidence-publication-receipt",
                "issue": "example/repo#46",
                "issueUrl": "https://github.com/example/repo/issues/46",
                "publishedAt": "2026-08-21T00:59:00Z",
            }))
            publication_hash = hashlib.sha256(
                publication_path.read_bytes()).hexdigest()
            (root / "dispatch-receipt-new.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-21T01:00:00Z",
                "evidencePublication": [{
                    "issue": "example/repo#46",
                    "receipt": str(publication_path),
                    "sha256": publication_hash,
                    "issueUrl": "https://github.com/example/repo/issues/46",
                }],
            }))
            block = {
                "schemaVersion": 2, "kind": "swiftui-work-item",
                "issue": "example/repo#46", "laneId": "picker",
                "rank": 10, "stage": "active", "acceptance": ["Visible"],
                "dependencies": [], "binding": {},
            }
            work_issue = issue(
                46, "Published", body="```swiftui-work-item-v2\n%s\n```" %
                json.dumps(block), labels=["lane:active"])
            evidence = status_report.build_evidence(
                [work_issue], CONTRACT, status_report.scan_receipts([root]),
                t3_origin="http://t3.test")
            self.assertNotIn("waiting", evidence[46])
            self.assertEqual(
                evidence[46]["issueEvidencePublication"]["sha256"],
                publication_hash)

    def test_parked_active_work_does_not_occupy_the_implementation_station(self):
        """A waiting reason means buffered work, not a worker holding a slot."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dispatch-receipt.json").write_text(json.dumps({
                "kind": "swiftui-coordinator-dispatch-receipt",
                "recordedAt": "2026-08-28T15:00:00Z",
                "environmentId": "env-1",
                "slots": [{"issue": "example/repo#46", "threadId": "live-thread"}],
                "waiting": [{"issue": "example/repo#45",
                             "reason": "blocked on #44 reaching landed"}],
            }))

            def active(number):
                block = {
                    "schemaVersion": 2, "kind": "swiftui-work-item",
                    "issue": "example/repo#%d" % number, "laneId": "picker",
                    "rank": 10, "stage": "active", "acceptance": ["Visible"],
                    "dependencies": [], "binding": {},
                }
                return issue(number, "Active %d" % number,
                             body="```swiftui-work-item-v2\n%s\n```" % json.dumps(block),
                             labels=["lane:active"])

            issues = [active(45), active(46)]
            evidence = status_report.build_evidence(
                issues, CONTRACT, status_report.scan_receipts([root]),
                t3_origin="http://t3.test")
            report = status_report.build_report(issues, CONTRACT, evidence=evidence)
            station = report["stations"]["activeImplementation"]

            self.assertEqual(report["stageCounts"]["active"], 2)
            self.assertEqual(station["occupied"], 1)
            self.assertEqual(station["parked"],
                             [{"issue": 45, "reason": "blocked on #44 reaching landed"}])
            self.assertIn("parked #45: blocked on #44 reaching landed",
                          status_report.render_text(report, "example/repo"))

    def test_missing_receipt_hash_stays_visible(self):
        block = {
            "schemaVersion": 2, "kind": "swiftui-work-item",
            "issue": "example/repo#42", "laneId": "picker",
            "rank": 10, "stage": "active",
            "acceptance": ["Visible"], "dependencies": [],
            "binding": {"launchReceiptSha256": "a" * 64},
        }
        work_issue = issue(
            42, "Picker", body="```swiftui-work-item-v2\n%s\n```" %
            json.dumps(block), labels=["lane:active"])
        evidence = status_report.build_evidence(
            [work_issue], CONTRACT, {"byHash": {}, "byKind": {}},
            t3_origin="http://t3.test")
        self.assertEqual(evidence[42]["unresolved"][0]["field"],
                         "launchReceiptSha256")

    def test_uat_receipt_links_the_build_and_marks_stale_stage_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "build-80-uat-thread-receipt.json").write_text(json.dumps({
                "kind": "swiftui-uat-thread-receipt",
                "build": 80, "channel": "test",
                "installedStatus": "installed",
                "threadId": "uat-thread", "projectId": "uat-project",
                "createdAt": "2026-08-22T01:00:00Z",
                "entries": {"freshVerdict": [44], "installedCarry": []},
            }))
            block = {
                "schemaVersion": 2, "kind": "swiftui-work-item",
                "issue": "example/repo#44", "laneId": "picker",
                "rank": 10, "stage": "proof-ready",
                "acceptance": ["Visible"], "dependencies": [],
                "binding": {},
            }
            work_issue = issue(
                44, "UAT history", body="```swiftui-work-item-v2\n%s\n```" %
                json.dumps(block), labels=["lane:proof-ready"])
            evidence = status_report.build_evidence(
                [work_issue], CONTRACT, status_report.scan_receipts([root]),
                t3_origin="http://t3.test", t3_environment_id="env-live")
            self.assertEqual(evidence[44]["uat"]["build"], 80)
            self.assertTrue(evidence[44]["uat"]["historical"])
            self.assertEqual(evidence[44]["uat"]["url"],
                             "http://t3.test/env-live/uat-thread")


if __name__ == "__main__":
    unittest.main()
