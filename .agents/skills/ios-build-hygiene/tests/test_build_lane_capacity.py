import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).parents[1] / "scripts"
ALLOCATE = SCRIPTS / "new-build-lane.sh"
SWEEP = SCRIPTS / "sweep-idle-xcode.sh"


class BuildLaneCapacityTests(unittest.TestCase):
    def run_command(self, command, environment):
        return subprocess.run(
            command, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=environment
        )

    def test_two_isolated_lanes_run_and_a_third_waits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["TMPDIR"] = str(root / "tmp")
            (root / "tmp").mkdir()
            first = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            second = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            third = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertNotEqual(first.stdout, second.stdout)
            self.assertEqual(third.returncode, 75)
            released = self.run_command(
                [str(SWEEP), "--derived-data", first.stdout.strip()], environment
            )
            self.assertEqual(released.returncode, 0, released.stderr)
            replacement = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(replacement.returncode, 0, replacement.stderr)

    def test_mismatched_slot_refuses_before_removing_the_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["TMPDIR"] = str(root / "tmp")
            (root / "tmp").mkdir()
            allocated = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(allocated.returncode, 0, allocated.stderr)
            derived = Path(allocated.stdout.strip())
            slot = Path((derived.parent / "hygiene-slot").read_text().strip())
            (slot / "run-root").write_text(str(root / "wrong") + "\n")
            refused = self.run_command(
                [str(SWEEP), "--derived-data", str(derived)], environment
            )
            self.assertEqual(refused.returncode, 75)
            self.assertTrue(derived.parent.exists())

    def test_slot_path_outside_capacity_root_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["TMPDIR"] = str(root / "tmp")
            (root / "tmp").mkdir()
            allocated = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(allocated.returncode, 0, allocated.stderr)
            derived = Path(allocated.stdout.strip())
            outside = root / "must-survive"
            outside.mkdir()
            (outside / "run-root").write_text(str(derived.parent) + "\n")
            (derived.parent / "hygiene-slot").write_text(str(outside) + "\n")
            refused = self.run_command(
                [str(SWEEP), "--derived-data", str(derived)], environment
            )
            self.assertEqual(refused.returncode, 75)
            self.assertTrue(derived.parent.exists())
            self.assertTrue(outside.exists())

    def test_interrupted_allocator_slot_is_reclaimed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["TMPDIR"] = str(root / "tmp")
            environment["T3_IOS_BUILD_CAPACITY"] = "1"
            (root / "tmp").mkdir()
            slot = root / "state/ios-build-capacity/slot-1.lock"
            slot.mkdir(parents=True)
            (slot / "state").write_text("allocating\n")
            (slot / "allocator-pid").write_text("99999999\n")
            allocated = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(allocated.returncode, 0, allocated.stderr)

    def test_missing_derived_data_releases_reciprocal_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["T3_IOS_BUILD_CAPACITY"] = "1"
            environment["TMPDIR"] = str(root / "tmp")
            (root / "tmp").mkdir()
            allocated = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            derived = Path(allocated.stdout.strip())
            shutil.rmtree(derived)
            swept = self.run_command([str(SWEEP), "--derived-data", str(derived)], environment)
            self.assertEqual(swept.returncode, 0, swept.stderr)
            replacement = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(replacement.returncode, 0, replacement.stderr)

    def test_missing_whole_run_root_releases_reciprocal_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["T3_IOS_BUILD_CAPACITY"] = "1"
            environment["TMPDIR"] = str(root / "tmp")
            (root / "tmp").mkdir()
            allocated = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            derived = Path(allocated.stdout.strip())
            shutil.rmtree(derived.parent)
            swept = self.run_command([str(SWEEP), "--derived-data", str(derived)], environment)
            self.assertEqual(swept.returncode, 0, swept.stderr)
            replacement = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(replacement.returncode, 0, replacement.stderr)

    def test_missing_hygiene_marker_finds_and_releases_reciprocal_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = os.environ.copy()
            environment["T3_IOS_BUILD_STATE_ROOT"] = str(root / "state")
            environment["T3_IOS_BUILD_CAPACITY"] = "1"
            environment["TMPDIR"] = str(root / "tmp")
            (root / "tmp").mkdir()
            allocated = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            derived = Path(allocated.stdout.strip())
            (derived.parent / "hygiene-slot").unlink()
            swept = self.run_command([str(SWEEP), "--derived-data", str(derived)], environment)
            self.assertEqual(swept.returncode, 0, swept.stderr)
            replacement = self.run_command([str(ALLOCATE), "--kind", "mcp"], environment)
            self.assertEqual(replacement.returncode, 0, replacement.stderr)


if __name__ == "__main__":
    unittest.main()
