"""Hermetic tests for status_report: fence parsing, WIP occupancy, drift."""

import json
import unittest

import status_report


def issue(number, title, stage=None, lane="lane-a", labels=(), body=None,
          hold=None):
    if body is None and stage is not None:
        block = {"schemaVersion": 2, "issue": "x#%d" % number,
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


if __name__ == "__main__":
    unittest.main()
