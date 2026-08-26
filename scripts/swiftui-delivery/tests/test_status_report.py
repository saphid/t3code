"""Hermetic tests for status_report: fence parsing, WIP occupancy, drift."""

import json
import unittest

import status_report


def issue(number, title, stage=None, lane="lane-a", labels=(), body=None,
          hold=None):
    if body is None and stage is not None:
        block = {"schemaVersion": 2, "issue": "example/repo#%d" % number,
                 "laneId": lane, "stage": stage}
        if hold:
            block["hold"] = {"reason": hold}
        body = "intro\n```swiftui-work-item-v2\n%s\n```\n" % json.dumps(block)
    return {"number": number, "title": title, "body": body or "",
            "labels": [{"name": l} for l in labels]}


CONTRACT = {
    "workItemRepository": "example/repo",
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
            stdout = "[]"
            stderr = ""

        def runner(cmd):
            calls.append(cmd)
            return Result()

        status_report.fetch_issues("example/repo", gh_runner=runner)
        self.assertEqual(calls[0][:4], ["gh", "issue", "list", "-R"])

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
            stdout = json.dumps([
                {"number": i, "title": "t", "body": "", "labels": []}
                for i in range(3)])

        with self.assertRaises(RuntimeError) as ctx:
            status_report.fetch_issues(
                "example/repo", limit=3, gh_runner=lambda cmd: Full())
        self.assertIn("cap", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
