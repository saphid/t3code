#!/usr/bin/env python3

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import assemble_review_proof as assembler


HEAD = "a" * 40
FEATURE_COMMIT = "b" * 40


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, sort_keys=True) + "\n")


def seal(value: dict) -> dict:
    value["seal"] = {
        "algorithm": "sha256",
        "canonicalPayloadSha256": assembler.canonical_seal(value),
    }
    return value


class AssembleReviewProofTests(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[dict, dict, Path, Path]:
        clean = root / "clean.mp4"
        annotated = root / "annotated.mp4"
        clean.write_bytes(b"clean")
        annotated.write_bytes(b"annotated")
        packet_receipt = root / "packet.json"
        write_json(
            packet_receipt,
            {
                "version": 1,
                "events": [{"kind": "tap", "caption": "The result is visible"}],
                "artifacts": {
                    "clean_video": {
                        "path": str(clean),
                        "sha256": assembler.sha256(clean),
                    },
                    "annotated_video": {
                        "path": str(annotated),
                        "sha256": assembler.sha256(annotated),
                    },
                },
            },
        )
        build_receipt = root / "build.json"
        write_json(
            build_receipt,
            {
                "schemaVersion": 1,
                "pipeline": "swiftui-private-ci",
                "stage": "test-train",
                "runId": "final-head-test-train",
                "status": "passed",
                "exitStatus": 0,
                "dryRun": False,
                "startedAt": "2026-08-15T00:59:59Z",
                "finishedAt": "2026-08-15T01:00:04Z",
                "repository": {"commit": HEAD, "dirty": False},
            },
        )
        build_reference = assembler.reference(build_receipt)
        validation = root / "validation.json"
        write_json(
            validation,
            seal(
                {
                    "version": 1,
                    "kind": "proof-packet-validation",
                    "verdict": "passed",
                    "packet_receipt": assembler.reference(packet_receipt),
                    "proofBinding": {
                        "featureId": "review-item",
                        "sourceCommit": HEAD,
                        "buildId": "final-head-test-train",
                        "buildReceipt": build_reference,
                    },
                }
            ),
        )
        manifest = {
            "currentTestBuild": {"build": 59},
            "features": [
                {
                    "id": "review-item",
                    "name": "Review item",
                    "state": "in-test",
                    "sourceCommit": FEATURE_COMMIT,
                    "testBuild": 59,
                    "order": 1,
                    "behavior": "The result is visible.",
                    "delivery": "direct",
                    "dependsOn": [],
                    "acceptancePoints": [
                        {"id": "result-visible", "text": "The result is visible."}
                    ],
                    "proofPending": True,
                }
            ],
        }
        assignments = {
            "schemaVersion": 1,
            "reviewItems": [
                {
                    "id": "review-item",
                    "packets": [
                        {
                            "id": "result-flow",
                            "validationPath": str(validation),
                            "acceptancePointIds": ["result-visible"],
                        }
                    ],
                }
            ],
        }
        return manifest, assignments, build_receipt, validation

    def test_assembles_schema_two_proof_without_mutating_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest, assignments, build_receipt, _ = self.fixture(Path(temporary))
            original = json.loads(json.dumps(manifest))

            result = assembler.assemble(manifest, assignments, build_receipt, HEAD)

            self.assertEqual(manifest, original)
            feature = result["features"][0]
            self.assertNotIn("proofPending", feature)
            self.assertEqual(feature["proof"]["schemaVersion"], 2)
            self.assertEqual(feature["proof"]["featureCommit"], FEATURE_COMMIT)
            self.assertEqual(feature["proof"]["sourceCommit"], HEAD)
            self.assertEqual(
                feature["proof"]["packets"][0]["acceptancePointIds"],
                ["result-visible"],
            )

    def test_rejects_unbound_or_old_packet_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest, assignments, build_receipt, validation = self.fixture(
                Path(temporary)
            )
            value = json.loads(validation.read_text())
            value.pop("proofBinding")
            value.pop("seal")
            write_json(validation, seal(value))

            with self.assertRaisesRegex(assembler.AssemblyError, "proofBinding"):
                assembler.assemble(manifest, assignments, build_receipt, HEAD)

    def test_rejects_build_receipt_from_another_head(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest, assignments, build_receipt, _ = self.fixture(Path(temporary))

            with self.assertRaisesRegex(assembler.AssemblyError, "expected HEAD"):
                assembler.assemble(manifest, assignments, build_receipt, "c" * 40)

    def test_plan_maps_every_catalog_acceptance_point_once(self) -> None:
        manifest = json.loads((Path(__file__).parent / "stream.json").read_text())
        value = assembler.plan_value(manifest, HEAD)
        pending = assembler.pending_features(manifest)

        self.assertEqual(len(value["reviewItems"]), 16)
        self.assertEqual(
            {item["id"] for item in value["reviewItems"]},
            {item["id"] for item in pending},
        )
        for item in value["reviewItems"]:
            feature = next(value for value in pending if value["id"] == item["id"])
            self.assertEqual(
                item["acceptancePointIds"],
                [point["id"] for point in feature["acceptancePoints"]],
            )


if __name__ == "__main__":
    unittest.main()
