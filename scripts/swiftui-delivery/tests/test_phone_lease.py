import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("swiftui_phone_lease", ROOT / "phone_lease.py")
lease = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lease)


class PhoneLeaseTests(unittest.TestCase):
    def test_only_owner_token_can_release(self):
        with tempfile.TemporaryDirectory() as directory:
            lease_dir = Path(directory) / "phone.lock"
            acquired = lease.acquire(
                lease_dir, "operation-1", "Alex", "publish-test", "a" * 64)
            self.assertTrue(acquired["ok"])
            refused = lease.release(lease_dir, "wrong-token")
            self.assertFalse(refused["ok"])
            self.assertTrue(lease_dir.exists())
            released = lease.release(lease_dir, acquired["releaseToken"])
            self.assertTrue(released["ok"])
            self.assertFalse(lease_dir.exists())

    def test_second_operation_cannot_break_live_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            lease_dir = Path(directory) / "phone.lock"
            first = lease.acquire(
                lease_dir, "operation-1", "Alex", "publish-test", "a" * 64)
            second = lease.acquire(
                lease_dir, "operation-2", "Alex", "publish-dev", "b" * 64)
            self.assertTrue(first["ok"])
            self.assertFalse(second["ok"])
            self.assertEqual(second["owner"]["operationId"], "operation-1")


if __name__ == "__main__":
    unittest.main()
