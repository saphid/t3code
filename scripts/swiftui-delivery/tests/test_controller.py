import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

PACKAGE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE))
import controller  # noqa: E402


NOW = datetime(2026, 8, 28, 11, 0, tzinfo=timezone.utc)


def report(rows=None, occupied=4, limit=4, queued=0, replenish=False):
    return {
        "workItems": rows or [],
        "stations": {"activeImplementation": {
            "occupied": occupied, "limit": limit,
        }},
        "queuedReady": queued,
        "backlogNeedsReplenish": replenish,
    }


def completed_active(issue=141):
    return {
        "issue": issue, "stage": "active", "waiting": None,
        "workerThread": {"state": "completed"},
    }


def failover_policy():
    def candidate(identifier, instance, model, lanes):
        return {
            "id": identifier,
            "modelSelection": {"instanceId": instance, "model": model},
            "requiredHeadroomLanes": lanes,
        }
    return {
        "minimumRemainingPercent": 10,
        "errorCooldownSeconds": 900,
        "allowUnknownLaneProbe": True,
        "candidates": [
            candidate("opus", "claudeAgent", "claude-opus-5",
                      ["claude-fiveHour", "claude-weekly"]),
            candidate("fable", "claudeAgent", "claude-fable-5",
                      ["claude-fable", "claude-weekly"]),
            candidate("sol", "codex", "gpt-5.6-sol",
                      ["codex-fiveHour", "codex-weekly"]),
        ],
    }


def headroom(opus=0, claude_weekly=20, fable=0,
             codex_five=None, codex_weekly=80, state="fresh"):
    values = {
        "claude-fiveHour": opus,
        "claude-weekly": claude_weekly,
        "claude-fable": fable,
        "codex-fiveHour": codex_five,
        "codex-weekly": codex_weekly,
    }
    lanes = []
    for identifier, value in values.items():
        lanes.append({
            "id": identifier,
            "available": value is not None,
            "remainingPercent": value,
            "state": state if value is not None else "unavailable",
            "resetsAt": None,
        })
    return {
        "capturedAt": "2026-08-28T10:59:30Z",
        "state": state,
        "lanes": lanes,
    }


class ReasonTests(unittest.TestCase):
    def test_idle_report_has_no_reason(self):
        rows = [{
            "issue": 1, "stage": "active", "waiting": None,
            "workerThread": {"state": "running"},
        }]
        self.assertEqual(controller.reconciliation_reasons(report(rows)), [])

    def test_proof_and_stalled_worker_are_actionable(self):
        rows = [completed_active(), {"issue": 112, "stage": "proof-ready"}]
        reasons = controller.reconciliation_reasons(report(rows))
        self.assertEqual(reasons, [
            "proof-ready issues: #112",
            "active issues without a live worker: #141",
        ])

    def test_explicit_waiting_reason_does_not_wake_worker(self):
        rows = [{
            "issue": 137, "stage": "active",
            "waiting": {"reason": "WIP full"}, "workerThread": None,
        }]
        self.assertEqual(controller.reconciliation_reasons(report(rows)), [])

    def test_flow_control_reasons_are_mechanical(self):
        self.assertEqual(
            controller.reconciliation_reasons(report(occupied=5, limit=4)),
            ["implementation WIP is over limit: 5/4"])
        self.assertEqual(
            controller.reconciliation_reasons(
                report(occupied=2, limit=4, queued=3, replenish=True)),
            ["implementation WIP has open capacity: 2/4",
             "ready backlog is below its configured floor"])


class ModelSelectionTests(unittest.TestCase):
    def test_prefers_first_fully_eligible_model(self):
        choice = controller.select_model(
            headroom(opus=25, fable=90, codex_five=90), failover_policy())
        self.assertEqual(choice["candidate"]["id"], "opus")
        self.assertEqual(choice["basis"], "eligible")

    def test_falls_through_zero_and_low_quota(self):
        choice = controller.select_model(
            headroom(opus=0, fable=3, codex_five=40), failover_policy())
        self.assertEqual(choice["candidate"]["id"], "sol")

    def test_one_unknown_lane_is_only_a_probe(self):
        choice = controller.select_model(
            headroom(opus=0, fable=3, codex_five=None), failover_policy())
        self.assertEqual(choice["candidate"]["id"], "sol")
        self.assertEqual(choice["basis"], "probe")

    def test_two_unknown_lanes_do_not_qualify(self):
        report = headroom(opus=0, fable=3, codex_five=None,
                          codex_weekly=None)
        choice = controller.select_model(report, failover_policy())
        self.assertIsNone(choice["candidate"])

    def test_error_cooldown_excludes_otherwise_eligible_model(self):
        blocked = {"claudeAgent:claude-opus-5": "recent turn error"}
        choice = controller.select_model(
            headroom(opus=50, fable=20, codex_five=80),
            failover_policy(), blocked=blocked)
        self.assertEqual(choice["candidate"]["id"], "fable")
        self.assertEqual(choice["decisions"][0]["status"], "cooldown")

    def test_receipt_evidence_whitelists_sanitized_quota_fields(self):
        value = headroom(opus=20)
        value["lanes"][0]["providerInternal"] = "must-not-leak"
        evidence = controller.headroom_evidence(value)
        self.assertNotIn("providerInternal", evidence["lanes"][0])
        self.assertEqual(evidence["lanes"][0]["remainingPercent"], 20)


class FakeResponse(object):
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.value).encode("utf-8")


class ControllerRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        package = self.checkout / "scripts/swiftui-delivery"
        package.mkdir(parents=True)
        (package / "contract.json").write_text(json.dumps({
            "coordinatorController": {"modelFailover": failover_policy()},
        }))
        t3_home = self.root / "t3"
        (t3_home / "userdata").mkdir(parents=True)
        (t3_home / "userdata/server-runtime.json").write_text(
            '{"origin":"http://127.0.0.1:3773"}\n')
        self.config = {
            "checkout": str(self.checkout),
            "t3Command": "/mock/t3",
            "t3Home": str(t3_home),
            "stateRoot": str(self.root / "state"),
            "minimumDispatchIntervalSeconds": 0,
            "headroomReporter": "/mock/report-headroom.py",
        }
        self.headroom = headroom(opus=0, fable=3, codex_five=None)
        self.commands = []
        self.http_commands = []

    def runner(self, command, timeout=120):
        self.commands.append(command)
        if command[-1] == "--json" and command[0].endswith("status"):
            return subprocess.CompletedProcess(
                command, 0, json.dumps(report([completed_active()])), "")
        if (len(command) == 3 and command[0] == sys.executable and
                command[1] == self.config["headroomReporter"] and
                command[2] == "--json"):
            return subprocess.CompletedProcess(
                command, 0, json.dumps(self.headroom), "")
        if command[1:4] == ["auth", "session", "issue"]:
            return subprocess.CompletedProcess(command, 0, json.dumps({
                "sessionId": "session-1", "token": "secret-token",
            }), "")
        if command[1:4] == ["auth", "session", "revoke"]:
            return subprocess.CompletedProcess(command, 0, "revoked\n", "")
        if command[:4] == ["git", "-C", str(self.checkout), "branch"]:
            return subprocess.CompletedProcess(command, 0, "main\n", "")
        return subprocess.CompletedProcess(command, 1, "", "unexpected")

    def opener(self, request, timeout=10):
        if request.full_url.endswith("/snapshot"):
            return FakeResponse(self.snapshot)
        payload = json.loads(request.data)
        self.http_commands.append(payload)
        return FakeResponse({"sequence": len(self.http_commands)})

    def base_snapshot(self, threads=None):
        return {
            "projects": [{
                "id": "project-1", "workspaceRoot": str(self.checkout),
                "deletedAt": None,
                "defaultModelSelection": {
                    "instanceId": "codex", "model": "gpt-5.6-sol",
                },
            }],
            "threads": threads or [],
        }

    def test_running_coordinator_suppresses_duplicate_dispatch(self):
        self.snapshot = self.base_snapshot([{
            "id": "human-turn", "projectId": "project-1",
            "title": "Current coordinator", "deletedAt": None,
            "worktreePath": str(self.checkout),
            "latestTurn": {"state": "running"},
        }])
        value = controller.run_once(
            self.config, runner=self.runner, opener=self.opener, now=NOW)
        self.assertEqual(value["status"], "coordinator-running")
        self.assertEqual(self.http_commands, [])
        self.assertEqual(value["sessionRevocationExitStatus"], 0)

    def test_missing_controller_thread_is_created_then_started(self):
        self.snapshot = self.base_snapshot()
        value = controller.run_once(
            self.config, runner=self.runner, opener=self.opener, now=NOW)
        self.assertEqual(value["status"], "dispatched")
        self.assertTrue(value["threadCreated"])
        self.assertEqual([item["type"] for item in self.http_commands],
                         ["thread.create", "thread.turn.start"])
        self.assertEqual(self.http_commands[1]["threadId"],
                         self.http_commands[0]["threadId"])
        self.assertIn("#141", self.http_commands[1]["message"]["text"])
        self.assertEqual(
            self.http_commands[0]["modelSelection"]["model"],
            "gpt-5.6-sol")
        self.assertEqual(value["selectionBasis"], "probe")
        self.assertNotIn("secret-token", json.dumps(value))

    def test_existing_controller_thread_is_woken_without_recreation(self):
        self.snapshot = self.base_snapshot([{
            "id": "controller-1", "projectId": "project-1",
            "title": controller.CONTROLLER_TITLE + " [sol]", "deletedAt": None,
            "archivedAt": None, "latestTurn": {"state": "completed"},
            "modelSelection": {
                "instanceId": "codex", "model": "gpt-5.6-sol",
            },
            "runtimeMode": "full-access", "interactionMode": "default",
            "updatedAt": "2026-08-28T10:00:00Z",
        }])
        value = controller.run_once(
            self.config, runner=self.runner, opener=self.opener, now=NOW)
        self.assertEqual(value["status"], "dispatched")
        self.assertFalse(value["threadCreated"])
        self.assertEqual([item["type"] for item in self.http_commands],
                         ["thread.turn.start"])

    def test_low_quota_switches_model_and_creates_new_thread(self):
        self.headroom = headroom(opus=0, fable=30, codex_five=60)
        self.snapshot = self.base_snapshot([{
            "id": "controller-opus", "projectId": "project-1",
            "title": controller.CONTROLLER_TITLE + " [opus]",
            "deletedAt": None, "archivedAt": None,
            "latestTurn": {"state": "completed"},
            "modelSelection": {
                "instanceId": "claudeAgent", "model": "claude-opus-5",
            },
            "updatedAt": "2026-08-28T10:00:00Z",
        }])
        value = controller.run_once(
            self.config, runner=self.runner, opener=self.opener, now=NOW)
        self.assertEqual(value["selectedModel"]["id"], "fable")
        self.assertTrue(value["threadCreated"])
        self.assertEqual(self.http_commands[0]["type"], "thread.create")
        self.assertEqual(
            self.http_commands[0]["modelSelection"]["model"],
            "claude-fable-5")

    def test_recent_model_error_forces_failover_even_with_headroom(self):
        self.headroom = headroom(opus=50, fable=30, codex_five=60)
        self.snapshot = self.base_snapshot([{
            "id": "controller-opus", "projectId": "project-1",
            "title": controller.CONTROLLER_TITLE + " [opus]",
            "deletedAt": None, "archivedAt": None,
            "latestTurn": {
                "state": "error",
                "requestedAt": "2026-08-28T10:58:00Z",
                "completedAt": "2026-08-28T10:59:30Z",
            },
            "modelSelection": {
                "instanceId": "claudeAgent", "model": "claude-opus-5",
            },
            "updatedAt": "2026-08-28T10:59:30Z",
        }])
        value = controller.run_once(
            self.config, runner=self.runner, opener=self.opener, now=NOW)
        self.assertEqual(value["selectedModel"]["id"], "fable")
        self.assertEqual(value["modelDecisions"][0]["status"], "cooldown")
        self.assertTrue(value["threadCreated"])

    def test_no_capacity_records_receipt_without_starting_turn(self):
        self.headroom = headroom(
            opus=0, claude_weekly=3, fable=0,
            codex_five=None, codex_weekly=None)
        self.snapshot = self.base_snapshot()
        value = controller.run_once(
            self.config, runner=self.runner, opener=self.opener, now=NOW)
        self.assertEqual(value["status"], "no-model-capacity")
        self.assertEqual(self.http_commands, [])
        self.assertEqual(value["sessionRevocationExitStatus"], 0)
        self.assertTrue((self.root / "state/latest.json").is_file())

    def test_headroom_failure_waits_and_revokes_session(self):
        self.snapshot = self.base_snapshot()

        def broken_runner(command, timeout=120):
            if (len(command) == 3 and command[0] == sys.executable and
                    command[1] == self.config["headroomReporter"]):
                return subprocess.CompletedProcess(command, 2, "", "quota unavailable")
            return self.runner(command, timeout=timeout)

        value = controller.run_once(
            self.config, runner=broken_runner, opener=self.opener, now=NOW)
        self.assertEqual(value["status"], "waiting")
        self.assertIn("headroom reporter exited 2", value["reason"])
        revoke = [command for command in self.commands
                  if command[1:4] == ["auth", "session", "revoke"]]
        self.assertEqual(len(revoke), 1)

    def test_idle_pass_does_not_issue_an_api_session(self):
        def idle_runner(command, timeout=120):
            self.commands.append(command)
            return subprocess.CompletedProcess(
                command, 0, json.dumps(report()), "")

        value = controller.run_once(
            self.config, runner=idle_runner, opener=self.opener, now=NOW)
        self.assertEqual(value["status"], "idle")
        self.assertEqual(len(self.commands), 1)
        self.assertTrue((self.root / "state/latest.json").is_file())

    def test_cooldown_survives_later_non_dispatch_receipts(self):
        state = pathlib.Path(self.config["stateRoot"])
        prior = {
            "status": "dispatched", "recordedAt": "2026-08-28T10:59:00.000Z",
        }
        controller.write_run_receipt(state, prior)
        controller.write_run_receipt(state, {
            "status": "coordinator-running",
            "recordedAt": "2026-08-28T10:59:30.000Z",
        })
        self.assertTrue(controller.last_dispatch_is_recent(
            state, NOW, minimum_seconds=300))

    def test_api_failure_records_waiting_and_revokes_session(self):
        self.snapshot = self.base_snapshot()

        def broken_opener(request, timeout=10):
            raise OSError("server gone")

        value = controller.run_once(
            self.config, runner=self.runner, opener=broken_opener, now=NOW)
        self.assertEqual(value["status"], "waiting")
        revoke = [command for command in self.commands
                  if command[1:4] == ["auth", "session", "revoke"]]
        self.assertEqual(len(revoke), 1)


if __name__ == "__main__":
    unittest.main()
