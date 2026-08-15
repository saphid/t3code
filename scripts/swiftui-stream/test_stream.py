#!/usr/bin/env python3

import importlib.util
import io
import json
import os
import plistlib
import sqlite3
import subprocess
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
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
    def test_ready_build_uses_stream_owned_package_clones(self):
        publisher = (ROOT / "build-ready.sh").read_text()

        self.assertIn("T3_SWIFT_SOURCE_PACKAGES_PATH", publisher)
        self.assertIn('-clonedSourcePackagesDirPath "$SOURCE_PACKAGES"', publisher)
        self.assertIn("-disablePackageRepositoryCache", publisher)

    def receipt_fixture(
        self,
        directory: str,
        current=None,
    ) -> tuple[dict, Path, Path, Path]:
        root = Path(directory)
        receipt_root = root / "device-receipts"
        receipt_root.mkdir()
        ready_root = root / "ready"
        ready_root.mkdir()
        current = dict(current or stream.manifest()["currentTestBuild"])
        receipt_path = receipt_root / "test.json"
        current["receipt"] = str(receipt_path)
        identity = {
            field: current[field]
            for field in (
                "channel",
                "build",
                "sequence",
                "commit",
                "bundleId",
                "deviceId",
            )
        }
        receipt_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    **identity,
                    "status": "installed-and-launched",
                    "launchPending": False,
                    "recordedAt": "2000-01-01T00:00:00Z",
                }
            )
        )
        ready_path = ready_root / "test.json"
        ready_path.write_text(json.dumps({"schemaVersion": 1, **identity}))
        return current, receipt_root, receipt_path, ready_path

    def test_projection_threads_are_developing_only_during_active_turns(self):
        now = datetime(2026, 8, 13, tzinfo=timezone.utc)
        fresh = now.isoformat()
        stale = (now - timedelta(hours=1)).isoformat()
        self.assertEqual(
            stream.projection_thread_state(None, "starting", None, fresh, now),
            ("developing", None),
        )
        self.assertEqual(
            stream.projection_thread_state(None, "running", "turn-1", fresh, now),
            ("developing", None),
        )
        for status, active_turn_id in (
            (None, None),
            ("idle", None),
            ("ready", None),
            ("running", None),
            ("stopped", "turn-1"),
        ):
            self.assertEqual(
                stream.projection_thread_state(None, status, active_turn_id, fresh, now),
                ("blocked", "inactive-development-thread"),
            )
        self.assertEqual(
            stream.projection_thread_state(None, "running", "turn-1", stale, now),
            ("blocked", "inactive-development-thread"),
        )
        self.assertEqual(
            stream.projection_thread_state(
                "2026-08-13T00:00:00Z", "running", "turn-1", fresh, now
            ),
            ("blocked", "migration-triage-required"),
        )

    def test_thread_records_use_authoritative_session_liveness(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "state.sqlite"
            connection = sqlite3.connect(db)
            connection.executescript(
                """
                CREATE TABLE projection_threads (
                  thread_id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  branch TEXT,
                  created_at TEXT NOT NULL,
                  archived_at TEXT,
                  deleted_at TEXT
                );
                CREATE TABLE projection_thread_sessions (
                  session_id TEXT PRIMARY KEY,
                  thread_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  active_turn_id TEXT,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE projection_thread_messages (
                  message_id TEXT PRIMARY KEY,
                  thread_id TEXT NOT NULL,
                  turn_id TEXT,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE projection_thread_activities (
                  activity_id TEXT PRIMARY KEY,
                  thread_id TEXT NOT NULL,
                  turn_id TEXT,
                  created_at TEXT NOT NULL
                );
                """
            )
            threads = [
                ("active", "SwiftUI active", None, "1", None, None),
                ("tool-active", "SwiftUI tool active", None, "1a", None, None),
                ("starting", "SwiftUI starting", None, "2", None, None),
                ("stale", "SwiftUI stale", None, "3", None, None),
                ("archived", "SwiftUI archived", None, "4", "now", None),
                ("deleted", "SwiftUI deleted", None, "5", None, "now"),
                ("no-session", "SwiftUI no session", None, "6", None, None),
                ("dedup", "SwiftUI dedup", None, "7", None, None),
                ("bad-time", "SwiftUI bad timestamp", None, "8", None, None),
            ]
            connection.executemany(
                "INSERT INTO projection_threads VALUES (?, ?, ?, ?, ?, ?)", threads
            )
            now = datetime.now(timezone.utc).isoformat()
            connection.executemany(
                "INSERT INTO projection_thread_sessions VALUES (?, ?, ?, ?, ?)",
                [
                    ("session-active", "active", "running", "turn-active", "2000-01-01T00:00:00Z"),
                    (
                        "session-tool",
                        "tool-active",
                        "running",
                        "turn-tool",
                        "2000-01-01T00:00:00Z",
                    ),
                    ("session-starting", "starting", "starting", None, now),
                    ("session-stale", "stale", "running", "turn-stale", "2000-01-01T00:00:00Z"),
                    ("session-archived", "archived", "running", "turn-archived", now),
                    ("session-deleted", "deleted", "running", "turn-deleted", now),
                    ("session-dedup-old", "dedup", "stopped", None, "2000-01-01T00:00:00Z"),
                    ("session-dedup-new", "dedup", "running", "turn-dedup", now),
                    ("session-bad-time", "bad-time", "running", "turn-bad", "not-a-timestamp"),
                ],
            )
            connection.execute(
                "INSERT INTO projection_thread_messages VALUES (?, ?, ?, ?)",
                ("message-active", "active", "turn-active", now),
            )
            connection.execute(
                "INSERT INTO projection_thread_activities VALUES (?, ?, ?, ?)",
                ("activity-tool", "tool-active", "turn-tool", now),
            )
            connection.execute(
                "INSERT INTO projection_thread_messages VALUES (?, ?, ?, ?)",
                ("message-dedup", "dedup", "turn-dedup", now),
            )
            connection.commit()
            connection.close()

            errors = io.StringIO()
            with (
                patch.object(stream.sqlite3, "connect", wraps=sqlite3.connect) as connect,
                redirect_stderr(errors),
            ):
                record_list = stream.thread_records([], db)
            records = {item["sourceThread"]: item for item in record_list}
            connect.assert_called_once_with(f"file:{db}?mode=ro", uri=True)
            self.assertEqual(records["active"]["state"], "developing")
            self.assertEqual(records["tool-active"]["state"], "developing")
            self.assertEqual(records["starting"]["state"], "developing")
            self.assertEqual(records["stale"]["state"], "blocked")
            self.assertEqual(
                records["stale"]["blockedReason"], "inactive-development-thread"
            )
            self.assertEqual(records["archived"]["state"], "blocked")
            self.assertEqual(
                records["archived"]["blockedReason"], "migration-triage-required"
            )
            self.assertEqual(records["no-session"]["state"], "blocked")
            self.assertEqual(records["dedup"]["state"], "developing")
            self.assertEqual(
                [item["sourceThread"] for item in record_list].count("dedup"), 1
            )
            self.assertEqual(records["bad-time"]["state"], "blocked")
            self.assertIn("bad-time", errors.getvalue())
            self.assertIn("timestamp", errors.getvalue())
            self.assertNotIn("deleted", records)

    def test_thread_record_schema_drift_is_a_reported_anomaly(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "state.sqlite"
            connection = sqlite3.connect(db)
            connection.execute("CREATE TABLE projection_threads (thread_id TEXT)")
            connection.close()
            errors = io.StringIO()
            with redirect_stderr(errors):
                self.assertEqual(stream.thread_records([], db), [])
        self.assertIn("projection schema", errors.getvalue())

    def test_misleading_legacy_branches_are_explicitly_swiftui(self):
        for branch in stream.EXPLICIT_SWIFTUI_THREAD_BRANCHES:
            self.assertTrue(stream.relevant_thread("Legacy title", branch))
        self.assertFalse(stream.relevant_thread("Electron GitHub work", "t3code/other"))

    def test_branch_allowlists_beat_generic_title_words(self):
        self.assertTrue(stream.relevant_thread("Audit SwiftUI Log View", None))
        self.assertFalse(
            stream.relevant_thread(
                "SwiftUI Dev/Test Feature Approval Workflow",
                "t3code/swiftui-testing-approval",
            )
        )
        self.assertTrue(
            stream.relevant_thread("SwiftUI Feature Approval Workflow", None)
        )
        self.assertTrue(
            stream.relevant_thread(
                "Audit lane", "t3code/sync-electron-github-work"
            )
        )
        self.assertTrue(stream.relevant_thread("SwiftUI Command Palette", None))

    def test_manifest_and_catalog_are_unique(self):
        value = stream.manifest()
        projection = {
            "id": "thread-catalog-uniqueness",
            "name": "SwiftUI catalog uniqueness",
            "state": "developing",
        }
        with patch.object(stream, "thread_records", return_value=[projection]) as threads:
            records = stream.catalog(True)
        threads.assert_called_once()
        self.assertEqual(len(records), len({item["id"] for item in records}))
        self.assertEqual(
            value["currentTestBuild"],
            {
                "channel": "test",
                "build": 55,
                "sequence": 55,
                "commit": "2af2d3c31228405bf1e0cbde6e3433263a9d801d",
                "bundleId": "com.alxs.t3code.typed-swiftui.dev",
                "deviceId": "2571CB7A-1DDF-5BFA-8C99-D7D17B6B5A5A",
                "receipt": "~/.t3/swiftui-stream/device-receipts/test.json",
                "status": "installed-and-launched",
                "launchPending": False,
            },
        )

    def test_manifest_requires_a_receipt_field(self):
        value = stream.load_json(ROOT / "stream.json")
        del value["currentTestBuild"]["receipt"]
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

    def test_approval_list_is_exact_build_order(self):
        with tempfile.TemporaryDirectory() as directory:
            value = stream.manifest()
            current = dict(value["currentTestBuild"])
            for feature in value["features"]:
                if feature.get("state") in stream.APPROVAL_STATES:
                    feature["testBuild"] = current["build"]
            current, receipt_root, _, ready_path = self.receipt_fixture(
                directory, current
            )
            value["currentTestBuild"] = current
            with (
                patch.object(stream, "manifest", return_value=value),
                patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                patch.object(stream, "TEST_READY_POINTER", ready_path),
            ):
                items = stream.approval_list()

        self.assertTrue(items)
        self.assertEqual(
            [item.get("order", 1_000_000) for item in items],
            sorted(item.get("order", 1_000_000) for item in items),
        )
        self.assertTrue(all(item["testBuild"] == current["build"] for item in items))
        self.assertNotIn("dev-title-label", {item["id"] for item in items})

    def test_approval_list_fails_closed_when_device_receipt_does_not_match(self):
        with tempfile.TemporaryDirectory() as directory:
            current, receipt_root, receipt_path, ready_path = self.receipt_fixture(
                directory
            )
            receipt = json.loads(receipt_path.read_text())
            receipt["build"] += 1
            receipt_path.write_text(json.dumps(receipt))
            with (
                patch.object(stream, "manifest", return_value={"currentTestBuild": current}),
                patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                patch.object(stream, "TEST_READY_POINTER", ready_path),
                patch.object(stream, "catalog", return_value=[]),
                self.assertRaises(SystemExit),
            ):
                stream.approval_list()

    def test_receipt_must_match_the_ready_pointer_device(self):
        with tempfile.TemporaryDirectory() as directory:
            current, receipt_root, _, ready_path = self.receipt_fixture(directory)
            pointer = json.loads(ready_path.read_text())
            pointer["deviceId"] = "another-device"
            ready_path.write_text(json.dumps(pointer))
            with (
                patch.object(stream, "manifest", return_value={"currentTestBuild": current}),
                patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                patch.object(stream, "TEST_READY_POINTER", ready_path),
                self.assertRaises(SystemExit),
            ):
                stream.require_installed_test_receipt()

    def test_receipt_path_rejects_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current, receipt_root, receipt_path, ready_path = self.receipt_fixture(
                directory
            )
            valid_receipt = receipt_path.read_text()
            outside = root / "outside.json"
            outside.write_text(valid_receipt)
            for name, path in (
                ("traversal", receipt_root / ".." / "outside.json"),
                ("outside", outside),
            ):
                with self.subTest(name=name):
                    current["receipt"] = str(path)
                    with (
                        patch.object(
                            stream,
                            "manifest",
                            return_value={"currentTestBuild": current},
                        ),
                        patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                        patch.object(stream, "TEST_READY_POINTER", ready_path),
                        self.assertRaises(SystemExit),
                    ):
                        stream.require_installed_test_receipt()
            receipt_path.unlink()
            receipt_path.symlink_to(outside)
            current["receipt"] = str(receipt_path)
            with (
                patch.object(stream, "manifest", return_value={"currentTestBuild": current}),
                patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                patch.object(stream, "TEST_READY_POINTER", ready_path),
                self.assertRaises(SystemExit),
            ):
                stream.require_installed_test_receipt()

    def test_promotion_queue_cannot_bypass_the_receipt_gate(self):
        with (
            patch.object(
                stream,
                "require_installed_test_receipt",
                side_effect=SystemExit(1),
            ) as receipt_gate,
            patch.object(stream, "queue_items") as queue_items,
            self.assertRaises(SystemExit),
        ):
            stream.command_queue(Namespace(path="queue.json", json=True))
        receipt_gate.assert_called_once_with()
        queue_items.assert_not_called()

    def test_receipt_gate_cli_accepts_an_exact_bound_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            state = home / ".t3/swiftui-stream"
            receipts = state / "device-receipts"
            ready = state / "ready"
            receipts.mkdir(parents=True)
            ready.mkdir()
            current = stream.manifest()["currentTestBuild"]
            identity = {
                field: current[field]
                for field in (
                    "channel",
                    "build",
                    "sequence",
                    "commit",
                    "bundleId",
                    "deviceId",
                )
            }
            (ready / "test.json").write_text(
                json.dumps({"schemaVersion": 1, **identity})
            )
            (receipts / "test.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        **identity,
                        "status": "installed-and-launched",
                        "launchPending": False,
                    }
                )
            )
            environment = dict(os.environ)
            environment["HOME"] = str(home)
            result = subprocess.run(
                [
                    "python3",
                    str(ROOT / "stream.py"),
                    "require-installed-test-receipt",
                ],
                cwd=stream.REPO_ROOT,
                env=environment,
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                **identity,
                "status": "installed-and-launched",
                "launchPending": False,
            },
        )

    def test_device_receipt_requires_successful_launch(self):
        current = {
            "channel": "test",
            "build": 41,
            "sequence": 41,
            "commit": "f" * 40,
            "bundleId": "test.bundle",
            "deviceId": "phone",
            "status": "installed-and-launched",
            "launchPending": False,
        }
        receipt = {
            "schemaVersion": 1,
            **current,
            "status": "installed-awaiting-unlock",
            "launchPending": True,
        }
        errors = stream.installed_test_receipt_errors(current, receipt)
        self.assertTrue(any("status" in error for error in errors))
        self.assertTrue(any("pending launch" in error for error in errors))

    def test_device_receipt_requires_all_identity_fields(self):
        current = {
            "channel": "test",
            "build": 41,
            "sequence": 41,
            "commit": "f" * 40,
            "bundleId": "test.bundle",
            "deviceId": "phone",
            "status": "installed-and-launched",
            "launchPending": False,
        }
        receipt = {
            "schemaVersion": 1,
            **current,
            "status": "installed-and-launched",
            "launchPending": False,
        }
        del current["commit"]
        del receipt["sequence"]
        errors = stream.installed_test_receipt_errors(current, receipt)
        self.assertIn("catalog field commit is missing", errors)
        self.assertIn("device receipt field sequence is missing", errors)

    def test_device_receipt_binds_every_ready_pointer_identity_field(self):
        current = {
            "channel": "test",
            "build": 55,
            "sequence": 55,
            "commit": "f" * 40,
            "bundleId": "test.bundle",
            "deviceId": "phone",
            "status": "installed-and-launched",
            "launchPending": False,
        }
        ready = {"schemaVersion": 1, **current}
        del ready["status"]
        del ready["launchPending"]
        for field in (
            "channel",
            "build",
            "sequence",
            "commit",
            "bundleId",
            "deviceId",
        ):
            with self.subTest(field=field):
                receipt = {
                    "schemaVersion": 1,
                    **current,
                    field: "wrong" if isinstance(current[field], str) else 56,
                }
                errors = stream.installed_test_receipt_errors(
                    current, receipt, ready
                )
                self.assertTrue(
                    any(
                        f"device receipt {field}" in error
                        and "ready pointer" in error
                        for error in errors
                    )
                )

    def test_validate_checks_uniqueness_with_projection_records(self):
        value = {"prDelivery": "delivery.json", "lifecycle": ["developing"]}
        duplicate = {"id": "duplicate", "state": "developing"}
        with (
            patch.object(stream, "manifest", return_value=value),
            patch.object(stream, "load_json", return_value={}),
            patch.object(stream, "validate_delivery_inventory"),
            patch.object(
                stream,
                "catalog",
                return_value=[duplicate, dict(duplicate)],
            ) as catalog,
            self.assertRaises(SystemExit),
        ):
            stream.command_validate(Namespace())
        catalog.assert_called_once_with(True)

    def test_fuzzy_match_prefers_command_palette(self):
        with tempfile.TemporaryDirectory() as directory:
            value = stream.manifest()
            current = dict(value["currentTestBuild"])
            for feature in value["features"]:
                if feature.get("state") in stream.APPROVAL_STATES:
                    feature["testBuild"] = current["build"]
            current, receipt_root, _, ready_path = self.receipt_fixture(
                directory, current
            )
            value["currentTestBuild"] = current
            with (
                patch.object(stream, "manifest", return_value=value),
                patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                patch.object(stream, "TEST_READY_POINTER", ready_path),
            ):
                ranked = sorted(
                    (
                        (stream.score("palette", item), item["id"])
                        for item in stream.approval_list()
                    ),
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
                watcher.process_channel(ready, {"deviceId": "resolved-device"})
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
                watcher.process_channel(ready, {"deviceId": "resolved-device"})
            install = next(call for call in calls if "install" in call)
            self.assertIn(str(app), install)
            receipt_value = json.loads((root / "receipts" / "test.json").read_text())
            self.assertEqual(receipt_value["build"], 44)
            self.assertEqual(receipt_value["sequence"], 44)
            self.assertEqual(receipt_value["deviceId"], "resolved-device")
            self.assertEqual(receipt_value["status"], "installed-and-launched")

    def test_process_channel_refreshes_a_receipt_without_the_resolved_device(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ready = root / "test.json"
            pointer = {
                "schemaVersion": 1,
                "channel": "test",
                "build": 55,
                "sequence": 55,
                "commit": "c" * 40,
                "bundleId": "test.bundle",
                "appPath": str(root / "T3Code.app"),
                "zipPath": str(root / "T3Code.app.zip"),
                "sha256": "d" * 64,
                "deviceId": "pointer-device",
            }
            ready.write_text(json.dumps(pointer))
            receipts = root / "receipts"
            receipts.mkdir()
            previous = watcher.receipt(
                pointer,
                "resolved-device",
                "installed-and-launched",
                False,
            )
            del previous["deviceId"]
            (receipts / "test.json").write_text(json.dumps(previous))
            completed = subprocess.CompletedProcess([], 0, "", "")
            with (
                patch.object(watcher, "RECEIPTS", receipts),
                patch.object(watcher, "valid_pointer", return_value=True),
                patch.object(watcher, "installed_build", return_value=55),
                patch.object(watcher, "run", return_value=completed) as run,
            ):
                watcher.process_channel(ready, {"deviceId": "resolved-device"})
            self.assertTrue(any("launch" in call.args for call in run.call_args_list))
            refreshed = json.loads((receipts / "test.json").read_text())
            self.assertEqual(refreshed["deviceId"], "resolved-device")

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
