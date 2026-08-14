#!/usr/bin/env python3

import importlib.util
import hashlib
import io
import json
import os
import plistlib
import sqlite3
import subprocess
import sys
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


def git(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def write_stream(repository: Path, features: list[dict]) -> None:
    for feature in features:
        if feature.get("state") in {"proved", "in-test", "needs-you"}:
            feature.setdefault("problem", "The previous behavior does not meet the acceptance contract.")
            feature.setdefault("reproductionSteps", ["Open the affected flow.", "Exercise the behavior."])
            feature.setdefault("summary", "Explains the change under review.")
            feature.setdefault("whatToCheck", "Exercise the changed behavior.")
            feature.setdefault("successLooksLike", "The behavior works without regression.")
            feature.setdefault("validationSummary", "Focused automated checks pass.")
            feature.setdefault("knownLimitations", "None known.")
            feature.setdefault("reviewPriority", 1)
            feature.setdefault("reviewGroup", "Core reliability")
            feature.setdefault(
                "sourceIssue",
                "https://github.com/saphid/t3code-personal/issues/1",
            )
    path = repository / "scripts/swiftui-stream/stream.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"features": features}))


def commit_all(repository: Path, message: str) -> str:
    git(repository, "add", ".")
    git(repository, "commit", "-m", message)
    return git(repository, "rev-parse", "HEAD")


ROOT = Path(__file__).resolve().parent
stream = load_module("swiftui_stream", ROOT / "stream.py")
watcher = load_module("swiftui_phone_watch", ROOT / "phone-watch.py")
testing_manifest = load_module(
    "swiftui_testing_manifest", ROOT / "generate_testing_manifest.py"
)


class StreamTests(unittest.TestCase):
    def review_manifest_fixture(self) -> dict:
        commit = "b" * 40
        return {
            "schemaVersion": 1,
            "lifecycle": ["in-test", "needs-you"],
            "currentTestBuild": {
                "channel": "test",
                "build": 1,
                "sequence": 1,
                "commit": "c" * 40,
                "bundleId": "test.bundle",
                "deviceId": "phone",
                "receipt": "~/.t3/swiftui-stream/device-receipts/test.json",
                "status": "installed-and-launched",
                "launchPending": False,
            },
            "features": [{
                "id": "review-item",
                "name": "Review item",
                "state": "in-test",
                "problem": "The prior behavior fails.",
                "reproductionSteps": ["Open the flow.", "Exercise the behavior."],
                "summary": "Fixes the behavior.",
                "whatToCheck": "Exercise the flow.",
                "successLooksLike": "The flow succeeds.",
                "validationSummary": "Focused checks pass.",
                "knownLimitations": "None known.",
                "reviewPriority": 1,
                "reviewGroup": "Core reliability",
                "sourceIssue": "https://github.com/saphid/t3code-personal/issues/1",
                "sourceThread": "THREAD-1",
                "integratedCommit": commit,
                "integratedCommits": [commit],
                "testBuild": 1,
            }],
        }

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
        current["status"] = "installed-and-launched"
        current["launchPending"] = False
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

    def test_manifest_requires_a_receipt_field(self):
        value = stream.load_json(ROOT / "stream.json")
        del value["currentTestBuild"]["receipt"]
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

    def test_test_build_catalog_rejects_build60_with_build59_attribution(self):
        source_commit = "a" * 40
        head_commit = "b" * 40
        previous = {
            "schemaVersion": 1,
            "currentTestBuild": {
                "build": 59,
                "sequence": 59,
                "commit": "9" * 40,
            },
            "features": [
                {"id": "candidate-a", "state": "in-test", "testBuild": 59},
                {"id": "candidate-b", "state": "needs-you", "testBuild": 59},
            ],
        }
        current = json.loads(json.dumps(previous))

        errors = stream.test_build_catalog_errors(
            previous,
            current,
            requested_build=60,
            source_commit=source_commit,
            head_commit=head_commit,
            changed_paths=["scripts/swiftui-stream/stream.json"],
            commit_count=1,
        )

        self.assertTrue(any("currentTestBuild.build 59" in error for error in errors))
        self.assertTrue(any("candidate-a testBuild 59" in error for error in errors))
        self.assertTrue(any("candidate-b testBuild 59" in error for error in errors))

    def test_test_build_catalog_accepts_one_catalog_only_staging_commit(self):
        source_commit = "a" * 40
        head_commit = "b" * 40
        previous = {
            "schemaVersion": 1,
            "currentTestBuild": {
                "build": 59,
                "sequence": 59,
                "commit": "9" * 40,
                "bundleId": "test.bundle",
            },
            "features": [
                {"id": "candidate-a", "state": "in-test", "testBuild": 59},
                {"id": "candidate-b", "state": "needs-you", "testBuild": 59},
                {"id": "approved", "state": "approved", "testBuild": 58},
            ],
        }
        current = json.loads(json.dumps(previous))
        current["currentTestBuild"].update(
            {"build": 60, "sequence": 60, "commit": source_commit}
        )
        for feature in current["features"][:2]:
            feature["testBuild"] = 60

        self.assertEqual(
            stream.test_build_catalog_errors(
                previous,
                current,
                requested_build=60,
                source_commit=source_commit,
                head_commit=head_commit,
                changed_paths=["scripts/swiftui-stream/stream.json"],
                commit_count=1,
            ),
            [],
        )

    def test_test_build_catalog_rejects_non_catalog_staging_changes(self):
        source_commit = "a" * 40
        previous = {
            "schemaVersion": 1,
            "currentTestBuild": {"build": 59, "sequence": 59, "commit": "9" * 40},
            "features": [
                {"id": "candidate-a", "name": "Before", "state": "in-test", "testBuild": 59}
            ],
        }
        current = json.loads(json.dumps(previous))
        current["currentTestBuild"].update(
            {"build": 60, "sequence": 60, "commit": source_commit}
        )
        current["features"][0].update({"name": "After", "testBuild": 60})

        errors = stream.test_build_catalog_errors(
            previous,
            current,
            requested_build=60,
            source_commit=source_commit,
            head_commit="b" * 40,
            changed_paths=[
                "apps/swift-ios/App/T3CodeApp.swift",
                "scripts/swiftui-stream/stream.json",
            ],
            commit_count=1,
        )

        self.assertIn("catalog staging changed paths other than stream.json", errors)
        self.assertIn("catalog staging changed fields outside build attribution", errors)

    def test_reserved_test_build_can_be_claimed_once_before_ready_pointer_moves(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            state = home / ".t3/swiftui-stream"
            ready = state / "ready"
            ready.mkdir(parents=True)
            (state / "build-counters.json").write_text('{"test": 60}\n')
            (ready / "test.json").write_text('{"build": 59}\n')
            environment = dict(os.environ)
            environment["HOME"] = str(home)
            command = [
                sys.executable,
                str(ROOT / "next-build.py"),
                "test",
                "--requested",
                "60",
                "--accept-reserved",
            ]

            accepted = subprocess.run(
                command,
                env=environment,
                text=True,
                capture_output=True,
            )
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertEqual(accepted.stdout.strip(), "60")

            (ready / "test.json").write_text('{"build": 60}\n')
            already_ready = subprocess.run(
                command,
                env=environment,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(already_ready.returncode, 0)
            self.assertIn("not the current unbuilt reservation", already_ready.stderr)

    def test_build_ready_guards_catalog_before_xcodebuild(self):
        script = (ROOT / "build-ready.sh").read_text()
        guard = 'validate-test-build-catalog --build "$BUILD"'
        self.assertIn(guard, script)
        self.assertLess(script.index(guard), script.index("xcodebuild build"))
        self.assertIn('"T3_GIT_COMMIT=$SOURCE_COMMIT"', script)
        self.assertIn('--arg catalogCommit "$CATALOG_COMMIT"', script)

    def test_review_readiness_rejects_missing_full_details_and_proof(self):
        feature = {
            "id": "candidate-a",
            "name": "Candidate A",
            "state": "in-test",
            "sourceCommit": "abc1234",
            "testBuild": 59,
        }

        errors = stream.review_readiness_errors(
            feature,
            current_build=59,
            verify_files=False,
        )

        self.assertTrue(any("full 40-character" in error for error in errors))
        self.assertTrue(any("order" in error for error in errors))
        self.assertTrue(any("behavior" in error for error in errors))
        self.assertTrue(any("delivery" in error for error in errors))
        self.assertTrue(any("acceptancePoints" in error for error in errors))
        self.assertTrue(any("proof" in error for error in errors))

    def test_current_catalog_has_only_explicit_proof_readiness_gaps(self):
        value = stream.load_json(ROOT / "stream.json")
        pending = [
            feature
            for feature in value["features"]
            if feature.get("state") in stream.APPROVAL_STATES
        ]

        self.assertEqual(len(pending), 15)
        self.assertTrue(all(feature.get("proofPending") is True for feature in pending))
        for feature in pending:
            self.assertRegex(feature["sourceCommit"], r"^[0-9a-f]{40}$")
            self.assertIn(feature["integratedCommit"], feature["integratedCommits"])
            self.assertTrue(feature["acceptancePoints"])

        self.assertEqual(
            stream.catalog_review_readiness_errors(
                value,
                verify_files=False,
                verify_commits=False,
            ),
            [f"{feature['id']} proof must be an object" for feature in pending],
        )

    def test_catalog_review_readiness_reports_bad_order_without_crashing(self):
        value = {
            "currentTestBuild": {"build": 59},
            "features": [
                {
                    "id": "candidate-a",
                    "state": "in-test",
                    "sourceCommit": "a" * 40,
                    "testBuild": 59,
                    "order": [1],
                }
            ],
        }

        errors = stream.catalog_review_readiness_errors(
            value,
            verify_files=False,
            verify_commits=False,
        )

        self.assertTrue(any("order must be a positive integer" in error for error in errors))

    def test_catalog_review_readiness_resolves_valid_commits_despite_other_errors(self):
        value = {
            "currentTestBuild": {"build": 59},
            "features": [
                {
                    "id": "candidate-a",
                    "state": "in-test",
                    "sourceCommit": "a" * 40,
                    "testBuild": 59,
                }
            ],
        }
        result = subprocess.CompletedProcess([], 1, "", "missing")

        with patch.object(stream.subprocess, "run", return_value=result) as run:
            errors = stream.catalog_review_readiness_errors(
                value,
                verify_files=False,
                verify_commits=True,
            )

        run.assert_called_once()
        self.assertTrue(any("sourceCommit does not resolve" in error for error in errors))

    def test_review_readiness_accepts_commit_build_bound_proof_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = root / "clean.mp4"
            annotated = root / "annotated.mp4"
            clean.write_bytes(b"clean proof")
            annotated.write_bytes(b"annotated proof")
            source_commit = "a" * 40
            build_receipt = root / "build.json"
            build_receipt.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "pipeline": "swiftui-private-ci",
                        "stage": "candidate-simulator",
                        "runId": "candidate-a-simulator-1",
                        "status": "passed",
                        "exitStatus": 0,
                        "repository": {"commit": source_commit},
                    }
                )
            )
            packet_receipt = root / "drawer-receipt.json"
            packet_receipt.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "events": [
                            {"kind": "tap", "caption": "Drawer opens"}
                        ],
                        "artifacts": {
                            "clean_video": {
                                "path": str(clean),
                                "sha256": hashlib.sha256(
                                    clean.read_bytes()
                                ).hexdigest(),
                            },
                            "annotated_video": {
                                "path": str(annotated),
                                "sha256": hashlib.sha256(
                                    annotated.read_bytes()
                                ).hexdigest(),
                            },
                        },
                    }
                )
            )
            feature = {
                "id": "candidate-a",
                "name": "Candidate A",
                "state": "in-test",
                "sourceCommit": source_commit,
                "testBuild": 60,
                "order": 1,
                "behavior": "Open the drawer and keep the selected item visible.",
                "delivery": "direct",
                "dependsOn": [],
                "acceptancePoints": [
                    {"id": "drawer-visible", "text": "The full drawer is visible."}
                ],
                "proof": {
                    "schemaVersion": 1,
                    "sourceCommit": source_commit,
                    "buildId": "candidate-a-simulator-1",
                    "buildReceipt": {
                        "path": str(build_receipt),
                        "sha256": hashlib.sha256(
                            build_receipt.read_bytes()
                        ).hexdigest(),
                    },
                    "packets": [
                        {
                            "id": "drawer-flow",
                            "receiptPath": str(packet_receipt),
                            "receiptSha256": hashlib.sha256(
                                packet_receipt.read_bytes()
                            ).hexdigest(),
                            "acceptancePointIds": ["drawer-visible"],
                        },
                    ],
                },
            }

            self.assertEqual(
                stream.review_readiness_errors(
                    feature,
                    current_build=60,
                    verify_files=True,
                ),
                [],
            )

            feature["proof"]["buildId"] = "another-build"
            build_errors = stream.review_readiness_errors(
                feature,
                current_build=60,
                verify_files=True,
            )
            self.assertTrue(
                any("buildId does not match proof" in error for error in build_errors)
            )

            feature["proof"]["buildId"] = "candidate-a-simulator-1"
            build_value = json.loads(build_receipt.read_text())
            build_value["repository"]["commit"] = "b" * 40
            build_receipt.write_text(json.dumps(build_value))
            feature["proof"]["buildReceipt"]["sha256"] = hashlib.sha256(
                build_receipt.read_bytes()
            ).hexdigest()
            commit_errors = stream.review_readiness_errors(
                feature,
                current_build=60,
                verify_files=True,
            )
            self.assertTrue(
                any(
                    "sourceCommit does not match feature" in error
                    for error in commit_errors
                )
            )

    def test_review_readiness_rejects_wrong_hash_and_unpaired_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            clean = Path(directory) / "clean.png"
            clean.write_bytes(b"clean")
            source_commit = "a" * 40
            build_receipt = Path(directory) / "build.json"
            build_receipt.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "pipeline": "swiftui-private-ci",
                        "stage": "candidate-simulator",
                        "runId": "candidate-a-simulator-1",
                        "status": "passed",
                        "exitStatus": 0,
                        "repository": {"commit": source_commit},
                    }
                )
            )
            packet_receipt = Path(directory) / "packet.json"
            packet_receipt.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "event": {"kind": "tap", "caption": "Final state"},
                        "artifacts": {
                            "clean_image": {
                                "path": str(clean),
                                "sha256": "0" * 64,
                            }
                        },
                    }
                )
            )
            feature = {
                "id": "candidate-a",
                "name": "Candidate A",
                "state": "in-test",
                "sourceCommit": source_commit,
                "testBuild": 60,
                "order": 1,
                "behavior": "Show the final state.",
                "delivery": "local-only",
                "dependsOn": [],
                "acceptancePoints": [
                    {"id": "final-state", "text": "The final state is visible."}
                ],
                "proof": {
                    "schemaVersion": 1,
                    "sourceCommit": source_commit,
                    "buildId": "candidate-a-simulator-1",
                    "buildReceipt": {
                        "path": str(build_receipt),
                        "sha256": hashlib.sha256(
                            build_receipt.read_bytes()
                        ).hexdigest(),
                    },
                    "packets": [
                        {
                            "id": "only-clean",
                            "receiptPath": str(packet_receipt),
                            "receiptSha256": hashlib.sha256(
                                packet_receipt.read_bytes()
                            ).hexdigest(),
                            "acceptancePointIds": ["final-state"],
                        }
                    ],
                },
            }

            errors = stream.review_readiness_errors(
                feature,
                current_build=60,
                verify_files=True,
            )

            self.assertTrue(any("SHA-256 does not match" in error for error in errors))
            self.assertTrue(any("clean and annotated proof pair" in error for error in errors))

    def test_stage_test_build_checks_proof_before_allocating_a_number(self):
        incomplete = stream.manifest()
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "catalog.lock"
            with (
                patch.object(stream, "TEST_CATALOG_LOCK", lock),
                patch.object(
                    stream,
                    "git",
                    side_effect=["personal/swiftui-test", "", "a" * 40],
                ),
                patch.object(stream, "manifest", return_value=incomplete),
                patch.object(stream.subprocess, "run") as run,
                self.assertRaises(SystemExit),
            ):
                stream.command_stage_test_build(Namespace(build=None))
            self.assertFalse(
                any(
                    call.args
                    and call.args[0]
                    and "next-build.py" in str(call.args[0][0])
                    for call in run.call_args_list
                )
            )

    def test_approval_list_checks_proof_before_phone_receipt(self):
        incomplete = stream.manifest()
        with (
            patch.object(stream, "manifest", return_value=incomplete),
            patch.object(stream, "require_installed_test_receipt") as receipt_gate,
            self.assertRaises(SystemExit),
        ):
            stream.approval_list()
        receipt_gate.assert_not_called()

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
                patch.object(stream, "require_review_ready_catalog"),
                patch.object(stream, "DEVICE_RECEIPTS_ROOT", receipt_root),
                patch.object(stream, "TEST_READY_POINTER", ready_path),
            ):
                items = stream.approval_list()

        self.assertTrue(items)
        ordering = [
            (item.get("reviewPriority", 1_000_000), item.get("order", 1_000_000))
            for item in items
        ]
        self.assertEqual(ordering, sorted(ordering))
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
                patch.object(stream, "require_review_ready_catalog"),
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
            manifest_path = home / "stream.json"
            manifest_path.write_text(json.dumps({
                "schemaVersion": 1,
                "lifecycle": ["in-test", "needs-you"],
                "currentTestBuild": {
                    **current,
                    "receipt": str(receipts / "test.json"),
                    "status": "installed-and-launched",
                    "launchPending": False,
                },
                "features": [],
            }))
            environment = dict(os.environ)
            environment["SWIFTUI_STREAM_STATE_DIR"] = str(state)
            environment["SWIFTUI_STREAM_MANIFEST"] = str(manifest_path)
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

    def test_build_number_peek_does_not_consume_the_counter(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = dict(os.environ, HOME=directory)
            command = [str(ROOT / "next-build.py"), "dev"]
            peek = subprocess.run(
                [*command, "--peek"],
                check=True,
                text=True,
                capture_output=True,
                env=environment,
            )
            self.assertEqual(peek.stdout.strip(), "41")
            counter = Path(directory) / ".t3/swiftui-stream/build-counters.json"
            self.assertFalse(counter.exists())

            allocated = subprocess.run(
                command,
                check=True,
                text=True,
                capture_output=True,
                env=environment,
            )
            self.assertEqual(allocated.stdout.strip(), "41")
            self.assertEqual(json.loads(counter.read_text()), {"dev": 41})

            next_peek = subprocess.run(
                [*command, "--peek"],
                check=True,
                text=True,
                capture_output=True,
                env=environment,
            )
            self.assertEqual(next_peek.stdout.strip(), "42")
            self.assertEqual(json.loads(counter.read_text()), {"dev": 41})

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
                  thread_id TEXT PRIMARY KEY,
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
            ]
            connection.executemany(
                "INSERT INTO projection_threads VALUES (?, ?, ?, ?, ?, ?)", threads
            )
            now = datetime.now(timezone.utc).isoformat()
            connection.executemany(
                "INSERT INTO projection_thread_sessions VALUES (?, ?, ?, ?)",
                [
                    ("active", "running", "turn-active", "2000-01-01T00:00:00Z"),
                    ("tool-active", "running", "turn-tool", "2000-01-01T00:00:00Z"),
                    ("starting", "starting", None, now),
                    ("stale", "running", "turn-stale", "2000-01-01T00:00:00Z"),
                    ("archived", "running", "turn-archived", now),
                    ("deleted", "running", "turn-deleted", now),
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
            connection.commit()
            connection.close()

            with patch.object(stream.sqlite3, "connect", wraps=sqlite3.connect) as connect:
                records = {
                    item["sourceThread"]: item
                    for item in stream.thread_records([], db)
                }
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
            self.assertNotIn("deleted", records)

    def test_misleading_legacy_branches_are_explicitly_swiftui(self):
        for branch in stream.EXPLICIT_SWIFTUI_THREAD_BRANCHES:
            self.assertTrue(stream.relevant_thread("Legacy title", branch))
        self.assertFalse(stream.relevant_thread("Electron GitHub work", "t3code/other"))

    def test_manifest_and_catalog_are_unique(self):
        value = stream.manifest()
        records = stream.catalog(False)
        self.assertEqual(len(records), len({item["id"] for item in records}))
        self.assertGreaterEqual(value["currentTestBuild"]["build"], 40)

    def test_pending_feature_requires_positive_integer_test_build(self):
        value = self.review_manifest_fixture()
        pending = value["features"][0]
        pending["testBuild"] = "42"
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

    def test_reviewable_feature_requires_the_exact_current_test_build(self):
        value = self.review_manifest_fixture()
        feature = value["features"][0]
        feature["state"] = "needs-you"
        value["currentTestBuild"]["build"] = 2
        feature["testBuild"] = 1
        errors = io.StringIO()
        with redirect_stderr(errors), self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        self.assertIn("not current build", errors.getvalue())

    def test_needs_you_feature_requires_image_and_video_evidence(self):
        commit = "b" * 40
        feature = {
            "id": "review-item",
            "name": "Review item",
            "state": "needs-you",
            "problem": "The prior behavior fails.",
            "reproductionSteps": ["Open the flow.", "Exercise the behavior."],
            "summary": "Fixes the behavior.",
            "whatToCheck": "Exercise the flow.",
            "successLooksLike": "The flow succeeds.",
            "validationSummary": "Focused checks pass.",
            "knownLimitations": "None known.",
            "reviewPriority": 1,
            "reviewGroup": "Core reliability",
            "sourceIssue": "https://github.com/saphid/t3code-personal/issues/1",
            "sourceThread": "THREAD-1",
            "integratedCommit": commit,
            "integratedCommits": [commit],
            "proofCommit": commit,
            "testBuild": 1,
            "reviewMedia": True,
            "proofMediaReceipt": "/missing/evidence-root/receipt.json",
            "visualEvidence": [
                {
                    "kind": kind,
                    "title": kind.title(),
                    "caption": f"Shows the {kind} result.",
                    "appearance": "dark",
                    "cleanURL": f"https://evidence.example/clean.{kind}",
                    "annotatedURL": f"https://evidence.example/annotated.{kind}",
                }
                for kind in ("image", "video")
            ],
        }
        value = {
            "schemaVersion": 1,
            "lifecycle": ["in-test", "needs-you"],
            "currentTestBuild": {
                "channel": "test",
                "build": 1,
                "sequence": 1,
                "commit": "c" * 40,
                "bundleId": "test.bundle",
                "deviceId": "phone",
                "receipt": "~/.t3/swiftui-stream/device-receipts/test.json",
                "status": "installed-and-launched",
                "launchPending": False,
            },
            "features": [feature],
        }
        with patch.object(stream, "validate_proof_media_receipt"):
            stream.validate_manifest(value)

            for kind in ("image", "video"):
                with self.subTest(missing_kind=kind):
                    invalid = json.loads(json.dumps(value))
                    invalid["features"][0]["visualEvidence"] = [
                        item
                        for item in invalid["features"][0]["visualEvidence"]
                        if item["kind"] != kind
                    ]
                    errors = io.StringIO()
                    with redirect_stderr(errors), self.assertRaises(SystemExit):
                        stream.validate_manifest(invalid)
                    self.assertIn("image and video", errors.getvalue())

            for field in ("reviewMedia", "proofCommit"):
                with self.subTest(missing_field=field):
                    invalid = json.loads(json.dumps(value))
                    invalid["features"][0].pop(field)
                    errors = io.StringIO()
                    with redirect_stderr(errors), self.assertRaises(SystemExit):
                        stream.validate_manifest(invalid)
                    self.assertIn(field, errors.getvalue())

            invalid = json.loads(json.dumps(value))
            invalid["features"][0]["proofCommit"] = "d" * 40
            errors = io.StringIO()
            with redirect_stderr(errors), self.assertRaises(SystemExit):
                stream.validate_manifest(invalid)
            self.assertIn("proofCommit", errors.getvalue())

    def test_reviewable_feature_requires_an_https_source_issue(self):
        for source_issue in ("http://example.com/issues/1", "https://", "https:///issues/1"):
            with self.subTest(source_issue=source_issue):
                value = self.review_manifest_fixture()
                feature = value["features"][0]
                feature["sourceIssue"] = source_issue
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value)
                self.assertIn("sourceIssue must use HTTPS", errors.getvalue())

    def test_reviewable_feature_requires_a_complete_acceptance_packet(self):
        required = (
            "problem",
            "reproductionSteps",
            "summary",
            "whatToCheck",
            "successLooksLike",
            "validationSummary",
            "knownLimitations",
            "reviewPriority",
            "reviewGroup",
            "sourceIssue",
        )
        for field in required:
            with self.subTest(field=field):
                value = self.review_manifest_fixture()
                feature = value["features"][0]
                feature.pop(field)
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value)
                self.assertIn(field, errors.getvalue())

    def test_integrated_commit_chain_is_exact_and_includes_the_tip(self):
        invalid_values = (
            [],
            ["short"],
            ["a" * 40, "a" * 40],
            ["a" * 40],
        )
        for commits in invalid_values:
            with self.subTest(commits=commits):
                value = self.review_manifest_fixture()
                feature = value["features"][0]
                feature["integratedCommits"] = commits
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value)
                self.assertIn("integratedCommits", errors.getvalue())

    def test_integrated_commit_must_exist_in_the_build_and_change_product_files(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            base = repository / "README.md"
            base.write_text("base\n")
            commit_all(repository, "base")
            base_branch = git(repository, "branch", "--show-current")
            git(repository, "checkout", "-b", "test")
            product = repository / "Product.swift"
            product.write_text("let value = 1\n")
            product_commit = commit_all(repository, "product change")
            git(repository, "checkout", base_branch)
            dev = repository / "Dev.swift"
            dev.write_text("let dev = true\n")
            commit_all(repository, "dev change")

            value = self.review_manifest_fixture()
            value["branches"] = {"test": "test"}
            feature = value["features"][0]
            feature["integratedCommit"] = product_commit
            feature["integratedCommits"] = [product_commit]
            with patch.object(stream, "REPO_ROOT", repository):
                stream.validate_manifest(value, verify_repository=True)

                feature["integratedCommit"] = "d" * 40
                feature["integratedCommits"] = ["d" * 40]
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value, verify_repository=True)
                self.assertIn("does not exist", errors.getvalue())

                feature["integratedCommit"] = product_commit
                feature["integratedCommits"] = [product_commit]
                git(repository, "checkout", "test")
                metadata = repository / "scripts/swiftui-stream/stream.json"
                metadata.parent.mkdir(parents=True)
                metadata.write_text("{}\n")
                metadata_commit = commit_all(repository, "metadata only")
                feature["integratedCommit"] = metadata_commit
                feature["integratedCommits"] = [metadata_commit]
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value, verify_repository=True)
                self.assertIn("metadata-only", errors.getvalue())

                git(repository, "checkout", "-b", "candidate", "test")
                candidate = repository / "Candidate.swift"
                candidate.write_text("let candidate = true\n")
                candidate_commit = commit_all(repository, "candidate change")
                feature["integratedCommit"] = candidate_commit
                feature["integratedCommits"] = [candidate_commit]
                stream.validate_manifest(value, verify_repository=True)

                git(repository, "checkout", "-b", "unrelated", base_branch)
                unrelated = repository / "Unrelated.swift"
                unrelated.write_text("let unrelated = true\n")
                unrelated_commit = commit_all(repository, "unrelated change")
                git(repository, "checkout", base_branch)
                feature["integratedCommit"] = unrelated_commit
                feature["integratedCommits"] = [unrelated_commit]
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value, verify_repository=True)
                self.assertIn("not in canonical Test", errors.getvalue())

    def test_in_test_feature_may_stage_a_future_build(self):
        value = self.review_manifest_fixture()
        feature = value["features"][0]
        feature["state"] = "in-test"
        feature["testBuild"] = value["currentTestBuild"]["build"] + 1
        stream.validate_manifest(value)

    def test_in_test_feature_cannot_reference_a_stale_build(self):
        value = self.review_manifest_fixture()
        value["currentTestBuild"]["build"] = 2
        feature = value["features"][0]
        feature["state"] = "in-test"
        feature["testBuild"] = 1
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

    def test_visual_candidates_require_dark_paired_media(self):
        base_feature = {
            "id": "visual",
            "name": "Visual",
            "state": "proved",
            "problem": "The previous interface is incorrect.",
            "reproductionSteps": ["Open the interface.", "Use the changed control."],
            "summary": "Changes the interface.",
            "whatToCheck": "Exercise the interface.",
            "successLooksLike": "The interface works.",
            "validationSummary": "Focused visual tests pass.",
            "knownLimitations": "None known.",
            "reviewPriority": 1,
            "reviewGroup": "Visual behavior",
            "sourceIssue": "https://github.com/saphid/t3code-personal/issues/1",
            "visualChange": True,
            "interactionChange": True,
            "sourceBranch": "feat/visual",
            "startingBaseline": "a" * 40,
            "candidateCommit": "b" * 40,
        }
        value = {
            "schemaVersion": 1,
            "lifecycle": ["developing", "proved"],
            "currentTestBuild": {
                "channel": "test",
                "build": 1,
                "sequence": 1,
                "commit": "c" * 40,
                "bundleId": "test.bundle",
                "deviceId": "phone",
                "receipt": "~/.t3/swiftui-stream/device-receipts/test.json",
                "status": "installed-and-launched",
                "launchPending": False,
            },
            "features": [base_feature],
        }

        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

        base_feature["visualEvidence"] = [{
            "kind": "image",
            "title": "Result",
            "caption": "Shows the result.",
            "appearance": "light",
            "cleanURL": "https://evidence.example/clean.png",
            "annotatedURL": "https://evidence.example/annotated.png",
        }]
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

        base_feature["visualEvidence"][0]["appearance"] = "dark"
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

        caption = base_feature["visualEvidence"][0].pop("caption")
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        base_feature["visualEvidence"][0]["caption"] = caption

        base_feature["visualEvidence"].append({
            "kind": "video",
            "title": "Interaction",
            "caption": "Shows the interaction.",
            "appearance": "dark",
            "cleanURL": "https://evidence.example/clean.mp4",
            "annotatedURL": "https://evidence.example/annotated.mp4",
        })
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

        base_feature["proofMediaReceipt"] = "~/.t3/evidence/visual/receipt.json"
        with patch.object(stream, "validate_proof_media_receipt"):
            stream.validate_manifest(value)

        base_feature["visualEvidence"][0]["cleanURL"] = "http://evidence.example/clean.png"
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        base_feature["visualEvidence"][0]["cleanURL"] = "https://evidence.example/clean.png"

        base_feature["visualChange"] = False
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

    def test_visual_item_can_stage_proof_only_while_in_test(self):
        value = self.review_manifest_fixture()
        feature = value["features"][0]
        feature["visualChange"] = True
        feature["proofPending"] = True
        stream.validate_manifest(value)

        for field, stale_value in (
            ("reviewMedia", True),
            ("proofMediaReceipt", "~/.t3/evidence/stale.json"),
            ("proofCommit", "d" * 40),
        ):
            with self.subTest(stale_field=field):
                feature[field] = stale_value
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value)
                self.assertIn(f"stale {field}", errors.getvalue())
                feature.pop(field)

        feature.pop("visualChange")
        stream.validate_manifest(value)
        feature["visualChange"] = True

        feature["visualEvidence"] = []
        errors = io.StringIO()
        with redirect_stderr(errors), self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        self.assertIn("cannot carry stale visualEvidence", errors.getvalue())
        feature.pop("visualEvidence")

        feature["state"] = "needs-you"
        errors = io.StringIO()
        with redirect_stderr(errors), self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        self.assertIn("proofPending", errors.getvalue())

        feature["state"] = "in-test"
        feature.pop("proofPending")
        errors = io.StringIO()
        with redirect_stderr(errors), self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        self.assertIn("without visualEvidence", errors.getvalue())

    def test_visual_receipt_binds_every_declared_url_and_hash(self):
        evidence = [{
            "kind": "image",
            "appearance": "dark",
            "cleanURL": "https://evidence.example/clean.png",
            "annotatedURL": "https://evidence.example/annotated.png",
        }]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = root / "clean.png"
            annotated = root / "annotated.png"
            clean.write_bytes(b"clean")
            annotated.write_bytes(b"annotated")
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({
                "featureId": "visual",
                "candidateCommit": "c" * 40,
                "testBuild": 1,
                "media": [{
                    **evidence[0],
                    "cleanPath": str(clean),
                    "cleanSha256": hashlib.sha256(clean.read_bytes()).hexdigest(),
                    "cleanBytes": clean.stat().st_size,
                    "annotatedPath": str(annotated),
                    "annotatedSha256": hashlib.sha256(annotated.read_bytes()).hexdigest(),
                    "annotatedBytes": annotated.stat().st_size,
                }],
            }))
            with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": directory}):
                self.assertEqual(
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40
                    ),
                    [
                        (
                            hashlib.sha256(b"clean").hexdigest(),
                            hashlib.sha256(b"annotated").hexdigest(),
                        )
                    ],
                )
                receipt_value = json.loads(receipt.read_text())
                for invalid_build in (None, 0, True, "1"):
                    with self.subTest(invalid_test_build=invalid_build):
                        if invalid_build is None:
                            receipt_value.pop("testBuild", None)
                        else:
                            receipt_value["testBuild"] = invalid_build
                        receipt.write_text(json.dumps(receipt_value))
                        errors = io.StringIO()
                        with redirect_stderr(errors), self.assertRaises(SystemExit):
                            stream.validate_proof_media_receipt(
                                "visual", evidence, str(receipt), "c" * 40
                            )
                        self.assertIn("no valid testBuild", errors.getvalue())
                receipt_value["testBuild"] = 1
                receipt.write_text(json.dumps(receipt_value))
                annotated.write_bytes(b"clean")
                receipt_value["media"][0]["annotatedSha256"] = hashlib.sha256(
                    annotated.read_bytes()
                ).hexdigest()
                receipt_value["media"][0]["annotatedBytes"] = annotated.stat().st_size
                receipt.write_text(json.dumps(receipt_value))
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40
                    )
                annotated.write_bytes(b"annotated")
                receipt_value["media"][0]["annotatedSha256"] = hashlib.sha256(
                    annotated.read_bytes()
                ).hexdigest()
                receipt_value["media"][0]["annotatedBytes"] = annotated.stat().st_size
                receipt.write_text(json.dumps(receipt_value))
                clean.write_bytes(b"tampered")
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40
                    )
                clean.write_bytes(b"clean")
                receipt_value = json.loads(receipt.read_text())
                receipt_value["media"][0]["cleanSha256"] = "0" * 64
                receipt.write_text(json.dumps(receipt_value))
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40
                    )
                receipt_value["media"][0]["cleanSha256"] = hashlib.sha256(
                    clean.read_bytes()
                ).hexdigest()
                receipt.write_text(json.dumps(receipt_value))
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "d" * 40
                    )
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 2
                    )
                evidence[0]["annotatedURL"] = "https://evidence.example/changed.png"
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt("visual", evidence, str(receipt))

    def test_visual_receipt_rejects_symlink_and_outside_media_paths(self):
        evidence = [{
            "kind": "image",
            "appearance": "dark",
            "cleanURL": "https://evidence.example/clean.png",
            "annotatedURL": "https://evidence.example/annotated.png",
        }]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = root / "clean.png"
            annotated = root / "annotated.png"
            clean.write_bytes(b"clean")
            annotated.write_bytes(b"annotated")
            clean_link = root / "clean-link.png"
            clean_link.symlink_to(clean)
            outside = root.parent / f"{root.name}-outside.png"
            outside.write_bytes(b"outside")
            self.addCleanup(outside.unlink, missing_ok=True)
            receipt = root / "receipt.json"

            def write_receipt(clean_path: Path) -> None:
                receipt.write_text(json.dumps({
                    "featureId": "visual",
                    "candidateCommit": "c" * 40,
                    "testBuild": 1,
                    "media": [{
                        **evidence[0],
                        "cleanPath": str(clean_path),
                        "cleanSha256": hashlib.sha256(
                            clean_path.read_bytes()
                        ).hexdigest(),
                        "cleanBytes": clean_path.stat().st_size,
                        "annotatedPath": str(annotated),
                        "annotatedSha256": hashlib.sha256(
                            annotated.read_bytes()
                        ).hexdigest(),
                        "annotatedBytes": annotated.stat().st_size,
                    }],
                }))

            with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": directory}):
                write_receipt(clean_link)
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40
                    )
                write_receipt(outside)
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40
                    )
                evidence[0]["annotatedURL"] = "https://evidence.example/annotated.png"
                receipt.unlink()
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt("visual", evidence, str(receipt))

    def test_visual_receipt_rejects_identical_video_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = root / "clean.mp4"
            annotated = root / "annotated.mp4"
            clean.write_bytes(b"same-video")
            annotated.write_bytes(b"same-video")
            evidence = [{
                "kind": "video",
                "appearance": "dark",
                "cleanURL": "https://evidence.example/clean.mp4",
                "annotatedURL": "https://evidence.example/annotated.mp4",
            }]
            digest = hashlib.sha256(clean.read_bytes()).hexdigest()
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({
                "featureId": "visual",
                "candidateCommit": "c" * 40,
                "testBuild": 1,
                "media": [{
                    **evidence[0],
                    "cleanPath": str(clean),
                    "cleanSha256": digest,
                    "cleanBytes": clean.stat().st_size,
                    "annotatedPath": str(annotated),
                    "annotatedSha256": digest,
                    "annotatedBytes": annotated.stat().st_size,
                }],
            }))
            with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": directory}):
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 1
                    )
            self.assertIn("video uses identical", errors.getvalue())

    def test_video_receipt_requires_sealed_action_packet_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = root / "clean.mp4"
            annotated = root / "annotated.mp4"
            clean.write_bytes(b"clean-video")
            annotated.write_bytes(b"annotated-video")
            clean_digest = hashlib.sha256(clean.read_bytes()).hexdigest()
            annotated_digest = hashlib.sha256(annotated.read_bytes()).hexdigest()
            evidence = [{
                "kind": "video",
                "appearance": "dark",
                "cleanURL": "https://evidence.example/clean.mp4",
                "annotatedURL": "https://evidence.example/annotated.mp4",
            }]
            validation = {
                "version": 1,
                "kind": "proof-packet-validation",
                "verdict": "passed",
                "packet_receipt": {"path": "/packet.json", "sha256": "1" * 64},
                "timeline": {"path": "/timeline.json", "sha256": "2" * 64},
                "ledger": {"path": "/ledger.json", "sha256": "3" * 64},
                "artifacts": {
                    "clean_video": {"sha256": clean_digest},
                    "annotated_video": {"sha256": annotated_digest},
                },
                "actions": [{
                    "action_id": "event-1",
                    "kind": "tap",
                    "expect": "The view opens",
                    "caption_sha256": "4" * 64,
                }],
                "actionCount": 1,
                "overlayWindows": [
                    {
                        "kind": "action", "id": "event-1",
                        "start": 0.9, "end": 1.3, "sample": 1.1,
                        "crop": [10, 20, 64, 64],
                        "cleanFrameSha256": "5" * 64,
                        "annotatedFrameSha256": "6" * 64,
                        "localVideoSsim": 0.8,
                        "maximumLocalVideoSsim": 0.949,
                    },
                    {
                        "kind": "caption", "id": "event-1",
                        "start": 0.6, "end": 2.0, "sample": 1.3,
                        "crop": [0, 300, 300, 180],
                        "cleanFrameSha256": "7" * 64,
                        "annotatedFrameSha256": "8" * 64,
                        "localVideoSsim": 0.7,
                        "maximumLocalVideoSsim": 0.949,
                    },
                ],
                "pairing": {
                    "videoSsim": 0.95,
                    "minimumVideoSsim": 0.75,
                    "durationDelta": 0.0,
                },
            }
            validation["seal"] = {
                "algorithm": "sha256",
                "canonicalPayloadSha256": hashlib.sha256(
                    json.dumps(
                        validation, sort_keys=True, separators=(",", ":")
                    ).encode("utf-8")
                ).hexdigest(),
            }
            validation_path = root / "packet-validation.json"
            validation_path.write_text(json.dumps(validation))
            media = {
                **evidence[0],
                "cleanPath": str(clean),
                "cleanSha256": clean_digest,
                "cleanBytes": clean.stat().st_size,
                "annotatedPath": str(annotated),
                "annotatedSha256": annotated_digest,
                "annotatedBytes": annotated.stat().st_size,
                "packetValidationPath": str(validation_path),
                "packetValidationSha256": hashlib.sha256(
                    validation_path.read_bytes()
                ).hexdigest(),
            }
            receipt = root / "receipt.json"

            def write_receipt(item: dict) -> None:
                receipt.write_text(json.dumps({
                    "featureId": "visual",
                    "candidateCommit": "c" * 40,
                    "testBuild": 1,
                    "media": [item],
                }))

            write_receipt(media)
            with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": directory}):
                self.assertEqual(
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 1
                    ),
                    [(clean_digest, annotated_digest)],
                )
                missing = dict(media)
                missing.pop("packetValidationPath")
                write_receipt(missing)
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 1
                    )
                self.assertIn("no packetValidationPath", errors.getvalue())

                for field, invalid_value in (
                    ("videoSsim", float("nan")),
                    ("minimumVideoSsim", float("inf")),
                    ("durationDelta", float("-inf")),
                ):
                    with self.subTest(non_finite_pairing=field):
                        invalid_validation = json.loads(json.dumps(validation))
                        invalid_validation.pop("seal")
                        invalid_validation["pairing"][field] = invalid_value
                        invalid_validation["seal"] = {
                            "algorithm": "sha256",
                            "canonicalPayloadSha256": hashlib.sha256(
                                json.dumps(
                                    invalid_validation,
                                    sort_keys=True,
                                    separators=(",", ":"),
                                ).encode("utf-8")
                            ).hexdigest(),
                        }
                        validation_path.write_text(json.dumps(invalid_validation))
                        invalid = dict(media)
                        invalid["packetValidationSha256"] = hashlib.sha256(
                            validation_path.read_bytes()
                        ).hexdigest()
                        write_receipt(invalid)
                        with self.assertRaises(SystemExit):
                            stream.validate_proof_media_receipt(
                                "visual", evidence, str(receipt), "c" * 40, 1
                            )

                missing_overlay = json.loads(json.dumps(validation))
                missing_overlay.pop("seal")
                missing_overlay["overlayWindows"][0]["annotatedFrameSha256"] = (
                    missing_overlay["overlayWindows"][0]["cleanFrameSha256"]
                )
                missing_overlay["seal"] = {
                    "algorithm": "sha256",
                    "canonicalPayloadSha256": hashlib.sha256(
                        json.dumps(
                            missing_overlay, sort_keys=True, separators=(",", ":")
                        ).encode("utf-8")
                    ).hexdigest(),
                }
                validation_path.write_text(json.dumps(missing_overlay))
                invalid = dict(media)
                invalid["packetValidationSha256"] = hashlib.sha256(
                    validation_path.read_bytes()
                ).hexdigest()
                write_receipt(invalid)
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 1
                    )

                invalid_localized = json.loads(json.dumps(validation))
                invalid_localized.pop("seal")
                invalid_localized["overlayWindows"][0]["localVideoSsim"] = 0.99
                invalid_localized["seal"] = {
                    "algorithm": "sha256",
                    "canonicalPayloadSha256": hashlib.sha256(
                        json.dumps(
                            invalid_localized, sort_keys=True, separators=(",", ":")
                        ).encode("utf-8")
                    ).hexdigest(),
                }
                validation_path.write_text(json.dumps(invalid_localized))
                invalid = dict(media)
                invalid["packetValidationSha256"] = hashlib.sha256(
                    validation_path.read_bytes()
                ).hexdigest()
                write_receipt(invalid)
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 1
                    )

                validation["actionCount"] = 2
                validation_path.write_text(json.dumps(validation))
                invalid = dict(media)
                invalid["packetValidationSha256"] = hashlib.sha256(
                    validation_path.read_bytes()
                ).hexdigest()
                write_receipt(invalid)
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt(
                        "visual", evidence, str(receipt), "c" * 40, 1
                    )

    def test_manifest_rejects_image_and_video_reusing_the_same_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = root / "clean.bin"
            annotated = root / "annotated.bin"
            clean.write_bytes(b"clean-proof")
            annotated.write_bytes(b"annotated-proof")
            evidence = [
                {
                    "kind": kind,
                    "title": f"{kind} proof",
                    "caption": f"Shows the {kind} proof.",
                    "appearance": "dark",
                    "cleanURL": f"https://evidence.example/{kind}-clean",
                    "annotatedURL": f"https://evidence.example/{kind}-annotated",
                }
                for kind in ("image", "video")
            ]
            media = []
            for item in evidence:
                media_item = {
                    "kind": item["kind"],
                    "appearance": "dark",
                    "cleanURL": item["cleanURL"],
                    "annotatedURL": item["annotatedURL"],
                    "cleanPath": str(clean),
                    "cleanSha256": hashlib.sha256(clean.read_bytes()).hexdigest(),
                    "cleanBytes": clean.stat().st_size,
                    "annotatedPath": str(annotated),
                    "annotatedSha256": hashlib.sha256(
                        annotated.read_bytes()
                    ).hexdigest(),
                    "annotatedBytes": annotated.stat().st_size,
                }
                if item["kind"] == "video":
                    validation = {
                        "version": 1,
                        "kind": "proof-packet-validation",
                        "verdict": "passed",
                        "packet_receipt": {
                            "path": "/packet.json", "sha256": "1" * 64,
                        },
                        "timeline": {
                            "path": "/timeline.json", "sha256": "2" * 64,
                        },
                        "ledger": {
                            "path": "/ledger.json", "sha256": "3" * 64,
                        },
                        "artifacts": {
                            "clean_video": {"sha256": media_item["cleanSha256"]},
                            "annotated_video": {
                                "sha256": media_item["annotatedSha256"]
                            },
                        },
                        "actions": [{
                            "action_id": "event-1",
                            "kind": "tap",
                            "expect": "The view opens",
                            "caption_sha256": "4" * 64,
                        }],
                        "actionCount": 1,
                        "overlayWindows": [
                            {
                                "kind": "action", "id": "event-1",
                                "start": 0.9, "end": 1.3, "sample": 1.1,
                                "crop": [10, 20, 64, 64],
                                "cleanFrameSha256": "5" * 64,
                                "annotatedFrameSha256": "6" * 64,
                                "localVideoSsim": 0.8,
                                "maximumLocalVideoSsim": 0.949,
                            },
                            {
                                "kind": "caption", "id": "event-1",
                                "start": 0.6, "end": 2.0, "sample": 1.3,
                                "crop": [0, 300, 300, 180],
                                "cleanFrameSha256": "7" * 64,
                                "annotatedFrameSha256": "8" * 64,
                                "localVideoSsim": 0.7,
                                "maximumLocalVideoSsim": 0.949,
                            },
                        ],
                        "pairing": {
                            "videoSsim": 0.95,
                            "minimumVideoSsim": 0.75,
                            "durationDelta": 0.0,
                        },
                    }
                    validation["seal"] = {
                        "algorithm": "sha256",
                        "canonicalPayloadSha256": hashlib.sha256(
                            json.dumps(
                                validation, sort_keys=True, separators=(",", ":")
                            ).encode("utf-8")
                        ).hexdigest(),
                    }
                    validation_path = root / "packet-validation.json"
                    validation_path.write_text(json.dumps(validation))
                    media_item.update({
                        "packetValidationPath": str(validation_path),
                        "packetValidationSha256": hashlib.sha256(
                            validation_path.read_bytes()
                        ).hexdigest(),
                    })
                media.append(media_item)
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({
                "featureId": "review-item",
                "testBuild": 1,
                "media": media,
            }))
            value = self.review_manifest_fixture()
            feature = value["features"][0]
            feature.update({
                "visualChange": True,
                "interactionChange": True,
                "reviewMedia": True,
                "proofMediaReceipt": str(receipt),
                "visualEvidence": evidence,
            })
            with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": directory}):
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit):
                    stream.validate_manifest(value, verify_evidence=True)
            self.assertIn("reuses clean media proof", errors.getvalue())

    def test_manifest_rejects_reused_image_proof(self):
        value = self.review_manifest_fixture()
        feature = value["features"][0]
        feature.update({
            "visualChange": True,
            "proofMediaReceipt": "~/.t3/evidence/review-item.json",
            "visualEvidence": [{
                "kind": "image",
                "title": "Review item",
                "caption": "Shows the review item.",
                "appearance": "dark",
                "cleanURL": "https://evidence.example/review-item-clean.png",
                "annotatedURL": "https://evidence.example/review-item-annotated.png",
            }],
        })
        duplicate = json.loads(json.dumps(feature))
        duplicate["id"] = "duplicate-item"
        duplicate["name"] = "Duplicate item"
        duplicate["sourceIssue"] = "https://github.com/saphid/t3code-personal/issues/2"
        duplicate["proofMediaReceipt"] = "~/.t3/evidence/duplicate-item.json"
        duplicate["visualEvidence"][0]["cleanURL"] = "https://evidence.example/duplicate-clean.png"
        duplicate["visualEvidence"][0]["annotatedURL"] = "https://evidence.example/duplicate-annotated.png"
        value["features"].append(duplicate)
        with patch.object(
            stream,
            "validate_proof_media_receipt",
            side_effect=[
                {("a" * 64, "b" * 64)},
                {("b" * 64, "c" * 64)},
            ],
        ):
            errors = io.StringIO()
            with redirect_stderr(errors), self.assertRaises(SystemExit):
                stream.validate_manifest(value, verify_evidence=True)
        self.assertIn("reuses clean media proof", errors.getvalue())
        self.assertIn("(annotated)", errors.getvalue())

    def test_structural_manifest_load_does_not_require_local_evidence(self):
        value = stream.load_json(ROOT / "stream.json")
        with patch.object(
            stream,
            "validate_proof_media_receipt",
            side_effect=AssertionError("local evidence must not be read"),
        ) as receipt_check:
            stream.validate_manifest(value)
        receipt_check.assert_not_called()

        feature = value["features"][0]
        feature.pop("proofPending", None)
        feature["interactionChange"] = False
        feature["proofMediaReceipt"] = "/tmp/nonexistent-evidence-store/receipt.json"
        feature["visualEvidence"] = [{
            "kind": "image",
            "title": "Local proof",
            "caption": "Requires local evidence verification.",
            "appearance": "dark",
            "cleanURL": "https://evidence.example/clean.png",
            "annotatedURL": "https://evidence.example/annotated.png",
        }]
        with patch.object(
            stream,
            "validate_proof_media_receipt",
            side_effect=AssertionError("local evidence must not be read"),
        ) as receipt_check:
            stream.validate_manifest(value)
        receipt_check.assert_not_called()

        with patch.dict(
            os.environ,
            {"SWIFTUI_STREAM_EVIDENCE_DIR": "/tmp/nonexistent-evidence-store"},
        ):
            with self.assertRaises(SystemExit):
                stream.validate_manifest(value, verify_evidence=True)

    def test_runtime_path_overrides_are_read_dynamically(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "stream.json"
            manifest_path.write_text(json.dumps({
                "schemaVersion": 1,
                "lifecycle": ["in-test", "needs-you"],
                "currentTestBuild": {
                    "channel": "test",
                    "build": 1,
                    "sequence": 1,
                    "commit": "c" * 40,
                    "bundleId": "test.bundle",
                    "deviceId": "phone",
                    "receipt": str(root / "state/device-receipts/test.json"),
                    "status": "installed-and-launched",
                    "launchPending": False,
                },
                "features": [],
            }))
            state_root = root / "state"
            with patch.dict(os.environ, {
                "SWIFTUI_STREAM_MANIFEST": str(manifest_path),
                "SWIFTUI_STREAM_STATE_DIR": str(state_root),
            }):
                self.assertEqual(stream.manifest()["features"], [])
                self.assertEqual(
                    stream.configured_device_receipts_root(),
                    state_root / "device-receipts",
                )
                self.assertEqual(
                    stream.configured_ready_pointer(),
                    state_root / "ready/test.json",
                )

    def test_visual_pr_body_requires_every_evidence_link(self):
        feature = {
            "id": "visual",
            "visualChange": True,
            "visualEvidence": [{
                "kind": "image",
                "cleanURL": "https://evidence.example/clean.png",
                "annotatedURL": "https://evidence.example/annotated.png",
            }],
        }
        body = """\
Delivery: direct
Validated against Theo commit: aaaaaaa
Depends on: none
Merge order: this PR only
Validation status: focused tests pass
Dark mode evidence: yes
Clean screenshot: https://evidence.example/clean.png
Annotated screenshot: https://evidence.example/annotated.png
"""

        def validate(candidate_body):
            with tempfile.NamedTemporaryFile(mode="w", suffix=".md") as file:
                file.write(candidate_body)
                file.flush()
                args = type("Args", (), {
                    "body": file.name,
                    "number": None,
                    "feature_id": "visual",
                })()
                with (
                    patch.object(stream, "manifest", return_value={
                        "features": [feature],
                        "branches": {"theo": "theo"},
                    }),
                    patch.object(stream, "git", side_effect=["a" * 40, "a" * 40]),
                ):
                    stream.command_validate_pr(args)

        validate(body)
        with self.assertRaises(SystemExit):
            validate(body.replace("Dark mode evidence: yes", "Dark mode evidence: no"))
        with self.assertRaises(SystemExit):
            validate(body.replace("Annotated screenshot:", "Evidence:"))
        with self.assertRaises(SystemExit):
            validate(body.replace("https://evidence.example/annotated.png", ""))

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
                patch.object(stream, "require_review_ready_catalog"),
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

    def test_testing_manifest_carries_pending_features_into_later_builds(self):
        value = {
            "features": [
                {"id": "developing", "name": "Developing", "state": "developing"},
                {"id": "proved", "name": "Proved", "state": "proved"},
                {
                    "id": "test-41",
                    "name": "Test 41",
                    "state": "needs-you",
                    "testBuild": 41,
                    "reviewPriority": 2,
                },
                {
                    "id": "test-42",
                    "name": "Test 42",
                    "state": "in-test",
                    "testBuild": 42,
                    "reviewPriority": 1,
                },
                {"id": "shipped", "name": "Shipped", "state": "in-dev"},
            ]
        }

        self.assertEqual(
            [item["id"] for item in testing_manifest.selected_features(value, "dev", 9)],
            ["proved"],
        )
        self.assertEqual(
            [item["id"] for item in testing_manifest.selected_features(value, "test", 42)],
            ["test-42", "test-41"],
        )

    def test_testing_manifest_requires_complete_review_guidance(self):
        complete = {
            "id": "complete",
            "problem": "The prior behavior fails.",
            "reproductionSteps": ["Open the flow.", "Trigger the action."],
            "summary": "Fixes the behavior.",
            "whatToCheck": "Exercise the flow.",
            "successLooksLike": "The flow succeeds.",
            "validationSummary": "Focused tests pass.",
            "knownLimitations": "None known.",
            "reviewPriority": 1,
            "reviewGroup": "Core reliability",
            "sourceIssue": "https://github.com/saphid/t3code-personal/issues/1",
        }
        guidance = testing_manifest.review_guidance(complete)
        self.assertEqual(guidance["reproductionSteps"], complete["reproductionSteps"])
        self.assertEqual(guidance["reviewPriority"], 1)

        invalid_values = {
            "reviewPriority": (True, 0),
            "reproductionSteps": ([], [" "], "text"),
            "sourceIssue": (
                None,
                "http://example.com/issues/1",
                "https://",
                "https:///issues/1",
            ),
        }
        for field, values in invalid_values.items():
            for invalid in values:
                with self.subTest(field=field, invalid=invalid):
                    feature = dict(complete)
                    feature[field] = invalid
                    with self.assertRaisesRegex(RuntimeError, field):
                        testing_manifest.review_guidance(feature)

    def test_testing_manifest_deduplicates_threads_and_commits(self):
        feature = {
            "sourceCommit": "abc",
            "candidateCommit": "abc",
            "commits": ["def", "abc"],
            "sourceThread": "THREAD-1",
            "sourceThreadTitle": "Source",
            "relatedThreads": ["thread-1", {"id": "THREAD-2", "title": "Related"}],
        }

        self.assertEqual(
            testing_manifest.feature_commit_values(feature, "dev"),
            [("def", "candidate"), ("abc", "candidate")],
        )
        self.assertEqual(
            testing_manifest.feature_thread_values(feature),
            [
                {"id": "THREAD-1", "title": "Source"},
                {"id": "THREAD-2", "title": "Related"},
            ],
        )

    def test_public_repository_url_removes_credentials(self):
        self.assertEqual(
            testing_manifest.public_repository_url(
                "https://token@github.com/saphid/t3code-personal.git"
            ),
            "https://github.com/saphid/t3code-personal",
        )
        self.assertEqual(
            testing_manifest.public_repository_url("git@github.com:saphid/t3code.git"),
            "https://github.com/saphid/t3code",
        )

    def test_dev_manifest_requires_one_frozen_candidate_and_metadata_only_tail(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-dev")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            baseline = commit_all(repository, "baseline")
            git(repository, "update-ref", "refs/remotes/origin/personal/swiftui-dev", baseline)
            git(repository, "switch", "-c", "feat/one")
            (repository / "Feature.swift").write_text("let feature = true\n")
            candidate = commit_all(repository, "feature")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", candidate)

            feature = {
                "id": "one",
                "name": "One",
                "state": "proved",
                "sourceBranch": "feat/one",
                "startingBaseline": baseline,
                "candidateCommit": candidate,
                "sourceCommit": candidate[:8],
                "sourceThread": "THREAD-1",
            }
            write_stream(repository, [feature])
            frozen = commit_all(repository, "freeze metadata")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", frozen)
            manifest = testing_manifest.build_manifest(repository, "dev", 2)
            self.assertEqual([entry["id"] for entry in manifest["entries"]], ["one"])
            self.assertEqual(manifest["entries"][0]["commits"][0]["role"], "candidate")
            self.assertEqual(len(manifest["entries"][0]["commits"]), 1)

            (repository / "Feature.swift").write_text("let feature = false\n")
            corrected = commit_all(repository, "correct feature")
            feature["candidateCommit"] = corrected
            feature["commits"] = [candidate, corrected]
            write_stream(repository, [feature])
            refrozen = commit_all(repository, "refreeze metadata")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", refrozen)
            corrected_manifest = testing_manifest.build_manifest(repository, "dev", 3)
            self.assertEqual(
                [commit["sha"] for commit in corrected_manifest["entries"][0]["commits"]],
                [candidate, corrected],
            )

            (repository / "Unexpected.swift").write_text("let unexpected = true\n")
            unexpected = commit_all(repository, "unexpected executable tail")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", unexpected)
            with self.assertRaisesRegex(RuntimeError, "non-metadata commits after candidateCommit"):
                testing_manifest.build_manifest(repository, "dev", 3)

            (repository / "Unexpected.swift").unlink()
            commit_all(repository, "cancel executable tail")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", "HEAD")
            with self.assertRaisesRegex(RuntimeError, "non-metadata commits after candidateCommit"):
                testing_manifest.build_manifest(repository, "dev", 3)

    def test_dev_manifest_requires_candidate_on_remote_source_branch(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-dev")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            baseline = commit_all(repository, "baseline")
            git(repository, "update-ref", "refs/remotes/origin/personal/swiftui-dev", baseline)
            git(repository, "switch", "-c", "feat/one")
            (repository / "Feature.swift").write_text("let feature = true\n")
            candidate = commit_all(repository, "feature")
            write_stream(repository, [{
                "id": "one",
                "name": "One",
                "state": "proved",
                "sourceBranch": "feat/one",
                "startingBaseline": baseline,
                "candidateCommit": candidate,
                "commits": [candidate],
                "sourceThread": "THREAD-1",
            }])
            commit_all(repository, "freeze metadata")

            with self.assertRaisesRegex(RuntimeError, "not published at origin/feat/one"):
                testing_manifest.build_manifest(repository, "dev", 2)
            git(repository, "update-ref", "refs/remotes/origin/feat/one", "HEAD")
            manifest = testing_manifest.build_manifest(repository, "dev", 2)
            self.assertEqual(manifest["entries"][0]["commits"][0]["sha"], candidate)

    def test_dev_manifest_rejects_zero_two_missing_and_nonancestor_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-dev")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            baseline = commit_all(repository, "baseline")
            git(repository, "update-ref", "refs/remotes/origin/personal/swiftui-dev", baseline)
            git(repository, "switch", "-c", "feat/one")

            with self.assertRaisesRegex(RuntimeError, "exactly one proved feature"):
                testing_manifest.build_manifest(repository, "dev", 2)

            missing = {
                "id": "one",
                "name": "One",
                "state": "proved",
                "sourceBranch": "feat/one",
                "startingBaseline": baseline,
                "sourceThread": "THREAD-1",
            }
            write_stream(repository, [missing])
            commit_all(repository, "missing candidate")
            with self.assertRaisesRegex(RuntimeError, "no frozen candidateCommit"):
                testing_manifest.build_manifest(repository, "dev", 2)

            second = dict(missing, id="two", name="Two")
            write_stream(repository, [missing, second])
            commit_all(repository, "two candidates")
            with self.assertRaisesRegex(RuntimeError, "exactly one proved feature"):
                testing_manifest.build_manifest(repository, "dev", 2)

            git(repository, "switch", "-c", "unrelated", baseline)
            (repository / "Other.swift").write_text("let other = true\n")
            unrelated = commit_all(repository, "unrelated")
            git(repository, "switch", "feat/one")
            missing["candidateCommit"] = unrelated
            write_stream(repository, [missing])
            commit_all(repository, "nonancestor candidate")
            with self.assertRaisesRegex(RuntimeError, "not an ancestor"):
                testing_manifest.build_manifest(repository, "dev", 2)

    def test_dev_manifest_rejects_undeclared_commit_before_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-dev")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            baseline = commit_all(repository, "baseline")
            git(repository, "update-ref", "refs/remotes/origin/personal/swiftui-dev", baseline)
            git(repository, "switch", "-c", "feat/one")
            (repository / "Unrelated.swift").write_text("let unrelated = true\n")
            commit_all(repository, "undeclared predecessor")
            (repository / "Feature.swift").write_text("let feature = true\n")
            candidate = commit_all(repository, "feature")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", candidate)
            write_stream(repository, [{
                "id": "one",
                "name": "One",
                "state": "proved",
                "sourceBranch": "feat/one",
                "startingBaseline": baseline,
                "candidateCommit": candidate,
                "sourceThread": "THREAD-1",
            }])
            frozen = commit_all(repository, "freeze metadata")
            git(repository, "update-ref", "refs/remotes/origin/feat/one", frozen)

            with self.assertRaisesRegex(RuntimeError, "range does not match"):
                testing_manifest.build_manifest(repository, "dev", 2)

    def test_test_manifest_rejects_integrated_commit_absent_from_head(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-test")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            baseline = commit_all(repository, "baseline")
            git(repository, "switch", "-c", "unrelated")
            (repository / "Other.swift").write_text("let other = true\n")
            unrelated = commit_all(repository, "unrelated")
            git(repository, "switch", "personal/swiftui-test")
            write_stream(repository, [{
                "id": "one",
                "name": "One",
                "state": "needs-you",
                "testBuild": 1,
                "integratedCommit": unrelated,
                "sourceThread": "THREAD-1",
            }])
            commit_all(repository, "test metadata")

            with self.assertRaisesRegex(RuntimeError, "integrated commit is not in this build"):
                testing_manifest.build_manifest(repository, "test", 2)

    def test_test_manifest_keeps_unresolvable_source_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-test")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            integrated = commit_all(repository, "integrated feature")
            write_stream(repository, [{
                "id": "one",
                "name": "One",
                "state": "needs-you",
                "testBuild": 1,
                "integratedCommit": integrated,
                "sourceCommit": "deadbee",
                "sourceThread": "THREAD-1",
            }])
            commit_all(repository, "test metadata")

            manifest = testing_manifest.build_manifest(repository, "test", 2)
            source = next(
                commit for commit in manifest["entries"][0]["commits"]
                if commit["role"] == "source"
            )
            self.assertEqual(source["sha"], "deadbee")
            self.assertEqual(source["title"], "Source attribution")

    def test_test_manifest_rejects_missing_test_build(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-test")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [{
                "id": "one",
                "name": "One",
                "state": "needs-you",
            }])
            commit_all(repository, "invalid Test metadata")

            with self.assertRaisesRegex(RuntimeError, "invalid testBuild"):
                testing_manifest.build_manifest(repository, "test", 2)

    def test_test_manifest_rejects_partial_future_build(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "personal/swiftui-test")
            git(repository, "config", "user.email", "test@example.com")
            git(repository, "config", "user.name", "Test")
            git(repository, "remote", "add", "origin", "https://github.com/test/repo.git")
            write_stream(repository, [])
            integrated = commit_all(repository, "baseline")
            write_stream(repository, [
                {
                    "id": "current",
                    "name": "Current",
                    "state": "needs-you",
                    "testBuild": 1,
                    "integratedCommit": integrated,
                    "sourceThread": "THREAD-1",
                },
                {
                    "id": "future",
                    "name": "Future",
                    "state": "in-test",
                    "testBuild": 3,
                    "integratedCommit": integrated,
                    "sourceThread": "THREAD-2",
                },
            ])
            commit_all(repository, "mixed Test metadata")

            with self.assertRaisesRegex(RuntimeError, "future build: future"):
                testing_manifest.build_manifest(repository, "test", 2)

    def test_ancestor_check_surfaces_git_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            git(repository, "init", "-b", "main")
            with self.assertRaisesRegex(RuntimeError, "Not a valid object name"):
                testing_manifest.is_ancestor(repository, "missing", "HEAD")


class WatcherTests(unittest.TestCase):
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
