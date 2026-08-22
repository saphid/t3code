import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "simulator_lane.py"
SPEC = importlib.util.spec_from_file_location("simulator_lane", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
UDID_A = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
UDID_B = "11111111-2222-3333-4444-555555555555"


def catalog():
    return {
        UDID_A: {"udid": UDID_A, "name": "Lane A", "state": "Booted", "runtime": "iOS-26"},
        UDID_B: {"udid": UDID_B, "name": "Lane B", "state": "Shutdown", "runtime": "iOS-26"},
    }


class SimulatorLaneTests(unittest.TestCase):
    def test_different_simulators_can_be_leased_concurrently(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt_a = Path(directory) / "a.json"
            receipt_b = Path(directory) / "b.json"
            a = MODULE.acquire_lease("lane-a", UDID_A, receipt_a, catalog(), root)
            b = MODULE.acquire_lease("lane-b", UDID_B, receipt_b, catalog(), root)
            self.assertNotEqual(a["token"], b["token"])
            self.assertEqual(MODULE.verify_lease(receipt_a, root)["laneId"], "lane-a")
            self.assertEqual(MODULE.verify_lease(receipt_b, root)["laneId"], "lane-b")

    def test_same_simulator_has_one_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            MODULE.acquire_lease("lane-a", UDID_A, Path(directory) / "a.json", catalog(), root)
            with self.assertRaisesRegex(RuntimeError, "lane-a"):
                MODULE.acquire_lease("lane-b", UDID_A, Path(directory) / "b.json", catalog(), root)

    def test_acquire_rejects_noncanonical_lane_id(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "canonical lowercase"):
                MODULE.acquire_lease(
                    "Lane A", UDID_A, Path(directory) / "receipt.json",
                    catalog(), Path(directory) / "leases"
                )

    def test_release_requires_the_exact_token(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            tampered = json.loads(receipt.read_text(encoding="utf-8"))
            tampered["token"] = "wrong"
            receipt.write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                MODULE.release_lease(receipt, root)
            self.assertTrue(MODULE.lease_directory(UDID_A, root).exists())

    def test_snapshot_binds_udid_and_screen_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            lease = MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            snapshot = Path(directory) / "snapshot.json"
            snapshot.write_text(json.dumps({
                "didError": False,
                "data": {
                    "artifacts": {"simulatorId": UDID_A},
                    "capture": {"udid": UDID_A, "screenHash": "screen-a"},
                },
            }), encoding="utf-8")
            binding = MODULE.snapshot_binding(snapshot, lease)
            self.assertEqual(binding["simulatorUdid"], UDID_A)
            self.assertEqual(binding["screenHash"], "screen-a")

    def test_snapshot_rejects_cross_lane_capture(self):
        snapshot = {"didError": False, "data": {
            "artifacts": {"simulatorId": UDID_B},
            "capture": {"udid": UDID_B, "screenHash": "wrong"},
        }}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.json"
            path.write_text(json.dumps(snapshot), encoding="utf-8")
            lease = {"laneId": "lane-a", "simulator": {"udid": UDID_A}}
            with self.assertRaisesRegex(ValueError, "mismatch"):
                MODULE.snapshot_binding(path, lease)

    def test_public_binding_matches_the_active_lease_without_token(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            output = Path(directory) / "binding.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            binding = MODULE.write_lease_binding(receipt, output, root)
            self.assertEqual(binding["laneId"], "lane-a")
            self.assertEqual(binding["simulator"]["udid"], UDID_A)
            self.assertRegex(binding["leaseSha256"], r"^[0-9a-f]{64}$")
            self.assertNotIn("token", output.read_text(encoding="utf-8"))

    @mock.patch.object(MODULE.subprocess, "run")
    def test_xcb_injects_the_leased_udid_and_pinned_version(self, run):
        run.return_value.returncode = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            result = MODULE.run_xcodebuildmcp(
                receipt, ["ui-automation", "snapshot-ui", "--output", "json"], root
            )
        self.assertEqual(result, 0)
        command = run.call_args.args[0]
        self.assertIn("xcodebuildmcp@2.7.0", command)
        self.assertEqual(command[-2:], ["--simulator-id", UDID_A])

    @mock.patch.object(MODULE.subprocess, "run")
    def test_xcb_rejects_process_local_element_ref_actions(self, run):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            with self.assertRaisesRegex(ValueError, "element refs"):
                MODULE.run_xcodebuildmcp(
                    receipt, ["ui-automation", "tap", "--element-ref", "e47"], root
                )
        run.assert_not_called()

    @mock.patch.object(MODULE.subprocess, "run")
    def test_xcb_rejects_an_equals_form_cross_lane_udid(self, run):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            with self.assertRaisesRegex(ValueError, "does not match"):
                MODULE.run_xcodebuildmcp(
                    receipt,
                    ["ui-automation", "snapshot-ui", "--simulator-id=" + UDID_B],
                    root,
                )
        run.assert_not_called()

    @mock.patch.object(MODULE.subprocess, "run")
    def test_axe_action_injects_exact_udid(self, run):
        run.return_value.returncode = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            status = MODULE.run_axe(
                receipt, ["tap", "--label", "Accessibility"], root, "/tmp/axe"
            )
        self.assertEqual(status, 0)
        self.assertEqual(run.call_args.args[0][-2:], ["--udid", UDID_A])

    def test_recovery_requires_hash_shutdown_and_no_matching_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            recovered = Path(directory) / "recovered.json"
            MODULE.acquire_lease("lane-a", UDID_B, receipt, catalog(), root)
            inspection = MODULE.inspect_lease(UDID_B, root, catalog())
            result = MODULE.recover_lease(
                UDID_B, inspection["leaseSha256"],
                "The allocator stopped before it could release this exact lane.",
                recovered, root, catalog(), process_matches=[]
            )
            self.assertEqual(result["kind"], "swiftui-simulator-lane-recovery")
            self.assertFalse(MODULE.lease_directory(UDID_B, root).exists())

    def test_recovery_refuses_a_booted_simulator(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            inspection = MODULE.inspect_lease(UDID_A, root, catalog())
            with self.assertRaisesRegex(RuntimeError, "Shutdown"):
                MODULE.recover_lease(
                    UDID_A, inspection["leaseSha256"], "x" * 40,
                    Path(directory) / "recovery.json", root, catalog(), []
                )

    @mock.patch.object(MODULE.os, "getpid", return_value=100)
    @mock.patch.object(MODULE.subprocess, "run")
    def test_recovery_process_scan_excludes_its_invocation_ancestors(self, run, _getpid):
        run.return_value.returncode = 0
        run.return_value.stdout = (
            "100 50 python simulator-lane recover --simulator %s\n"
            "50 10 zsh -c simulator-lane recover --simulator %s\n"
            "200 10 serve-sim --udid %s\n" % (UDID_B, UDID_B, UDID_B)
        )
        matches = MODULE.processes_referencing_udid(UDID_B)
        self.assertEqual(matches, ["200 serve-sim --udid " + UDID_B])

    @mock.patch.object(MODULE.subprocess, "run")
    def test_same_udid_operations_are_serialized(self, run):
        first_entered = threading.Event()
        allow_first = threading.Event()
        second_entered = threading.Event()
        call_count = []

        def execute(_command, check=False):
            call_count.append(check)
            if len(call_count) == 1:
                first_entered.set()
                allow_first.wait(1)
            else:
                second_entered.set()
            return mock.Mock(returncode=0)

        run.side_effect = execute
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            command = ["ui-automation", "snapshot-ui"]
            first = threading.Thread(
                target=MODULE.run_xcodebuildmcp, args=(receipt, command, root)
            )
            second = threading.Thread(
                target=MODULE.run_xcodebuildmcp, args=(receipt, command, root)
            )
            first.start()
            self.assertTrue(first_entered.wait(1))
            second.start()
            self.assertFalse(second_entered.wait(0.05))
            allow_first.set()
            first.join(1)
            second.join(1)
            self.assertTrue(second_entered.is_set())

    @mock.patch.object(MODULE.subprocess, "run")
    def test_different_udid_operations_can_enter_concurrently(self, run):
        barrier = threading.Barrier(2)

        def execute(_command, check=False):
            barrier.wait(1)
            return mock.Mock(returncode=0)

        run.side_effect = execute
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt_a = Path(directory) / "a.json"
            receipt_b = Path(directory) / "b.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt_a, catalog(), root)
            MODULE.acquire_lease("lane-b", UDID_B, receipt_b, catalog(), root)
            command = ["ui-automation", "snapshot-ui"]
            first = threading.Thread(
                target=MODULE.run_xcodebuildmcp, args=(receipt_a, command, root)
            )
            second = threading.Thread(
                target=MODULE.run_xcodebuildmcp, args=(receipt_b, command, root)
            )
            first.start()
            second.start()
            first.join(2)
            second.join(2)
            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())


if __name__ == "__main__":
    unittest.main()
