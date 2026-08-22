import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("swiftui_package_audit", ROOT / "audit_package.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


class PackageAuditTests(unittest.TestCase):
    def test_package_has_no_checkout_specific_source_or_retired_runtime(self):
        errors, scanned = audit.audit()
        self.assertGreater(len(scanned), 10)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
