import importlib.util
import hashlib
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
UDID_C = "66666666-7777-8888-9999-AAAAAAAAAAAA"
DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-26-5"


def catalog():
    return {
        UDID_A: {"udid": UDID_A, "name": "Lane A", "state": "Booted", "runtime": "iOS-26"},
        UDID_B: {"udid": UDID_B, "name": "Lane B", "state": "Shutdown", "runtime": "iOS-26"},
    }


def pool_catalog():
    return {
        UDID_A: {
            "udid": UDID_A, "name": "Proof Lane 1", "state": "Shutdown",
            "runtime": RUNTIME, "deviceTypeIdentifier": DEVICE_TYPE,
            "isAvailable": True,
        },
        UDID_B: {
            "udid": UDID_B, "name": "Proof Lane 2", "state": "Shutdown",
            "runtime": RUNTIME, "deviceTypeIdentifier": DEVICE_TYPE,
            "isAvailable": True,
        },
    }


def write_pool(path):
    MODULE.atomic_json(path, {
        "schemaVersion": 1,
        "kind": "swiftui-simulator-pool",
        "deviceTypeIdentifier": DEVICE_TYPE,
        "runtimeIdentifier": RUNTIME,
        "desiredCount": 2,
        "namePrefix": "Proof Lane",
        "members": [
            {"slot": 1, "name": "Proof Lane 1", "udid": UDID_A},
            {"slot": 2, "name": "Proof Lane 2", "udid": UDID_B},
        ],
        "updatedAt": "2026-08-28T00:00:00Z",
    })


class SimulatorLaneTests(unittest.TestCase):
    def test_driver_identity_rejects_the_stale_touch_move_implementation(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / "xcodebuildmcp"
            axe = package / "bundled" / "axe"
            framework = (package / "bundled" / "Frameworks" /
                         "FBSimulatorControl.framework" / "Versions" / "A" /
                         "FBSimulatorControl")
            axe.parent.mkdir(parents=True)
            framework.parent.mkdir(parents=True)
            (package / "package.json").write_text(
                json.dumps({"version": MODULE.XCODEBUILDMCP_VERSION}))
            axe.write_bytes(
                b"axe 1.8.0\x00FBSimulatorHIDEvent does not support touch move events."
            )
            axe.chmod(0o755)
            framework.write_bytes(b"framework")

            with self.assertRaisesRegex(RuntimeError, "stale touch-move"):
                MODULE.inspect_driver(package, command_runner=mock.Mock())

    def test_driver_identity_records_the_matched_release_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / "xcodebuildmcp"
            axe = package / "bundled" / "axe"
            framework = (package / "bundled" / "Frameworks" /
                         "FBSimulatorControl.framework" / "Versions" / "A" /
                         "FBSimulatorControl")
            axe.parent.mkdir(parents=True)
            framework.parent.mkdir(parents=True)
            (package / "package.json").write_text(
                json.dumps({"version": MODULE.XCODEBUILDMCP_VERSION}))
            axe.write_bytes(b"current-axe")
            axe.chmod(0o755)
            framework.write_bytes(b"current-framework")

            def runner(command, **_kwargs):
                if command[-1] == "--version":
                    return mock.Mock(returncode=0, stdout="1.8.0\n", stderr="")
                self.assertEqual(command[-2:], ["drag", "--help"])
                return mock.Mock(
                    returncode=0,
                    stdout="Perform a low-level point-to-point drag using explicit touch move events.\n",
                    stderr="",
                )

            identity = MODULE.inspect_driver(package, command_runner=runner)

        self.assertEqual(identity["kind"], "swiftui-simulator-driver-identity")
        self.assertEqual(identity["xcodeBuildMcpVersion"], "2.7.0")
        self.assertEqual(identity["axeVersion"], "1.8.0")
        self.assertEqual(identity["axeSha256"], hashlib.sha256(b"current-axe").hexdigest())
        self.assertEqual(
            identity["frameworkSha256"],
            hashlib.sha256(b"current-framework").hexdigest(),
        )
        self.assertTrue(identity["supportsCompositeDrag"])

    @mock.patch.object(MODULE, "locate_driver_package")
    @mock.patch.object(MODULE, "inspect_driver")
    def test_driver_receipt_binds_identity_to_the_active_lease(
            self, inspect_driver, locate_driver_package):
        inspect_driver.return_value = {
            "schemaVersion": 1,
            "kind": "swiftui-simulator-driver-identity",
            "xcodeBuildMcpVersion": "2.7.0",
            "axeVersion": "1.8.0",
            "axeSha256": "a" * 64,
            "frameworkSha256": "b" * 64,
            "supportsCompositeDrag": True,
        }
        locate_driver_package.return_value = Path("/tmp/package")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "lease.json"
            output = Path(directory) / "driver.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            payload = MODULE.write_driver_receipt(receipt, output, root)

        self.assertEqual(payload["kind"], "swiftui-simulator-driver-receipt")
        self.assertEqual(payload["laneId"], "lane-a")
        self.assertEqual(payload["simulatorUdid"], UDID_A)
        self.assertEqual(payload["axeSha256"], "a" * 64)
        self.assertRegex(payload["leaseSha256"], r"^[0-9a-f]{64}$")
        self.assertNotIn("token", payload)

    def test_ensure_pool_reuses_matching_device_and_creates_missing_slots(self):
        created = []

        def runner(command, **_kwargs):
            created.append(command)
            return mock.Mock(returncode=0, stdout=UDID_C + "\n", stderr="")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.json"
            existing = {UDID_A: dict(pool_catalog()[UDID_A])}
            result = MODULE.ensure_pool(
                DEVICE_TYPE, RUNTIME, count=2, name_prefix="Proof Lane",
                path=path, catalog=existing, runner=runner,
            )
            self.assertEqual([member["udid"] for member in result["members"]],
                             [UDID_A, UDID_C])
            self.assertEqual(created, [[
                "xcrun", "simctl", "create", "Proof Lane 2", DEVICE_TYPE, RUNTIME
            ]])
            self.assertEqual(MODULE.load_pool(path)["desiredCount"], 2)

    def test_ensure_pool_is_idempotent_for_matching_members(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.json"
            write_pool(path)
            runner = mock.Mock()
            result = MODULE.ensure_pool(
                DEVICE_TYPE, RUNTIME, count=2, name_prefix="Proof Lane",
                path=path, catalog=pool_catalog(), runner=runner,
            )
            self.assertEqual(len(result["members"]), 2)
            runner.assert_not_called()

    def test_ensure_pool_refuses_to_reconfigure_or_shrink_existing_pool(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.json"
            write_pool(path)
            with self.assertRaisesRegex(RuntimeError, "configuration differs"):
                MODULE.ensure_pool(
                    DEVICE_TYPE, "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
                    count=2, name_prefix="Proof Lane", path=path,
                    catalog=pool_catalog(),
                )
            with self.assertRaisesRegex(RuntimeError, "cannot be shrunk"):
                MODULE.ensure_pool(
                    DEVICE_TYPE, RUNTIME, count=1, name_prefix="Proof Lane",
                    path=path, catalog=pool_catalog(),
                )

    def test_ensure_pool_refuses_to_replace_a_leased_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            path = Path(directory) / "pool.json"
            write_pool(path)
            MODULE.acquire_lease(
                "lane-a", UDID_A, Path(directory) / "a.json", pool_catalog(), root
            )
            replacement = dict(pool_catalog())
            replacement.pop(UDID_A)
            replacement[UDID_C] = {
                "udid": UDID_C, "name": "Proof Lane 1", "state": "Shutdown",
                "runtime": RUNTIME, "deviceTypeIdentifier": DEVICE_TYPE,
                "isAvailable": True,
            }
            with self.assertRaisesRegex(RuntimeError, "leased by lane lane-a"):
                MODULE.ensure_pool(
                    DEVICE_TYPE, RUNTIME, count=2, name_prefix="Proof Lane",
                    path=path, catalog=replacement, root=root,
                )

    def test_load_pool_reports_missing_and_malformed_members(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pool.json"
            with self.assertRaisesRegex(ValueError, "run ensure-pool"):
                MODULE.load_pool(path)
            MODULE.atomic_json(path, {
                "schemaVersion": 1, "kind": "swiftui-simulator-pool",
                "deviceTypeIdentifier": DEVICE_TYPE, "runtimeIdentifier": RUNTIME,
                "members": ["not-an-object"],
            })
            with self.assertRaisesRegex(ValueError, "invalid members"):
                MODULE.load_pool(path)

    def test_concurrent_acquire_next_uses_distinct_pool_members(self):
        barrier = threading.Barrier(2)
        leases = []
        errors = []

        def acquire(lane_id, receipt):
            try:
                barrier.wait(5)
                leases.append(MODULE.acquire_pool_lease(
                    lane_id, receipt, pool, pool_catalog(), root
                ))
            except Exception as error:
                errors.append(error)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            pool = Path(directory) / "pool.json"
            write_pool(pool)
            first = threading.Thread(
                target=acquire, args=("lane-a", Path(directory) / "a.json")
            )
            second = threading.Thread(
                target=acquire, args=("lane-b", Path(directory) / "b.json")
            )
            first.start()
            second.start()
            first.join(2)
            second.join(2)
            self.assertFalse(first.is_alive())
            self.assertFalse(second.is_alive())
            self.assertEqual(errors, [])
            self.assertEqual(
                {lease["simulator"]["udid"] for lease in leases}, {UDID_A, UDID_B}
            )

    def test_acquire_next_skips_a_leased_pool_member(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            pool = Path(directory) / "pool.json"
            write_pool(pool)
            MODULE.acquire_lease(
                "lane-a", UDID_A, Path(directory) / "a.json", pool_catalog(), root
            )
            receipt = Path(directory) / "b.json"
            lease = MODULE.acquire_pool_lease(
                "lane-b", receipt, pool, pool_catalog(), root
            )
            self.assertEqual(lease["simulator"]["udid"], UDID_B)
            self.assertEqual(MODULE.verify_lease(receipt, root)["laneId"], "lane-b")

    def test_acquire_next_reports_when_all_pool_members_are_leased(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            pool = Path(directory) / "pool.json"
            write_pool(pool)
            MODULE.acquire_lease(
                "lane-a", UDID_A, Path(directory) / "a.json", pool_catalog(), root
            )
            MODULE.acquire_lease(
                "lane-b", UDID_B, Path(directory) / "b.json", pool_catalog(), root
            )
            with self.assertRaisesRegex(RuntimeError, "leased slots 1, 2"):
                MODULE.acquire_pool_lease(
                    "lane-c", Path(directory) / "c.json", pool, pool_catalog(), root
                )

    def test_pool_status_reports_exact_lease_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            pool = Path(directory) / "pool.json"
            write_pool(pool)
            MODULE.acquire_lease(
                "lane-a", UDID_A, Path(directory) / "a.json", pool_catalog(), root
            )
            status = MODULE.inspect_pool(pool, pool_catalog(), root)
            self.assertEqual(status["members"][0]["laneId"], "lane-a")
            self.assertFalse(status["members"][1]["leased"])

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

    @mock.patch.object(MODULE, "locate_axe", return_value=Path("/tmp/axe"))
    @mock.patch.object(MODULE.subprocess, "run")
    def test_axe_action_injects_exact_udid(self, run, _locate_axe):
        run.return_value.returncode = 0
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "leases"
            receipt = Path(directory) / "receipt.json"
            MODULE.acquire_lease("lane-a", UDID_A, receipt, catalog(), root)
            status = MODULE.run_axe(
                receipt, ["tap", "--label", "Accessibility"], root
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
