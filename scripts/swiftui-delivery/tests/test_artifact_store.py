import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("swiftui_build_store", ROOT / "artifact_store.py")
store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(store)


class ArtifactStoreTests(unittest.TestCase):
    def test_preserve_and_verify_reusable_app(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "T3Code.app"
            app.mkdir()
            (app / "T3Code").write_bytes(b"binary")
            receipt_path, receipt, status = store.preserve(
                app, root / "store", "a" * 40, "Debug", "iphonesimulator")
            self.assertEqual(status, "preserved")
            self.assertEqual(store.verify(receipt_path)["treeSha256"], receipt["treeSha256"])
            second_path, _, second_status = store.preserve(
                app, root / "store", "a" * 40, "Debug", "iphonesimulator")
            self.assertEqual(second_path, receipt_path)
            self.assertEqual(second_status, "already-preserved")

    def test_tampered_build_cannot_be_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "T3Code.app"
            app.mkdir()
            (app / "T3Code").write_bytes(b"binary")
            receipt_path, receipt, _ = store.preserve(
                app, root / "store", "a" * 40, "Debug", "iphonesimulator")
            (Path(receipt["storedPath"]) / "T3Code").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "no longer match"):
                store.verify(receipt_path)

    def test_identical_bytes_from_different_commits_get_distinct_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "T3Code.app"
            app.mkdir()
            (app / "T3Code").write_bytes(b"binary")
            first_path, first, first_status = store.preserve(
                app, root / "store", "a" * 40, "Debug", "iphonesimulator")
            second_path, second, second_status = store.preserve(
                app, root / "store", "b" * 40, "Debug", "iphonesimulator")
            self.assertEqual(first_status, "preserved")
            self.assertEqual(second_status, "preserved")
            self.assertNotEqual(first_path, second_path)
            self.assertEqual(first["storedPath"], second["storedPath"])
            self.assertEqual(first["commit"], "a" * 40)
            self.assertEqual(second["commit"], "b" * 40)
            store.verify(first_path)
            store.verify(second_path)


if __name__ == "__main__":
    unittest.main()
