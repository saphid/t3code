import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


composer = module("swiftui_compose_generation", "compose_generation.py")


def git(repository, *arguments):
    result = subprocess.run(
        ["git", "-C", str(repository)] + list(arguments),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise AssertionError(result.stderr.decode())
    return result.stdout.decode().strip()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    return {"path": str(path),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


class ComposeGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.remote = self.root / "upstream.git"
        self.repository = self.root / "product"
        subprocess.run(["git", "init", "--bare", str(self.remote)],
                       check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "init", str(self.repository)],
                       check=True, stdout=subprocess.DEVNULL)
        git(self.repository, "config", "user.name", "Test")
        git(self.repository, "config", "user.email", "test@example.com")
        git(self.repository, "remote", "add", "origin", str(self.remote))
        (self.repository / "Feature.swift").write_text("let value = 1\n")
        git(self.repository, "add", "Feature.swift")
        git(self.repository, "commit", "-m", "base")
        self.base = git(self.repository, "rev-parse", "HEAD")
        git(self.repository, "branch", "-M", "t3code/rebuild-mobile-app-swift")
        git(self.repository, "push", "origin", "t3code/rebuild-mobile-app-swift")
        git(self.repository, "switch", "-c", "feature")
        (self.repository / "Feature.swift").write_text("let value = 2\n")
        git(self.repository, "add", "Feature.swift")
        git(self.repository, "commit", "-m", "feature")
        self.head = git(self.repository, "rev-parse", "HEAD")

    def tearDown(self):
        self.temporary.cleanup()

    def make_plan(self):
        item_path = self.root / "work-item.json"
        item = {"binding": {"baseCommit": self.base}}
        item_descriptor = write_json(item_path, item)
        generation_path = self.root / "generation.json"
        generation = {
            "mode": "publish-test",
            "entries": [{
                "issue": "saphid/t3code-personal#271",
                "headCommit": self.head,
                "workItem": item_descriptor,
            }],
        }
        generation_descriptor = write_json(generation_path, generation)
        plan_path = self.root / "composition.json"
        plan = {
            "schemaVersion": 1,
            "kind": "swiftui-build-composition-plan",
            "mode": "publish-test",
            "sourceBase": {
                "repository": "pingdotgg/t3code",
                "remote": "origin",
                "ref": "refs/heads/t3code/rebuild-mobile-app-swift",
                "commit": self.base,
                "resolvedAt": "2026-08-30T01:02:03Z",
            },
            "generationPlan": generation_descriptor,
            "overlays": [{
                "issue": "saphid/t3code-personal#271",
                "baseCommit": self.base,
                "headCommit": self.head,
            }],
        }
        write_json(plan_path, plan)
        return plan, plan_path

    def test_materializes_fresh_base_and_records_each_overlay(self):
        plan, plan_path = self.make_plan()
        worktree = self.root / "combined"
        receipt_path = self.root / "receipt.json"
        with mock.patch.object(composer.delivery, "validate_generation_plan",
                               return_value=[]):
            receipt = composer.compose(
                plan_path, self.repository, worktree, receipt_path)

        self.assertEqual((worktree / "Feature.swift").read_text(), "let value = 2\n")
        self.assertEqual(git(worktree, "rev-list", "--count", self.base + "..HEAD"), "1")
        self.assertFalse(receipt["priorCompositeUsedAsBase"])
        self.assertEqual(receipt["sourceBase"]["commit"], self.base)
        self.assertEqual(receipt["overlays"][0]["headCommit"], self.head)
        self.assertTrue(receipt_path.is_file())
        with mock.patch.object(composer.delivery, "validate_generation_plan",
                               return_value=[]):
            second = composer.compose(
                plan_path, self.repository, self.root / "combined-again",
                self.root / "receipt-again.json")
        self.assertEqual(second["resultingCommit"], receipt["resultingCommit"])
        self.assertEqual(second["resultingTree"], receipt["resultingTree"])
        with mock.patch.object(composer.delivery, "validate_generation_plan",
                               return_value=[]):
            self.assertEqual(composer.delivery.validate_composition_receipt(
                receipt, plan, plan_path), [])

        generation_path = Path(plan["generationPlan"]["path"])
        generation = json.loads(generation_path.read_text())
        generation_receipt = {
            "schemaVersion": 3,
            "kind": "swiftui-generation-receipt",
            "mode": "publish-test",
            "planSha256": hashlib.sha256(generation_path.read_bytes()).hexdigest(),
            "completedAt": "2026-08-30T02:03:04Z",
            "entries": [{
                "issue": "saphid/t3code-personal#271",
                "headCommit": self.head,
            }],
            "resolvedDestination": "SwiftUI Test",
            "installedArtifactSha256": "a" * 64,
            "compositionPlan": {
                "path": str(plan_path),
                "sha256": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
            },
            "compositionReceipt": {
                "path": str(receipt_path),
                "sha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
            },
            "resultingCommit": receipt["resultingCommit"],
        }
        with mock.patch.object(composer.delivery, "validate_generation_plan",
                               return_value=[]):
            self.assertEqual(composer.delivery.validate_generation_receipt(
                generation_receipt, generation, generation_path), [])

        generation_receipt["schemaVersion"] = 2
        errors = composer.delivery.validate_generation_receipt(
            generation_receipt, generation, generation_path)
        self.assertTrue(any("must use schemaVersion 3" in error for error in errors))

    def test_refuses_stale_theo_base_instead_of_reusing_a_composite(self):
        _, plan_path = self.make_plan()
        git(self.repository, "switch", "t3code/rebuild-mobile-app-swift")
        (self.repository / "Second.swift").write_text("let second = true\n")
        git(self.repository, "add", "Second.swift")
        git(self.repository, "commit", "-m", "advance base")
        git(self.repository, "push", "origin", "t3code/rebuild-mobile-app-swift")
        with mock.patch.object(composer.delivery, "validate_generation_plan",
                               return_value=[]):
            with self.assertRaisesRegex(composer.CompositionError,
                                        "Theo source ref moved"):
                composer.compose(
                    plan_path, self.repository, self.root / "combined",
                    self.root / "receipt.json")


if __name__ == "__main__":
    unittest.main()
