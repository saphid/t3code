#!/usr/bin/env python3
"""Build a review-ready catalog candidate from immutable proof receipts.

This tool never edits stream.json and never allocates a build number. It writes
only the explicit --output path after every Review Item and receipt is valid.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import stream


SHA40 = re.compile(r"[0-9a-f]{40}")
SHA256 = re.compile(r"[0-9a-f]{64}")


class AssemblyError(ValueError):
    pass


def read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.expanduser().read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise AssemblyError(f"cannot read {label} {path}: {error}") from error
    if not isinstance(value, dict):
        raise AssemblyError(f"{label} must contain a JSON object")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reference(path: Path) -> dict[str, str]:
    path = path.expanduser()
    if path.is_symlink() or not path.is_file():
        raise AssemblyError(f"proof input is missing or symbolic: {path}")
    path = path.resolve()
    return {"path": str(path), "sha256": sha256(path)}


def pending_features(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        feature
        for feature in manifest.get("features", [])
        if feature.get("state") in stream.APPROVAL_STATES
    ]


def plan_value(manifest: dict[str, Any], expected_head: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "expectedHead": expected_head,
        "requiredBuildReceiptFields": [
            "schemaVersion=1",
            "pipeline=swiftui-private-ci",
            "stage=candidate-simulator|test-train",
            "status=passed",
            "exitStatus=0",
            "dryRun=false",
            "repository.commit=expectedHead",
            "repository.dirty=false",
            "startedAt",
            "finishedAt",
            "runId",
        ],
        "reviewItems": [
            {
                "id": feature["id"],
                "featureCommit": feature["sourceCommit"],
                "packetId": f"{feature['id']}-flow",
                "acceptancePointIds": [
                    point["id"] for point in feature.get("acceptancePoints", [])
                ],
                "requiredPacketValidationFields": [
                    f"proofBinding.featureId={feature['id']}",
                    "proofBinding.sourceCommit=expectedHead",
                    "proofBinding.buildId=build receipt runId",
                    "proofBinding.buildReceipt.path",
                    "proofBinding.buildReceipt.sha256",
                    "packet_receipt.path",
                    "packet_receipt.sha256",
                    "verdict=passed",
                    "valid seal",
                ],
            }
            for feature in pending_features(manifest)
        ],
    }


def validate_build_receipt(
    path: Path, expected_head: str
) -> tuple[dict[str, Any], dict[str, str]]:
    value = read_object(path, "build receipt")
    repository = value.get("repository")
    errors: list[str] = []
    if value.get("schemaVersion") != 1:
        errors.append("schemaVersion is not 1")
    if value.get("pipeline") != "swiftui-private-ci":
        errors.append("pipeline is not swiftui-private-ci")
    if value.get("stage") not in {"candidate-simulator", "test-train"}:
        errors.append("stage is not a proof-build stage")
    if value.get("status") != "passed" or value.get("exitStatus") != 0:
        errors.append("build did not pass")
    if value.get("dryRun") is not False:
        errors.append("receipt is a dry run")
    if not isinstance(value.get("runId"), str) or not value["runId"]:
        errors.append("runId is missing")
    for timestamp in ("startedAt", "finishedAt"):
        if not isinstance(value.get(timestamp), str) or not value[timestamp]:
            errors.append(f"{timestamp} is missing")
    if not isinstance(repository, dict):
        errors.append("repository is missing")
    else:
        if repository.get("commit") != expected_head:
            errors.append("repository.commit does not match expected HEAD")
        if repository.get("dirty") is not False:
            errors.append("repository was dirty")
    if errors:
        raise AssemblyError("invalid build receipt: " + "; ".join(errors))
    return value, reference(path)


def canonical_seal(value: dict[str, Any]) -> str:
    unsigned = {key: item for key, item in value.items() if key != "seal"}
    payload = json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def validate_packet_validation(
    path: Path,
    *,
    feature_id: str,
    expected_head: str,
    build_id: str,
    build_reference: dict[str, str],
) -> tuple[dict[str, Any], dict[str, str]]:
    value = read_object(path, f"packet validation for {feature_id}")
    seal = value.get("seal")
    binding = value.get("proofBinding")
    packet_reference = value.get("packet_receipt")
    errors: list[str] = []
    if (
        value.get("version") != 1
        or value.get("kind") != "proof-packet-validation"
        or value.get("verdict") != "passed"
    ):
        errors.append("validation is not a passed version 1 packet validation")
    if (
        not isinstance(seal, dict)
        or seal.get("algorithm") != "sha256"
        or seal.get("canonicalPayloadSha256") != canonical_seal(value)
    ):
        errors.append("validation seal is invalid")
    expected_binding = {
        "featureId": feature_id,
        "sourceCommit": expected_head,
        "buildId": build_id,
        "buildReceipt": build_reference,
    }
    if binding != expected_binding:
        errors.append("proofBinding does not match the Review Item and final build")
    if not isinstance(packet_reference, dict):
        errors.append("packet_receipt binding is missing")
    else:
        receipt_path_value = packet_reference.get("path")
        receipt_digest = packet_reference.get("sha256")
        if not isinstance(receipt_path_value, str) or not Path(
            receipt_path_value
        ).is_absolute():
            errors.append("packet_receipt.path is not absolute")
        elif not SHA256.fullmatch(str(receipt_digest or "")):
            errors.append("packet_receipt.sha256 is invalid")
        else:
            try:
                actual = reference(Path(receipt_path_value))
            except AssemblyError as error:
                errors.append(str(error))
            else:
                if actual != packet_reference:
                    errors.append("packet_receipt binding does not match its file")
    if errors:
        raise AssemblyError(
            f"invalid packet validation for {feature_id}: " + "; ".join(errors)
        )
    return value, reference(path)


def assemble(
    manifest: dict[str, Any],
    assignments: dict[str, Any],
    build_receipt_path: Path,
    expected_head: str,
) -> dict[str, Any]:
    if not SHA40.fullmatch(expected_head):
        raise AssemblyError("expected HEAD must be a full lowercase commit SHA")
    build_receipt, build_reference = validate_build_receipt(
        build_receipt_path, expected_head
    )
    build_id = build_receipt["runId"]
    assignment_items = assignments.get("reviewItems")
    if assignments.get("schemaVersion") != 1 or not isinstance(
        assignment_items, list
    ):
        raise AssemblyError("assignments must be a version 1 reviewItems document")
    by_id: dict[str, dict[str, Any]] = {}
    for assignment in assignment_items:
        if not isinstance(assignment, dict) or not isinstance(
            assignment.get("id"), str
        ):
            raise AssemblyError("every assignment must have an id")
        if assignment["id"] in by_id:
            raise AssemblyError(f"duplicate assignment: {assignment['id']}")
        by_id[assignment["id"]] = assignment

    result = copy.deepcopy(manifest)
    pending = pending_features(result)
    expected_ids = {feature["id"] for feature in pending}
    if set(by_id) != expected_ids:
        missing = sorted(expected_ids - set(by_id))
        extra = sorted(set(by_id) - expected_ids)
        raise AssemblyError(
            f"assignment inventory mismatch; missing={missing}; extra={extra}"
        )

    for feature in pending:
        feature_id = feature["id"]
        acceptance_ids = {
            point["id"] for point in feature.get("acceptancePoints", [])
        }
        packets = by_id[feature_id].get("packets")
        if not isinstance(packets, list) or not packets:
            raise AssemblyError(f"{feature_id} has no packet assignments")
        assembled_packets: list[dict[str, Any]] = []
        covered: set[str] = set()
        for packet in packets:
            if not isinstance(packet, dict):
                raise AssemblyError(f"{feature_id} packet assignment is not an object")
            packet_id = packet.get("id")
            point_ids = packet.get("acceptancePointIds")
            validation_path_value = packet.get("validationPath")
            if not isinstance(packet_id, str) or not packet_id:
                raise AssemblyError(f"{feature_id} packet id is missing")
            if not isinstance(point_ids, list) or not point_ids or any(
                not isinstance(point_id, str) or not point_id for point_id in point_ids
            ):
                raise AssemblyError(
                    f"{feature_id}/{packet_id} acceptancePointIds are invalid"
                )
            unknown = set(point_ids) - acceptance_ids
            if unknown:
                raise AssemblyError(
                    f"{feature_id}/{packet_id} names unknown acceptance points: {sorted(unknown)}"
                )
            if not isinstance(validation_path_value, str):
                raise AssemblyError(
                    f"{feature_id}/{packet_id} validationPath is missing"
                )
            validation, validation_reference = validate_packet_validation(
                Path(validation_path_value),
                feature_id=feature_id,
                expected_head=expected_head,
                build_id=build_id,
                build_reference=build_reference,
            )
            packet_reference = validation["packet_receipt"]
            assembled_packets.append(
                {
                    "id": packet_id,
                    "receiptPath": packet_reference["path"],
                    "receiptSha256": packet_reference["sha256"],
                    "validationPath": validation_reference["path"],
                    "validationSha256": validation_reference["sha256"],
                    "acceptancePointIds": point_ids,
                }
            )
            covered.update(point_ids)
        if covered != acceptance_ids:
            raise AssemblyError(
                f"{feature_id} acceptance coverage mismatch; "
                f"missing={sorted(acceptance_ids - covered)}"
            )
        feature.pop("proofPending", None)
        feature["proof"] = {
            "schemaVersion": 2,
            "featureCommit": feature["sourceCommit"],
            "sourceCommit": expected_head,
            "buildId": build_id,
            "buildReceipt": build_reference,
            "packets": assembled_packets,
        }

    errors = stream.catalog_review_readiness_errors(
        result, verify_files=True, verify_commits=False
    )
    if errors:
        raise AssemblyError(
            "assembled catalog is not review-ready: " + "; ".join(errors)
        )
    return result


def write_json(path: Path, value: dict[str, Any]) -> None:
    if path.exists() and path.is_symlink():
        raise AssemblyError(f"output must not be a symbolic link: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan")
    plan.add_argument("--manifest", required=True, type=Path)
    plan.add_argument("--expected-head", required=True)
    plan.add_argument("--output", required=True, type=Path)
    assemble_parser = commands.add_parser("assemble")
    assemble_parser.add_argument("--manifest", required=True, type=Path)
    assemble_parser.add_argument("--assignments", required=True, type=Path)
    assemble_parser.add_argument("--build-receipt", required=True, type=Path)
    assemble_parser.add_argument("--expected-head", required=True)
    assemble_parser.add_argument("--output", required=True, type=Path)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        protected_inputs = {args.manifest.expanduser().resolve()}
        if args.command == "assemble":
            protected_inputs.update(
                {
                    args.assignments.expanduser().resolve(),
                    args.build_receipt.expanduser().resolve(),
                }
            )
        if args.output.expanduser().resolve() in protected_inputs:
            raise AssemblyError("--output must not overwrite an input file")
        manifest = read_object(args.manifest, "manifest")
        actual_head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=stream.REPO_ROOT,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()
        if args.expected_head != actual_head:
            raise AssemblyError(
                f"expected HEAD {args.expected_head} does not match worktree HEAD {actual_head}"
            )
        if args.command == "plan":
            if not SHA40.fullmatch(args.expected_head):
                raise AssemblyError("expected HEAD must be a full lowercase commit SHA")
            value = plan_value(manifest, args.expected_head)
        else:
            assignments = read_object(args.assignments, "assignments")
            value = assemble(
                manifest, assignments, args.build_receipt, args.expected_head
            )
        write_json(args.output, value)
    except AssemblyError as error:
        print(f"[assemble-review-proof] error: {error}", file=sys.stderr)
        return 1
    print(str(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
