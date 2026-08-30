"""Focused tests for signed phone artifact validity."""

import importlib.util
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
            "schemaVersion": 1,
            "channel": "test",
            "build": 81,
            "sequence": 81,
            "commit": "a" * 40,
            "bundleId": "com.example.test",
            "appPath": "/allowed/T3Code.app",
            "zipPath": "/allowed/T3Code.app.zip",
            "sha256": "b" * 64,
            "deviceId": "DEVICE",
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


if __name__ == "__main__":
    unittest.main()
