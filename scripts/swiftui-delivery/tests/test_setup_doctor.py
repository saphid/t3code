"""Regression tests for scripts/setup and scripts/doctor failure modes.

These run the real bash scripts against a hermetic skeleton package in a
temporary directory, with a stub PATH, so they prove the guards the doctor
exists for: zero discovered tests, missing tests directory, and a failing
package auditor. They also prove setup's non-bootstrap mutation boundary.
"""

import json
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest

PACKAGE_DIR = pathlib.Path(__file__).resolve().parents[1]
SKILLS = (
    "file-swiftui-lane-issue",
    "swiftui-orchestrate",
    "swiftui-feature-work",
    "swiftui-deliver",
)
TOOL_NAMES = (
    "swiftui-delivery",
    "simulator-lane",
    "phone-lease",
    "audit-package",
    "setup",
    "doctor",
    "status",
)


def _write_executable(path, body):
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class SkeletonHarness(unittest.TestCase):
    """Builds repo/.agents/skills + repo/scripts/swiftui-delivery skeleton."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="swiftui-doctor-test."))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.repo = self.tmp / "repo"
        self.pkg = self.repo / "scripts" / "swiftui-delivery"
        self.scripts = self.pkg / "scripts"
        self.scripts.mkdir(parents=True)
        (self.pkg / "tests").mkdir()
        for skill in SKILLS:
            d = self.repo / ".agents" / "skills" / skill
            d.mkdir(parents=True)
            (d / "SKILL.md").write_text("stub\n")
        contract = {
            "schemaVersion": 2,
            "package": "swiftui-delivery",
            "stateRoot": "~/.local/state/t3/swiftui-delivery",
            "buildStore": "~/.local/share/t3/swiftui-delivery/builds",
            "phonePublicationLease":
                "~/.local/state/t3/swiftui-delivery/phone-publication.lock",
            "flowPolicy": {"wipLimits": {}},
        }
        (self.pkg / "contract.json").write_text(json.dumps(contract))
        for tool in TOOL_NAMES:
            if tool in ("setup", "doctor"):
                shutil.copy2(PACKAGE_DIR / "scripts" / tool, self.scripts / tool)
            elif tool == "audit-package":
                _write_executable(
                    self.scripts / tool,
                    "#!/bin/bash\n"
                    "echo '{\"errors\": [], \"filesScanned\": 1, \"ok\": true}'\n")
            else:
                _write_executable(self.scripts / tool, "#!/bin/bash\nexit 0\n")
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        _write_executable(self.bin / "gh", "#!/bin/bash\nexit 0\n")

    def run_tool(self, tool, *args):
        env = dict(os.environ)
        env["HOME"] = str(self.home)
        env["PATH"] = "%s:%s" % (self.bin, env["PATH"])
        return subprocess.run(
            [str(self.scripts / tool)] + list(args),
            capture_output=True, text=True, env=env, timeout=120)

    def make_state_dirs(self):
        for rel in (".local/state/t3/swiftui-delivery",
                    ".local/share/t3/swiftui-delivery/builds"):
            (self.home / rel).mkdir(parents=True, exist_ok=True)


class DoctorGuards(SkeletonHarness):
    def test_zero_discovered_tests_is_broken(self):
        self.make_state_dirs()
        result = self.run_tool("doctor")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("ZERO tests", result.stdout)

    def test_missing_tests_directory_is_broken(self):
        self.make_state_dirs()
        shutil.rmtree(self.pkg / "tests")
        result = self.run_tool("doctor")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("no run summary", result.stdout)

    def test_failing_auditor_is_broken(self):
        self.make_state_dirs()
        (self.pkg / "tests" / "test_ok.py").write_text(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_pass(self):\n"
            "        self.assertTrue(True)\n")
        _write_executable(self.scripts / "audit-package",
                          "#!/bin/bash\nexit 3\n")
        result = self.run_tool("doctor")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("auditor exited 3", result.stdout)

    def test_failing_suite_is_broken(self):
        self.make_state_dirs()
        (self.pkg / "tests" / "test_fail.py").write_text(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_fail(self):\n"
            "        self.assertTrue(False)\n")
        result = self.run_tool("doctor")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("suite FAILED", result.stdout)

    def test_healthy_skeleton_is_clean(self):
        self.make_state_dirs()
        (self.pkg / "tests" / "test_ok.py").write_text(
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_pass(self):\n"
            "        self.assertTrue(True)\n")
        result = self.run_tool("doctor")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("CLEAN", result.stdout)


class SetupMutationBoundary(SkeletonHarness):
    def test_non_bootstrap_setup_creates_only_state_dirs(self):
        before = {str(p.relative_to(self.home))
                  for p in self.home.rglob("*")}
        self.run_tool("setup")
        after = {str(p.relative_to(self.home))
                 for p in self.home.rglob("*")}
        created = after - before
        allowed_roots = (".local",)
        allowed_leaves = (
            ".local/state/t3/swiftui-delivery",
            ".local/share/t3/swiftui-delivery/builds",
        )
        for path in created:
            self.assertTrue(
                path.startswith(allowed_roots),
                "setup created a path outside its mutation boundary: %s" % path)
        for leaf in allowed_leaves:
            self.assertIn(leaf, after, "setup did not create %s" % leaf)
        pointer = (self.home / ".local/state/t3/swiftui-delivery"
                   / "canonical-checkout")
        self.assertTrue(pointer.is_file(), "canonical-checkout not written")
        self.assertEqual(
            pathlib.Path(pointer.read_text().strip()).resolve(),
            self.repo.resolve())


if __name__ == "__main__":
    unittest.main()
