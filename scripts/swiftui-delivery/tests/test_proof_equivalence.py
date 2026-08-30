import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "proof_equivalence.py"
SPEC = importlib.util.spec_from_file_location("proof_equivalence", MODULE_PATH)
equivalence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(equivalence)


class ProofEquivalenceTests(unittest.TestCase):
    def test_normalization_ignores_context_but_preserves_changed_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            subprocess.run(["git", "init", "-q", repository], check=True)
            subprocess.run(["git", "-C", repository, "config", "user.email", "test@example.com"], check=True)
            subprocess.run(["git", "-C", repository, "config", "user.name", "Test"], check=True)
            source = repository / "value.txt"
            source.write_text("context\nold\n")
            subprocess.run(["git", "-C", repository, "add", "value.txt"], check=True)
            subprocess.run(["git", "-C", repository, "commit", "-qm", "base"], check=True)
            base = subprocess.check_output(["git", "-C", repository, "rev-parse", "HEAD"], text=True).strip()
            source.write_text("context\nnew\n")
            subprocess.run(["git", "-C", repository, "commit", "-qam", "head"], check=True)
            head = subprocess.check_output(["git", "-C", repository, "rev-parse", "HEAD"], text=True).strip()

            patch = equivalence.normalized_product_patch(repository, base, head, ["value.txt"])
            self.assertEqual(patch, b"-old\n+new\n")


if __name__ == "__main__":
    unittest.main()
