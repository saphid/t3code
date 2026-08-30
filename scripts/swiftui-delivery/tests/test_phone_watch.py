"""Focused tests for signed phone artifact validity."""

import importlib.util
import hashlib
import json
import plistlib
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


WATCHER_PATH = Path(__file__).resolve().parents[1] / "watcher" / "phone-watch.py"
SPEC = importlib.util.spec_from_file_location("swiftui_phone_watch", WATCHER_PATH)
watcher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(watcher)


def cms_result(expiration):
    value = plistlib.dumps({"ExpirationDate": expiration}).decode()
    return subprocess.CompletedProcess([], 0, value, "")


class ProvisioningProfileValidityTests(unittest.TestCase):
    def make_app(self, directory, extensions=()):
        app = Path(directory) / "T3Code.app"
        app.mkdir()
        (app / "embedded.mobileprovision").touch()
        for name in extensions:
            extension = app / "PlugIns" / (name + ".appex")
            extension.mkdir(parents=True)
            (extension / "embedded.mobileprovision").touch()
        return app

    def test_accepts_host_and_extension_profiles_with_more_than_one_day_left(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(directory, ("Widgets", "Share"))
            expiration = datetime.now(timezone.utc) + timedelta(days=6)
            with mock.patch.object(watcher, "run", return_value=cms_result(expiration)):
                self.assertEqual(watcher.provisioning_profiles_current(app), (True, None))

    def test_rejects_profile_with_less_than_one_day_left(self):
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(directory)
            expiration = datetime.now(timezone.utc) + timedelta(hours=12)
            with mock.patch.object(watcher, "run", return_value=cms_result(expiration)):
                self.assertEqual(
                    watcher.provisioning_profiles_current(app),
                    (False, "expiring-provisioning"),
                )

    def test_rejects_missing_host_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "T3Code.app"
            app.mkdir()
            self.assertEqual(
                watcher.provisioning_profiles_current(app),
                (False, "missing-provisioning"),
            )

    def test_process_channel_records_expiring_profile(self):
        pointer = {
            "schemaVersion": 2,
            "channel": "test",
            "build": 81,
            "sequence": 81,
            "commit": "a" * 40,
            "bundleId": "com.example.test",
            "appPath": "/allowed/T3Code.app",
            "zipPath": "/allowed/T3Code.app.zip",
            "sha256": "b" * 64,
            "deviceId": "DEVICE",
            "generationPlan": {"path": "/allowed/generation-plan.json", "sha256": "c" * 64},
            "generationReceipt": {"path": "/allowed/generation-receipt.json", "sha256": "d" * 64},
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pointer_path = root / "test.json"
            pointer_path.write_text(json.dumps(pointer))
            receipts = root / "receipts"
            with mock.patch.object(watcher, "RECEIPTS", receipts), \
                    mock.patch.object(
                        watcher, "_valid_pointer_without_profile_expiry",
                        return_value=True,
                    ), \
                    mock.patch.object(
                        watcher, "provisioning_profiles_current",
                        return_value=(False, "expiring-provisioning"),
                    ):
                watcher.process_channel(pointer_path, {"deviceId": "DEVICE"})
            receipt = watcher.load(receipts / "test.json")
            self.assertEqual(receipt["status"], "rejected-expiring-provisioning")
            self.assertTrue(receipt["launchPending"])


class GenerationProvenanceTests(unittest.TestCase):
    def write_json(self, path, value):
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_generation_receipt_binds_plan_artifact_and_composed_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan_path = root / "generation-plan.json"
            plan_sha = self.write_json(plan_path, {
                "mode": "publish-test", "entries": [{"issue": "example/repo#1"}],
            })
            receipt_path = root / "generation-receipt.json"
            receipt_sha = self.write_json(receipt_path, {
                "schemaVersion": 3,
                "kind": "swiftui-generation-receipt",
                "mode": "publish-test",
                "planSha256": plan_sha,
                "installedArtifactSha256": "a" * 64,
                "resultingCommit": "b" * 40,
                "entries": [{"issue": "example/repo#1", "headCommit": "c" * 40}],
            })
            pointer = {
                "channel": "test", "sha256": "a" * 64, "commit": "b" * 40,
            }
            self.assertTrue(watcher.generation_provenance_matches(
                pointer,
                root,
                {"path": str(plan_path), "sha256": plan_sha},
                {"path": str(receipt_path), "sha256": receipt_sha},
            ))

    def test_generation_receipt_rejects_a_different_artifact_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan_path = root / "generation-plan.json"
            plan_sha = self.write_json(plan_path, {"mode": "publish-test"})
            receipt_path = root / "generation-receipt.json"
            receipt_sha = self.write_json(receipt_path, {
                "schemaVersion": 3,
                "kind": "swiftui-generation-receipt",
                "mode": "publish-test",
                "planSha256": plan_sha,
                "installedArtifactSha256": "f" * 64,
                "resultingCommit": "b" * 40,
                "entries": [{}],
            })
            pointer = {"channel": "test", "sha256": "a" * 64, "commit": "b" * 40}
            self.assertFalse(watcher.generation_provenance_matches(
                pointer,
                root,
                {"path": str(plan_path), "sha256": plan_sha},
                {"path": str(receipt_path), "sha256": receipt_sha},
            ))


if __name__ == "__main__":
    unittest.main()
