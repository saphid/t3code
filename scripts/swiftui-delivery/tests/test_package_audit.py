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

    def test_ios_debugger_skill_matches_the_delivery_driver_contract(self):
        contract = __import__("json").loads((ROOT / "contract.json").read_text())
        skill = (ROOT.parents[1] / ".agents" / "skills" /
                 "ios-debugger-agent" / "SKILL.md").read_text()
        version = contract["xcodeBuildMcpVersion"]
        self.assertEqual(contract["axeVersion"], "1.8.0")
        self.assertEqual(
            contract["simulatorDriverReceiptKind"],
            "swiftui-simulator-driver-receipt",
        )
        self.assertIn("xcodebuildmcp@" + version, skill)
        self.assertNotIn("xcodebuildmcp@2.6.2", skill)
        self.assertIn("simulator-lane axe", skill)
        feature_skill = (ROOT.parents[1] / ".agents" / "skills" /
                         "swiftui-feature-work" / "SKILL.md").read_text()
        self.assertIn("driver-receipt", feature_skill)
        self.assertIn("accessibility `Move up`", feature_skill)


if __name__ == "__main__":
    unittest.main()
