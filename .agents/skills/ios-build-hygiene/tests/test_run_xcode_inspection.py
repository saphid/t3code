import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "run-xcode-inspection.py"
SPEC = importlib.util.spec_from_file_location("run_xcode_inspection", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class XcodeInspectionTests(unittest.TestCase):
    def test_accepts_one_read_only_operation(self):
        self.assertEqual(
            MODULE.validate_xcode_arguments(
                ["-project", "App.xcodeproj", "-scheme", "App", "-showBuildSettings"]
            ),
            "show-build-settings",
        )

    def test_rejects_build_or_test_actions(self):
        for action in ("build", "test", "archive", "clean"):
            with self.subTest(action=action):
                with self.assertRaises(ValueError):
                    MODULE.validate_xcode_arguments(["-showBuildSettings", action])

    def test_rejects_missing_or_multiple_inspection_operations(self):
        with self.assertRaises(ValueError):
            MODULE.validate_xcode_arguments(["-project", "App.xcodeproj"])
        with self.assertRaises(ValueError):
            MODULE.validate_xcode_arguments(["-list", "-showBuildSettings"])

    def test_hygiene_lock_is_owned_and_released_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_dir = Path(directory) / "locks" / "ios-build-hygiene.lock"
            acquired, reason = MODULE.acquire_hygiene_lock(lock_dir)
            self.assertTrue(acquired)
            self.assertIsNone(reason)
            self.assertEqual(
                int((lock_dir / "owner-pid").read_text(encoding="utf-8")),
                os.getpid(),
            )
            self.assertTrue(MODULE.release_hygiene_lock(lock_dir))
            self.assertFalse(lock_dir.exists())

    def test_active_mcp_lease_defers_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_dir = Path(directory) / "ios-build-hygiene.lock"
            lock_dir.mkdir()
            derived_data = Path(directory) / "owned" / "DerivedData"
            derived_data.mkdir(parents=True)
            marker = lock_dir / "mcp-derived-data"
            marker.write_text(str(derived_data) + "\n", encoding="utf-8")
            acquired, reason = MODULE.acquire_hygiene_lock(lock_dir)
            self.assertFalse(acquired)
            self.assertEqual(reason, "xcodebuildmcp-lease-active")
            self.assertEqual(
                marker.read_text(encoding="utf-8"),
                str(derived_data) + "\n",
            )

    def test_stale_direct_lock_is_reclaimed(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_dir = Path(directory) / "ios-build-hygiene.lock"
            lock_dir.mkdir()
            (lock_dir / "owner-pid").write_text("99999999\n", encoding="utf-8")
            acquired, reason = MODULE.acquire_hygiene_lock(lock_dir)
            self.assertTrue(acquired)
            self.assertIsNone(reason)
            self.assertEqual(
                int((lock_dir / "owner-pid").read_text(encoding="utf-8")),
                os.getpid(),
            )
            self.assertTrue(MODULE.release_hygiene_lock(lock_dir))

    def test_owner_marker_failure_rolls_back_new_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_dir = Path(directory) / "ios-build-hygiene.lock"
            with mock.patch.object(Path, "write_text", side_effect=OSError("fixture")):
                with self.assertRaises(OSError):
                    MODULE.acquire_hygiene_lock(lock_dir)
            self.assertFalse(lock_dir.exists())

    def test_preserves_real_exit_status(self):
        result = MODULE.run_process(
            "/bin/sh", ["-c", "exit 7"], timeout_seconds=2, grace_seconds=0.2
        )
        self.assertEqual(result["exitCode"], 7)
        self.assertFalse(result["timedOut"])

    def test_timeout_terminates_the_process_group(self):
        started = time.monotonic()
        result = MODULE.run_process(
            "/bin/sh", ["-c", "sleep 10"], timeout_seconds=0.1, grace_seconds=0.2
        )
        self.assertEqual(result["exitCode"], 124)
        self.assertTrue(result["timedOut"])
        self.assertIn(result["termination"], ("terminated", "killed"))
        self.assertLess(time.monotonic() - started, 2)

    def test_receipt_is_complete_and_atomic(self):
        receipt = {
            "schemaVersion": 1,
            "kind": "xcodebuild-inspection",
            "durationMs": 12,
            "exitCode": 0,
        }
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "nested" / "receipt.json"
            MODULE.write_receipt(target, receipt)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), receipt)
            self.assertEqual(list(target.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
