#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent


def load_pipeline():
    spec = importlib.util.spec_from_file_location("swiftui_private_ci", ROOT / "pipeline.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pipeline = load_pipeline()


class PipelineTests(unittest.TestCase):
    def run_stage(
        self,
        directory: str,
        stage: str,
        command: list[str] | None = None,
        dry_run: bool = False,
        approval_reference: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        receipt_root = Path(directory) / "artifacts"
        arguments = [
            sys.executable,
            str(ROOT / "pipeline.py"),
            "run",
            stage,
            "--receipt-dir",
            str(receipt_root),
            "--run-id",
            "focused-test",
        ]
        if command is not None:
            arguments.extend(("--fake-command-json", json.dumps(command)))
        if dry_run:
            arguments.append("--dry-run")
        if approval_reference is not None:
            arguments.extend(("--approval-receipt-reference", approval_reference))
        environment = dict(os.environ)
        environment["T3_SWIFT_PIPELINE_LOCK_ROOT"] = str(Path(directory) / "locks")
        return subprocess.run(
            arguments,
            cwd=REPO_ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def receipt(self, directory: str, stage: str) -> dict:
        path = (
            Path(directory)
            / "artifacts/receipts/focused-test"
            / f"{stage}.json"
        )
        return json.loads(path.read_text())

    def test_fake_success_emits_a_valid_hashed_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_stage(
                directory,
                "candidate-verification",
                [sys.executable, "-c", "print('deterministic output')"],
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            value = self.receipt(directory, "candidate-verification")
            self.assertEqual(pipeline.validate_receipt(value), [])
            self.assertEqual(value["status"], "passed")
            self.assertEqual(value["exitStatus"], 0)
            self.assertEqual(value["commands"][0]["exitStatus"], 0)
            self.assertEqual(len(value["artifacts"]), 2)
            self.assertTrue(all(len(item["sha256"]) == 64 for item in value["artifacts"]))
            stdout = next(
                item for item in value["artifacts"] if item["kind"] == "command-stdout"
            )
            self.assertEqual(Path(stdout["path"]).read_text(), "deterministic output\n")

    def test_failure_preserves_real_exit_status_and_both_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_stage(
                directory,
                "test-train",
                [
                    sys.executable,
                    "-c",
                    "import sys; print('before failure'); print('reason', file=sys.stderr); sys.exit(17)",
                ],
            )
            self.assertEqual(result.returncode, 17)
            value = self.receipt(directory, "test-train")
            self.assertEqual(value["status"], "failed")
            self.assertEqual(value["exitStatus"], 17)
            self.assertEqual(value["commands"][0]["exitStatus"], 17)
            stdout_path = Path(value["commands"][0]["stdoutPath"])
            stderr_path = Path(value["commands"][0]["stderrPath"])
            self.assertEqual(stdout_path.read_text(), "before failure\n")
            self.assertEqual(stderr_path.read_text(), "reason\n")
            self.assertEqual(pipeline.validate_receipt(value), [])

    def test_dry_run_does_not_run_a_phone_or_signing_command(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_stage(directory, "test-phone-build", dry_run=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            value = self.receipt(directory, "test-phone-build")
            self.assertEqual(value["status"], "planned")
            self.assertTrue(value["dryRun"])
            self.assertIsNone(value["commands"][0]["exitStatus"])
            self.assertIn("build-ready.sh", value["commands"][0]["argv"][0])

    def test_receipt_validator_rejects_policy_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_stage(
                directory,
                "candidate-verification",
                ["/usr/bin/true"],
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            value = self.receipt(directory, "candidate-verification")
            value["githubAllowed"] = True
            value["artifacts"][0]["sha256"] = "bad"
            errors = pipeline.validate_receipt(value)
            self.assertIn("githubAllowed does not match stage policy", errors)
            self.assertTrue(any("SHA-256" in error for error in errors))

    def test_dev_promotion_requires_and_records_exact_human_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = self.run_stage(
                directory,
                "dev-promotion",
                ["/usr/bin/true"],
            )
            self.assertEqual(missing.returncode, 2)
            self.assertIn("approval-receipt-reference", missing.stderr)
            receipt_path = (
                Path(directory)
                / "artifacts/receipts/focused-test/dev-promotion.json"
            )
            self.assertFalse(receipt_path.exists())

            reference = "approvals/feature-a/receipt-123.json"
            accepted = self.run_stage(
                directory,
                "dev-promotion",
                ["/usr/bin/true"],
                approval_reference=reference,
            )
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            value = self.receipt(directory, "dev-promotion")
            self.assertEqual(value["approvalReceiptReference"], reference)
            self.assertEqual(pipeline.validate_receipt(value), [])

    def test_buildkite_declares_every_resource_and_ordered_stage(self):
        content = (REPO_ROOT / ".buildkite/pipeline.yml").read_text()
        groups = {
            "swiftui/native-build",
            "swiftui/simulator",
            "swiftui/signing",
            "swiftui/test-phone",
            "swiftui/dev-phone",
        }
        for group in groups:
            self.assertIn(f'concurrency_group: "{group}"', content)
        keys = [
            "candidate-verification",
            "candidate-simulator",
            "test-train",
            "test-phone-build",
            "test-phone-install",
            "human-acceptance",
            "dev-promotion",
            "dev-phone-build",
            "dev-phone-install",
            "upstream-handoff",
        ]
        offsets = [content.index(f'key: "{key}"') for key in keys]
        self.assertEqual(offsets, sorted(offsets))
        self.assertIn('depends_on: "human-acceptance"', content)
        self.assertIn(
            "buildkite-agent meta-data get approval-receipt-reference", content
        )

    def test_github_boundary_is_closed_until_upstream_handoff(self):
        for name, stage in pipeline.STAGES.items():
            if name == "upstream-handoff":
                self.assertTrue(stage.github_allowed)
                continue
            self.assertFalse(stage.github_allowed, name)
            flattened = " ".join(argument for command in stage.commands for argument in command)
            self.assertNotIn(".github", flattened.lower())
            self.assertNotIn("github actions", flattened.lower())
            self.assertNotIn(" gh ", f" {flattened.lower()} ")
        buildkite = (REPO_ROOT / ".buildkite/pipeline.yml").read_text().lower()
        self.assertNotIn(".github/workflows", buildkite)
        self.assertNotIn("workflow_dispatch", buildkite)
        wrapper = (ROOT / "fastlane.sh").read_text()
        self.assertIn("FASTLANE_HIDE_GITHUB_ISSUES=1", wrapper)

    def test_declared_json_schema_matches_runtime_stage_names(self):
        schema = json.loads((ROOT / "receipt.schema.json").read_text())
        self.assertEqual(
            set(schema["properties"]["stage"]["enum"]),
            set(pipeline.STAGES),
        )


if __name__ == "__main__":
    unittest.main()
