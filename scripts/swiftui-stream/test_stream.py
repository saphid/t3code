#!/usr/bin/env python3

import importlib.util
import json
import os
import plistlib
import sqlite3
import subprocess
import tempfile
import unittest
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
            feature.setdefault("summary", "Explains the change under review.")
            feature.setdefault("whatToCheck", "Exercise the changed behavior.")
            feature.setdefault("successLooksLike", "The behavior works without regression.")
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

    def test_operational_swiftui_threads_are_not_features(self):
        self.assertFalse(stream.relevant_thread("Audit SwiftUI Commit Upstream Status", None))
        self.assertFalse(
            stream.relevant_thread(
                "SwiftUI Dev/Test Feature Approval Workflow",
                "t3code/swiftui-testing-approval",
            )
        )
        self.assertFalse(
            stream.relevant_thread("SwiftUI Feature Approval Workflow", None)
        )
        self.assertFalse(
            stream.relevant_thread(
                "Audit lane", "t3code/sync-electron-github-work"
            )
        )
        self.assertTrue(stream.relevant_thread("SwiftUI Command Palette", None))

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

    def test_visual_candidates_require_dark_paired_media(self):
        base_feature = {
            "id": "visual",
            "name": "Visual",
            "state": "proved",
            "summary": "Changes the interface.",
            "whatToCheck": "Exercise the interface.",
            "successLooksLike": "The interface works.",
            "visualChange": True,
            "interactionChange": True,
            "sourceBranch": "feat/visual",
            "startingBaseline": "a" * 40,
            "candidateCommit": "b" * 40,
        }
        value = {
            "schemaVersion": 1,
            "lifecycle": ["developing", "proved"],
            "currentTestBuild": {"build": 1},
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
        with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": "/missing/evidence-root"}):
            stream.validate_manifest(value)

        base_feature["visualEvidence"][0]["cleanURL"] = "http://evidence.example/clean.png"
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)
        base_feature["visualEvidence"][0]["cleanURL"] = "https://evidence.example/clean.png"

        base_feature["visualChange"] = False
        with self.assertRaises(SystemExit):
            stream.validate_manifest(value)

    def test_visual_receipt_binds_every_declared_url_and_hash(self):
        evidence = [{
            "kind": "image",
            "appearance": "dark",
            "cleanURL": "https://evidence.example/clean.png",
            "annotatedURL": "https://evidence.example/annotated.png",
        }]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({
                "featureId": "visual",
                "media": [{
                    **evidence[0],
                    "cleanSha256": "a" * 64,
                    "cleanBytes": 1,
                    "annotatedSha256": "b" * 64,
                    "annotatedBytes": 2,
                }],
            }))
            with patch.dict(os.environ, {"SWIFTUI_STREAM_EVIDENCE_DIR": directory}):
                stream.validate_proof_media_receipt("visual", evidence, str(receipt))
                evidence[0]["annotatedURL"] = "https://evidence.example/changed.png"
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt("visual", evidence, str(receipt))
                evidence[0]["annotatedURL"] = "https://evidence.example/annotated.png"
                receipt.unlink()
                with self.assertRaises(SystemExit):
                    stream.validate_proof_media_receipt("visual", evidence, str(receipt))

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

    def test_testing_manifest_carries_pending_features_into_later_builds(self):
        value = {
            "features": [
                {"id": "developing", "name": "Developing", "state": "developing"},
                {"id": "proved", "name": "Proved", "state": "proved"},
                {"id": "test-41", "name": "Test 41", "state": "needs-you", "testBuild": 41},
                {"id": "test-42", "name": "Test 42", "state": "in-test", "testBuild": 42},
                {"id": "shipped", "name": "Shipped", "state": "in-dev"},
            ]
        }

        self.assertEqual(
            [item["id"] for item in testing_manifest.selected_features(value, "dev", 9)],
            ["proved"],
        )
        self.assertEqual(
            [item["id"] for item in testing_manifest.selected_features(value, "test", 42)],
            ["test-41", "test-42"],
        )

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
