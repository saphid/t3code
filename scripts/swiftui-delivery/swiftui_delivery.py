#!/usr/bin/env python3
"""Validate the small, issue-backed SwiftUI delivery protocol.

This module deliberately does not run GitHub, T3, Xcode, or phone operations.
It validates the durable receipts those tools must produce. That keeps the
process portable and makes authority boundaries visible instead of hiding them
inside a second orchestration runtime.
"""

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from copy import deepcopy
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
CONTRACT = json.loads((ROOT / "contract.json").read_text())
ISSUE_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*$")
LANE_RE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
UDID_RE = re.compile(r"^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$")
PULL_REQUEST_RE = re.compile(
    r"^https://github\.com/%s/pull/[1-9][0-9]*$" % re.escape(CONTRACT["repository"]))


def load_build_store_module():
    spec = importlib.util.spec_from_file_location("swiftui_delivery_build_store",
                                                  ROOT / "artifact_store.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD_STORE = load_build_store_module()


def load(path):
    return json.loads(Path(path).read_text())


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def add(errors, condition, message):
    if not condition:
        errors.append(message)


def artifact_errors(value, prefix, check_files=True):
    errors = []
    add(errors, isinstance(value, dict), "%s must be an object" % prefix)
    if not isinstance(value, dict):
        return errors
    path = value.get("path")
    expected = value.get("sha256")
    add(errors, nonempty(path), "%s.path is required" % prefix)
    add(errors, matches(SHA_RE, expected),
        "%s.sha256 must be a lowercase SHA-256" % prefix)
    if check_files and nonempty(path):
        candidate = Path(path).expanduser()
        add(errors, candidate.is_file(), "%s.path does not exist: %s" % (prefix, candidate))
        if candidate.is_file() and matches(SHA_RE, expected):
            add(errors, sha256(candidate) == expected, "%s.sha256 does not match file bytes" % prefix)
    return errors


def validate_work_item(value):
    errors = []
    add(errors, isinstance(value, dict), "work item must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-work-item", "kind must be swiftui-work-item")
    add(errors, matches(ISSUE_RE, value.get("issue")),
        "issue must be owner/repository#number")
    add(errors, matches(LANE_RE, value.get("laneId")),
        "laneId must be a stable lowercase identifier")
    stage = value.get("stage")
    add(errors, stage in CONTRACT["stages"], "stage is invalid")
    add(errors, isinstance(value.get("rank"), int) and value.get("rank", -1) >= 0,
        "rank must be a non-negative integer")
    acceptance = value.get("acceptance")
    add(errors, isinstance(acceptance, list) and bool(acceptance) and
        all(nonempty(point) for point in acceptance or []),
        "acceptance must contain observable statements")
    dependencies = value.get("dependencies")
    add(errors, isinstance(dependencies, list), "dependencies must be an array")
    seen = set()
    for index, dep in enumerate(dependencies or []):
        prefix = "dependencies[%d]" % index
        add(errors, isinstance(dep, dict), "%s must be an object" % prefix)
        if not isinstance(dep, dict):
            continue
        issue = dep.get("issue")
        add(errors, matches(ISSUE_RE, issue), "%s.issue is invalid" % prefix)
        add(errors, issue != value.get("issue"), "%s cannot point to itself" % prefix)
        add(errors, dep.get("kind") in CONTRACT["dependencyKinds"], "%s.kind is invalid" % prefix)
        add(errors, dep.get("satisfiedAt") in CONTRACT["stages"], "%s.satisfiedAt is invalid" % prefix)
        add(errors, not isinstance(issue, str) or issue not in seen,
            "%s duplicates a dependency" % prefix)
        if isinstance(issue, str):
            seen.add(issue)
    binding = value.get("binding")
    add(errors, isinstance(binding, dict), "binding must be an object")
    if isinstance(binding, dict):
        external_provenance = CONTRACT["externalLanding"]["bindingProvenance"]
        landing_provenance = binding.get("landingProvenance")
        add(errors, landing_provenance in (None, external_provenance),
            "binding.landingProvenance is invalid")
        add(errors, landing_provenance is None or stage == "landed",
            "binding.landingProvenance is only valid at landed")
        externally_landed = stage == "landed" and landing_provenance == external_provenance
        for name in ("baseCommit", "headCommit"):
            item = binding.get(name)
            if item is not None:
                add(errors, matches(COMMIT_RE, item),
                    "binding.%s must be a lowercase 40-character commit" % name)
        receipt_fields = (
            "launchReceiptSha256", "proofSha256", "inspectionSha256",
            "phoneGenerationReceiptSha256", "acceptanceReceiptSha256",
            "prGenerationReceiptSha256", "landedReceiptSha256")
        for name in receipt_fields:
            item = binding.get(name)
            if item is not None:
                add(errors, matches(SHA_RE, item),
                    "binding.%s must be a lowercase SHA-256" % name)
        if stage in ("active", "proof-ready", "phone-test", "accepted", "pr-open", "landed"):
            add(errors, binding.get("launchReceiptSha256") is not None,
                "binding.launchReceiptSha256 is required at %s" % stage)
        if stage in ("proof-ready", "phone-test", "accepted", "pr-open") or \
                stage == "landed" and not externally_landed:
            for name in ("baseCommit", "headCommit", "proofSha256", "inspectionSha256"):
                add(errors, binding.get(name) is not None,
                    "binding.%s is required at %s" % (name, stage))
        if stage in ("phone-test", "accepted", "pr-open") or \
                stage == "landed" and not externally_landed:
            add(errors, binding.get("phoneGenerationReceiptSha256") is not None,
                "binding.phoneGenerationReceiptSha256 is required at %s" % stage)
        if stage in ("accepted", "pr-open") or stage == "landed" and not externally_landed:
            add(errors, binding.get("acceptanceReceiptSha256") is not None,
                "binding.acceptanceReceiptSha256 is required at %s" % stage)
        if stage == "pr-open" or stage == "landed" and not externally_landed:
            add(errors, binding.get("prGenerationReceiptSha256") is not None,
                "binding.prGenerationReceiptSha256 is required at %s" % stage)
        if stage == "landed":
            add(errors, binding.get("landedReceiptSha256") is not None,
                "binding.landedReceiptSha256 is required at landed")
        if externally_landed:
            add(errors, binding.get("baseCommit") is not None,
                "binding.baseCommit is required at externally landed")
            for name in ("headCommit", "proofSha256", "inspectionSha256",
                         "phoneGenerationReceiptSha256", "acceptanceReceiptSha256",
                         "prGenerationReceiptSha256"):
                add(errors, binding.get(name) is None,
                    "binding.%s must be absent at externally landed" % name)
    return errors


def validate_catalog(values):
    errors = []
    if not isinstance(values, list):
        return ["catalog must be an array of work items"]
    by_issue = {}
    for index, value in enumerate(values):
        errors.extend("items[%d]: %s" % (index, error) for error in validate_work_item(value))
        if isinstance(value, dict) and nonempty(value.get("issue")):
            add(errors, value["issue"] not in by_issue,
                "issue %s appears in more than one work item" % value["issue"])
            by_issue[value["issue"]] = value
    graph = {}
    for issue, item in by_issue.items():
        graph[issue] = []
        for dep in item.get("dependencies", []):
            if not isinstance(dep, dict):
                continue
            target = dep.get("issue")
            if not isinstance(target, str):
                continue
            add(errors, target in by_issue, "%s dependency %s is missing from catalog" % (issue, target))
            if target in by_issue:
                graph[issue].append(target)
    visiting, visited = set(), set()
    def walk(issue):
        if issue in visiting:
            errors.append("dependency cycle contains %s" % issue)
            return
        if issue in visited:
            return
        visiting.add(issue)
        for target in graph.get(issue, []):
            walk(target)
        visiting.remove(issue)
        visited.add(issue)
    for issue in graph:
        walk(issue)
    return errors


def stage_satisfies(observed, required):
    ordered = ("queued", "active", "proof-ready", "phone-test", "accepted", "pr-open", "landed")
    if observed not in ordered or required not in ordered:
        return False
    return ordered.index(observed) >= ordered.index(required)


def validate_video_receipt(value, capture, prefix, check_files):
    errors = []
    add(errors, isinstance(value, dict), "%s video edit receipt must be an object" % prefix)
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 1, "%s video receipt schemaVersion must be 1" % prefix)
    add(errors, value.get("kind") == "swiftui-video-edit-receipt",
        "%s video receipt kind is invalid" % prefix)
    add(errors, value.get("outputSha256") == capture.get("artifact", {}).get("sha256"),
        "%s video receipt output hash must match capture" % prefix)
    add(errors, value.get("sourceSha256") == capture.get("rawArtifact", {}).get("sha256"),
        "%s video receipt source hash must match raw capture" % prefix)
    add(errors, value.get("planSha256") == capture.get("editPlan", {}).get("sha256"),
        "%s video receipt plan hash must match edit plan" % prefix)
    add(errors, isinstance(value.get("segments"), list) and bool(value.get("segments")),
        "%s video receipt must record retained segments" % prefix)
    add(errors, isinstance(value.get("annotations"), list) and bool(value.get("annotations")),
        "%s video receipt must record at least one annotation" % prefix)
    renderer = value.get("renderer", "repo-ffmpeg")
    add(errors, renderer in ("repo-ffmpeg", "external-editor"),
        "%s video receipt renderer is invalid" % prefix)
    if renderer == "external-editor":
        add(errors, nonempty(value.get("editor")),
            "%s external video receipt must record editor and version" % prefix)
    else:
        for field in ("ffmpegVersion", "imageMagickVersion", "annotationFont"):
            add(errors, nonempty(value.get(field)),
                "%s video receipt %s is required" % (prefix, field))
        add(errors, isinstance(value.get("ffmpegCommand"), list) and bool(value.get("ffmpegCommand")),
            "%s video receipt must record the FFmpeg command" % prefix)
    source_duration, output_duration = value.get("sourceDurationSeconds"), value.get("outputDurationSeconds")
    add(errors, isinstance(source_duration, (int, float)) and source_duration > 0,
        "%s source duration is invalid" % prefix)
    add(errors, isinstance(output_duration, (int, float)) and output_duration > 0 and
        isinstance(source_duration, (int, float)) and output_duration <= source_duration,
        "%s output duration is invalid" % prefix)
    for index, segment in enumerate(value.get("segments", [])):
        add(errors, isinstance(segment, dict) and
            isinstance(segment.get("start"), (int, float)) and
            isinstance(segment.get("end"), (int, float)) and
            segment.get("start", -1) >= 0 and segment.get("end", 0) > segment.get("start", 0),
            "%s segments[%d] needs a valid range" % (prefix, index))
        add(errors, nonempty(segment.get("reason")) if isinstance(segment, dict) else False,
            "%s segments[%d] needs a reason, including intentional pauses" % (prefix, index))
    for index, annotation in enumerate(value.get("annotations", [])):
        add(errors, isinstance(annotation, dict) and nonempty(annotation.get("text")) and
            isinstance(annotation.get("start"), (int, float)) and
            isinstance(annotation.get("end"), (int, float)) and
            annotation.get("start", -1) >= 0 and
            annotation.get("end", 0) > annotation.get("start", 0),
            "%s annotations[%d] needs text and a valid range" % (prefix, index))
    return errors


def validate_build_receipt(descriptor, prefix, expected_commit, check_files):
    errors = artifact_errors(descriptor, prefix, check_files)
    receipt = None
    if isinstance(descriptor, dict) and nonempty(descriptor.get("path")):
        receipt_path = Path(descriptor["path"]).expanduser()
        if receipt_path.is_file():
            try:
                receipt = load(receipt_path)
                add(errors, receipt.get("schemaVersion") == 1,
                    "%s schemaVersion must be 1" % prefix)
                add(errors, receipt.get("kind") == "swiftui-preserved-build",
                    "%s kind must be swiftui-preserved-build" % prefix)
                add(errors, receipt.get("commit") == expected_commit,
                    "%s commit must match proof phase" % prefix)
                add(errors, matches(SHA_RE, receipt.get("treeSha256")),
                    "%s treeSha256 is invalid" % prefix)
                add(errors, matches(SHA_RE, receipt.get("binarySha256")),
                    "%s binarySha256 is invalid" % prefix)
                if check_files:
                    BUILD_STORE.verify(receipt_path)
            except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
                errors.append("%s cannot be verified: %s" % (prefix, exc))
    return receipt, errors


def positive_dimension(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def validate_runtime_capture(capture, prefix, expected_lane, check_files):
    errors = []
    simulator = capture.get("simulator")
    add(errors, isinstance(simulator, dict), "%s.simulator must be an object" % prefix)
    if isinstance(simulator, dict):
        add(errors, matches(UDID_RE, simulator.get("udid")),
            "%s.simulator.udid must be an exact uppercase UDID" % prefix)
        add(errors, nonempty(simulator.get("runtime")),
            "%s.simulator.runtime is required" % prefix)
        add(errors, nonempty(simulator.get("deviceType")),
            "%s.simulator.deviceType is required" % prefix)
        add(errors, nonempty(simulator.get("laneId")),
            "%s.simulator.laneId is required" % prefix)
        add(errors, simulator.get("laneId") == expected_lane,
            "%s.simulator.laneId must match proof laneId" % prefix)
        add(errors, matches(SHA_RE, simulator.get("leaseSha256")),
            "%s.simulator.leaseSha256 is required" % prefix)
        binding = simulator.get("leaseBinding")
        errors.extend(artifact_errors(binding, "%s.simulator.leaseBinding" % prefix, check_files))
        if check_files and isinstance(binding, dict) and nonempty(binding.get("path")):
            path = Path(binding["path"]).expanduser()
            if path.is_file():
                try:
                    value = load(path)
                    add(errors, value.get("schemaVersion") == 1 and
                        value.get("kind") == "swiftui-simulator-lease-binding",
                        "%s.simulator.leaseBinding has the wrong schema" % prefix)
                    add(errors, value.get("laneId") == expected_lane,
                        "%s.simulator.leaseBinding lane does not match" % prefix)
                    add(errors, value.get("leaseSha256") == simulator.get("leaseSha256"),
                        "%s.simulator.leaseBinding hash does not match" % prefix)
                    add(errors, value.get("simulator", {}).get("udid") == simulator.get("udid"),
                        "%s.simulator.leaseBinding UDID does not match" % prefix)
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    errors.append("%s.simulator.leaseBinding cannot be read: %s" % (prefix, exc))
    driver = capture.get("driver")
    add(errors, isinstance(driver, dict), "%s.driver must be an object" % prefix)
    if isinstance(driver, dict):
        for field in ("name", "version", "axeVersion", "routing"):
            add(errors, nonempty(driver.get(field)),
                "%s.driver.%s is required" % (prefix, field))
    coordinate_space = capture.get("coordinateSpace")
    add(errors, isinstance(coordinate_space, dict),
        "%s.coordinateSpace must be an object" % prefix)
    if isinstance(coordinate_space, dict):
        for field in ("interactionWidth", "interactionHeight",
                      "capturePixelWidth", "capturePixelHeight"):
            add(errors, positive_dimension(coordinate_space.get(field)),
                "%s.coordinateSpace.%s must be positive" % (prefix, field))
    input_state = capture.get("input")
    add(errors, isinstance(input_state, dict), "%s.input must be an object" % prefix)
    if isinstance(input_state, dict):
        add(errors, input_state.get("method") in (
            "touch", "software-keyboard", "hardware-hid", "mixed", "not-applicable"),
            "%s.input.method is invalid" % prefix)
        add(errors, isinstance(input_state.get("softwareKeyboardVisible"), bool),
            "%s.input.softwareKeyboardVisible must be boolean" % prefix)
        add(errors, nonempty(input_state.get("notes")), "%s.input.notes is required" % prefix)
    return errors


def validate_capture(capture, prefix, phase, commit, proof_schema, expected_lane, check_files):
    errors = []
    add(errors, isinstance(capture, dict), "%s must be an object" % prefix)
    if not isinstance(capture, dict):
        return errors
    add(errors, nonempty(capture.get("id")), "%s.id is required" % prefix)
    add(errors, capture.get("phase") == phase, "%s.phase must be %s" % (prefix, phase))
    kind = capture.get("kind")
    add(errors, kind in ("image", "video"), "%s.kind must be image or video" % prefix)
    add(errors, capture.get("commit") == commit, "%s.commit must match the %s commit" % (prefix, phase))
    add(errors, matches(SHA_RE, capture.get("installedBinarySha256")),
        "%s.installedBinarySha256 is required" % prefix)
    add(errors, capture.get("booted") is True, "%s must record a Booted assertion" % prefix)
    add(errors, nonempty(capture.get("device")), "%s.device is required" % prefix)
    add(errors, capture.get("appearance") in ("light", "dark", "not-applicable"),
        "%s.appearance is invalid" % prefix)
    add(errors, matches(UTC_RE, capture.get("capturedAt")),
        "%s.capturedAt must be UTC ending in Z" % prefix)
    add(errors, nonempty(capture.get("expected")), "%s.expected is required" % prefix)
    add(errors, nonempty(capture.get("observed")), "%s.observed is required" % prefix)
    if proof_schema == 3:
        errors.extend(validate_runtime_capture(capture, prefix, expected_lane, check_files))
    errors.extend(artifact_errors(capture.get("artifact"), "%s.artifact" % prefix, check_files))
    if kind == "video":
        errors.extend(artifact_errors(capture.get("rawArtifact"), "%s.rawArtifact" % prefix, check_files))
        errors.extend(artifact_errors(capture.get("editPlan"), "%s.editPlan" % prefix, check_files))
        errors.extend(artifact_errors(capture.get("editReceipt"), "%s.editReceipt" % prefix, check_files))
        receipt_artifact = capture.get("editReceipt")
        if isinstance(receipt_artifact, dict) and nonempty(receipt_artifact.get("path")):
            path = Path(receipt_artifact["path"]).expanduser()
            if path.is_file():
                try:
                    errors.extend(validate_video_receipt(load(path), capture, prefix, check_files))
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    errors.append("%s edit receipt cannot be read: %s" % (prefix, exc))
    return errors


def validate_proof(value, check_files=True):
    errors = []
    add(errors, isinstance(value, dict), "proof must be an object")
    if not isinstance(value, dict):
        return errors
    proof_schema = value.get("schemaVersion")
    add(errors, proof_schema in (2, 3), "proof schemaVersion must be 2 or 3")
    add(errors, value.get("kind") == "swiftui-proof", "proof kind must be swiftui-proof")
    expected_lane = value.get("laneId")
    if proof_schema == 3:
        add(errors, matches(LANE_RE, expected_lane), "proof laneId is required for schema 3")
    add(errors, matches(ISSUE_RE, value.get("issue")), "proof issue is invalid")
    base, head = value.get("baseCommit"), value.get("headCommit")
    add(errors, matches(COMMIT_RE, base), "baseCommit is invalid")
    add(errors, matches(COMMIT_RE, head), "headCommit is invalid")
    add(errors, base != head, "baseCommit and headCommit must differ")
    add(errors, isinstance(value.get("userVisible"), bool), "userVisible must be boolean")
    add(errors, isinstance(value.get("visualChange"), bool), "visualChange must be boolean")
    base_receipt, base_errors = validate_build_receipt(
        value.get("baseBuildReceipt"), "baseBuildReceipt", base, check_files)
    head_receipt, head_errors = validate_build_receipt(
        value.get("headBuildReceipt"), "headBuildReceipt", head, check_files)
    errors.extend(base_errors)
    errors.extend(head_errors)
    captures = value.get("captures")
    add(errors, isinstance(captures, list), "captures must be an array")
    ids = set()
    for index, capture in enumerate(captures or []):
        prefix = "captures[%d]" % index
        phase = capture.get("phase") if isinstance(capture, dict) else None
        commit = base if phase == "before" else head if phase == "after" else None
        add(errors, phase in ("before", "after"), "%s.phase is invalid" % prefix)
        errors.extend(validate_capture(
            capture, prefix, phase, commit, proof_schema, expected_lane, check_files
        ))
        expected_binary = base_receipt.get("binarySha256") if phase == "before" and isinstance(base_receipt, dict) \
            else head_receipt.get("binarySha256") if phase == "after" and isinstance(head_receipt, dict) else None
        add(errors, capture.get("installedBinarySha256") == expected_binary
            if isinstance(capture, dict) and expected_binary is not None else False,
            "%s installed binary must match the retained %s build" % (prefix, phase))
        capture_id = capture.get("id") if isinstance(capture, dict) else None
        add(errors, capture_id not in ids, "%s.id is duplicated" % prefix)
        ids.add(capture_id)
    if value.get("userVisible") is True:
        add(errors, value.get("evidenceException") is None,
            "user-visible proof cannot use an evidence exception")
        for phase in ("before", "after"):
            phase_captures = [item for item in captures or [] if item.get("phase") == phase]
            for kind in ("image", "video"):
                add(errors, any(item.get("kind") == kind for item in phase_captures),
                    "%s evidence requires at least one %s" % (phase, kind))
            if value.get("visualChange") is True:
                appearances = {item.get("appearance") for item in phase_captures if item.get("kind") == "image"}
                add(errors, {"light", "dark"}.issubset(appearances),
                    "%s visual evidence requires light and dark screenshots" % phase)
    else:
        exception = value.get("evidenceException")
        add(errors, isinstance(exception, dict),
            "non-user-visible proof must include an evidenceException")
        if isinstance(exception, dict):
            reason = exception.get("reason")
            add(errors, nonempty(reason) and len(reason.strip()) >= 40,
                "evidenceException.reason must specifically explain why images and video add no proof")
    commands = value.get("verificationCommands")
    add(errors, isinstance(commands, list) and bool(commands), "verificationCommands must not be empty")
    for index, command in enumerate(commands or []):
        add(errors, isinstance(command, dict) and nonempty(command.get("command")) and
            isinstance(command.get("exitStatus"), int),
            "verificationCommands[%d] needs command and exitStatus" % index)
        if isinstance(command, dict):
            add(errors, command.get("exitStatus") == 0,
                "verificationCommands[%d] did not pass" % index)
            add(errors, command.get("testsMatched", 1) > 0,
                "verificationCommands[%d] matched zero tests" % index)
    return errors


def validate_inspection(value, proof, proof_path=None, check_files=True):
    errors = []
    add(errors, isinstance(value, dict), "inspection must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "inspection schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-evidence-inspection",
        "inspection kind must be swiftui-evidence-inspection")
    add(errors, value.get("issue") == proof.get("issue"), "inspection issue must match proof")
    if proof_path:
        add(errors, value.get("proofSha256") == sha256(proof_path),
            "inspection proofSha256 must match exact proof bytes")
    reviewer = value.get("reviewer")
    add(errors, isinstance(reviewer, dict), "inspection reviewer must be an object")
    if isinstance(reviewer, dict):
        for field in ("agent", "model", "harness"):
            add(errors, nonempty(reviewer.get(field)), "reviewer.%s is required" % field)
    add(errors, matches(UTC_RE, value.get("reviewedAt")),
        "reviewedAt must be UTC ending in Z")
    add(errors, value.get("verdict") == "pass", "inspection verdict must be pass")
    add(errors, nonempty(value.get("intentComparison")) and
        len(value.get("intentComparison", "").strip()) >= 30,
        "intentComparison must describe how before and after compare with intent")
    add(errors, nonempty(value.get("sideEffectAssessment")) and
        len(value.get("sideEffectAssessment", "").strip()) >= 30,
        "sideEffectAssessment must describe unintended effects checked")
    reviews = value.get("captureReviews")
    add(errors, isinstance(reviews, list), "captureReviews must be an array")
    expected = {item.get("id"): item for item in proof.get("captures", [])}
    observed = {}
    for index, review in enumerate(reviews or []):
        prefix = "captureReviews[%d]" % index
        add(errors, isinstance(review, dict), "%s must be an object" % prefix)
        if not isinstance(review, dict):
            continue
        capture_id = review.get("captureId")
        add(errors, capture_id in expected, "%s.captureId is not in proof" % prefix)
        add(errors, capture_id not in observed, "%s.captureId is duplicated" % prefix)
        observed[capture_id] = review
        capture = expected.get(capture_id, {})
        add(errors, review.get("artifactSha256") == capture.get("artifact", {}).get("sha256"),
            "%s artifact hash must match the reviewed capture" % prefix)
        add(errors, review.get("phase") == capture.get("phase"), "%s.phase must match capture" % prefix)
        add(errors, review.get("kind") == capture.get("kind"), "%s.kind must match capture" % prefix)
        add(errors, nonempty(review.get("expected")) and
            len(review.get("expected", "").strip()) >= 12,
            "%s.expected must be specific" % prefix)
        add(errors, nonempty(review.get("observed")) and
            len(review.get("observed", "").strip()) >= 12,
            "%s.observed must be specific" % prefix)
        add(errors, nonempty(review.get("sideEffectsChecked")) and
            len(review.get("sideEffectsChecked", "").strip()) >= 20,
            "%s.sideEffectsChecked must describe what was checked" % prefix)
        add(errors, review.get("verdict") == "pass", "%s.verdict must be pass" % prefix)
    add(errors, set(observed) == set(expected),
        "captureReviews must review every proof capture exactly once")
    if proof.get("userVisible") is False:
        exception_review = value.get("evidenceExceptionReview")
        add(errors, isinstance(exception_review, dict),
            "inspection must review the no-media exception")
        if isinstance(exception_review, dict):
            add(errors, exception_review.get("verdict") == "accepted",
                "evidenceExceptionReview.verdict must be accepted")
            add(errors, nonempty(exception_review.get("reason")) and
                len(exception_review.get("reason", "").strip()) >= 40,
                "evidenceExceptionReview.reason must be specific")
    return errors


def read_validated_artifact(descriptor, validator, prefix, errors):
    errors.extend(artifact_errors(descriptor, prefix, True))
    if not isinstance(descriptor, dict) or not nonempty(descriptor.get("path")):
        return None
    path = Path(descriptor["path"]).expanduser()
    if not path.is_file():
        return None
    try:
        value = load(path)
        errors.extend("%s: %s" % (prefix, item) for item in validator(value))
        return value
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors.append("%s cannot be read: %s" % (prefix, exc))
        return None


def validate_generation_plan(value):
    errors = []
    add(errors, isinstance(value, dict), "generation plan must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "generation plan schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-generation-plan", "generation plan kind is invalid")
    mode = value.get("mode")
    add(errors, mode in CONTRACT["generationModes"], "generation plan mode is invalid")
    authority = value.get("authority")
    add(errors, isinstance(authority, dict), "authority must be structured")
    if isinstance(authority, dict):
        for field in ("actor", "source", "scopeSha256", "grantedAt"):
            item = authority.get(field)
            if field == "scopeSha256":
                add(errors, matches(SHA_RE, item), "authority.scopeSha256 is invalid")
            elif field == "grantedAt":
                add(errors, matches(UTC_RE, item), "authority.grantedAt is invalid")
            else:
                add(errors, nonempty(item), "authority.%s is required" % field)
        add(errors, authority.get("actor") in CONTRACT["humanActors"],
            "authority.actor must be an authorized human")
    catalog = read_validated_artifact(
        value.get("catalog"), validate_catalog, "catalog", errors)
    catalog_by_issue = {
        item.get("issue"): item for item in catalog or [] if isinstance(item, dict)
    } if isinstance(catalog, list) else {}
    entries = value.get("entries")
    add(errors, isinstance(entries, list) and bool(entries), "entries must not be empty")
    seen = set()
    role_entries = {}
    for index, entry in enumerate(entries or []):
        prefix = "entries[%d]" % index
        add(errors, isinstance(entry, dict), "%s must be an object" % prefix)
        if not isinstance(entry, dict):
            continue
        issue = entry.get("issue")
        role = entry.get("role")
        add(errors, role in CONTRACT["generationRoles"].get(mode, []),
            "%s.role is invalid for %s" % (prefix, mode))
        if isinstance(role, str):
            role_entries.setdefault(role, []).append(entry)
        add(errors, matches(ISSUE_RE, issue), "%s.issue is invalid" % prefix)
        add(errors, not isinstance(issue, str) or issue not in seen,
            "%s.issue is duplicated" % prefix)
        if isinstance(issue, str):
            seen.add(issue)
        add(errors, matches(COMMIT_RE, entry.get("headCommit")),
            "%s.headCommit is invalid" % prefix)
        work_item = read_validated_artifact(entry.get("workItem"), validate_work_item,
                                            "%s.workItem" % prefix, errors)
        proof = read_validated_artifact(entry.get("proof"), lambda item: validate_proof(item, True),
                                        "%s.proof" % prefix, errors)
        inspection_descriptor = entry.get("inspection")
        errors.extend(artifact_errors(inspection_descriptor, "%s.inspection" % prefix, True))
        inspection = None
        if isinstance(inspection_descriptor, dict) and nonempty(inspection_descriptor.get("path")):
            inspection_path = Path(inspection_descriptor["path"]).expanduser()
            if inspection_path.is_file() and isinstance(proof, dict):
                try:
                    inspection = load(inspection_path)
                    errors.extend("%s.inspection: %s" % (prefix, item) for item in
                                  validate_inspection(inspection, proof, proof_path=None))
                    add(errors, inspection.get("proofSha256") == entry.get("proof", {}).get("sha256"),
                        "%s inspection must bind the plan's proof hash" % prefix)
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    errors.append("%s.inspection cannot be read: %s" % (prefix, exc))
        if isinstance(work_item, dict):
            add(errors, work_item.get("issue") == issue, "%s work item issue mismatch" % prefix)
            add(errors, issue in catalog_by_issue,
                "%s issue is missing from the plan dependency catalog" % prefix)
            if issue in catalog_by_issue:
                add(errors, work_item == catalog_by_issue[issue],
                    "%s work item does not match the dependency catalog" % prefix)
            add(errors, work_item.get("binding", {}).get("headCommit") == entry.get("headCommit"),
                "%s head does not match work item" % prefix)
            add(errors, work_item.get("binding", {}).get("proofSha256") ==
                entry.get("proof", {}).get("sha256"), "%s proof hash does not match work item" % prefix)
            add(errors, work_item.get("binding", {}).get("inspectionSha256") ==
                inspection_descriptor.get("sha256") if isinstance(inspection_descriptor, dict) else False,
                "%s inspection hash does not match work item" % prefix)
            if mode == "publish-test" and role == "candidate":
                allowed = ("proof-ready",)
            elif mode == "publish-test" and role == "installed-carry":
                allowed = ("phone-test", "accepted", "pr-open", "landed")
            else:
                allowed = ("accepted", "pr-open", "landed")
            add(errors, work_item.get("stage") in allowed,
                "%s work item stage is not eligible for %s" % (prefix, mode))
        if isinstance(proof, dict):
            add(errors, proof.get("issue") == issue, "%s proof issue mismatch" % prefix)
            add(errors, proof.get("headCommit") == entry.get("headCommit"), "%s proof head mismatch" % prefix)
            if proof.get("schemaVersion") == 3 and isinstance(work_item, dict):
                add(errors, proof.get("laneId") == work_item.get("laneId"),
                    "%s proof lane mismatch" % prefix)
    for issue, item in catalog_by_issue.items():
        for dependency in item.get("dependencies", []):
            if not isinstance(dependency, dict):
                continue
            target = catalog_by_issue.get(dependency.get("issue"))
            if isinstance(target, dict):
                add(errors, stage_satisfies(target.get("stage"), dependency.get("satisfiedAt")),
                    "%s dependency %s is at %s, requires %s" % (
                        issue, dependency.get("issue"), target.get("stage"),
                        dependency.get("satisfiedAt")))
    if mode in ("publish-test", "open-pr"):
        add(errors, bool(role_entries.get("candidate")), "%s requires at least one candidate" % mode)
    if mode == "publish-test":
        carry_descriptor = value.get("carryReceipt")
        carry_entries = role_entries.get("installed-carry", [])
        if carry_descriptor is None:
            add(errors, not carry_entries, "installed-carry entries require carryReceipt")
            reason = value.get("emptyCarryReason")
            add(errors, nonempty(reason) and len(reason.strip()) >= 40,
                "publish-test without carryReceipt requires a specific emptyCarryReason")
        else:
            errors.extend(artifact_errors(carry_descriptor, "carryReceipt", True))
            if isinstance(carry_descriptor, dict) and nonempty(carry_descriptor.get("path")):
                carry_path = Path(carry_descriptor["path"]).expanduser()
                if carry_path.is_file():
                    try:
                        prior = load(carry_path)
                        add(errors, prior.get("kind") == "swiftui-generation-receipt" and
                            prior.get("mode") == "publish-test",
                            "carryReceipt must be a prior publish-test generation receipt")
                        prior_entries = prior.get("entries")
                        add(errors, isinstance(prior_entries, list),
                            "carryReceipt entries must be an array")
                        if isinstance(prior_entries, list) and all(
                                isinstance(entry, dict) for entry in prior_entries):
                            candidate_issues = {
                                entry.get("issue") for entry in role_entries.get("candidate", [])
                                if isinstance(entry.get("issue"), str)}
                            expected = {(entry.get("issue"), entry.get("headCommit"))
                                        for entry in prior_entries
                                        if entry.get("issue") not in candidate_issues}
                            actual = {(entry.get("issue"), entry.get("headCommit"))
                                      for entry in carry_entries}
                            add(errors, actual == expected,
                                "installed-carry entries must exactly preserve the prior installed generation")
                    except (OSError, ValueError, json.JSONDecodeError) as exc:
                        errors.append("carryReceipt cannot be read: %s" % exc)
    return errors


def validate_generation_receipt(value, plan, plan_path):
    errors = []
    add(errors, isinstance(value, dict), "generation receipt must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, isinstance(plan, dict), "generation receipt plan must be an object")
    if not isinstance(plan, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "generation receipt schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-generation-receipt", "generation receipt kind is invalid")
    add(errors, value.get("mode") == plan.get("mode"), "generation receipt mode must match plan")
    add(errors, value.get("planSha256") == sha256(plan_path),
        "generation receipt must bind exact plan bytes")
    add(errors, matches(UTC_RE, value.get("completedAt")),
        "generation receipt completedAt must be UTC ending in Z")
    expected_entries = [(entry.get("issue"), entry.get("headCommit"))
                        for entry in plan.get("entries", [])]
    actual_entries = [(entry.get("issue"), entry.get("headCommit"))
                      for entry in value.get("entries", [])] if isinstance(value.get("entries"), list) else None
    add(errors, actual_entries == expected_entries,
        "generation receipt entries must match plan issue/head order")
    if plan.get("mode") in ("publish-test", "publish-dev"):
        add(errors, nonempty(value.get("resolvedDestination")), "resolvedDestination is required")
        add(errors, matches(SHA_RE, value.get("installedArtifactSha256")),
            "installedArtifactSha256 must be a lowercase SHA-256")
    if plan.get("mode") == "open-pr":
        add(errors, nonempty(value.get("pullRequestUrl")), "pullRequestUrl is required for open-pr")
        add(errors, matches(COMMIT_RE, value.get("resultingHeadCommit")),
            "resultingHeadCommit is required for open-pr")
    return errors


def validate_transition_generation(plan, item, required_role):
    """Bind a valid generation to the exact work item being transitioned."""
    errors = []
    entries = plan.get("entries", []) if isinstance(plan, dict) else []
    matches_for_issue = [entry for entry in entries
                         if isinstance(entry, dict) and
                         entry.get("issue") == item.get("issue")]
    add(errors, len(matches_for_issue) == 1,
        "generation must contain the transitioning issue exactly once")
    if len(matches_for_issue) != 1:
        return errors
    entry = matches_for_issue[0]
    add(errors, entry.get("role") == required_role,
        "transitioning issue must be a %s entry" % required_role)
    add(errors, entry.get("headCommit") == item.get("binding", {}).get("headCommit"),
        "generation head must match the transitioning work item")
    descriptor = entry.get("workItem")
    if not isinstance(descriptor, dict) or not nonempty(descriptor.get("path")):
        errors.append("generation entry must reference the transitioning work item")
        return errors
    try:
        planned_item = load(Path(descriptor["path"]).expanduser())
        add(errors, planned_item == item,
            "generation work item must exactly match the transitioning work item")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors.append("generation work item cannot be read: %s" % exc)
    return errors


def validate_launch_receipt(value, item):
    errors = []
    add(errors, isinstance(value, dict), "launch receipt must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "launch receipt schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-launch-receipt", "launch receipt kind is invalid")
    add(errors, value.get("issue") == item.get("issue"), "launch receipt issue must match work item")
    add(errors, value.get("laneId") == item.get("laneId"), "launch receipt laneId must match work item")
    add(errors, matches(COMMIT_RE, value.get("baseCommit")), "launch receipt baseCommit is invalid")
    for field in ("branch", "worktree", "environmentId", "projectId", "threadId"):
        add(errors, nonempty(value.get(field)), "launch receipt %s is required" % field)
    add(errors, matches(UTC_RE, value.get("launchedAt")),
        "launch receipt launchedAt must be UTC ending in Z")
    return errors


def validate_acceptance_receipt(value, item):
    errors = []
    add(errors, isinstance(value, dict), "acceptance receipt must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "acceptance receipt schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-acceptance-receipt", "acceptance receipt kind is invalid")
    add(errors, value.get("issue") == item.get("issue"), "acceptance receipt issue must match work item")
    add(errors, value.get("actor") in CONTRACT["humanActors"],
        "acceptance receipt actor must be an authorized human")
    add(errors, value.get("verdict") == "accept", "acceptance receipt verdict must be accept")
    add(errors, value.get("phoneGenerationReceiptSha256") ==
        item.get("binding", {}).get("phoneGenerationReceiptSha256"),
        "acceptance receipt must bind the tested phone generation")
    add(errors, matches(UTC_RE, value.get("acceptedAt")),
        "acceptance receipt acceptedAt must be UTC ending in Z")
    return errors


def source_path_from_reference(value):
    if not nonempty(value):
        return None
    path = PurePosixPath(value.split(":", 1)[0])
    if path.is_absolute() or not path.parts or ".." in path.parts:
        return None
    return str(path)


def validate_external_landing_receipt(value, item, source_root=None):
    errors = []
    add(errors, isinstance(value, dict), "external landing receipt must be an object")
    if not isinstance(value, dict):
        return errors
    policy = CONTRACT["externalLanding"]
    binding = item.get("binding", {}) if isinstance(item, dict) else {}
    add(errors, value.get("schemaVersion") == 1,
        "external landing receipt schemaVersion must be 1")
    add(errors, value.get("kind") == policy["receiptKind"],
        "external landing receipt kind is invalid")
    add(errors, value.get("provenanceMode") == policy["provenanceMode"],
        "external landing receipt provenanceMode is invalid")
    add(errors, value.get("issue") == item.get("issue"),
        "external landing receipt issue must match work item")
    add(errors, value.get("laneId") == item.get("laneId"),
        "external landing receipt laneId must match work item")
    add(errors, value.get("baseCommit") == binding.get("baseCommit") and
        matches(COMMIT_RE, value.get("baseCommit")),
        "external landing receipt baseCommit must match work item")
    add(errors, value.get("launchReceiptSha256") == binding.get("launchReceiptSha256") and
        matches(SHA_RE, value.get("launchReceiptSha256")),
        "external landing receipt launch receipt must match work item")
    add(errors, matches(PULL_REQUEST_RE, value.get("pullRequestUrl")),
        "external landing receipt pullRequestUrl must name a repository pull request")
    add(errors, value.get("pullRequestState") == "MERGED",
        "external landing receipt pullRequestState must be MERGED")
    add(errors, matches(UTC_RE, value.get("mergedAt")),
        "external landing receipt mergedAt must be UTC ending in Z")
    merge_commit = value.get("mergeCommit")
    add(errors, matches(COMMIT_RE, merge_commit),
        "external landing receipt mergeCommit is invalid")

    attestation = value.get("ancestorAttestation")
    add(errors, isinstance(attestation, dict),
        "external landing receipt ancestorAttestation must be an object")
    if isinstance(attestation, dict):
        add(errors, attestation.get("mergeCommit") == merge_commit,
            "ancestor attestation mergeCommit must match external landing")
        add(errors, matches(COMMIT_RE, attestation.get("liveBaseCommit")),
            "ancestor attestation liveBaseCommit is invalid")
        add(errors, attestation.get("method") == "git-merge-base-is-ancestor",
            "ancestor attestation method is invalid")
        add(errors, attestation.get("exitStatus") == 0,
            "ancestor attestation exitStatus must be zero")
        add(errors, attestation.get("isAncestor") is True,
            "merge commit must be attested as an ancestor of live base")
        add(errors, matches(UTC_RE, attestation.get("attestedAt")),
            "ancestor attestation attestedAt must be UTC ending in Z")

    mapping = value.get("acceptanceMapping")
    expected_acceptance = item.get("acceptance", []) if isinstance(item, dict) else []
    add(errors, isinstance(mapping, list) and bool(mapping),
        "external landing receipt acceptanceMapping must be nonempty")
    if isinstance(mapping, list):
        actual_acceptance = [entry.get("acceptance") if isinstance(entry, dict) else None
                             for entry in mapping]
        add(errors, actual_acceptance == expected_acceptance,
            "external landing receipt must map every acceptance statement exactly once in order")
        referenced_paths = []
        for index, entry in enumerate(mapping):
            prefix = "external landing acceptanceMapping[%d]" % index
            add(errors, isinstance(entry, dict), "%s must be an object" % prefix)
            if not isinstance(entry, dict):
                continue
            source_path = source_path_from_reference(entry.get("source"))
            add(errors, source_path is not None, "%s.source is invalid" % prefix)
            add(errors, nonempty(entry.get("observation")),
                "%s.observation is required" % prefix)
            if source_path is not None:
                referenced_paths.append(source_path)
    else:
        referenced_paths = []

    source_hashes = value.get("currentSourceHashes")
    live_base_commit = attestation.get("liveBaseCommit") \
        if isinstance(attestation, dict) else None
    add(errors, value.get("currentSourceCommit") == live_base_commit and
        matches(COMMIT_RE, value.get("currentSourceCommit")),
        "external landing currentSourceCommit must match the attested live base")
    add(errors, isinstance(source_hashes, dict) and bool(source_hashes),
        "external landing receipt currentSourceHashes must be nonempty")
    if isinstance(source_hashes, dict):
        valid_paths = []
        resolved_root = Path(source_root or REPO_ROOT).resolve()
        for path_value, expected_hash in source_hashes.items():
            source_path = source_path_from_reference(path_value)
            add(errors, source_path == path_value,
                "current source hash path must be repository-relative: %s" % path_value)
            add(errors, matches(SHA_RE, expected_hash),
                "current source hash must be a lowercase SHA-256: %s" % path_value)
            if source_path == path_value:
                valid_paths.append(source_path)
                candidate = (resolved_root / source_path).resolve()
                inside_root = candidate == resolved_root or resolved_root in candidate.parents
                add(errors, inside_root,
                    "current source path escapes repository root: %s" % source_path)
                add(errors, inside_root and candidate.is_file(),
                    "current source path does not exist: %s" % source_path)
                if inside_root and candidate.is_file() and matches(SHA_RE, expected_hash):
                    add(errors, sha256(candidate) == expected_hash,
                        "current source hash does not match file bytes: %s" % source_path)
        add(errors, set(valid_paths) == set(referenced_paths),
            "currentSourceHashes must exactly cover acceptance mapping sources")

    side_effects = value.get("sideEffects")
    prohibited = policy["prohibitedSideEffects"]
    add(errors, isinstance(side_effects, dict),
        "external landing receipt sideEffects must be an object")
    if isinstance(side_effects, dict):
        add(errors, set(side_effects) == set(prohibited),
            "external landing receipt sideEffects must name every prohibited side effect exactly")
        for name in prohibited:
            add(errors, side_effects.get(name) is False,
                "external landing receipt sideEffects.%s must be false" % name)
    add(errors, matches(UTC_RE, value.get("reconciledAt")),
        "external landing receipt reconciledAt must be UTC ending in Z")
    return errors


def validate_landed_receipt(value, item, pr_receipt, pr_receipt_path):
    errors = []
    add(errors, isinstance(value, dict), "landed receipt must be an object")
    if not isinstance(value, dict):
        return errors
    add(errors, value.get("schemaVersion") == 2, "landed receipt schemaVersion must be 2")
    add(errors, value.get("kind") == "swiftui-landed-receipt", "landed receipt kind is invalid")
    add(errors, value.get("issue") == item.get("issue"), "landed receipt issue must match work item")
    add(errors, nonempty(value.get("pullRequestUrl")), "landed receipt pullRequestUrl is required")
    add(errors, matches(COMMIT_RE, value.get("mergeCommit")), "landed receipt mergeCommit is invalid")
    add(errors, isinstance(pr_receipt, dict) and
        pr_receipt.get("kind") == "swiftui-generation-receipt" and
        pr_receipt.get("mode") == "open-pr",
        "landed transition requires the open-pr generation receipt")
    if isinstance(pr_receipt, dict):
        add(errors, sha256(pr_receipt_path) ==
            item.get("binding", {}).get("prGenerationReceiptSha256"),
            "open-pr generation receipt must match the work item binding")
        add(errors, value.get("pullRequestUrl") == pr_receipt.get("pullRequestUrl"),
            "landed receipt pull request must match the open-pr generation")
    add(errors, matches(UTC_RE, value.get("landedAt")),
        "landed receipt landedAt must be UTC ending in Z")
    return errors


def transition(item, destination, proof_path=None, inspection_path=None,
               plan_path=None, receipt_path=None, verdict=None,
               launch_receipt_path=None, acceptance_receipt_path=None,
               landed_receipt_path=None, external_landing_receipt_path=None,
               source_root=None):
    errors = validate_work_item(item)
    current = item.get("stage") if isinstance(item, dict) else None
    add(errors, destination in CONTRACT["transitions"].get(current, []),
        "transition %s -> %s is not allowed" % (current, destination))
    result = deepcopy(item)
    if current == "queued" and destination == "active":
        add(errors, launch_receipt_path is not None, "active requires a launch receipt")
        if launch_receipt_path:
            launch_receipt = load(launch_receipt_path)
            errors.extend(validate_launch_receipt(launch_receipt, item))
            if not errors:
                result["binding"]["baseCommit"] = launch_receipt["baseCommit"]
                result["binding"]["launchReceiptSha256"] = sha256(launch_receipt_path)
    if current == "active" and destination == "proof-ready":
        add(errors, proof_path is not None and inspection_path is not None,
            "proof-ready requires proof and inspection files")
        if proof_path and inspection_path:
            proof = load(proof_path)
            inspection = load(inspection_path)
            errors.extend(validate_proof(proof, True))
            errors.extend(validate_inspection(inspection, proof, proof_path, True))
            add(errors, proof.get("issue") == item.get("issue"), "proof issue must match work item")
            if proof.get("schemaVersion") == 3:
                add(errors, proof.get("laneId") == item.get("laneId"),
                    "proof laneId must match work item")
            if not errors:
                result["binding"].update({
                    "baseCommit": proof["baseCommit"], "headCommit": proof["headCommit"],
                    "proofSha256": sha256(proof_path), "inspectionSha256": sha256(inspection_path)})
    if current == "active" and destination == "landed":
        add(errors, external_landing_receipt_path is not None,
            "active -> landed requires an external landing receipt")
        add(errors, all(value is None for value in (
            proof_path, inspection_path, plan_path, receipt_path, verdict,
            acceptance_receipt_path, landed_receipt_path)),
            "external landing cannot use proof, phone acceptance, generation, or ordinary landed inputs")
        for name in ("headCommit", "proofSha256", "inspectionSha256",
                     "phoneGenerationReceiptSha256", "acceptanceReceiptSha256",
                     "prGenerationReceiptSha256", "landedReceiptSha256"):
            add(errors, item.get("binding", {}).get(name) is None,
                "external landing requires binding.%s to be absent" % name)
        if external_landing_receipt_path:
            external_landing = load(external_landing_receipt_path)
            errors.extend(validate_external_landing_receipt(
                external_landing, item, source_root))
            if not errors:
                result["binding"]["landingProvenance"] = \
                    CONTRACT["externalLanding"]["bindingProvenance"]
                result["binding"]["landedReceiptSha256"] = \
                    sha256(external_landing_receipt_path)
    if current == "proof-ready" and destination == "phone-test":
        add(errors, plan_path is not None and receipt_path is not None,
            "phone-test requires generation plan and receipt")
        if plan_path and receipt_path:
            plan, receipt = load(plan_path), load(receipt_path)
            errors.extend(validate_generation_plan(plan))
            errors.extend(validate_generation_receipt(receipt, plan, plan_path))
            add(errors, plan.get("mode") == "publish-test",
                "phone-test requires a publish-test generation plan")
            errors.extend(validate_transition_generation(plan, item, "candidate"))
            if not errors:
                result["binding"]["phoneGenerationReceiptSha256"] = sha256(receipt_path)
    if current == "phone-test" and destination == "accepted":
        add(errors, verdict == "accept" and acceptance_receipt_path is not None,
            "phone-test -> accepted requires explicit accept verdict and receipt")
        if acceptance_receipt_path:
            acceptance = load(acceptance_receipt_path)
            errors.extend(validate_acceptance_receipt(acceptance, item))
            if not errors:
                result["binding"]["acceptanceReceiptSha256"] = sha256(acceptance_receipt_path)
    if current == "accepted" and destination == "pr-open":
        add(errors, plan_path is not None and receipt_path is not None,
            "pr-open requires generation plan and receipt")
        if plan_path and receipt_path:
            plan, receipt = load(plan_path), load(receipt_path)
            errors.extend(validate_generation_plan(plan))
            errors.extend(validate_generation_receipt(receipt, plan, plan_path))
            add(errors, plan.get("mode") == "open-pr", "pr-open requires an open-pr plan")
            errors.extend(validate_transition_generation(plan, item, "candidate"))
            if not errors:
                result["binding"]["prGenerationReceiptSha256"] = sha256(receipt_path)
    if current == "pr-open" and destination == "landed":
        add(errors, landed_receipt_path is not None and receipt_path is not None,
            "landed requires landed and open-pr generation receipts")
        if landed_receipt_path and receipt_path:
            landed = load(landed_receipt_path)
            pr_receipt = load(receipt_path)
            errors.extend(validate_landed_receipt(
                landed, item, pr_receipt, receipt_path))
            if not errors:
                result["binding"]["landedReceiptSha256"] = sha256(landed_receipt_path)
    if destination == "active" and current in ("proof-ready", "phone-test", "accepted", "pr-open"):
        add(errors, verdict in ("reject", "rework"), "return to active requires reject or rework verdict")
        if not errors:
            result["binding"].update({
                "proofSha256": None, "inspectionSha256": None,
                "phoneGenerationReceiptSha256": None, "acceptanceReceiptSha256": None,
                "prGenerationReceiptSha256": None, "landedReceiptSha256": None})
    if not errors:
        result["stage"] = destination
    return result, errors


def print_result(errors, value=None):
    payload = {"ok": not errors, "errors": errors}
    if value is not None and not errors:
        payload["value"] = value
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if not errors else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("validate-work-item", "validate-catalog", "validate-proof"):
        command = sub.add_parser(name)
        command.add_argument("path")
    inspection = sub.add_parser("validate-inspection")
    inspection.add_argument("path")
    inspection.add_argument("--proof", required=True)
    plan = sub.add_parser("validate-generation-plan")
    plan.add_argument("path")
    receipt = sub.add_parser("validate-generation-receipt")
    receipt.add_argument("path")
    receipt.add_argument("--plan", required=True)
    move = sub.add_parser("transition-work-item")
    move.add_argument("path")
    move.add_argument("--to", required=True)
    move.add_argument("--proof")
    move.add_argument("--inspection")
    move.add_argument("--generation-plan")
    move.add_argument("--generation-receipt")
    move.add_argument("--verdict")
    move.add_argument("--launch-receipt")
    move.add_argument("--acceptance-receipt")
    move.add_argument("--landed-receipt")
    move.add_argument("--external-landing-receipt")
    args = parser.parse_args(argv)
    try:
        if args.command == "validate-work-item":
            return print_result(validate_work_item(load(args.path)))
        if args.command == "validate-catalog":
            return print_result(validate_catalog(load(args.path)))
        if args.command == "validate-proof":
            return print_result(validate_proof(load(args.path), True))
        if args.command == "validate-inspection":
            proof = load(args.proof)
            errors = validate_proof(proof, True)
            errors.extend(validate_inspection(load(args.path), proof, args.proof, True))
            return print_result(errors)
        if args.command == "validate-generation-plan":
            return print_result(validate_generation_plan(load(args.path)))
        if args.command == "validate-generation-receipt":
            plan_value = load(args.plan)
            errors = validate_generation_plan(plan_value)
            errors.extend(validate_generation_receipt(load(args.path), plan_value, args.plan))
            return print_result(errors)
        if args.command == "transition-work-item":
            value, errors = transition(load(args.path), args.to, args.proof, args.inspection,
                                       args.generation_plan, args.generation_receipt, args.verdict,
                                       args.launch_receipt, args.acceptance_receipt,
                                       args.landed_receipt, args.external_landing_receipt)
            return print_result(errors, value)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return print_result([str(exc)])
    return 2


if __name__ == "__main__":
    sys.exit(main())
