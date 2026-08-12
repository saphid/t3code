#!/usr/bin/env python3

import importlib.util
import json
import plistlib
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parent
stream = load_module("swiftui_stream", ROOT / "stream.py")
watcher = load_module("swiftui_phone_watch", ROOT / "phone-watch.py")


class StreamTests(unittest.TestCase):
    def test_manifest_and_catalog_are_unique(self):
        value = stream.manifest()
        records = stream.catalog(False)
        self.assertEqual(len(records), len({item["id"] for item in records}))
        self.assertGreaterEqual(value["currentTestBuild"]["build"], 40)

    def test_pending_feature_requires_positive_integer_test_build(self):
        value = json.loads(json.dumps(stream.manifest()))
        pending = next(
            item for item in value["features"]
            if item["state"] in stream.APPROVAL_STATES
        )
        pending["testBuild"] = "42"
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

    def test_imported_pending_record_requires_test_build(self):
        record = {
            "id": "upstream-pr-1",
            "name": "Imported pending record",
            "state": "needs-you",
        }
        with patch.object(stream, "catalog", return_value=[record]):
            with self.assertRaises(SystemExit):
                stream.approval_list()

    def test_approval_list_carries_forward_installed_features_in_order(self):
        items = stream.approval_list()
        current = stream.manifest()["currentTestBuild"]["build"]
        self.assertTrue(items)
        self.assertEqual(
            [item.get("order", 1_000_000) for item in items],
            sorted(item.get("order", 1_000_000) for item in items),
        )
        self.assertTrue(all(item["testBuild"] <= current for item in items))
        self.assertNotIn("dev-title-label", {item["id"] for item in items})
        future_ids = {
            item["id"]
            for item in stream.catalog(False)
            if item.get("state") in stream.APPROVAL_STATES
            and item["testBuild"] > current
        }
        self.assertTrue(future_ids.isdisjoint(item["id"] for item in items))

    def test_fuzzy_match_prefers_command_palette(self):
        ranked = sorted(
            ((stream.score("palette", item), item["id"]) for item in stream.approval_list()),
            reverse=True,
        )
        self.assertEqual(ranked[0][1], "command-palette-top-drawer")

    def test_pr_delivery_inventory_is_complete(self):
        value = stream.load_json(ROOT / "pr-delivery.json")
        records = value["pullRequests"]
        self.assertEqual(len(records), len({item["number"] for item in records}))
        self.assertTrue(any(item["delivery"] == "direct" for item in records))
        self.assertTrue(any(item["delivery"] == "chain" for item in records))
        for item in records:
            if item["delivery"] == "direct":
                self.assertFalse(item["dependsOn"])
            if item["delivery"] == "chain":
                self.assertTrue(item["dependsOn"])
            delivery, dependencies = stream.delivery_for(
                f"https://github.com/pingdotgg/t3code/pull/{item['number']}"
            )
            self.assertEqual((delivery, dependencies), (item["delivery"], item["dependsOn"]))
        legacy = stream.load_json(stream.REPO_ROOT / stream.manifest()["legacyManifest"])
        referenced = {
            stream.pr_number(item.get("pullRequest"))
            for group in ("features", "candidates")
            for item in legacy.get(group, [])
            if item.get("pullRequest")
        }
        self.assertFalse(referenced - {item["number"] for item in records})
        catalog_by_pr = {}
        for item in stream.legacy_features(stream.manifest()):
            number = stream.pr_number(item.get("pullRequest"))
            if number is not None:
                catalog_by_pr.setdefault(number, set()).add(item["state"])
        for number in (5611, 5753, 5801, 5829):
            self.assertEqual(catalog_by_pr[number], {"upstream-validation"})


class WatcherTests(unittest.TestCase):
    def test_valid_pointer_checks_bundle_and_build(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "T3Code.app"
            app.mkdir()
            with (app / "Info.plist").open("wb") as file:
                plistlib.dump(
                    {
                        "CFBundleIdentifier": "com.alxs.t3code.typed-swiftui.dev",
                        "CFBundleVersion": "41",
                        "T3BuildChannel": "test",
                        "T3GitCommit": "a" * 40,
                    },
                    file,
                )
            archive = Path(directory) / "T3Code.app.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.write(app / "Info.plist", "T3Code.app/Info.plist")
            import hashlib
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            pointer = {
                "schemaVersion": 1,
                "channel": "test",
                "build": 41,
                "sequence": 41,
                "commit": "a" * 40,
                "bundleId": "com.alxs.t3code.typed-swiftui.dev",
                "appPath": str(app),
                "zipPath": str(archive),
                "sha256": digest,
                "deviceId": "device",
            }
            completed = subprocess.CompletedProcess([], 0, "", "")
            with patch.object(watcher, "run", return_value=completed):
                self.assertTrue(watcher.valid_pointer(pointer))
                pointer["build"] = 42
                self.assertFalse(watcher.valid_pointer(pointer))

    def test_process_channel_never_downgrades(self):
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / "test.json"
            ready.write_text(json.dumps({
                "schemaVersion": 1,
                "channel": "test",
                "build": 41,
                "sequence": 41,
                "commit": "a" * 40,
                "bundleId": "test.bundle",
                "appPath": "/artifact/T3Code.app",
                "zipPath": "/artifact/T3Code.app.zip",
                "sha256": "b" * 64,
                "deviceId": "device",
            }))
            with (
                patch.object(watcher, "valid_pointer", return_value=True),
                patch.object(watcher, "installed_build", return_value=42),
                patch.object(watcher, "run") as run,
            ):
                watcher.process_channel(ready, {})
                run.assert_not_called()

    def test_process_channel_installs_exact_current_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ready = root / "test.json"
            app = root / "T3Code.app"
            app.mkdir()
            pointer = {
                "schemaVersion": 1,
                "channel": "test",
                "build": 44,
                "sequence": 44,
                "commit": "c" * 40,
                "bundleId": "test.bundle",
                "appPath": str(app),
                "zipPath": str(root / "T3Code.app.zip"),
                "sha256": "d" * 64,
                "deviceId": "device",
            }
            ready.write_text(json.dumps(pointer))
            completed = subprocess.CompletedProcess([], 0, "", "")
            calls = []

            def capture(*arguments, **_):
                calls.append(arguments)
                return completed

            with (
                patch.object(watcher, "RECEIPTS", root / "receipts"),
                patch.object(watcher, "valid_pointer", return_value=True),
                patch.object(watcher, "installed_build", return_value=43),
                patch.object(watcher, "extract_verified_app", return_value=app),
                patch.object(watcher, "run", side_effect=capture),
            ):
                watcher.process_channel(ready, {})
            install = next(call for call in calls if "install" in call)
            self.assertIn(str(app), install)
            receipt_value = json.loads((root / "receipts" / "test.json").read_text())
            self.assertEqual(receipt_value["build"], 44)
            self.assertEqual(receipt_value["sequence"], 44)
            self.assertEqual(receipt_value["status"], "installed-and-launched")

    def test_notification_dedup_is_independent_per_channel(self):
        completed = subprocess.CompletedProcess([], 0, "", "")
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(watcher, "ROOT", Path(directory)),
                patch.object(watcher.subprocess, "run", return_value=completed) as send,
            ):
                watcher.notify({}, "dev", "unlock", "build-41")
                watcher.notify({}, "dev", "unlock", "build-41")
                watcher.notify({}, "test", "unlock", "build-41")
                self.assertEqual(send.call_count, 2)

    def test_notification_dedup_survives_alternating_failure_reasons(self):
        completed = subprocess.CompletedProcess([], 0, "", "")
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(watcher, "ROOT", Path(directory)),
                patch.object(watcher.subprocess, "run", return_value=completed) as send,
            ):
                watcher.notify({}, "test", "locked", "test:41")
                watcher.notify({}, "test", "unavailable", "test:41")
                watcher.notify({}, "test", "locked again", "test:41")
                self.assertEqual(send.call_count, 1)

    def test_notification_history_retains_newest_digest(self):
        completed = subprocess.CompletedProcess([], 0, "", "")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = {"deliveredByChannel": {"test": [f"old-{i}" for i in range(100)]}}
            (root / "notification-state.json").write_text(json.dumps(state))
            with (
                patch.object(watcher, "ROOT", root),
                patch.object(watcher.subprocess, "run", return_value=completed),
            ):
                watcher.notify({}, "test", "new", "new-build")
                value = json.loads((root / "notification-state.json").read_text())
                self.assertEqual(len(value["deliveredByChannel"]["test"]), 100)
                self.assertNotIn("old-0", value["deliveredByChannel"]["test"])


if __name__ == "__main__":
    unittest.main()
