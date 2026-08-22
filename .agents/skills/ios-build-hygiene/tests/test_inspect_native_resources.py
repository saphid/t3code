import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "inspect-native-resources.py"
SPEC = importlib.util.spec_from_file_location("inspect_native_resources", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeResourceInventoryTests(unittest.TestCase):
    def snapshot(self, **overrides):
        raw = {
            "observedAt": "2026-08-16T00:00:00Z",
            "hostname": "fixture-host",
            "lock": {"path": "/fixture/lock", "present": False},
            "processes": [],
            "simulators": [],
            "derivedData": [],
            "disk": {"path": "/", "bytesTotal": 100, "bytesUsed": 60, "bytesFree": 40},
            "errors": [],
        }
        raw.update(overrides)
        return MODULE.classify_snapshot(raw, "fixture")

    def test_active_mcp_path_is_grandfathered_and_never_cleanup_eligible(self):
        path = "/private/tmp/t3-xcodebuildmcp.fixture/DerivedData"
        snapshot = self.snapshot(
            lock={
                "path": "/fixture/lock",
                "present": True,
                "ownerPid": None,
                "mcpDerivedDataPath": path,
            },
            derivedData=[
                {
                    "path": path,
                    "exists": True,
                    "productLane": "simulator-verification",
                    "openHandlePids": [42],
                }
            ],
        )
        self.assertEqual(snapshot["lock"]["state"], "mcp-active")
        self.assertEqual(snapshot["lock"]["classification"], "owned-active")
        self.assertEqual(snapshot["derivedData"][0]["classification"], "owned-active")
        self.assertFalse(snapshot["derivedData"][0]["cleanupEligible"])
        self.assertEqual(snapshot["summary"]["cleanupEligibleCount"], 0)

    def test_direct_owner_and_child_are_preserved(self):
        snapshot = self.snapshot(
            lock={
                "path": "/fixture/lock",
                "present": True,
                "ownerPid": 100,
                "mcpDerivedDataPath": None,
            },
            processes=[
                {"pid": 100, "ppid": 1, "elapsedSeconds": 20, "command": "/bin/bash wrapper"},
                {"pid": 101, "ppid": 100, "elapsedSeconds": 10, "command": "/usr/bin/xcodebuild test"},
            ],
        )
        self.assertEqual(snapshot["lock"]["state"], "direct-active")
        worker = snapshot["processes"][0]
        self.assertEqual(worker["kind"], "xcodebuild")
        self.assertEqual(worker["classification"], "owned-active")
        self.assertEqual(worker["ownerEvidence"], "direct-hygiene-lock")

    def test_xcodebuild_metadata_query_is_labeled_as_inspection(self):
        snapshot = self.snapshot(
            processes=[
                {
                    "pid": 110,
                    "ppid": 1,
                    "elapsedSeconds": 45,
                    "command": "/usr/bin/xcodebuild -scheme App -showBuildSettings",
                }
            ]
        )
        worker = snapshot["processes"][0]
        self.assertEqual(worker["kind"], "xcodebuild-inspection")
        self.assertEqual(worker["resourceClass"], "native-worker")
        self.assertEqual(worker["classification"], "protected-unknown")

    def test_mcp_derived_data_argument_links_worker_to_lease(self):
        path = "/private/tmp/t3-xcodebuildmcp.fixture/DerivedData"
        snapshot = self.snapshot(
            lock={
                "path": "/fixture/lock",
                "present": True,
                "ownerPid": None,
                "mcpDerivedDataPath": path,
            },
            processes=[
                {
                    "pid": 200,
                    "ppid": 1,
                    "elapsedSeconds": 8,
                    "command": "/usr/bin/xcodebuild -derivedDataPath " + path + " test",
                }
            ],
            derivedData=[
                {
                    "path": path,
                    "exists": True,
                    "openHandlePids": [200],
                }
            ],
        )
        worker = snapshot["processes"][0]
        self.assertEqual(worker["classification"], "owned-active")
        self.assertEqual(worker["ownerEvidence"], "mcp-hygiene-lock")

    def test_unknown_resources_fail_closed(self):
        snapshot = self.snapshot(
            processes=[
                {"pid": 900, "ppid": 1, "elapsedSeconds": 90, "command": "/usr/bin/xctest bundle"}
            ],
            derivedData=[
                {
                    "path": "/unknown/DerivedData",
                    "exists": True,
                    "openHandlePids": [],
                }
            ],
            simulators=[
                {"udid": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", "name": "Phone", "state": "Booted", "runtime": "iOS"}
            ],
        )
        self.assertEqual(snapshot["processes"][0]["classification"], "protected-unknown")
        self.assertEqual(snapshot["derivedData"][0]["classification"], "protected-unknown")
        self.assertEqual(snapshot["simulators"][0]["classification"], "protected-unknown")
        self.assertEqual(snapshot["summary"]["cleanupEligibleCount"], 0)

    def test_serve_sim_marks_only_its_named_simulator_as_legacy_active(self):
        owned = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
        other = "11111111-2222-3333-4444-555555555555"
        snapshot = self.snapshot(
            processes=[
                {"pid": 50, "ppid": 1, "elapsedSeconds": 30, "command": "serve-sim --udid " + owned}
            ],
            simulators=[
                {"udid": owned, "name": "Owned", "state": "Booted", "runtime": "iOS"},
                {"udid": other, "name": "Other", "state": "Shutdown", "runtime": "iOS"},
            ],
        )
        by_udid = {item["udid"]: item for item in snapshot["simulators"]}
        self.assertEqual(by_udid[owned]["classification"], "owned-active")
        self.assertEqual(by_udid[owned]["ownerEvidence"], "serve-sim")
        self.assertEqual(by_udid[other]["classification"], "informational")

    def test_partial_evidence_is_explicit_and_raw_commands_are_not_emitted(self):
        secret = "TOP_SECRET_VALUE"
        snapshot = self.snapshot(
            processes=[
                {"pid": 7, "ppid": 1, "elapsedSeconds": 1, "command": "xcodebuild TOKEN=" + secret}
            ],
            errors=[{"source": "simulators", "error": "exit-1"}],
        )
        encoded = json.dumps(snapshot)
        self.assertEqual(snapshot["coverage"], "partial")
        self.assertNotIn(secret, encoded)
        self.assertEqual(snapshot["errors"][0]["source"], "simulators")

    def test_fixture_cli_does_not_read_live_state(self):
        fixture = {
            "observedAt": "2026-08-16T00:00:00Z",
            "hostname": "fixture-host",
            "lock": {"path": "/fixture/lock", "present": False},
            "processes": [],
            "simulators": [],
            "derivedData": [],
            "disk": None,
            "errors": [],
        }
        with tempfile.TemporaryDirectory() as directory:
            fixture_path = Path(directory) / "fixture.json"
            fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
            environment = os.environ.copy()
            environment["PYTHONDONTWRITEBYTECODE"] = "1"
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--fixture", str(fixture_path), "--compact"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=environment,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["mode"], "fixture")
        self.assertTrue(payload["safety"]["readOnly"])

    @mock.patch.object(MODULE.subprocess, "run")
    def test_lsof_warning_makes_open_handle_coverage_partial(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="permission denied"
        )
        errors = []
        self.assertIsNone(MODULE.open_handle_pids("/fixture/DerivedData", errors))
        self.assertEqual(errors[0]["error"], "inspection-incomplete")

    @mock.patch.object(MODULE.subprocess, "run")
    def test_lsof_no_matches_is_a_complete_empty_result(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr=""
        )
        errors = []
        self.assertEqual(MODULE.open_handle_pids("/fixture/DerivedData", errors), [])
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
