import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "swiftui_issue_evidence", ROOT / "issue_evidence.py"
)
issue_evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(issue_evidence)


class IssueEvidenceTests(unittest.TestCase):
    def proof(self):
        return {
            "baseCommit": "a" * 40,
            "headCommit": "b" * 40,
            "captures": [
                {
                    "id": "before-light",
                    "phase": "before",
                    "kind": "image",
                    "appearance": "light",
                },
                {
                    "id": "before-video",
                    "phase": "before",
                    "kind": "video",
                    "appearance": "not-applicable",
                },
                {
                    "id": "after-dark",
                    "phase": "after",
                    "kind": "image",
                    "appearance": "dark",
                },
            ],
        }

    def test_builds_full_size_phase_sections_and_playable_video(self):
        section = issue_evidence.build_evidence_section(
            self.proof(),
            "c" * 64,
            {
                "before-light": "https://github.com/user-attachments/assets/1",
                "before-video": "https://github.com/user-attachments/assets/2",
                "after-dark": "https://github.com/user-attachments/assets/3",
            },
            "https://github.com/user-attachments/assets/4",
        )
        self.assertIn("### Before", section)
        self.assertIn("### After", section)
        self.assertIn(
            "![before-light](https://github.com/user-attachments/assets/1)", section
        )
        self.assertIn(
            "\nhttps://github.com/user-attachments/assets/2\n", section
        )
        self.assertIn(
            "![animated-comparison](https://github.com/user-attachments/assets/4)",
            section,
        )
        self.assertNotIn("| Before | After |", section)

    def test_replaces_only_the_managed_section_and_preserves_work_item_bytes(self):
        fence = "```swiftui-work-item-v2\n{\"issue\":144}\n```"
        old = (
            "Problem\n\n"
            + fence
            + "\n\n<!-- swiftui-validated-evidence:start proof-sha256=old -->"
            + "\nold\n<!-- swiftui-validated-evidence:end -->\n\nHuman note"
        )
        new_section = (
            "<!-- swiftui-validated-evidence:start proof-sha256=new -->"
            "\nnew\n<!-- swiftui-validated-evidence:end -->"
        )
        updated = issue_evidence.replace_evidence_section(old, new_section)
        self.assertEqual(issue_evidence.work_item_blocks(updated), [fence])
        self.assertIn("Human note", updated)
        self.assertNotIn("\nold\n", updated)

    def test_rejects_incomplete_managed_markers(self):
        with self.assertRaises(issue_evidence.PublishError):
            issue_evidence.replace_evidence_section(
                "<!-- swiftui-validated-evidence:start proof-sha256=x -->", "new"
            )

    def test_parses_exact_issue_reference(self):
        self.assertEqual(
            issue_evidence.parse_issue_ref("saphid/t3code-personal#144"),
            ("saphid", "t3code-personal", 144),
        )
        with self.assertRaises(issue_evidence.PublishError):
            issue_evidence.parse_issue_ref("#144")

    def test_reuse_receipt_is_content_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset = root / "proof.png"
            asset.write_bytes(b"current")
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({
                "kind": "swiftui-issue-evidence-publication-receipt",
                "assets": [{
                    "path": str(asset),
                    "sha256": issue_evidence.sha256_file(asset),
                    "url": "https://github.com/user-attachments/assets/valid",
                }],
            }))
            self.assertEqual(
                issue_evidence.reuse_from_receipt(str(receipt))[str(asset.resolve())],
                "https://github.com/user-attachments/assets/valid",
            )
            asset.write_bytes(b"changed")
            with self.assertRaises(issue_evidence.PublishError):
                issue_evidence.reuse_from_receipt(str(receipt))

    def test_receipts_are_write_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            issue_evidence.atomic_write_json(path, {"kind": "first"})
            with self.assertRaises(issue_evidence.PublishError):
                issue_evidence.atomic_write_json(path, {"kind": "second"})


if __name__ == "__main__":
    unittest.main()
