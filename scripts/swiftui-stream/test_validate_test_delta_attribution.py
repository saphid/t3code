#!/usr/bin/env python3

import copy
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parent
validator = load_module(
    "test_delta_attribution", ROOT / "validate_test_delta_attribution.py"
)


class TestDeltaAttributionTests(unittest.TestCase):
    def setUp(self):
        self.value = json.loads((ROOT / "test-build-attribution-55.json").read_text())
        self.receipt = copy.deepcopy(self.value["deviceGate"]["observedReceipt"])

    def test_frozen_delta_and_catalog_match_git(self):
        self.assertEqual(validator.validate(self.value, receipt=self.receipt), [])

    def test_base_attribution_pins_the_repaired_pr_71_artifact(self):
        self.assertEqual(
            validator.BASE_ATTRIBUTION_COMMIT,
            "b8f9c6616d82880768bcc8b92583a54f1319efc4",
        )
        self.assertEqual(
            validator.BASE_ATTRIBUTION_SHA256,
            "c026b6bd8204a329e1147b6536bfa24b3c12be79455b097e4d03145bdebdccfc",
        )
        self.assertEqual(
            self.value["baseAttribution"]["sha256"],
            validator.BASE_ATTRIBUTION_SHA256,
        )
        self.assertEqual(
            self.value["baseAttribution"]["sourceCommit"],
            validator.BASE_ATTRIBUTION_COMMIT,
        )

    def test_base_attribution_preserves_incomplete_anomaly_and_merge_evidence(self):
        base = self.value["baseAttribution"]
        self.assertEqual(base["attributionStatus"], "incomplete")
        self.assertEqual(base["acknowledgedAnomalyCount"], 30)
        self.assertEqual(base["integrationEvidenceCount"], 9)
        self.assertEqual(validator.validate(self.value, receipt=self.receipt), [])

    def test_classification_rule_excludes_merges_from_candidates(self):
        self.assertEqual(self.value["classificationRule"], validator.CLASSIFICATION_RULE)
        self.assertEqual(
            self.value["classificationRule"]["integration"],
            "The delta commit has exactly two parents.",
        )
        self.value["classificationRule"]["candidate"] = (
            "The exact delta commit is cited by a checked-in build-55 source record."
        )
        self.assertIn(
            "classificationRule does not match the required rule",
            validator.validate(self.value, receipt=self.receipt),
        )

    def test_cli_reports_valid_but_incomplete_cumulative_attribution(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as receipt_file:
            json.dump(self.receipt, receipt_file)
            receipt_file.flush()
            result = subprocess.run(
                [
                    "python3",
                    str(ROOT / "validate_test_delta_attribution.py"),
                    "--receipt",
                    receipt_file.name,
                ],
                cwd=ROOT.parent.parent,
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "acknowledgedAnomalyCount": 30,
                "attributionStatus": "incomplete",
                "catalogRecordCount": 88,
                "deltaCommitCount": 4,
                "deviceGate": "ready",
                "message": (
                    "Attribution is incomplete. The base record has 30 acknowledged anomalies."
                ),
                "validationStatus": "valid",
            },
        )

    def test_attribution_message_uses_the_actual_status_and_count(self):
        self.assertEqual(
            validator.attribution_message("complete", 0),
            "Attribution is complete. The base record has no acknowledged anomalies.",
        )
        self.assertEqual(
            validator.attribution_message("incomplete", 1),
            "Attribution is incomplete. The base record has 1 acknowledged anomaly.",
        )
        self.assertEqual(
            validator.attribution_message("incomplete", 30),
            "Attribution is incomplete. The base record has 30 acknowledged anomalies.",
        )

    def test_ready_device_gate_matches_the_live_receipt(self):
        gate = self.value["deviceGate"]
        self.assertEqual(gate["status"], "ready")
        self.assertTrue(gate["approvalEligible"])
        self.assertEqual(
            validator.validate(self.value, receipt=self.receipt), []
        )

    def test_ready_device_gate_rejects_a_divergent_live_receipt(self):
        self.receipt["sequence"] = 999
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "live device receipt differs from the ready receipt snapshot", errors
        )

    def test_blocked_device_gate_rejects_a_divergent_live_receipt(self):
        gate = self.value["deviceGate"]
        gate["status"] = "blocked"
        gate["approvalEligible"] = False
        gate["observedReceipt"]["status"] = "install-failed"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "live device receipt differs from the blocked receipt snapshot", errors
        )

    def test_build_55_identity_cannot_collude_with_the_receipt(self):
        mutations = {
            "channel": ("dev", "installedTestBuild.channel must be test"),
            "bundleId": (
                "com.not-the-test-app",
                "installedTestBuild.bundleId must identify the Test app",
            ),
            "build": (
                999,
                "installedTestBuild.build must be one more than verified build 54",
            ),
            "sequence": (
                999,
                "installedTestBuild.sequence must be one more than verified build 54",
            ),
            "schemaVersion": (
                2,
                "installedTestBuild.schemaVersion must be 1",
            ),
        }
        for field, (wrong_value, expected) in mutations.items():
            with self.subTest(field=field):
                value = copy.deepcopy(self.value)
                receipt = copy.deepcopy(self.receipt)
                value["installedTestBuild"][field] = wrong_value
                value["deviceGate"]["observedReceipt"][field] = wrong_value
                receipt[field] = wrong_value
                errors = validator.validate(value, receipt=receipt)
                self.assertIn(expected, errors)

    def test_malformed_containers_return_errors(self):
        cases = {
            "root": ([], "attribution must be an object"),
            "base": ({**self.value, "baseAttribution": None}, "baseAttribution must be an object"),
            "installed": (
                {**self.value, "installedTestBuild": []},
                "installedTestBuild must be an object",
            ),
            "catalog": ({**self.value, "catalog": None}, "catalog must be an object"),
            "commits": ({**self.value, "commits": {}}, "commits must be a list"),
            "commit item": (
                {**self.value, "commits": [None]},
                "commit record 0 must be an object",
            ),
            "gate": ({**self.value, "deviceGate": []}, "deviceGate must be an object"),
            "source snapshots": (
                {**self.value, "sourceSnapshots": []},
                "sourceSnapshots must be an object",
            ),
        }
        for name, (value, expected) in cases.items():
            with self.subTest(name=name):
                self.assertIn(expected, validator.validate(value, receipt=self.receipt))

        value = copy.deepcopy(self.value)
        value["deviceGate"]["observedReceipt"] = None
        self.assertIn(
            "deviceGate.observedReceipt must be an object",
            validator.validate(value, receipt=self.receipt),
        )
        self.assertIn(
            "live device receipt must be an object",
            validator.validate(self.value, receipt=[]),
        )

        value = copy.deepcopy(self.value)
        value["baseAttribution"]["installedTestBuild"] = None
        self.assertIn(
            "base attribution installedTestBuild must be an object",
            validator.validate(value, receipt=self.receipt),
        )
        value = copy.deepcopy(self.value)
        value["catalog"]["states"] = []
        self.assertIn(
            "catalog.states must be an object",
            validator.validate(value, receipt=self.receipt),
        )
        value = copy.deepcopy(self.value)
        value["sourceSnapshots"]["legacyManifest"] = None
        self.assertIn(
            "source snapshot legacyManifest must be an object",
            validator.validate(value, receipt=self.receipt),
        )
        value = copy.deepcopy(self.value)
        value["commits"][0]["sourceRecords"] = {}
        self.assertTrue(
            any(
                "sourceRecords must be a list" in error
                for error in validator.validate(value, receipt=self.receipt)
            )
        )
        value = copy.deepcopy(self.value)
        value["commits"][0]["sourceRecords"] = [None]
        self.assertTrue(
            any(
                "source record reference must be an object" in error
                for error in validator.validate(value, receipt=self.receipt)
            )
        )
        value = copy.deepcopy(self.value)
        value["commits"][1]["sourceRecords"][0]["field"] = []
        self.assertTrue(
            any(
                "source record reference is malformed" in error
                for error in validator.validate(value, receipt=self.receipt)
            )
        )

    def test_cli_reports_malformed_input_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            attribution_path = Path(directory) / "attribution.json"
            receipt_path = Path(directory) / "receipt.json"
            attribution_path.write_text('{"baseAttribution": null}')
            receipt_path.write_text("[]")
            result = subprocess.run(
                [
                    "python3",
                    str(ROOT / "validate_test_delta_attribution.py"),
                    "--attribution",
                    str(attribution_path),
                    "--receipt",
                    str(receipt_path),
                ],
                cwd=ROOT.parent.parent,
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("Traceback", result.stderr)
        self.assertIn("baseAttribution must be an object", result.stderr)

    def test_missing_delta_commit_fails(self):
        self.value["commits"] = self.value["commits"][1:]
        errors = validator.validate(self.value)
        self.assertIn(
            "commit records do not exactly match the build-54-to-build-55 delta",
            errors,
        )

    def test_build_54_must_be_an_ancestor_of_build_55(self):
        self.value["installedTestBuild"]["commit"] = (
            "125ed781e20716091222651092ed2708448bb6b6"
        )
        self.value["deviceGate"]["observedReceipt"]["commit"] = (
            "125ed781e20716091222651092ed2708448bb6b6"
        )
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "build 55 must be a strict descendant of build 54",
            errors,
        )

    def test_build_55_delta_must_not_be_empty(self):
        base_commit = self.value["baseAttribution"]["installedTestBuild"]["commit"]
        self.value["installedTestBuild"]["commit"] = base_commit
        self.value["deviceGate"]["observedReceipt"]["commit"] = base_commit
        self.receipt["commit"] = base_commit
        self.value["commits"] = []
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "build 55 must be a strict descendant of build 54", errors
        )
        self.assertIn(
            "build 54-to-build 55 delta must contain at least one commit", errors
        )

    def test_candidate_requires_exact_source_record(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        candidate["sourceRecords"] = []
        errors = validator.validate(self.value)
        self.assertTrue(any("candidate has no exact source record" in error for error in errors))

    def test_source_proven_candidate_cannot_use_another_category(self):
        for category in ("anomaly", "integration", "metadata", "revert"):
            with self.subTest(category=category):
                value = copy.deepcopy(self.value)
                candidate = next(
                    item
                    for item in value["commits"]
                    if item["category"] == "candidate"
                )
                candidate["category"] = category
                candidate["anomaly"] = "downgraded despite exact source evidence"
                errors = validator.validate(value, receipt=self.receipt)
                self.assertTrue(
                    any(
                        "source-cited commit must be classified as candidate" in error
                        for error in errors
                    )
                )

    def test_merge_commit_must_use_the_integration_category(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        commit = candidate["commit"]
        second_parent = self.value["baseAttribution"]["devCommit"]
        candidate["parents"].append(second_parent)
        candidate["patchId"] = None
        real_run_git = validator.run_git

        def merge_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + description[1] + " " + second_parent + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=merge_description):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("merge commit must be classified as integration" in error for error in errors)
        )

    def test_source_cited_merge_commit_uses_the_integration_category(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        commit = candidate["commit"]
        second_parent = self.value["baseAttribution"]["devCommit"]
        candidate["category"] = "integration"
        candidate["parents"].append(second_parent)
        candidate["patchId"] = None
        real_run_git = validator.run_git

        def merge_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + description[1] + " " + second_parent + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=merge_description):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertFalse(
            any(
                "source-cited commit must be classified as candidate" in error
                for error in errors
            )
        )

    def test_every_integration_requires_deterministic_merge_evidence(self):
        metadata = next(
            item for item in self.value["commits"] if item["category"] == "metadata"
        )
        commit = metadata["commit"]
        second_parent = self.value["baseAttribution"]["devCommit"]
        metadata["category"] = "integration"
        metadata["parents"].append(second_parent)
        metadata["patchId"] = None
        real_run_git = validator.run_git

        def merge_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + description[1] + " " + second_parent + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=merge_description):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("merge evidence does not match Git" in error for error in errors))

    def test_source_cited_integration_requires_an_exact_source_record(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        commit = candidate["commit"]
        second_parent = self.value["baseAttribution"]["devCommit"]
        candidate["category"] = "integration"
        candidate["parents"].append(second_parent)
        candidate["patchId"] = None
        candidate["sourceRecords"] = []
        real_run_git = validator.run_git

        def merge_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + description[1] + " " + second_parent + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=merge_description):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any(
                "source-cited integration has no exact source record" in error
                for error in errors
            )
        )

    def test_complete_integration_record_round_trips_through_validate(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        commit = candidate["commit"]
        parents = [candidate["parents"][0], self.value["baseAttribution"]["devCommit"]]
        candidate["category"] = "integration"
        candidate["parents"] = parents
        candidate["patchId"] = None
        candidate["changedPaths"] = validator.changed_paths(
            ROOT.parent.parent, commit, parents
        )
        candidate["mergeEvidence"] = validator.merge_evidence(
            ROOT.parent.parent, commit, parents
        )
        real_run_git = validator.run_git

        def merge_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + " ".join(parents) + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=merge_description):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertEqual(errors, [])

    def test_recorded_merge_only_content_requires_a_frozen_acknowledgment(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        commit = candidate["commit"]
        parents = [candidate["parents"][0], self.value["baseAttribution"]["devCommit"]]
        candidate["category"] = "integration"
        candidate["parents"] = parents
        candidate["patchId"] = None
        candidate["sourceRecords"] = []
        candidate["changedPaths"] = validator.changed_paths(
            ROOT.parent.parent, commit, parents
        )
        candidate["mergeEvidence"] = validator.merge_evidence(
            ROOT.parent.parent, commit, parents
        )
        merge_only = validator.merge_only_paths(ROOT.parent.parent, commit, parents)
        self.assertEqual(candidate["mergeEvidence"]["resolution"], "recorded")
        self.assertTrue(merge_only)
        real_run_git = validator.run_git

        def merge_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + " ".join(parents) + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=merge_description), mock.patch.object(
            validator, "candidate_source_commits", return_value=set()
        ):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any(
                "recorded merge-only paths need exact source evidence or a frozen acknowledgment"
                in error
                for error in errors
            )
        )

        candidate["mergeOnlyContent"] = {
            "acknowledgedPaths": merge_only,
            "justification": "This record acknowledges the exact merge-only paths.",
        }
        with mock.patch.object(validator, "run_git", side_effect=merge_description), mock.patch.object(
            validator, "candidate_source_commits", return_value=set()
        ):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertEqual(errors, [])

    def test_octopus_integration_has_one_clear_failure(self):
        metadata = next(
            item for item in self.value["commits"] if item["category"] == "metadata"
        )
        commit = metadata["commit"]
        parents = [
            metadata["parents"][0],
            self.value["baseAttribution"]["devCommit"],
            self.value["baseAttribution"]["installedTestBuild"]["commit"],
        ]
        metadata["category"] = "integration"
        metadata["parents"] = parents
        metadata["patchId"] = None
        metadata["changedPaths"] = validator.changed_paths(
            ROOT.parent.parent, commit, parents
        )
        real_run_git = validator.run_git

        def octopus_description(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return description[0] + "\n" + " ".join(parents) + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=octopus_description):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertEqual(
            errors,
            [f"{commit}: integration commits must have exactly two parents"],
        )

    def test_non_merge_commit_cannot_use_the_integration_category(self):
        metadata = next(
            item for item in self.value["commits"] if item["category"] == "metadata"
        )
        metadata["category"] = "integration"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any(
                "integration commits must have exactly two parents" in error
                for error in errors
            )
        )

    def test_clean_merge_has_automatic_tree_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)

            def git(*arguments):
                return subprocess.run(
                    ["git", *arguments],
                    cwd=repository,
                    text=True,
                    capture_output=True,
                    check=True,
                ).stdout.strip()

            git("init", "--quiet", "--initial-branch=main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            (repository / "base.txt").write_text("base\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "base")
            git("checkout", "--quiet", "-b", "feature")
            (repository / "feature.txt").write_text("feature\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "feature")
            git("checkout", "--quiet", "main")
            (repository / "main.txt").write_text("main\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "main")
            git("merge", "--quiet", "--no-ff", "--no-edit", "feature")
            description = git("show", "-s", "--format=%H%n%P", "HEAD").splitlines()
            evidence = validator.merge_evidence(
                repository, description[0], description[1].split()
            )
            real_run_git = validator.run_git

            def unsafe_objects(repo, *arguments, stdin=None):
                if arguments == ("rev-parse", "--git-path", "objects"):
                    return f"/tmp/unsafe{os.pathsep}objects\n"
                return real_run_git(repo, *arguments, stdin=stdin)

            with mock.patch.object(validator, "run_git", side_effect=unsafe_objects):
                with self.assertRaisesRegex(ValueError, "path separator"):
                    validator.merge_evidence(
                        repository, description[0], description[1].split()
                    )
        self.assertEqual(evidence["automaticMerge"], "clean")
        self.assertEqual(evidence["resolution"], "automatic")
        self.assertEqual(evidence["actualTree"], evidence["automaticTree"])
        self.assertNotIn("resolutionNote", evidence)

    def test_merge_changed_paths_include_an_unrelated_merge_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)

            def git(*arguments, check=True):
                return subprocess.run(
                    ["git", *arguments],
                    cwd=repository,
                    text=True,
                    capture_output=True,
                    check=check,
                ).stdout.strip()

            git("init", "--quiet", "--initial-branch=main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            (repository / "base.txt").write_text("base\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "base")
            git("checkout", "--quiet", "-b", "feature")
            (repository / "feature.txt").write_text("feature\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "feature")
            feature_commit = git("rev-parse", "HEAD")
            git("checkout", "--quiet", "main")
            (repository / "main.txt").write_text("main\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "main")
            main_commit = git("rev-parse", "HEAD")
            (repository / "feature.txt").write_text("feature\n")
            (repository / "evil.txt").write_text("unrelated merge edit\n")
            git("add", ".")
            actual_tree = git("write-tree")
            merge_commit = git(
                "commit-tree",
                actual_tree,
                "-p",
                main_commit,
                "-p",
                feature_commit,
                "-m",
                "merge with unrelated edit",
            )
            git("reset", "--quiet", "--hard", merge_commit)
            description = git("show", "-s", "--format=%H%n%P", "HEAD").splitlines()
            self.assertEqual(
                validator.changed_paths(repository, description[0], description[1].split()),
                ["evil.txt", "feature.txt", "main.txt"],
            )
            self.assertEqual(
                validator.merge_only_paths(
                    repository, description[0], description[1].split()
                ),
                ["evil.txt"],
            )
            evidence = validator.merge_evidence(
                repository, description[0], description[1].split()
            )
            absent = subprocess.run(
                ["git", "cat-file", "-e", f"{evidence['automaticTree']}^{{tree}}"],
                cwd=repository,
                capture_output=True,
            )
        self.assertEqual(evidence["automaticMerge"], "clean")
        self.assertEqual(evidence["resolution"], "recorded")
        self.assertNotEqual(evidence["actualTree"], evidence["automaticTree"])
        self.assertEqual(
            evidence["resolutionNote"],
            "The merge commit differs from the automatic merge. It contains the recorded resolution.",
        )
        self.assertNotEqual(absent.returncode, 0)

    def test_conflict_merge_changed_paths_include_the_recorded_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)

            def git(*arguments, check=True):
                return subprocess.run(
                    ["git", *arguments],
                    cwd=repository,
                    text=True,
                    capture_output=True,
                    check=check,
                ).stdout.strip()

            git("init", "--quiet", "--initial-branch=main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            (repository / "shared.txt").write_text("base\n")
            (repository / ".gitattributes").write_text(
                "shared.txt merge=fixture\n"
            )
            git("add", ".")
            git("commit", "--quiet", "-m", "base")
            git("checkout", "--quiet", "-b", "feature")
            (repository / "shared.txt").write_text("feature\n")
            git("commit", "--quiet", "-am", "feature")
            git("checkout", "--quiet", "main")
            (repository / "shared.txt").write_text("main\n")
            git("commit", "--quiet", "-am", "main")
            result = subprocess.run(
                ["git", "merge", "--no-ff", "feature"],
                cwd=repository,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            (repository / "shared.txt").write_text("recorded resolution\n")
            (repository / "resolution-only.txt").write_text("merge-only content\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "resolve conflict")
            description = git("show", "-s", "--format=%H%n%P", "HEAD").splitlines()
            self.assertEqual(
                validator.changed_paths(repository, description[0], description[1].split()),
                ["resolution-only.txt", "shared.txt"],
            )
            self.assertEqual(
                validator.merge_only_paths(
                    repository, description[0], description[1].split()
                ),
                ["resolution-only.txt"],
            )
            git("config", "merge.conflictStyle", "zdiff3")
            git("config", "merge.fixture.driver", "true")
            global_config = repository / "ambient-global-config"
            global_config.write_text(
                "[merge]\n"
                "\tconflictStyle = zdiff3\n"
                "[merge \"fixture\"]\n"
                "\tdriver = true\n"
            )
            with mock.patch.dict(
                os.environ,
                {
                    "GIT_CONFIG_GLOBAL": str(global_config),
                    "GIT_CONFIG_COUNT": "1",
                    "GIT_CONFIG_KEY_0": "merge.fixture.driver",
                    "GIT_CONFIG_VALUE_0": "true",
                },
            ):
                evidence = validator.merge_evidence(
                    repository, description[0], description[1].split()
                )
            absent = subprocess.run(
                ["git", "cat-file", "-e", f"{evidence['automaticTree']}^{{tree}}"],
                cwd=repository,
                capture_output=True,
            )
        self.assertEqual(evidence["automaticMerge"], "conflicts")
        self.assertEqual(evidence["resolution"], "recorded")
        self.assertNotEqual(evidence["actualTree"], evidence["automaticTree"])
        self.assertEqual(
            evidence["resolutionNote"],
            "Git reported conflicts. The merge commit contains the recorded resolution.",
        )
        self.assertNotEqual(absent.returncode, 0)

    def test_parent_rename_does_not_create_merge_only_content(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)

            def git(*arguments, check=True):
                return subprocess.run(
                    ["git", *arguments],
                    cwd=repository,
                    text=True,
                    capture_output=True,
                    check=check,
                ).stdout.strip()

            git("init", "--quiet", "--initial-branch=main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            (repository / "old.txt").write_text("base\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "base")
            git("checkout", "--quiet", "-b", "feature")
            git("mv", "old.txt", "new.txt")
            git("commit", "--quiet", "-m", "rename")
            git("checkout", "--quiet", "main")
            (repository / "old.txt").write_text("main update\n")
            git("commit", "--quiet", "-am", "modify")
            result = subprocess.run(
                ["git", "merge", "--no-ff", "feature"],
                cwd=repository,
                text=True,
                capture_output=True,
            )
            if result.returncode:
                (repository / "new.txt").write_text("resolved rename\n")
                git("rm", "--quiet", "--ignore-unmatch", "old.txt")
                git("add", ".")
                git("commit", "--quiet", "-m", "resolve rename")
            description = git("show", "-s", "--format=%H%n%P", "HEAD").splitlines()
            self.assertEqual(
                validator.merge_only_paths(
                    repository, description[0], description[1].split()
                ),
                [],
            )

    def test_unrelated_history_merge_has_a_clear_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)

            def git(*arguments):
                return subprocess.run(
                    ["git", *arguments],
                    cwd=repository,
                    text=True,
                    capture_output=True,
                    check=True,
                ).stdout.strip()

            git("init", "--quiet", "--initial-branch=main")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            (repository / "main.txt").write_text("main\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "main")
            git("checkout", "--quiet", "--orphan", "other")
            git("rm", "--quiet", "-f", "main.txt")
            (repository / "other.txt").write_text("other\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "other")
            git("checkout", "--quiet", "main")
            git(
                "merge",
                "--quiet",
                "--allow-unrelated-histories",
                "--no-ff",
                "--no-edit",
                "other",
            )
            description = git("show", "-s", "--format=%H%n%P", "HEAD").splitlines()
            with self.assertRaisesRegex(ValueError, "do not have a common ancestor"):
                validator.merge_evidence(
                    repository, description[0], description[1].split()
                )

    def test_verified_base_anomaly_acknowledgment_is_self_consistent(self):
        base_bytes, verified = validator.load_base_attribution(ROOT.parent.parent)
        verified = copy.deepcopy(verified)
        verified["acknowledgedAnomalies"] = []
        with mock.patch.object(
            validator, "load_base_attribution", return_value=(base_bytes, verified)
        ):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "verified PR #71 anomaly acknowledgment does not match its anomaly records",
            errors,
        )

    def test_verified_base_integration_evidence_is_self_consistent(self):
        base_bytes, verified = validator.load_base_attribution(ROOT.parent.parent)
        verified = copy.deepcopy(verified)
        integration = next(
            item for item in verified["commits"] if item["category"] == "integration"
        )
        del integration["mergeEvidence"]
        with mock.patch.object(
            validator, "load_base_attribution", return_value=(base_bytes, verified)
        ):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("verified PR #71 integration evidence is incomplete", errors)

    def test_catalog_count_is_frozen_at_88(self):
        self.assertEqual(self.value["catalog"]["durableRecordCount"], 88)

    def test_base_attribution_hash_must_match_pr_71(self):
        self.value["baseAttribution"]["sha256"] = "a" * 64
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "base attribution sha256 does not match the artifact", errors
        )

    def test_all_base_fields_must_match_the_verified_pr_71_bytes(self):
        mutations = {
            "schemaVersion": lambda value: value["baseAttribution"].update(
                schemaVersion=2
            ),
            "devCommit": lambda value: value["baseAttribution"].update(
                devCommit="a" * 40
            ),
            "commitCount": lambda value: value["baseAttribution"].update(
                commitCount=999
            ),
            "sourceCommit": lambda value: value["baseAttribution"].update(
                sourceCommit="a" * 40
            ),
            "attributionStatus": lambda value: value["baseAttribution"].update(
                attributionStatus="complete"
            ),
            "acknowledgedAnomalyCount": lambda value: value["baseAttribution"].update(
                acknowledgedAnomalyCount=0
            ),
            "integrationEvidenceCount": lambda value: value["baseAttribution"].update(
                integrationEvidenceCount=0
            ),
            "installedTestBuild.build": lambda value: value["baseAttribution"][
                "installedTestBuild"
            ].update(build=999),
            "installedTestBuild.bundleId": lambda value: value["baseAttribution"][
                "installedTestBuild"
            ].update(bundleId="com.not-the-test-app"),
            "installedTestBuild.channel": lambda value: value["baseAttribution"][
                "installedTestBuild"
            ].update(channel="dev"),
            "installedTestBuild.commit": lambda value: value["baseAttribution"][
                "installedTestBuild"
            ].update(commit="a" * 40),
            "installedTestBuild.schemaVersion": lambda value: value["baseAttribution"][
                "installedTestBuild"
            ].update(schemaVersion=2),
            "installedTestBuild.sequence": lambda value: value["baseAttribution"][
                "installedTestBuild"
            ].update(sequence=999),
        }
        for field, mutate in mutations.items():
            with self.subTest(field=field):
                value = copy.deepcopy(self.value)
                mutate(value)
                errors = validator.validate(value, receipt=self.receipt)
                self.assertIn(
                    f"base attribution {field} does not match the verified PR #71 artifact",
                    errors,
                )

    def test_wrong_base_artifact_name_does_not_report_a_shallow_checkout(self):
        self.value["baseAttribution"]["artifact"] = "wrong.json"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "base attribution artifact must be test-build-attribution-54.json",
            errors,
        )
        self.assertFalse(any("checkout may be shallow" in error for error in errors))

    def test_missing_pr_71_object_has_a_clear_shallow_checkout_error(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(
                ["git", "init", "--quiet"], cwd=directory, check=True
            )
            errors = validator.validate(
                self.value, repo=Path(directory), receipt=self.receipt
            )
        self.assertTrue(
            any(
                "cannot read repaired PR #71 commit" in error
                and "checkout may be shallow" in error
                for error in errors
            )
        )

    def test_catalog_state_mismatch_fails(self):
        self.value["catalog"]["states"]["in-test"] = 5
        errors = validator.validate(self.value)
        self.assertIn(
            "durable catalog states do not match the frozen source records", errors
        )

    def test_extra_source_snapshot_cannot_disable_catalog_validation(self):
        self.value["sourceSnapshots"]["extra"] = {
            "commit": self.value["installedTestBuild"]["commit"],
            "path": "scripts/swiftui-stream/stream.json",
        }
        self.value["catalog"]["durableRecordCount"] = -1
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "source snapshot names do not match the required snapshot set", errors
        )
        self.assertIn(
            "durable catalog count does not match the frozen source records", errors
        )

    def test_missing_source_snapshot_fails(self):
        del self.value["sourceSnapshots"]["prDelivery"]
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "source snapshot names do not match the required snapshot set", errors
        )

    def test_catalog_source_commit_must_match_installed_test(self):
        self.value["catalog"]["sourceCommit"] = "a" * 40
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "catalog.sourceCommit does not match installedTestBuild.commit", errors
        )

    def test_every_source_snapshot_must_match_installed_test(self):
        self.value["sourceSnapshots"]["streamManifest"]["commit"] = (
            "e9f4dbd510f862717188d2118fe30d33ab999022"
        )
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "source snapshot streamManifest commit does not match installedTestBuild.commit",
            errors,
        )

    def test_ready_receipt_must_identify_build_55(self):
        self.value["deviceGate"]["observedReceipt"]["commit"] = "a" * 40
        errors = validator.validate(self.value)
        self.assertIn(
            "device gate receipt commit does not match installedTestBuild", errors
        )

    def test_ready_device_gate_must_be_approval_eligible(self):
        self.value["deviceGate"]["approvalEligible"] = False
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("ready device gate must be approval eligible", errors)

    def test_ready_device_gate_cannot_have_a_pending_launch(self):
        self.value["deviceGate"]["observedReceipt"]["launchPending"] = True
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("ready device receipt has a pending launch", errors)


if __name__ == "__main__":
    unittest.main()
