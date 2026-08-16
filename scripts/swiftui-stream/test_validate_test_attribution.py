#!/usr/bin/env python3

import importlib.util
import json
import subprocess
import sys
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
validator = load_module("test_attribution", ROOT / "validate_test_attribution.py")


class TestAttributionTests(unittest.TestCase):
    def setUp(self):
        self.value = json.loads((ROOT / "test-build-attribution-54.json").read_text())
        self.repo_head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        self.receipt = {
            "schemaVersion": 1,
            "channel": "test",
            "build": 54,
            "sequence": 54,
            "commit": "e9f4dbd510f862717188d2118fe30d33ab999022",
            "bundleId": "com.alxs.t3code.typed-swiftui.dev",
            "status": "installed-and-launched",
            "launchPending": False,
        }

    def test_frozen_attribution_matches_git_and_receipt(self):
        self.assertEqual(validator.validate(self.value, receipt=self.receipt), [])

    def test_acknowledged_anomaly_set_is_frozen(self):
        self.value["acknowledgedAnomalies"] = []
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "acknowledgedAnomalies does not match the frozen anomaly set", errors
        )

    def test_cli_reports_valid_but_incomplete_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt_path = Path(directory) / "receipt.json"
            receipt_path.write_text(json.dumps(self.receipt))
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "validate_test_attribution.py"),
                    "--receipt",
                    str(receipt_path),
                ],
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["validationStatus"], "valid")
        self.assertEqual(output["attributionStatus"], "incomplete")
        self.assertEqual(output["acknowledgedAnomalyCount"], 30)
        self.assertEqual(
            output["message"],
            "Attribution is incomplete. The record has acknowledged anomalies.",
        )

    def test_receipt_mismatch_fails(self):
        self.receipt["build"] = 55
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "device receipt build does not match installedTestBuild", errors
        )

    def test_receipt_status_must_confirm_install_and_launch(self):
        self.receipt["status"] = "install-failed"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "device receipt does not show installed-and-launched", errors
        )

    def test_receipt_launch_must_not_be_pending(self):
        self.receipt["launchPending"] = True
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("device receipt has a pending launch", errors)

    def test_validation_requires_a_device_receipt(self):
        errors = validator.validate(self.value)
        self.assertIn("device receipt is required", errors)

    def test_cli_requires_a_device_receipt(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "validate_test_attribution.py")],
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("device receipt is required", result.stderr)

    def test_receipt_must_match_the_test_bundle(self):
        self.receipt["bundleId"] = "com.not-the-test-app"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "device receipt bundleId does not match installedTestBuild", errors
        )

    def test_attribution_and_receipt_cannot_agree_on_the_wrong_bundle(self):
        self.value["installedTestBuild"]["bundleId"] = "com.not-the-test-app"
        self.receipt["bundleId"] = "com.not-the-test-app"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "installedTestBuild.bundleId must identify the Test app", errors
        )

    def test_attribution_and_receipt_cannot_agree_on_the_wrong_channel(self):
        self.value["installedTestBuild"]["channel"] = "dev"
        self.receipt["channel"] = "dev"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("installedTestBuild.channel must be test", errors)

    def test_missing_commit_fails_exact_range_check(self):
        self.value["commits"] = self.value["commits"][1:]
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "commit records do not match the commit list from Dev to the installed Test build",
            errors,
        )

    def test_dev_must_be_an_ancestor_of_installed_test(self):
        self.value["baseline"]["devCommit"] = self.repo_head
        self.value["commits"] = []
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "baseline.devCommit must be an ancestor of installedTestBuild.commit",
            errors,
        )

    def test_candidate_must_have_source_record(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        candidate["sourceRecords"] = []
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("candidate has no exact source record" in error for error in errors))

    def test_candidate_with_exact_source_evidence_cannot_be_an_anomaly(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        candidate["category"] = "anomaly"
        candidate["anomaly"] = "downgraded despite exact source evidence"
        candidate["sourceRecords"] = []
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("anomaly has exact candidate source evidence" in error for error in errors)
        )

    def test_merge_commit_cannot_be_an_anomaly(self):
        integration = next(
            item for item in self.value["commits"] if item["category"] == "integration"
        )
        integration["category"] = "anomaly"
        integration["anomaly"] = "downgraded despite merge structure"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("merge commit must be classified as integration" in error for error in errors)
        )

    def test_non_merge_commit_cannot_be_an_integration(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        candidate["category"] = "integration"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("integration is not a merge commit" in error for error in errors)
        )

    def test_revert_subject_must_use_the_revert_category(self):
        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        commit = candidate["commit"]
        candidate["subject"] = 'Revert "candidate"'
        real_run_git = validator.run_git

        def subject_override(repo, *arguments, stdin=None):
            if arguments == ("show", "-s", "--format=%s%n%P", commit, "--"):
                description = real_run_git(repo, *arguments, stdin=stdin).splitlines()
                return candidate["subject"] + "\n" + description[1] + "\n"
            return real_run_git(repo, *arguments, stdin=stdin)

        with mock.patch.object(validator, "run_git", side_effect=subject_override):
            errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("revert commit must be classified as revert" in error for error in errors)
        )

    def test_source_snapshot_cannot_postdate_installed_test(self):
        self.value["sourceSnapshots"]["streamManifest"]["commit"] = self.repo_head
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "source snapshot streamManifest commit must be an ancestor of installedTestBuild.commit",
            errors,
        )

    def test_installed_test_must_be_an_ancestor_of_the_observed_tip(self):
        self.value["observedTestTip"]["commit"] = self.value["baseline"]["devCommit"]
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn(
            "installedTestBuild.commit must be an ancestor of observedTestTip.commit",
            errors,
        )

    def test_source_snapshot_names_and_paths_are_fixed(self):
        self.value["sourceSnapshots"]["streamManifest"]["path"] = (
            "scripts/swiftui-stream/test_stream.py"
        )
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("source snapshot streamManifest has an unexpected path", errors)

    def test_integration_changed_paths_use_the_first_parent(self):
        self.assertEqual(
            self.value.get("integrationChangedPathsRule"),
            "Diff the merge tree against its first parent.",
        )
        integration = next(
            item for item in self.value["commits"] if item["category"] == "integration"
        )
        self.assertTrue(integration["changedPaths"])
        integration["changedPaths"] = []
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("changed paths do not match Git" in error for error in errors)
        )

    def test_integration_tree_evidence_must_match_git(self):
        integration = next(
            item for item in self.value["commits"] if item["category"] == "integration"
        )
        integration["mergeEvidence"] = {
            "actualTree": "0" * 40,
            "automaticTree": "0" * 40,
            "status": "automatic",
        }
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(
            any("merge evidence does not match Git" in error for error in errors)
        )

    def test_merge_evidence_does_not_write_to_the_repository_object_store(self):
        integration = next(
            item
            for item in self.value["commits"]
            if item["category"] == "integration"
            and item["mergeEvidence"]["resolution"] == "recorded"
        )
        automatic_tree = integration["mergeEvidence"]["automaticTree"]
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True)
            subprocess.run(
                [
                    "git",
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    str(ROOT.parent.parent),
                    integration["commit"],
                    *integration["parents"],
                ],
                cwd=repository,
                check=True,
            )
            before = subprocess.run(
                ["git", "cat-file", "-e", f"{automatic_tree}^{{tree}}"],
                cwd=repository,
                capture_output=True,
            )
            self.assertNotEqual(before.returncode, 0)
            evidence = validator.merge_evidence(
                repository, integration["commit"], integration["parents"]
            )
            after = subprocess.run(
                ["git", "cat-file", "-e", f"{automatic_tree}^{{tree}}"],
                cwd=repository,
                capture_output=True,
            )
        self.assertEqual(evidence, integration["mergeEvidence"])
        self.assertNotEqual(after.returncode, 0)

    def test_invalid_commit_id_is_rejected_before_git(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "git-output"
            self.value["commits"][0]["commit"] = f"--output={output_path}"
            errors = validator.validate(self.value, receipt=self.receipt)
            self.assertFalse(output_path.exists())
        self.assertTrue(any("commit id must be 40 lowercase hex characters" in error for error in errors))

    def test_duplicate_commit_ids_are_rejected(self):
        self.value["commits"][1]["commit"] = self.value["commits"][0]["commit"]
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("commit records contain duplicate commit ids", errors)

    def test_anomaly_records_must_match_the_frozen_set(self):
        anomaly = next(
            item for item in self.value["commits"] if item["category"] == "anomaly"
        )
        anomaly["category"] = "metadata"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertIn("anomaly records do not match the frozen anomaly set", errors)

    def test_malformed_structures_return_errors(self):
        malformed_values = [
            ([], "attribution must be an object"),
            ({**self.value, "commits": [None]}, "commit record 0 must be an object"),
        ]
        for value, expected in malformed_values:
            with self.subTest(expected=expected):
                errors = validator.validate(value, receipt=self.receipt)
                self.assertIn(expected, errors)

        candidate = next(
            item for item in self.value["commits"] if item["category"] == "candidate"
        )
        candidate["sourceRecords"] = {}
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("sourceRecords must be a list" in error for error in errors))

    def test_cli_reports_malformed_attribution_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            attribution_path = Path(directory) / "attribution.json"
            receipt_path = Path(directory) / "receipt.json"
            attribution_path.write_text("[]")
            receipt_path.write_text(json.dumps(self.receipt))
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "validate_test_attribution.py"),
                    "--attribution",
                    str(attribution_path),
                    "--receipt",
                    str(receipt_path),
                ],
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("attribution must be an object", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_descriptive_fields_are_bound(self):
        mutations = [
            ("baseline", lambda: self.value["baseline"].update(branch="wrong")),
            ("classification", lambda: self.value.update(classificationRule={})),
            (
                "observed branch",
                lambda: self.value["observedTestTip"].update(branch="wrong"),
            ),
            (
                "observed note",
                lambda: self.value["observedTestTip"].update(note="wrong"),
            ),
        ]
        for name, mutate in mutations:
            with self.subTest(name=name):
                original = json.loads(
                    (ROOT / "test-build-attribution-54.json").read_text()
                )
                self.value = original
                mutate()
                errors = validator.validate(self.value, receipt=self.receipt)
                self.assertTrue(errors)

    def test_single_parent_patch_id_must_match_git(self):
        item = next(item for item in self.value["commits"] if len(item["parents"]) == 1)
        item["patchId"] = "0" * 40
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("patch id does not match Git" in error for error in errors))

    def test_patch_id_must_be_40_lowercase_hex_characters(self):
        item = next(item for item in self.value["commits"] if len(item["parents"]) == 1)
        item["patchId"] = "not-a-patch-id"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("patchId must be 40 lowercase hex characters" in error for error in errors))

    def test_recorded_merge_resolution_note_is_required(self):
        item = next(
            item
            for item in self.value["commits"]
            if item["category"] == "integration"
            and item["mergeEvidence"]["resolution"] == "recorded"
        )
        del item["mergeEvidence"]["resolutionNote"]
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("merge evidence does not match Git" in error for error in errors))

    def test_merge_commit_cannot_have_a_patch_id(self):
        item = next(item for item in self.value["commits"] if len(item["parents"]) == 2)
        item["patchId"] = "0" * 40
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("merge commit cannot declare a patch id" in error for error in errors))

    def test_parent_list_must_match_git(self):
        self.value["commits"][0]["parents"][0] = "0" * 40
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("parents do not match Git" in error for error in errors))

    def test_subject_must_match_git(self):
        self.value["commits"][0]["subject"] = "wrong subject"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("subject does not match Git" in error for error in errors))

    def test_metadata_cannot_hide_runtime_paths(self):
        item = next(item for item in self.value["commits"] if item["category"] == "candidate")
        item["category"] = "metadata"
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("metadata changes files outside stream.json" in error for error in errors))

    def test_revert_must_invert_an_in_range_commit(self):
        item = next(item for item in self.value["commits"] if item["category"] == "candidate")
        item["category"] = "revert"
        item["revertTarget"] = self.value["commits"][0]["commit"]
        errors = validator.validate(self.value, receipt=self.receipt)
        self.assertTrue(any("revert patch does not invert revertTarget" in error for error in errors))

    def test_inverse_patch_id_disables_text_conversion(self):
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

            git("init", "--quiet")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "Test")
            (repository / ".gitattributes").write_text("*.data diff=fixture\n")
            filter_path = repository / "textconv.py"
            filter_path.write_text('#!/usr/bin/env python3\nprint("converted")\n')
            filter_path.chmod(0o755)
            git("config", "diff.fixture.textconv", str(filter_path))
            (repository / "sample.data").write_bytes(b"a\x00one\n")
            git("add", ".")
            git("commit", "--quiet", "-m", "base")
            (repository / "sample.data").write_bytes(b"b\x00two\n")
            git("add", "sample.data")
            git("commit", "--quiet", "-m", "change")
            target = git("rev-parse", "HEAD")
            git("revert", "--no-edit", target)
            revert = git("rev-parse", "HEAD")
            self.assertEqual(
                validator.inverse_patch_id(repository, target),
                validator.patch_id(repository, revert),
            )


if __name__ == "__main__":
    unittest.main()
