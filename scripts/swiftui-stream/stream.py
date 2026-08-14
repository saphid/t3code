#!/usr/bin/env python3
"""Deterministic control plane for the personal SwiftUI Dev/Test stream."""

from __future__ import annotations

import argparse
import copy
import difflib
import fcntl
import hashlib
import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
MANIFEST_PATH = SCRIPT_DIR / "stream.json"
STREAM_STATE_ROOT = Path.home() / ".t3/swiftui-stream"
DEVICE_RECEIPTS_ROOT = STREAM_STATE_ROOT / "device-receipts"
TEST_READY_POINTER = STREAM_STATE_ROOT / "ready/test.json"
TEST_CATALOG_LOCK = Path.home() / ".t3/locks/swiftui-test-catalog.lock"
APPROVAL_STATES = {"in-test", "needs-you"}
VALID_DELIVERY = {"direct", "chain", "blocked", "local-only"}
APPROVED_OR_LATER = {
    "approved", "in-dev", "upstream-validation", "needs-pr", "upstream-pr", "landed"
}
VERIFIED_INTEGRATED_COMMITS: set[tuple[str, str, str, str]] = set()
STREAM_MANIFEST_RELATIVE = "scripts/swiftui-stream/stream.json"


def pr_number(url: str | None) -> int | None:
    match = re.search(r"/pull/(\d+)$", url or "")
    return int(match.group(1)) if match else None


def delivery_for(url: str | None) -> tuple[str | None, list[int]]:
    number = pr_number(url)
    if number is None:
        return None, []
    value = load_json(REPO_ROOT / manifest_path_value("prDelivery"))
    record = next(
        (item for item in value.get("pullRequests", []) if item.get("number") == number),
        None,
    )
    if record is None:
        return None, []
    return record["delivery"], record.get("dependsOn", [])


def delivery_state_for(url: str | None) -> str | None:
    number = pr_number(url)
    if number is None:
        return None
    value = load_json(REPO_ROOT / manifest_path_value("prDelivery"))
    record = next(
        (item for item in value.get("pullRequests", []) if item.get("number") == number),
        None,
    )
    return record.get("state") if record else None


def fail(message: str) -> None:
    print(f"[swiftui-stream] error: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.expanduser().read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read {path}: {error}")


def configured_manifest_path() -> Path:
    return Path(os.environ.get("SWIFTUI_STREAM_MANIFEST", str(MANIFEST_PATH))).expanduser()


def configured_device_receipts_root() -> Path:
    state_root = os.environ.get("SWIFTUI_STREAM_STATE_DIR")
    return (
        Path(state_root).expanduser() / "device-receipts"
        if state_root
        else DEVICE_RECEIPTS_ROOT.expanduser()
    )


def configured_ready_pointer() -> Path:
    state_root = os.environ.get("SWIFTUI_STREAM_STATE_DIR")
    return (
        Path(state_root).expanduser() / "ready/test.json"
        if state_root
        else TEST_READY_POINTER.expanduser()
    )


def manifest_path_value(key: str) -> str:
    value = load_json(configured_manifest_path())
    path = value.get(key)
    if not isinstance(path, str) or not path:
        fail(f"stream.json is missing {key}")
    return path


def manifest(verify_evidence: bool = False) -> dict[str, Any]:
    value = load_json(configured_manifest_path())
    validate_manifest(
        value,
        verify_repository=True,
        verify_evidence=verify_evidence,
    )
    return value


def validate_manifest(
    value: dict[str, Any],
    verify_repository: bool = False,
    verify_evidence: bool = False,
) -> None:
    if value.get("schemaVersion") != 1:
        fail("stream.json schemaVersion must be 1")
    states = value.get("lifecycle", [])
    if len(states) != len(set(states)) or not states:
        fail("lifecycle states must be non-empty and unique")
    current = value.get("currentTestBuild", {})
    if not isinstance(current, dict):
        fail("currentTestBuild must be an object")
    current_build = current.get("build")
    if type(current_build) is not int or current_build < 1:
        fail("currentTestBuild.build must be a positive integer")
    if type(current.get("sequence")) is not int or current["sequence"] < 1:
        fail("currentTestBuild.sequence must be a positive integer")
    for field in ("channel", "commit", "bundleId", "deviceId", "status", "receipt"):
        if not isinstance(current.get(field), str) or not current[field]:
            fail(f"currentTestBuild.{field} must be a non-empty string")
    if not isinstance(current.get("launchPending"), bool):
        fail("currentTestBuild.launchPending must be true or false")
    ids: set[str] = set()
    seen_media_proof: dict[str, tuple[str, str]] = {}
    for feature in value.get("features", []):
        feature_id = feature.get("id")
        if not feature_id or feature_id in ids:
            fail(f"feature id is missing or duplicated: {feature_id}")
        ids.add(feature_id)
        if not isinstance(feature.get("name"), str) or not feature["name"].strip():
            fail(f"{feature_id} has no name")
        if feature.get("state") not in states:
            fail(f"{feature_id} has invalid state {feature.get('state')}")
        if feature.get("state") in {"proved", *APPROVAL_STATES}:
            for key in (
                "problem",
                "summary",
                "whatToCheck",
                "successLooksLike",
                "validationSummary",
                "knownLimitations",
                "reviewGroup",
            ):
                if not isinstance(feature.get(key), str) or not feature[key].strip():
                    fail(f"{feature_id} is reviewable without {key}")
            steps = feature.get("reproductionSteps")
            if (
                not isinstance(steps, list)
                or not steps
                or any(not isinstance(step, str) or not step.strip() for step in steps)
            ):
                fail(f"{feature_id} is reviewable without valid reproductionSteps")
            priority = feature.get("reviewPriority")
            if not isinstance(priority, int) or isinstance(priority, bool) or priority < 1:
                fail(f"{feature_id} is reviewable without valid reviewPriority")
            source_issue = feature.get("sourceIssue")
            if not isinstance(source_issue, str) or not source_issue.strip():
                fail(f"{feature_id} is reviewable without sourceIssue")
            parsed_issue = urlparse(source_issue)
            if parsed_issue.scheme != "https" or not parsed_issue.netloc:
                fail(f"{feature_id} sourceIssue must use HTTPS")
        evidence = feature.get("visualEvidence")
        proof_pending = feature.get("proofPending") is True
        if proof_pending:
            if feature.get("state") != "in-test":
                fail(f"{feature_id} can only stage proofPending while in-test")
            if evidence is not None:
                fail(f"{feature_id} proofPending cannot carry stale visualEvidence")
            if feature.get("reviewMedia") is True:
                fail(f"{feature_id} proofPending cannot carry stale reviewMedia")
            for stale_field in ("proofMediaReceipt", "proofCommit"):
                if feature.get(stale_field) is not None:
                    fail(f"{feature_id} proofPending cannot carry stale {stale_field}")
        carries_review_media = bool(
            feature.get("visualChange")
            or feature.get("reviewMedia")
            or feature.get("state") == "needs-you"
        )
        if evidence is not None:
            if not carries_review_media:
                fail(f"{feature_id} has visualEvidence without a media scope")
            if not isinstance(evidence, list) or not evidence:
                fail(f"{feature_id} has invalid visualEvidence")
            kinds = set()
            for item in evidence:
                kind = item.get("kind") if isinstance(item, dict) else None
                if kind not in {"image", "video"}:
                    fail(f"{feature_id} has invalid visual evidence kind {kind}")
                kinds.add(kind)
                if item.get("appearance") != "dark":
                    fail(f"{feature_id} visual evidence must use dark appearance")
                for key in ("title", "caption", "cleanURL", "annotatedURL"):
                    field = item.get(key)
                    if not isinstance(field, str) or not field.strip():
                        fail(f"{feature_id} visual evidence is missing {key}")
                for key in ("cleanURL", "annotatedURL"):
                    url = item[key]
                    parsed = urlparse(url)
                    if parsed.scheme != "https" or not parsed.netloc:
                        fail(f"{feature_id} visual evidence {key} must use HTTPS")
        if feature.get("visualChange"):
            if (not isinstance(evidence, list) or not evidence) and not proof_pending:
                fail(f"{feature_id} is a visual change without visualEvidence")
            if evidence and "image" not in kinds:
                fail(f"{feature_id} visual change has no image evidence")
            if evidence and feature.get("interactionChange") and "video" not in kinds:
                fail(f"{feature_id} interaction change has no video evidence")
        if evidence is not None:
            receipt = feature.get("proofMediaReceipt")
            if not isinstance(receipt, str) or not receipt.strip():
                fail(f"{feature_id} visual evidence has no proofMediaReceipt")
            if verify_evidence:
                media_proof = validate_proof_media_receipt(
                    feature_id,
                    evidence,
                    receipt,
                    feature.get("proofCommit") or feature.get("candidateCommit"),
                    feature.get("testBuild"),
                )
                for clean_hash, annotated_hash in media_proof:
                    for variant, digest in (
                        ("clean", clean_hash),
                        ("annotated", annotated_hash),
                    ):
                        prior = seen_media_proof.get(digest)
                        if prior is not None:
                            prior_feature, prior_variant = prior
                            if prior_feature == feature_id:
                                fail(
                                    f"{feature_id} reuses {variant} media proof "
                                    f"from another {prior_variant} entry in the "
                                    "same feature"
                                )
                            fail(
                                f"{feature_id} reuses {variant} media proof "
                                f"from {prior_feature} ({prior_variant}); each "
                                "review item needs feature-specific media evidence"
                            )
                        seen_media_proof[digest] = (feature_id, variant)
        if feature.get("state") == "proved":
            source_branch = feature.get("sourceBranch")
            candidate = feature.get("candidateCommit")
            baseline = feature.get("startingBaseline")
            if not isinstance(source_branch, str) or not source_branch:
                fail(f"{feature_id} is proved without sourceBranch")
            if not isinstance(candidate, str) or not re.fullmatch(r"[0-9a-f]{40}", candidate):
                fail(f"{feature_id} is proved without a full candidateCommit")
            if not isinstance(baseline, str) or not re.fullmatch(r"[0-9a-f]{40}", baseline):
                fail(f"{feature_id} is proved without a full startingBaseline")
        if feature.get("state") in APPROVAL_STATES:
            test_build = feature.get("testBuild")
            integrated = feature.get("integratedCommit")
            if not isinstance(test_build, int) or isinstance(test_build, bool) or test_build < 1:
                fail(f"{feature_id} is in Test without a positive testBuild")
            state = feature.get("state")
            if state == "needs-you" and test_build != current_build:
                fail(
                    f"{feature_id} is reviewable in Test build {test_build}, "
                    f"not current build {current_build}"
                )
            if state == "in-test" and test_build < current_build:
                fail(
                    f"{feature_id} is staged for Test build {test_build}, "
                    f"behind current build {current_build}"
                )
            if not isinstance(integrated, str) or not re.fullmatch(r"[0-9a-f]{40}", integrated):
                fail(f"{feature_id} is in Test without a full integratedCommit")
            integrated_commits = feature.get("integratedCommits")
            if integrated_commits is not None:
                if (
                    not isinstance(integrated_commits, list)
                    or not integrated_commits
                    or any(
                        not isinstance(commit, str)
                        or not re.fullmatch(r"[0-9a-f]{40}", commit)
                        for commit in integrated_commits
                    )
                    or len(integrated_commits) != len(set(integrated_commits))
                    or integrated not in integrated_commits
                ):
                    fail(
                        f"{feature_id} integratedCommits must contain unique full SHAs "
                        "including integratedCommit"
                    )
            declared_commits = integrated_commits or [integrated]
            if verify_repository:
                for commit in declared_commits:
                    validate_integrated_commit(
                        feature_id,
                        commit,
                        value.get("branches", {}).get("test", "HEAD"),
                    )
            if state == "needs-you":
                if feature.get("reviewMedia") is not True:
                    fail(f"{feature_id} is reviewable without reviewMedia")
                if not isinstance(evidence, list) or not evidence:
                    fail(f"{feature_id} is reviewable without visualEvidence")
                evidence_kinds = {
                    item.get("kind") for item in evidence if isinstance(item, dict)
                }
                if not {"image", "video"} <= evidence_kinds:
                    fail(f"{feature_id} review evidence needs an image and video")
                proof_commit = feature.get("proofCommit")
                declared_commits = set(declared_commits)
                if (
                    not isinstance(proof_commit, str)
                    or not re.fullmatch(r"[0-9a-f]{40}", proof_commit)
                    or proof_commit not in declared_commits
                ):
                    fail(
                        f"{feature_id} proofCommit must name an integrated feature commit"
                    )
            if not feature.get("sourceThread"):
                fail(f"{feature_id} is in Test without a sourceThread")
        delivery = feature.get("delivery")
        if delivery is not None and delivery not in VALID_DELIVERY:
            fail(f"{feature_id} has invalid delivery {delivery}")
        if delivery == "chain" and not feature.get("dependsOn"):
            fail(f"{feature_id} is a chain PR without dependsOn")
        if feature.get("state") in APPROVED_OR_LATER and not any(
            feature.get(key)
            for key in ("approvedBy", "approvedAt", "approvedInThread", "approvalEvidence", "legacy")
        ):
            fail(f"{feature_id} reached {feature.get('state')} without human approval evidence")
        if feature.get("state") in APPROVED_OR_LATER and not feature.get("legacy"):
            receipt_path = feature.get("approvalReceipt")
            if not isinstance(receipt_path, str) or not receipt_path:
                fail(f"{feature_id} reached {feature.get('state')} without an approval receipt")
            receipt_file = Path(receipt_path).expanduser()
            receipt_root = Path(
                os.environ.get(
                    "SWIFTUI_STREAM_APPROVALS_DIR",
                    str(Path.home() / ".t3/swiftui-stream/approvals"),
                )
            ).expanduser()
            if receipt_root.exists():
                receipt = load_json(receipt_file)
                if receipt.get("featureId") != feature_id or not receipt.get("humanConfirmation"):
                    fail(f"{feature_id} approval receipt does not match confirmed human approval")


def validate_proof_media_receipt(
    feature_id: str,
    evidence: list[dict[str, Any]],
    receipt_path: str,
    candidate_commit: str | None = None,
    test_build: int | None = None,
) -> list[tuple[str, str]]:
    receipt_root = Path(
        os.environ.get(
            "SWIFTUI_STREAM_EVIDENCE_DIR",
            str(Path.home() / ".t3/artifacts/swiftui-stream/evidence"),
        )
    ).expanduser()
    if not receipt_root.is_dir():
        fail(f"{feature_id} durable evidence storage does not exist")
    receipt_file = Path(receipt_path).expanduser()
    try:
        receipt_file.resolve().relative_to(receipt_root.resolve())
    except ValueError:
        fail(f"{feature_id} proofMediaReceipt is outside durable evidence storage")
    if not receipt_file.is_file():
        fail(f"{feature_id} proofMediaReceipt does not exist")
    receipt = load_json(receipt_file)
    if receipt.get("featureId") != feature_id:
        fail(f"{feature_id} proofMediaReceipt names another feature")
    if candidate_commit is not None and receipt.get("candidateCommit") != candidate_commit:
        fail(f"{feature_id} proofMediaReceipt names another candidate")
    receipt_test_build = receipt.get("testBuild")
    if type(receipt_test_build) is not int or receipt_test_build < 1:
        fail(f"{feature_id} proofMediaReceipt has no valid testBuild")
    if test_build is not None and receipt_test_build != test_build:
        fail(f"{feature_id} proofMediaReceipt names another Test build")
    receipt_media = receipt.get("media")
    if not isinstance(receipt_media, list):
        fail(f"{feature_id} proofMediaReceipt has no media inventory")
    declared = {
        (item["kind"], item["appearance"], item["cleanURL"], item["annotatedURL"])
        for item in evidence
    }
    attested = set()
    media_proof: list[tuple[str, str]] = []
    for item in receipt_media:
        if not isinstance(item, dict):
            fail(f"{feature_id} proofMediaReceipt has invalid media")
        for prefix in ("clean", "annotated"):
            digest = item.get(f"{prefix}Sha256")
            size = item.get(f"{prefix}Bytes")
            artifact_path = item.get(f"{prefix}Path")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                fail(f"{feature_id} proofMediaReceipt has invalid {prefix}Sha256")
            if not isinstance(size, int) or size < 1:
                fail(f"{feature_id} proofMediaReceipt has invalid {prefix}Bytes")
            if not isinstance(artifact_path, str) or not artifact_path.strip():
                fail(f"{feature_id} proofMediaReceipt has no {prefix}Path")
            artifact_file = Path(artifact_path).expanduser()
            try:
                artifact_file.resolve().relative_to(receipt_root.resolve())
            except ValueError:
                fail(
                    f"{feature_id} proofMediaReceipt {prefix}Path is outside "
                    "durable evidence storage"
                )
            if artifact_file.is_symlink() or not artifact_file.is_file():
                fail(
                    f"{feature_id} proofMediaReceipt {prefix}Path is not a "
                    "regular evidence file"
                )
            actual_size = artifact_file.stat().st_size
            if actual_size != size:
                fail(
                    f"{feature_id} proofMediaReceipt {prefix}Bytes does not "
                    "match its file"
                )
            actual_digest = hashlib.sha256()
            with artifact_file.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    actual_digest.update(chunk)
            if actual_digest.hexdigest() != digest:
                fail(
                    f"{feature_id} proofMediaReceipt {prefix}Sha256 does not "
                    "match its file"
                )
        attested.add(
            (item.get("kind"), item.get("appearance"), item.get("cleanURL"), item.get("annotatedURL"))
        )
        if item["cleanSha256"] == item["annotatedSha256"]:
            fail(
                f"{feature_id} proofMediaReceipt {item.get('kind')} uses "
                "identical clean and annotated proof"
            )
        if item.get("kind") == "video":
            validate_packet_validation_receipt(feature_id, item, receipt_root)
        media_proof.append((item["cleanSha256"], item["annotatedSha256"]))
    if declared != attested:
        fail(f"{feature_id} visualEvidence does not match its proofMediaReceipt")
    return media_proof


def validate_packet_validation_receipt(
    feature_id: str, media: dict[str, Any], evidence_root: Path
) -> None:
    path_value = media.get("packetValidationPath")
    expected_digest = media.get("packetValidationSha256")
    if not isinstance(path_value, str) or not path_value.strip():
        fail(f"{feature_id} video proof has no packetValidationPath")
    if not isinstance(expected_digest, str) or not re.fullmatch(
        r"[0-9a-f]{64}", expected_digest
    ):
        fail(f"{feature_id} video proof has invalid packetValidationSha256")
    validation_path = Path(path_value).expanduser()
    try:
        validation_path.resolve().relative_to(evidence_root.resolve())
    except ValueError:
        fail(f"{feature_id} packetValidationPath is outside durable evidence storage")
    if validation_path.is_symlink() or not validation_path.is_file():
        fail(f"{feature_id} packetValidationPath is not a regular evidence file")
    actual_digest = hashlib.sha256(validation_path.read_bytes()).hexdigest()
    if actual_digest != expected_digest:
        fail(f"{feature_id} packetValidationSha256 does not match its file")
    validation = load_json(validation_path)
    if (
        not isinstance(validation, dict)
        or validation.get("version") != 1
        or validation.get("kind") != "proof-packet-validation"
        or validation.get("verdict") != "passed"
    ):
        fail(f"{feature_id} video proof has no passed packet validation")
    for binding_name in ("packet_receipt", "timeline", "ledger"):
        binding = validation.get(binding_name)
        if (
            not isinstance(binding, dict)
            or not isinstance(binding.get("path"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", str(binding.get("sha256", "")))
        ):
            fail(f"{feature_id} packet validation has no valid {binding_name} binding")
    seal = validation.get("seal")
    unsigned = {key: value for key, value in validation.items() if key != "seal"}
    canonical_digest = hashlib.sha256(
        json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if (
        not isinstance(seal, dict)
        or seal.get("algorithm") != "sha256"
        or seal.get("canonicalPayloadSha256") != canonical_digest
    ):
        fail(f"{feature_id} video proof has an invalid packet validation seal")
    artifacts = validation.get("artifacts")
    if not isinstance(artifacts, dict):
        fail(f"{feature_id} packet validation has no artifact inventory")
    for name, media_field in (
        ("clean_video", "cleanSha256"),
        ("annotated_video", "annotatedSha256"),
    ):
        artifact = artifacts.get(name)
        if not isinstance(artifact, dict) or artifact.get("sha256") != media[media_field]:
            fail(f"{feature_id} packet validation does not bind {name}")
    actions = validation.get("actions")
    action_count = validation.get("actionCount")
    if (
        not isinstance(actions, list)
        or type(action_count) is not int
        or action_count < 1
        or len(actions) != action_count
    ):
        fail(f"{feature_id} packet validation has no complete action inventory")
    action_ids = [
        action.get("action_id") if isinstance(action, dict) else None
        for action in actions
    ]
    if any(not isinstance(action_id, str) or not action_id for action_id in action_ids):
        fail(f"{feature_id} packet validation has an invalid action id")
    if len(action_ids) != len(set(action_ids)):
        fail(f"{feature_id} packet validation has duplicate action ids")
    for action in actions:
        if (
            action.get("kind") not in ("tap", "swipe")
            or not isinstance(action.get("expect"), str)
            or not action["expect"].strip()
            or not re.fullmatch(
                r"[0-9a-f]{64}", str(action.get("caption_sha256", ""))
            )
        ):
            fail(f"{feature_id} packet validation has an incomplete action")
    overlay_windows = validation.get("overlayWindows")
    if not isinstance(overlay_windows, list):
        fail(f"{feature_id} packet validation has no overlay-window inventory")
    declared_windows: set[tuple[str, str]] = set()
    for window in overlay_windows:
        if not isinstance(window, dict):
            fail(f"{feature_id} packet validation has an invalid overlay window")
        kind = window.get("kind")
        action_id = window.get("id")
        start = window.get("start")
        end = window.get("end")
        sample = window.get("sample")
        crop = window.get("crop")
        local_similarity = window.get("localVideoSsim")
        maximum_local_similarity = window.get("maximumLocalVideoSsim")
        if (
            kind not in ("action", "caption")
            or not isinstance(action_id, str)
            or not action_id
            or isinstance(start, bool)
            or not isinstance(start, (int, float))
            or not math.isfinite(start)
            or isinstance(end, bool)
            or not isinstance(end, (int, float))
            or not math.isfinite(end)
            or isinstance(sample, bool)
            or not isinstance(sample, (int, float))
            or not math.isfinite(sample)
            or start < 0
            or end <= start
            or sample < start
            or sample > end
            or not isinstance(crop, list)
            or len(crop) != 4
            or any(
                isinstance(value, bool) or not isinstance(value, int)
                for value in crop
            )
            or crop[0] < 0
            or crop[1] < 0
            or crop[2] <= 0
            or crop[3] <= 0
            or isinstance(local_similarity, bool)
            or not isinstance(local_similarity, (int, float))
            or not math.isfinite(local_similarity)
            or local_similarity < 0
            or local_similarity > 1
            or isinstance(maximum_local_similarity, bool)
            or not isinstance(maximum_local_similarity, (int, float))
            or not math.isfinite(maximum_local_similarity)
            or maximum_local_similarity < 0
            or maximum_local_similarity > 0.98
            or local_similarity > maximum_local_similarity
            or not re.fullmatch(
                r"[0-9a-f]{64}", str(window.get("cleanFrameSha256", ""))
            )
            or not re.fullmatch(
                r"[0-9a-f]{64}", str(window.get("annotatedFrameSha256", ""))
            )
            or window.get("cleanFrameSha256") == window.get("annotatedFrameSha256")
        ):
            fail(f"{feature_id} packet validation has an invalid overlay window")
        if (kind, action_id) in declared_windows:
            fail(f"{feature_id} packet validation has duplicate overlay windows")
        declared_windows.add((kind, action_id))
    for action_id in action_ids:
        if ("action", action_id) not in declared_windows:
            fail(f"{feature_id} packet validation has no action overlay window")
        if ("caption", action_id) not in declared_windows:
            fail(f"{feature_id} packet validation has no caption overlay window")
    pairing = validation.get("pairing")
    if not isinstance(pairing, dict):
        fail(f"{feature_id} packet validation has no content-pairing result")
    similarity = pairing.get("videoSsim")
    minimum = pairing.get("minimumVideoSsim")
    duration_delta = pairing.get("durationDelta")
    if (
        isinstance(similarity, bool)
        or not isinstance(similarity, (int, float))
        or not math.isfinite(similarity)
        or similarity < 0
        or similarity > 1
        or isinstance(minimum, bool)
        or not isinstance(minimum, (int, float))
        or not math.isfinite(minimum)
        or minimum < 0.75
        or similarity < minimum
        or isinstance(duration_delta, bool)
        or not isinstance(duration_delta, (int, float))
        or not math.isfinite(duration_delta)
        or duration_delta < 0
        or duration_delta > 1 / 24
    ):
        fail(f"{feature_id} packet validation has no valid content pairing")
    expected_local_maximum = min(0.98, similarity - 0.001)
    if expected_local_maximum < 0 or any(
        abs(window["maximumLocalVideoSsim"] - expected_local_maximum) > 0.000001
        for window in overlay_windows
    ):
        fail(f"{feature_id} packet validation has invalid localized overlay evidence")


def validate_integrated_commit(feature_id: str, commit: str, test_ref: str) -> None:
    head = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    cache_key = (str(REPO_ROOT), commit, test_ref, head)
    if cache_key in VERIFIED_INTEGRATED_COMMITS:
        return
    exists = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "cat-file", "-e", f"{commit}^{{commit}}"],
        text=True,
        capture_output=True,
    )
    if exists.returncode:
        fail(f"{feature_id} integrated commit does not exist: {commit}")
    targets = [test_ref]
    test_to_head = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "merge-base", "--is-ancestor", test_ref, "HEAD"],
        text=True,
        capture_output=True,
    )
    if test_to_head.returncode == 0 and test_ref != "HEAD":
        targets.append("HEAD")
    elif test_to_head.returncode not in {0, 1}:
        fail(test_to_head.stderr.strip() or f"cannot inspect Test ref {test_ref}")
    reachable = False
    for target in targets:
        result = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "merge-base", "--is-ancestor", commit, target],
            text=True,
            capture_output=True,
        )
        if result.returncode == 0:
            reachable = True
        elif result.returncode != 1:
            fail(result.stderr.strip() or f"cannot inspect integrated commit {commit}")
    if not reachable:
        fail(f"{feature_id} integrated commit is not in canonical Test: {commit}")
    changed = set(
        subprocess.run(
            [
                "git", "-C", str(REPO_ROOT), "diff-tree", "--root", "-m", "--no-commit-id",
                "--name-only", "-r", commit,
            ],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.splitlines()
    )
    if changed and changed <= {"scripts/swiftui-stream/stream.json"}:
        fail(f"{feature_id} integrated commit is metadata-only: {commit}")
    VERIFIED_INTEGRATED_COMMITS.add(cache_key)


def staged_test_manifest(
    value: dict[str, Any],
    build: int,
    source_commit: str,
) -> dict[str, Any]:
    staged = copy.deepcopy(value)
    staged["currentTestBuild"].update(
        {"build": build, "sequence": build, "commit": source_commit}
    )
    for feature in staged.get("features", []):
        if feature.get("state") in APPROVAL_STATES:
            feature["testBuild"] = build
    return staged


def test_build_catalog_errors(
    previous: dict[str, Any],
    current: dict[str, Any],
    *,
    requested_build: int,
    source_commit: str,
    head_commit: str,
    changed_paths: list[str],
    commit_count: int,
) -> list[str]:
    """Return reasons that Test catalog staging cannot authorize a build."""
    errors: list[str] = []
    previous_build = previous.get("currentTestBuild", {}).get("build")
    current_build = current.get("currentTestBuild", {}).get("build")
    current_sequence = current.get("currentTestBuild", {}).get("sequence")
    current_source = current.get("currentTestBuild", {}).get("commit")
    if current_build != requested_build:
        errors.append(
            f"currentTestBuild.build {current_build!r} does not match requested "
            f"build {requested_build}"
        )
    if current_sequence != requested_build:
        errors.append(
            f"currentTestBuild.sequence {current_sequence!r} does not match "
            f"requested build {requested_build}"
        )
    if current_source != source_commit:
        errors.append(
            f"currentTestBuild.commit {current_source!r} does not match app source "
            f"commit {source_commit}"
        )
    if type(previous_build) is not int or requested_build <= previous_build:
        errors.append(
            f"requested build {requested_build} must be newer than catalog build "
            f"{previous_build!r}"
        )
    for feature in current.get("features", []):
        if (
            feature.get("state") in APPROVAL_STATES
            and feature.get("testBuild") != requested_build
        ):
            errors.append(
                f"{feature.get('id')} testBuild {feature.get('testBuild')!r} does not "
                f"match requested build {requested_build}"
            )
    if source_commit == head_commit or commit_count != 1:
        errors.append("Test build requires exactly one catalog staging commit")
    if set(changed_paths) != {STREAM_MANIFEST_RELATIVE}:
        errors.append("catalog staging changed paths other than stream.json")
    expected = staged_test_manifest(previous, requested_build, source_commit)
    if current != expected:
        errors.append("catalog staging changed fields outside build attribution")
    return errors


def atomic_manifest(value: dict[str, Any]) -> None:
    with tempfile.NamedTemporaryFile("w", dir=MANIFEST_PATH.parent, delete=False) as file:
        json.dump(value, file, indent=2)
        file.write("\n")
        temporary = Path(file.name)
    os.replace(temporary, MANIFEST_PATH)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def proof_file_errors(
    path_value: Any,
    digest_value: Any,
    label: str,
    verify_files: bool,
    parse_json: bool = True,
) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    if not isinstance(path_value, str) or not path_value:
        return [f"{label} path must be a non-empty absolute path"], None
    path = Path(path_value).expanduser()
    if not path.is_absolute():
        errors.append(f"{label} path must be a non-empty absolute path")
    if not isinstance(digest_value, str) or not re.fullmatch(
        r"[0-9a-f]{64}", digest_value
    ):
        errors.append(f"{label} SHA-256 must be 64 lowercase hex characters")
    if errors or not verify_files:
        return errors, None
    if not path.is_file() or path.is_symlink():
        return [f"{label} file is missing or is a symbolic link: {path}"], None
    try:
        actual = file_sha256(path)
    except OSError as error:
        return [f"{label} file cannot be read: {path}: {error}"], None
    if actual != digest_value:
        errors.append(f"{label} SHA-256 does not match {path}")
        return errors, None
    if not parse_json:
        return errors, None
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"{label} is not valid JSON: {error}")
        return errors, None
    if not isinstance(value, dict):
        errors.append(f"{label} must contain a JSON object")
        return errors, None
    return errors, value


def proof_packet_errors(
    feature_id: str,
    packet: dict[str, Any],
    acceptance_ids: set[str],
    verify_files: bool,
) -> tuple[list[str], set[str]]:
    packet_id = packet.get("id")
    label = f"{feature_id} proof packet {packet_id!r}"
    errors: list[str] = []
    covered: set[str] = set()
    if not isinstance(packet_id, str) or not packet_id:
        errors.append(f"{feature_id} proof packet id must be non-empty")
    point_ids = packet.get("acceptancePointIds")
    if not isinstance(point_ids, list) or not point_ids or any(
        not isinstance(point_id, str) or not point_id for point_id in point_ids
    ):
        errors.append(f"{label} acceptancePointIds must be a non-empty string list")
    else:
        covered = set(point_ids)
        unknown = sorted(covered - acceptance_ids)
        if unknown:
            errors.append(f"{label} names unknown acceptance points: {', '.join(unknown)}")
    reference_errors, receipt = proof_file_errors(
        packet.get("receiptPath"),
        packet.get("receiptSha256"),
        f"{label} receipt",
        verify_files,
    )
    errors.extend(reference_errors)
    if receipt is None:
        return errors, covered
    if receipt.get("version") != 1:
        errors.append(f"{label} receipt version must be 1")
    artifacts = receipt.get("artifacts")
    if not isinstance(artifacts, dict):
        errors.append(f"{label} receipt artifacts must be an object")
        return errors, covered
    video_pair = {"clean_video", "annotated_video"}
    image_pair = {"clean_image", "annotated_image"}
    if video_pair <= set(artifacts):
        pair = video_pair
        events = receipt.get("events")
        if not isinstance(events, list) or not events:
            errors.append(f"{label} annotated video must contain timeline events")
        else:
            if not any(isinstance(event, dict) and event.get("caption") for event in events):
                errors.append(f"{label} annotated video must contain a caption")
            if not any(
                isinstance(event, dict) and event.get("kind") in {"tap", "swipe"}
                for event in events
            ):
                errors.append(f"{label} annotated video must show a tap or swipe")
    elif image_pair <= set(artifacts):
        pair = image_pair
        event = receipt.get("event")
        if not isinstance(event, dict) or not event.get("caption"):
            errors.append(f"{label} annotated image must contain a caption")
    else:
        errors.append(f"{label} must contain a clean and annotated proof pair")
        pair = set(artifacts) & (video_pair | image_pair)
    for artifact_name in sorted(pair):
        record = artifacts.get(artifact_name)
        if not isinstance(record, dict):
            errors.append(f"{label} artifact {artifact_name} must be an object")
            continue
        artifact_errors, _ = proof_file_errors(
            record.get("path"),
            record.get("sha256"),
            f"{label} artifact {artifact_name}",
            verify_files,
            parse_json=False,
        )
        errors.extend(artifact_errors)
    return errors, covered


def review_readiness_errors(
    feature: dict[str, Any],
    *,
    current_build: int,
    verify_files: bool,
) -> list[str]:
    """Return every reason a pending feature cannot be shown for review."""
    feature_id = feature.get("id") or "<missing-id>"
    errors: list[str] = []
    source_commit = feature.get("sourceCommit")
    if not isinstance(source_commit, str) or not re.fullmatch(
        r"[0-9a-f]{40}", source_commit
    ):
        errors.append(f"{feature_id} sourceCommit must be a full 40-character SHA")
    if feature.get("testBuild") != current_build:
        errors.append(
            f"{feature_id} testBuild {feature.get('testBuild')!r} does not match "
            f"current Test build {current_build}"
        )
    if type(feature.get("order")) is not int or feature["order"] < 1:
        errors.append(f"{feature_id} order must be a positive integer")
    if not isinstance(feature.get("behavior"), str) or not feature["behavior"].strip():
        errors.append(f"{feature_id} behavior must be a non-empty string")
    delivery = feature.get("delivery")
    if delivery not in VALID_DELIVERY:
        errors.append(f"{feature_id} delivery must be classified")
    dependencies = feature.get("dependsOn")
    if not isinstance(dependencies, list) or any(
        not isinstance(dependency, str) or not dependency
        for dependency in dependencies or []
    ):
        errors.append(f"{feature_id} dependsOn must be a string list")
    elif delivery == "chain" and not dependencies:
        errors.append(f"{feature_id} chain delivery requires dependsOn")

    points = feature.get("acceptancePoints")
    acceptance_ids: set[str] = set()
    if not isinstance(points, list) or not points:
        errors.append(f"{feature_id} acceptancePoints must be a non-empty list")
    else:
        for index, point in enumerate(points):
            if not isinstance(point, dict):
                errors.append(f"{feature_id} acceptancePoints[{index}] must be an object")
                continue
            point_id = point.get("id")
            if not isinstance(point_id, str) or not point_id:
                errors.append(f"{feature_id} acceptancePoints[{index}].id must be non-empty")
            elif point_id in acceptance_ids:
                errors.append(f"{feature_id} duplicates acceptance point {point_id}")
            else:
                acceptance_ids.add(point_id)
            if not isinstance(point.get("text"), str) or not point["text"].strip():
                errors.append(
                    f"{feature_id} acceptancePoints[{index}].text must be non-empty"
                )

    proof = feature.get("proof")
    if not isinstance(proof, dict):
        errors.append(f"{feature_id} proof must be an object")
        return errors
    if proof.get("schemaVersion") != 1:
        errors.append(f"{feature_id} proof schemaVersion must be 1")
    if proof.get("sourceCommit") != source_commit:
        errors.append(f"{feature_id} proof sourceCommit must match the feature")
    build_id = proof.get("buildId")
    if not isinstance(build_id, str) or not build_id:
        errors.append(f"{feature_id} proof buildId must be non-empty")
    build_reference = proof.get("buildReceipt")
    if not isinstance(build_reference, dict):
        errors.append(f"{feature_id} proof buildReceipt must be an object")
    else:
        reference_errors, build_receipt = proof_file_errors(
            build_reference.get("path"),
            build_reference.get("sha256"),
            f"{feature_id} build receipt",
            verify_files,
        )
        errors.extend(reference_errors)
        if build_receipt is not None:
            if build_receipt.get("schemaVersion") != 1:
                errors.append(f"{feature_id} build receipt schemaVersion must be 1")
            if build_receipt.get("pipeline") != "swiftui-private-ci":
                errors.append(f"{feature_id} build receipt pipeline is not private CI")
            if build_receipt.get("stage") not in {"candidate-simulator", "test-train"}:
                errors.append(f"{feature_id} build receipt is not a proof build stage")
            if build_receipt.get("runId") != build_id:
                errors.append(f"{feature_id} build receipt buildId does not match proof")
            repository = build_receipt.get("repository")
            if not isinstance(repository, dict) or repository.get("commit") != source_commit:
                errors.append(
                    f"{feature_id} build receipt sourceCommit does not match feature"
                )
            if build_receipt.get("status") != "passed" or build_receipt.get(
                "exitStatus"
            ) != 0:
                errors.append(f"{feature_id} build receipt did not pass")

    packets = proof.get("packets")
    covered: set[str] = set()
    packet_ids: set[str] = set()
    if not isinstance(packets, list) or not packets:
        errors.append(f"{feature_id} proof packets must be a non-empty list")
    else:
        for packet in packets:
            if not isinstance(packet, dict):
                errors.append(f"{feature_id} proof packet must be an object")
                continue
            packet_id = packet.get("id")
            if isinstance(packet_id, str) and packet_id:
                if packet_id in packet_ids:
                    errors.append(f"{feature_id} duplicates proof packet {packet_id}")
                packet_ids.add(packet_id)
            packet_errors, packet_coverage = proof_packet_errors(
                feature_id, packet, acceptance_ids, verify_files
            )
            errors.extend(packet_errors)
            covered.update(packet_coverage)
    uncovered = sorted(acceptance_ids - covered)
    if uncovered:
        errors.append(
            f"{feature_id} acceptance points lack proof: {', '.join(uncovered)}"
        )
    return errors


def catalog_review_readiness_errors(
    value: dict[str, Any],
    *,
    verify_files: bool,
    verify_commits: bool,
) -> list[str]:
    current_build = value.get("currentTestBuild", {}).get("build")
    errors: list[str] = []
    pending = [
        feature
        for feature in value.get("features", [])
        if feature.get("state") in APPROVAL_STATES
    ]
    orders = [
        feature.get("order")
        for feature in pending
        if type(feature.get("order")) is int and feature["order"] > 0
    ]
    if len(orders) != len(set(orders)):
        errors.append("pending review order values must be unique")
    for feature in pending:
        errors.extend(
            review_readiness_errors(
                feature,
                current_build=current_build,
                verify_files=verify_files,
            )
        )
    if not verify_commits:
        return errors
    for feature in pending:
        commit = feature.get("sourceCommit")
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
            continue
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{commit}^{{commit}}"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            errors.append(f"{feature['id']} sourceCommit does not resolve: {commit}")
    return errors


def require_review_ready_catalog(
    value: dict[str, Any],
    *,
    verify_files: bool = True,
    verify_commits: bool = True,
) -> None:
    errors = catalog_review_readiness_errors(
        value,
        verify_files=verify_files,
        verify_commits=verify_commits,
    )
    if errors:
        visible = "; ".join(errors[:20])
        suffix = f"; and {len(errors) - 20} more" if len(errors) > 20 else ""
        fail(f"Test catalog is not review-ready: {visible}{suffix}")


def validate_delivery_inventory(value: dict[str, Any], states: list[str]) -> None:
    records = value.get("pullRequests", [])
    numbers = [item.get("number") for item in records]
    if any(not isinstance(number, int) for number in numbers) or len(numbers) != len(set(numbers)):
        fail("PR delivery inventory numbers must be present and unique")
    for item in records:
        delivery = item.get("delivery")
        dependencies = item.get("dependsOn", [])
        if delivery not in VALID_DELIVERY - {"local-only"}:
            fail(f"PR {item['number']} has invalid delivery {delivery}")
        if delivery == "chain" and not dependencies:
            fail(f"PR {item['number']} is a chain without dependencies")
        if delivery == "direct" and dependencies:
            fail(f"direct PR {item['number']} cannot have dependencies")
        if item.get("state") not in states:
            fail(f"PR {item['number']} has invalid state {item.get('state')}")

    legacy = load_json(REPO_ROOT / manifest_path_value("legacyManifest"))
    referenced = {
        number
        for group in ("features", "candidates")
        for item in legacy.get(group, [])
        if (number := pr_number(item.get("pullRequest"))) is not None
    }
    missing = sorted(referenced - set(numbers))
    if missing:
        fail(f"PR delivery inventory is missing legacy PRs: {', '.join(map(str, missing))}")


def normalize(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def legacy_features(value: dict[str, Any]) -> list[dict[str, Any]]:
    path = REPO_ROOT / value["legacyManifest"]
    if not path.exists():
        return []
    legacy = load_json(path)
    records: list[dict[str, Any]] = []
    for index, item in enumerate(legacy.get("features", []), 1):
        delivery, dependencies = delivery_for(item.get("pullRequest"))
        delivery_state = delivery_state_for(item.get("pullRequest"))
        records.append({
            "id": f"legacy-approved-{index}",
            "name": item["name"],
            "aliases": [item.get("sourceBranch", "")],
            "state": delivery_state or "upstream-validation",
            "sourceCommit": item.get("reviewCommit"),
            "integratedCommit": item.get("integratedCommit"),
            "pullRequest": item.get("pullRequest"),
            "delivery": delivery,
            "dependsOnPullRequests": dependencies,
            "legacy": True,
        })
    for index, item in enumerate(legacy.get("candidates", []), 1):
        has_pr = bool(item.get("pullRequest"))
        delivery, dependencies = delivery_for(item.get("pullRequest"))
        delivery_state = delivery_state_for(item.get("pullRequest"))
        records.append({
            "id": f"legacy-candidate-{index}",
            "name": item["name"],
            "aliases": [item.get("sourceBranch", "")],
            "state": delivery_state if has_pr and delivery_state else "upstream-validation",
            "sourceCommit": item.get("sourceCommit"),
            "integratedCommit": item.get("integratedCommit"),
            "pullRequest": item.get("pullRequest"),
            "delivery": delivery,
            "dependsOnPullRequests": dependencies,
            "approvedBy": legacy.get("approvedBy"),
            "approvedAt": legacy.get("approvedAt"),
            "legacy": True,
        })
    return records


def upstream_pr_features(value: dict[str, Any], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    path = REPO_ROOT / value["prDelivery"]
    delivery = load_json(path)
    existing_numbers = {pr_number(item.get("pullRequest")) for item in existing}
    records = []
    for item in delivery.get("pullRequests", []):
        if item["number"] in existing_numbers:
            continue
        records.append({
            "id": f"upstream-pr-{item['number']}",
            "name": item["name"],
            "state": item["state"],
            "pullRequest": f"https://github.com/pingdotgg/t3code/pull/{item['number']}",
            "delivery": item["delivery"],
            "dependsOnPullRequests": item.get("dependsOn", []),
            "validatedAgainst": delivery.get("validatedAgainst"),
            "legacy": True,
        })
    return records


EXPLICIT_SWIFTUI_THREAD_BRANCHES = {
    # These cards predate the SwiftUI naming convention, but their messages,
    # issues, and implementation branches are explicitly native SwiftUI work.
    "t3code/share-electron-vscode-themes",
    "t3code/sync-electron-github-work",
}

NON_FEATURE_THREAD_BRANCHES = {
    # Operational threads can be live and mention SwiftUI heavily without
    # developing a user-facing feature. They belong in the audit trail, not
    # the feature-state catalog.
    "t3code/audit-swiftui-thread-branches",
    "t3code/review-recent-upstream-pr-status",
    "t3code/swiftui-testing-approval",
}


def relevant_thread(title: str, branch: str | None) -> bool:
    value = normalize(f"{title} {branch or ''}")
    explicit = (
        "swiftui", "swift ui", "ios share", "ios live activity", "iphone app",
        "iphone environment", "mobile thread", "new thread list", "dev banner",
        "thread size prefix", "header clearance", "xcode login", "bonjour discovery",
    )
    branch_key = (branch or "").lower()
    if branch_key in EXPLICIT_SWIFTUI_THREAD_BRANCHES:
        return True
    if branch_key in NON_FEATURE_THREAD_BRANCHES:
        return False
    return any(token in value for token in explicit)


def projection_activity(
    last_activity_at: str | None,
    reference: datetime,
) -> datetime | None:
    try:
        activity = datetime.fromisoformat(
            (last_activity_at or "").replace("Z", "+00:00")
        )
    except (AttributeError, TypeError, ValueError):
        return None
    if activity.tzinfo is None or activity > reference + timedelta(minutes=5):
        return None
    return activity


def projection_thread_state(
    archived_at: str | None,
    session_status: str | None,
    active_turn_id: str | None,
    last_activity_at: str | None,
    now: datetime | None = None,
) -> tuple[str, str | None]:
    if archived_at:
        return "blocked", "migration-triage-required"
    reference = now or datetime.now(timezone.utc)
    activity = projection_activity(last_activity_at, reference)
    is_fresh = (
        activity is not None
        and activity >= reference - timedelta(minutes=30)
    )
    is_live = session_status == "starting" or (
        session_status == "running" and active_turn_id
    )
    if is_live and is_fresh:
        return "developing", None
    return "blocked", "inactive-development-thread"


def thread_records(
    known: list[dict[str, Any]],
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    db = db_path or Path.home() / ".t3/userdata/state.sqlite"
    if not db.exists():
        return []
    known_threads = {
        feature.get("approvedInThread") or feature.get("sourceThread")
        for feature in known
    }
    connection = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """WITH ranked_sessions AS (
                 SELECT sessions.*,
                        ROW_NUMBER() OVER (
                          PARTITION BY sessions.thread_id
                          ORDER BY sessions.updated_at DESC, sessions.rowid DESC
                        ) AS session_rank
                   FROM projection_thread_sessions sessions
               )
               SELECT threads.thread_id, threads.title, threads.branch,
                      threads.archived_at, sessions.status, sessions.active_turn_id,
                      MAX(
                        sessions.updated_at,
                        COALESCE(
                          (SELECT MAX(messages.updated_at)
                           FROM projection_thread_messages messages
                           WHERE messages.thread_id = threads.thread_id
                             AND messages.turn_id = sessions.active_turn_id),
                          sessions.updated_at
                        ),
                        COALESCE(
                          (SELECT MAX(activities.created_at)
                           FROM projection_thread_activities activities
                           WHERE activities.thread_id = threads.thread_id
                             AND activities.turn_id = sessions.active_turn_id),
                          sessions.updated_at
                        )
                      ) AS last_activity_at
               FROM projection_threads threads
               LEFT JOIN ranked_sessions sessions
                 ON sessions.thread_id = threads.thread_id
                AND sessions.session_rank = 1
               WHERE threads.deleted_at IS NULL
               ORDER BY threads.created_at, threads.thread_id"""
        ).fetchall()
    except sqlite3.OperationalError as error:
        print(
            f"[swiftui-stream] anomaly: projection schema cannot supply thread "
            f"records: {error}",
            file=sys.stderr,
        )
        return []
    finally:
        connection.close()
    records = []
    for (
        thread_id,
        title,
        branch,
        archived_at,
        session_status,
        active_turn_id,
        last_activity_at,
    ) in rows:
        if thread_id in known_threads or not relevant_thread(title, branch):
            continue
        reference = datetime.now(timezone.utc)
        is_live = session_status == "starting" or (
            session_status == "running" and active_turn_id
        )
        if (
            not archived_at
            and is_live
            and projection_activity(last_activity_at, reference) is None
        ):
            print(
                f"[swiftui-stream] anomaly: thread {thread_id} has an invalid "
                "activity timestamp; it is not treated as active",
                file=sys.stderr,
            )
        state, blocked_reason = projection_thread_state(
            archived_at,
            session_status,
            active_turn_id,
            last_activity_at,
        )
        records.append({
            "id": f"thread-{thread_id.lower()}",
            "name": title,
            "aliases": [branch or ""],
            "state": state,
            "sourceThread": thread_id,
            "sourceBranch": branch,
            "blockedReason": blocked_reason,
            "projectionOnly": True,
        })
    return records


def catalog(include_threads: bool = True) -> list[dict[str, Any]]:
    value = manifest()
    records = [dict(feature) for feature in value["features"]]
    records.extend(legacy_features(value))
    records.extend(upstream_pr_features(value, records))
    if include_threads:
        records.extend(thread_records(records))
    return records


def installed_test_receipt_errors(
    current: dict[str, Any],
    receipt: dict[str, Any],
    ready: dict[str, Any] | None = None,
) -> list[str]:
    """Return reasons that a device receipt cannot authorize Test approval."""
    errors: list[str] = []
    if receipt.get("schemaVersion") != 1:
        errors.append("device receipt schemaVersion is not 1")
    identity_fields = ("channel", "build", "sequence", "commit", "bundleId", "deviceId")
    for field in (*identity_fields, "status", "launchPending"):
        if field not in current or current[field] is None:
            errors.append(f"catalog field {field} is missing")
            continue
        if field not in receipt or receipt[field] is None:
            errors.append(f"device receipt field {field} is missing")
            continue
        if receipt.get(field) != current.get(field):
            errors.append(
                f"device receipt {field} {receipt.get(field)!r} does not match "
                f"catalog {current.get(field)!r}"
            )
    if ready is not None:
        if ready.get("schemaVersion") != 1:
            errors.append("ready pointer schemaVersion is not 1")
        for field in identity_fields:
            if field not in ready or ready[field] is None:
                errors.append(f"ready pointer field {field} is missing")
                continue
            if current.get(field) != ready.get(field):
                errors.append(
                    f"catalog {field} {current.get(field)!r} does not match "
                    f"ready pointer {ready.get(field)!r}"
                )
            if receipt.get(field) != ready.get(field):
                errors.append(
                    f"device receipt {field} {receipt.get(field)!r} does not match "
                    f"ready pointer {ready.get(field)!r}"
                )
    if receipt.get("status") != "installed-and-launched":
        errors.append(
            "device receipt status is not installed-and-launched: "
            f"{receipt.get('status')!r}"
        )
    if receipt.get("launchPending") is not False:
        errors.append("device receipt still has a pending launch")
    return errors


def contained_receipt_path(receipt_path: Any) -> Path:
    if not isinstance(receipt_path, str) or not receipt_path:
        fail("currentTestBuild.receipt is missing")
    path = Path(receipt_path).expanduser()
    if not path.is_absolute():
        fail("currentTestBuild.receipt must resolve to an absolute path")
    root = configured_device_receipts_root()
    if root.is_symlink():
        fail("the device receipt directory cannot be a symbolic link")
    try:
        relative = path.relative_to(root)
    except ValueError:
        fail(f"currentTestBuild.receipt must be below {root}")
    if ".." in relative.parts:
        fail("currentTestBuild.receipt cannot contain path traversal")
    candidate = root
    for part in relative.parts:
        candidate /= part
        if candidate.is_symlink():
            fail("currentTestBuild.receipt cannot use a symbolic link")
    resolved_root = root.resolve(strict=False)
    resolved_path = path.resolve(strict=False)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError:
        fail(f"currentTestBuild.receipt must resolve below {resolved_root}")
    return resolved_path


def require_installed_test_receipt(
    current: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current = current or manifest().get("currentTestBuild", {})
    receipt = load_json(contained_receipt_path(current.get("receipt")))
    if not isinstance(receipt, dict):
        fail("installed Test receipt must be a JSON object")
    ready = load_json(configured_ready_pointer())
    if not isinstance(ready, dict):
        fail("Test ready pointer must be a JSON object")
    receipt_errors = installed_test_receipt_errors(current, receipt, ready)
    if receipt_errors:
        details = "; ".join(receipt_errors)
        fail(f"installed Test receipt is not eligible for approval: {details}")
    return receipt


def approval_list() -> list[dict[str, Any]]:
    value = manifest()
    require_review_ready_catalog(value)
    current = value.get("currentTestBuild", {})
    build = current.get("build")
    require_installed_test_receipt(current)
    pending = [
        feature for feature in catalog(False)
        if feature.get("state") in APPROVAL_STATES
    ]
    for feature in pending:
        test_build = feature.get("testBuild")
        if not isinstance(test_build, int) or isinstance(test_build, bool) or test_build < 1:
            fail(f"{feature['id']} requires a positive integer testBuild")
    future = [feature for feature in pending if feature["testBuild"] > build]
    if future:
        print(
            f"[swiftui-stream] {len(future)} pending approval record(s) "
            f"are staged after current Test build {build}; excluded",
            file=sys.stderr,
        )
    eligible = [feature for feature in pending if feature["testBuild"] <= build]
    return sorted(
        eligible,
        key=lambda feature: (
            feature.get("reviewPriority", 1_000_000),
            feature.get("order", 1_000_000),
            normalize(feature["name"]),
            feature["id"],
        ),
    )


def command_list(args: argparse.Namespace) -> None:
    items = approval_list()
    if args.json:
        print(json.dumps(items, indent=2, sort_keys=True))
        return
    if not items:
        print("No Test features are waiting for approval.")
        return
    for index, feature in enumerate(items, 1):
        build = feature.get("testBuild")
        print(f"{index}. {feature['name']} [Test build {build}]")


def score(query: str, feature: dict[str, Any]) -> float:
    target = " ".join([feature["name"], feature["id"], *feature.get("aliases", [])])
    query_words = set(normalize(query).split())
    target_words = set(normalize(target).split())
    overlap = len(query_words & target_words) / max(1, len(query_words))
    ratio = difflib.SequenceMatcher(None, normalize(query), normalize(target)).ratio()
    exact_bonus = 0.5 if normalize(query) in normalize(target) else 0.0
    return overlap * 0.65 + ratio * 0.35 + exact_bonus


def command_match(args: argparse.Namespace) -> None:
    ranked = sorted(
        ((score(args.query, item), item) for item in approval_list()),
        key=lambda pair: (-pair[0], normalize(pair[1]["name"]), pair[1]["id"]),
    )
    shortlist = [
        {"score": round(value, 3), **item}
        for value, item in ranked[: args.limit]
        if value >= 0.2
    ]
    print(json.dumps(shortlist, indent=2, sort_keys=True))


def command_status(args: argparse.Namespace) -> None:
    items = catalog(args.threads)
    states: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        states.setdefault(item["state"], []).append(item)
    if args.json:
        print(json.dumps({"states": states, "total": len(items)}, indent=2, sort_keys=True))
        return
    for state in manifest()["lifecycle"]:
        group = states.get(state, [])
        if not group:
            continue
        print(f"{state}: {len(group)}")
        if args.verbose:
            for item in group:
                print(f"  - {item['name']} ({item['id']})")


def git(*arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments], cwd=REPO_ROOT, text=True, capture_output=True
    )
    if result.returncode:
        fail(result.stderr.strip() or f"git {' '.join(arguments)} failed")
    return result.stdout.strip()


def command_verify_branches(_: argparse.Namespace) -> None:
    refs = manifest()["branches"]
    resolved = {}
    for name in ("theo", "dev", "test"):
        ref = refs[name]
        resolved[name] = git("rev-parse", "--verify", f"{ref}^{{commit}}")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", resolved["theo"], resolved["dev"]],
        cwd=REPO_ROOT,
    ).returncode:
        fail("Theo is not an ancestor of Dev")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", resolved["dev"], resolved["test"]],
        cwd=REPO_ROOT,
    ).returncode:
        fail("Dev is not an ancestor of Test")
    print(json.dumps(resolved, indent=2, sort_keys=True))


def command_validate_pr(args: argparse.Namespace) -> None:
    text = Path(args.body).read_text() if args.body else sys.stdin.read()
    fields = {
        "Delivery": r"(?mi)^Delivery:\s*(direct|chain|blocked)\s*$",
        "Validated against Theo commit": r"(?mi)^Validated against Theo commit:\s*([0-9a-f]{7,40})\s*$",
        "Depends on": r"(?mi)^Depends on:\s*.+$",
        "Merge order": r"(?mi)^Merge order:\s*.+$",
        "Validation status": r"(?mi)^Validation status:\s*.+$",
    }
    missing = [name for name, pattern in fields.items() if not re.search(pattern, text)]
    if missing:
        fail(f"PR delivery block is missing or invalid: {', '.join(missing)}")
    delivery = re.search(fields["Delivery"], text).group(1)
    validated_commit = re.search(fields["Validated against Theo commit"], text).group(1)
    depends_on = re.search(fields["Depends on"], text).group(0).split(":", 1)[1].strip()
    merge_order = re.search(fields["Merge order"], text).group(0).split(":", 1)[1].strip()
    dependencies = [int(number) for number in re.findall(r"#(\d+)", depends_on)]
    ordered = [int(number) for number in re.findall(r"#(\d+)", merge_order)]
    if delivery == "direct" and (depends_on.lower() != "none" or dependencies):
        fail("a direct PR must say 'Depends on: none'")
    if delivery == "direct" and merge_order.lower() != "this pr only":
        fail("a direct PR must say 'Merge order: this PR only'")
    if delivery == "chain" and not dependencies:
        fail("a chain PR must name at least one dependency")
    if delivery == "chain" and ordered[: len(dependencies)] != dependencies:
        fail("a chain PR merge order must begin with its dependencies in declared order")
    if delivery == "blocked" and depends_on.lower() == "none":
        fail("a blocked PR must name its blocker in Depends on")
    if args.number is not None:
        inventory = load_json(REPO_ROOT / manifest_path_value("prDelivery"))
        expected = next(
            (item for item in inventory.get("pullRequests", []) if item["number"] == args.number),
            None,
        )
        if expected is None:
            fail(f"PR {args.number} is absent from the delivery inventory")
        if delivery != expected["delivery"] or dependencies != expected.get("dependsOn", []):
            fail(
                f"PR {args.number} body does not match inventory delivery/dependencies"
            )
    feature = next(
        (item for item in manifest().get("features", []) if item.get("id") == args.feature_id),
        None,
    )
    if feature is None:
        fail(f"feature {args.feature_id} is absent from the stream catalog")
    if feature.get("visualChange"):
        if not re.search(r"(?mi)^Dark mode evidence:\s*yes\s*$", text):
            fail("a visual-change PR must say 'Dark mode evidence: yes'")
        labels = {
            ("image", "cleanURL"): "Clean screenshot",
            ("image", "annotatedURL"): "Annotated screenshot",
            ("video", "cleanURL"): "Clean video",
            ("video", "annotatedURL"): "Annotated video",
        }
        for item in feature.get("visualEvidence", []):
            for key in ("cleanURL", "annotatedURL"):
                label = labels[(item["kind"], key)]
                pattern = rf"(?mi)^{re.escape(label)}:\s*{re.escape(item[key])}\s*$"
                if not re.search(pattern, text):
                    fail(f"PR body is missing {label}: {item[key]}")
    theo = git("rev-parse", manifest()["branches"]["theo"])
    resolved = git("rev-parse", validated_commit)
    if resolved != theo:
        fail(f"validated Theo commit {resolved} is not the current Theo tip {theo}")
    print("PR delivery block valid")


def queue_items(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    value = load_json(path)
    return value if isinstance(value, list) else value.get("queue", [])


def command_queue(args: argparse.Namespace) -> None:
    require_installed_test_receipt()
    items = queue_items(Path(args.path).expanduser())
    item_ids = [item.get("id") for item in items]
    if any(not item_id for item_id in item_ids) or len(item_ids) != len(set(item_ids)):
        fail("promotion queue ids must be present and unique")
    by_id = {item["id"]: item for item in items}
    unknown = sorted({
        dependency
        for item in items
        for dependency in item.get("dependsOn", [])
        if dependency not in by_id
    })
    if unknown:
        fail(f"promotion queue has unresolved dependencies: {', '.join(unknown)}")
    pending = set(by_id)
    ordered: list[dict[str, Any]] = []
    while pending:
        ready = [
            by_id[item_id] for item_id in pending
            if all(dep not in pending for dep in by_id[item_id].get("dependsOn", []))
        ]
        ready.sort(key=lambda item: (item.get("approvedAt", ""), normalize(item["id"])))
        if not ready:
            fail("promotion queue contains a dependency cycle")
        for item in ready:
            pending.remove(item["id"])
            ordered.append(item)
    if args.json:
        print(json.dumps(ordered, indent=2, sort_keys=True))
    else:
        for index, item in enumerate(ordered, 1):
            print(f"{index}. {item['id']}")


def command_validate(_: argparse.Namespace) -> None:
    value = manifest(verify_evidence=True)
    validate_delivery_inventory(load_json(REPO_ROOT / value["prDelivery"]), value["lifecycle"])
    records = catalog(True)
    if len({item["id"] for item in records}) != len(records):
        fail("catalog contains duplicate ids")
    for item in records:
        if item.get("state") not in value["lifecycle"]:
            fail(f"catalog record {item['id']} has invalid state {item.get('state')}")
        if item.get("delivery") is not None and item.get("delivery") not in VALID_DELIVERY:
            fail(f"catalog record {item['id']} has invalid delivery {item.get('delivery')}")
    print(f"stream manifest valid: {len(records)} catalog records")


def command_stage_test_build(args: argparse.Namespace) -> None:
    TEST_CATALOG_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with TEST_CATALOG_LOCK.open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        branch = git("branch", "--show-current")
        if branch != "personal/swiftui-test":
            fail(f"Test catalog staging requires personal/swiftui-test, not {branch}")
        if git("status", "--porcelain"):
            fail("Test catalog staging requires a clean worktree")
        source_commit = git("rev-parse", "HEAD")
        value = manifest()
        require_review_ready_catalog(value)
        allocator = [str(SCRIPT_DIR / "next-build.py"), "test"]
        if args.build is not None:
            allocator.extend(("--requested", str(args.build)))
        result = subprocess.run(
            allocator,
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )
        if result.returncode:
            fail(result.stderr.strip() or "cannot reserve the next Test build")
        try:
            build = int(result.stdout.strip())
        except ValueError:
            fail(f"Test build allocator returned an invalid build: {result.stdout!r}")
        staged = staged_test_manifest(value, build, source_commit)
        validate_manifest(staged)
        atomic_manifest(staged)
        print(
            json.dumps(
                {
                    "build": build,
                    "catalogPath": str(MANIFEST_PATH),
                    "sourceCommit": source_commit,
                    "pendingFeatureIds": [
                        feature["id"]
                        for feature in staged["features"]
                        if feature.get("state") in APPROVAL_STATES
                    ],
                },
                indent=2,
                sort_keys=True,
            )
        )


def command_validate_test_build_catalog(args: argparse.Namespace) -> None:
    current = manifest()
    require_review_ready_catalog(current)
    source_commit = current["currentTestBuild"]["commit"]
    head_commit = git("rev-parse", "HEAD")
    git("rev-parse", "--verify", f"{source_commit}^{{commit}}")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", source_commit, head_commit],
        cwd=REPO_ROOT,
    ).returncode:
        fail(f"catalog app source {source_commit} is not an ancestor of {head_commit}")
    try:
        previous = json.loads(
            git("show", f"{source_commit}:{STREAM_MANIFEST_RELATIVE}")
        )
    except json.JSONDecodeError as error:
        fail(f"cannot read source catalog at {source_commit}: {error}")
    changed_output = git("diff", "--name-only", f"{source_commit}..{head_commit}")
    changed_paths = changed_output.splitlines() if changed_output else []
    try:
        commit_count = int(
            git("rev-list", "--count", f"{source_commit}..{head_commit}")
        )
    except ValueError:
        fail("cannot count Test catalog staging commits")
    errors = test_build_catalog_errors(
        previous,
        current,
        requested_build=args.build,
        source_commit=source_commit,
        head_commit=head_commit,
        changed_paths=changed_paths,
        commit_count=commit_count,
    )
    if errors:
        fail("Test build catalog is not staged: " + "; ".join(errors))
    print(
        json.dumps(
            {
                "build": args.build,
                "catalogCommit": head_commit,
                "sourceCommit": source_commit,
            },
            sort_keys=True,
        )
    )


def command_review_readiness(args: argparse.Namespace) -> None:
    value = load_json(Path(args.manifest)) if args.manifest else manifest()
    errors = catalog_review_readiness_errors(
        value,
        verify_files=args.verify_files,
        verify_commits=args.verify_commits,
    )
    result = {
        "catalogBuild": value.get("currentTestBuild", {}).get("build"),
        "errorCount": len(errors),
        "errors": errors,
        "reviewReady": not errors,
        "reviewItemCount": len(
            [
                feature
                for feature in value.get("features", [])
                if feature.get("state") in APPROVAL_STATES
            ]
        ),
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    if errors:
        raise SystemExit(1)


def command_require_receipt(_: argparse.Namespace) -> None:
    receipt = require_installed_test_receipt()
    print(
        json.dumps(
            {
                field: receipt[field]
                for field in (
                    "channel",
                    "build",
                    "sequence",
                    "commit",
                    "bundleId",
                    "deviceId",
                    "status",
                    "launchPending",
                )
            },
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.set_defaults(func=command_validate)
    status = commands.add_parser("status")
    status.add_argument("--json", action="store_true")
    status.add_argument("--verbose", action="store_true")
    status.add_argument("--no-threads", dest="threads", action="store_false")
    status.set_defaults(func=command_status, threads=True)
    listing = commands.add_parser("approval-list")
    listing.add_argument("--json", action="store_true")
    listing.set_defaults(func=command_list)
    matching = commands.add_parser("match")
    matching.add_argument("query")
    matching.add_argument("--limit", type=int, default=5)
    matching.set_defaults(func=command_match)
    verify = commands.add_parser("verify-branches")
    verify.set_defaults(func=command_verify_branches)
    pr = commands.add_parser("validate-pr-body")
    pr.add_argument("--body")
    pr.add_argument("--number", type=int)
    pr.add_argument("--feature-id", required=True)
    pr.set_defaults(func=command_validate_pr)
    queue = commands.add_parser("queue-order")
    queue.add_argument("--path", default="~/.t3/swiftui-stream/promotion-queue.json")
    queue.add_argument("--json", action="store_true")
    queue.set_defaults(func=command_queue)
    receipt = commands.add_parser("require-installed-test-receipt")
    receipt.set_defaults(func=command_require_receipt)
    stage_test = commands.add_parser("stage-test-build")
    stage_test.add_argument("--build", type=int)
    stage_test.set_defaults(func=command_stage_test_build)
    validate_test = commands.add_parser("validate-test-build-catalog")
    validate_test.add_argument("--build", type=int, required=True)
    validate_test.set_defaults(func=command_validate_test_build_catalog)
    review = commands.add_parser("review-readiness")
    review.add_argument("--manifest")
    review.add_argument("--verify-files", action="store_true")
    review.add_argument("--verify-commits", action="store_true")
    review.set_defaults(func=command_review_readiness)
    return result


if __name__ == "__main__":
    arguments = parser().parse_args()
    arguments.func(arguments)
