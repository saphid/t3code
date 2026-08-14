#!/usr/bin/env python3

"""Validate, resolve, and receipt the native app-flow test contract."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
REPO_ROOT = APP_DIR.parent.parent
DEFAULT_CATALOG = SCRIPT_DIR / "app-flow-catalog.json"
DEFAULT_TEST_SOURCE = APP_DIR / "UITests" / "AppFlowUITests.swift"
PACKAGE_RESOLVED = (
    APP_DIR
    / "T3Code.xcodeproj"
    / "project.xcworkspace"
    / "xcshareddata"
    / "swiftpm"
    / "Package.resolved"
)
TEST_PATTERN = re.compile(r"^\s+func (test[A-Za-z0-9_]+)\s*\(", re.MULTILINE)


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"could not read JSON from {path}: {error}")
    if not isinstance(value, dict):
        fail(f"expected a JSON object in {path}")
    return value


def catalog_data(path: Path, test_source: Path) -> dict[str, Any]:
    catalog = load_json(path)
    if catalog.get("schemaVersion") != 1:
        fail("catalog schemaVersion must be 1")
    suite = catalog.get("suite")
    if not isinstance(suite, str) or not suite:
        fail("catalog suite must be a non-empty string")

    journeys = catalog.get("journeys")
    plans = catalog.get("plans")
    if not isinstance(journeys, list) or not journeys:
        fail("catalog journeys must be a non-empty array")
    if not isinstance(plans, dict) or not plans:
        fail("catalog plans must be a non-empty object")

    journey_by_id: dict[str, dict[str, Any]] = {}
    test_to_id: dict[str, str] = {}
    all_checkpoints: set[str] = set()
    allowed_lanes = {"fixture", "live", "security", "accessibility", "known-red"}
    for journey in journeys:
        if not isinstance(journey, dict):
            fail("each journey must be an object")
        journey_id = journey.get("id")
        test = journey.get("test")
        if not isinstance(journey_id, str) or not journey_id:
            fail("each journey needs a non-empty id")
        if not isinstance(test, str) or not test.startswith("test"):
            fail(f"journey {journey_id} needs a test method")
        if journey_id in journey_by_id:
            fail(f"duplicate journey id: {journey_id}")
        if test in test_to_id:
            fail(f"test {test} is assigned to more than one journey")
        checkpoints = journey.get("checkpoints")
        if not isinstance(checkpoints, list) or not all(
            isinstance(checkpoint, str) and checkpoint for checkpoint in checkpoints
        ):
            fail(f"journey {journey_id} needs a checkpoints array")
        if len(checkpoints) != len(set(checkpoints)):
            fail(f"journey {journey_id} contains duplicate checkpoints")
        checkpoint_alternatives = journey.get("checkpointAlternatives", {})
        if not isinstance(checkpoint_alternatives, dict):
            fail(f"journey {journey_id} checkpointAlternatives must be an object")
        for checkpoint, alternatives in checkpoint_alternatives.items():
            if checkpoint not in checkpoints:
                fail(
                    f"journey {journey_id} has alternatives for unknown checkpoint "
                    f"{checkpoint!r}"
                )
            if not isinstance(alternatives, list) or not alternatives or not all(
                isinstance(alternative, str) and alternative
                for alternative in alternatives
            ):
                fail(
                    f"journey {journey_id} checkpoint {checkpoint!r} needs a "
                    "non-empty alternatives array"
                )
            if len(alternatives) != len(set(alternatives)):
                fail(
                    f"journey {journey_id} checkpoint {checkpoint!r} contains "
                    "duplicate alternatives"
                )
        duplicate_checkpoints = all_checkpoints.intersection(checkpoints)
        if duplicate_checkpoints:
            fail(
                "checkpoint names must be globally unique: "
                + ", ".join(sorted(duplicate_checkpoints))
            )
        all_checkpoints.update(checkpoints)
        lane = journey.get("lane")
        persona = journey.get("persona")
        surfaces = journey.get("surfaces")
        estimated_seconds = journey.get("estimatedSeconds")
        credentials = journey.get("credentials", "none")
        if lane not in allowed_lanes:
            fail(f"journey {journey_id} has invalid lane: {lane!r}")
        if not isinstance(persona, str) or not persona:
            fail(f"journey {journey_id} needs a persona")
        if not isinstance(surfaces, list) or not surfaces or not all(
            isinstance(surface, str) and surface for surface in surfaces
        ):
            fail(f"journey {journey_id} needs non-empty surfaces")
        if not isinstance(estimated_seconds, int) or estimated_seconds <= 0:
            fail(f"journey {journey_id} needs a positive estimatedSeconds")
        if credentials not in {"none", "required"}:
            fail(f"journey {journey_id} has invalid credentials policy")
        if (lane in {"live", "security"}) != (credentials == "required"):
            fail(f"journey {journey_id} has a credential policy inconsistent with its lane")
        issue = journey.get("issue")
        if lane == "known-red" and (
            not isinstance(issue, str) or not issue.startswith("https://github.com/")
        ):
            fail(f"known-red journey {journey_id} needs a GitHub issue URL")
        journey_by_id[journey_id] = journey
        test_to_id[test] = journey_id

    for plan_name, plan in plans.items():
        if not isinstance(plan_name, str) or not isinstance(plan, dict):
            fail("each plan must be a named object")
        plan_journeys = plan.get("journeys")
        if not isinstance(plan_journeys, list) or not plan_journeys:
            fail(f"plan {plan_name} must select at least one journey")
        if len(plan_journeys) != len(set(plan_journeys)):
            fail(f"plan {plan_name} contains duplicate journeys")
        missing = [item for item in plan_journeys if item not in journey_by_id]
        if missing:
            fail(f"plan {plan_name} references unknown journeys: {', '.join(missing)}")

    required_plans = {
        "pr",
        "regression",
        "live",
        "security",
        "visual-accessibility",
        "stability",
        "known-red",
    }
    missing_plans = required_plans - set(plans)
    if missing_plans:
        fail(f"catalog is missing required plans: {', '.join(sorted(missing_plans))}")
    fixture_ids = {
        journey_id
        for journey_id, journey in journey_by_id.items()
        if journey["lane"] == "fixture"
    }
    if set(plans["regression"]["journeys"]) != fixture_ids:
        fail("regression plan must contain every fixture journey exactly once")
    if not set(plans["pr"]["journeys"]).issubset(fixture_ids):
        fail("pr plan may contain only fixture journeys")
    if not set(plans["stability"]["journeys"]).issubset(fixture_ids):
        fail("stability plan may contain only fixture journeys")
    for plan_name, plan in plans.items():
        repetitions = plan.get("repetitions", 1)
        if not isinstance(repetitions, int) or repetitions <= 0:
            fail(f"plan {plan_name} needs a positive repetitions value")
        if plan_name != "stability" and repetitions != 1:
            fail("only the stability plan may repeat tests")
    if plans["stability"].get("repetitions") != 3:
        fail("stability plan must run three repetitions")
    for plan_name, lane in (
        ("live", "live"),
        ("security", "security"),
        ("visual-accessibility", "accessibility"),
        ("known-red", "known-red"),
    ):
        selected_ids = set(plans[plan_name]["journeys"])
        lane_ids = {
            journey_id
            for journey_id, journey in journey_by_id.items()
            if journey["lane"] == lane
        }
        if selected_ids != lane_ids:
            fail(f"{plan_name} plan must contain every {lane} journey exactly once")

    impact_selection = catalog.get("impactSelection")
    if not isinstance(impact_selection, dict):
        fail("catalog impactSelection must be an object")
    fast_plan = impact_selection.get("fastPlan")
    fallback_plan = impact_selection.get("fallbackPlan")
    if fast_plan not in plans or fallback_plan not in plans:
        fail("impactSelection plans must reference catalog plans")
    if fast_plan == fallback_plan:
        fail("impactSelection fastPlan and fallbackPlan must differ")
    impact_rules = impact_selection.get("rules")
    if not isinstance(impact_rules, list) or not impact_rules:
        fail("impactSelection rules must be a non-empty array")
    rule_ids: set[str] = set()
    for rule in impact_rules:
        if not isinstance(rule, dict):
            fail("each impactSelection rule must be an object")
        rule_id = rule.get("id")
        patterns = rule.get("patterns")
        required_journeys = rule.get("journeys")
        if not isinstance(rule_id, str) or not rule_id or rule_id in rule_ids:
            fail("impactSelection rule ids must be unique non-empty strings")
        rule_ids.add(rule_id)
        if not isinstance(patterns, list) or not patterns or not all(
            isinstance(pattern, str) and pattern for pattern in patterns
        ):
            fail(f"impactSelection rule {rule_id} needs non-empty patterns")
        if not isinstance(required_journeys, list) or not all(
            isinstance(journey_id, str) and journey_id in journey_by_id
            for journey_id in required_journeys
        ):
            fail(f"impactSelection rule {rule_id} references unknown journeys")

    try:
        source_tests = set(TEST_PATTERN.findall(test_source.read_text(encoding="utf-8")))
    except OSError as error:
        fail(f"could not read UI test source {test_source}: {error}")
    catalog_tests = set(test_to_id)
    if source_tests != catalog_tests:
        uncataloged = sorted(source_tests - catalog_tests)
        stale = sorted(catalog_tests - source_tests)
        details = []
        if uncataloged:
            details.append(f"uncataloged tests: {', '.join(uncataloged)}")
        if stale:
            details.append(f"catalog tests missing from Swift: {', '.join(stale)}")
        fail("; ".join(details))

    catalog["_journeyById"] = journey_by_id
    catalog["_testToId"] = test_to_id
    return catalog


def selected_journeys(catalog: dict[str, Any], plan_name: str) -> list[dict[str, Any]]:
    plan = catalog["plans"].get(plan_name)
    if not isinstance(plan, dict):
        names = ", ".join(sorted(catalog["plans"]))
        fail(f"unknown app-flow plan {plan_name!r}; choose one of: {names}")
    return [catalog["_journeyById"][item] for item in plan["journeys"]]


def test_identifier(catalog: dict[str, Any], journey: dict[str, Any]) -> str:
    return f"{catalog['suite']}/{journey['test']}"


def git_output(*arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def git_bytes(*arguments: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *arguments],
        check=True,
        capture_output=True,
    )
    return result.stdout


def source_identity() -> dict[str, Any]:
    digest = hashlib.sha256()
    index_entries = {}
    for entry in git_bytes("ls-files", "-s", "-z").split(b"\0"):
        if entry and b"\t" in entry:
            metadata, raw_path = entry.split(b"\t", maxsplit=1)
            index_entries[raw_path] = metadata
    paths = sorted(
        path for path in git_bytes("ls-files", "-z", "-co", "--exclude-standard").split(b"\0") if path
    )
    for raw_path in paths:
        relative = os.fsdecode(raw_path)
        path = REPO_ROOT / relative
        digest.update(raw_path)
        digest.update(b"\0")
        if path.is_symlink():
            digest.update(b"symlink\0")
            digest.update(os.fsencode(os.readlink(path)))
        elif path.is_file():
            digest.update(f"file:{path.stat().st_mode & 0o777:o}\0".encode())
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        elif path.is_dir() and raw_path in index_entries:
            digest.update(b"gitlink\0")
            digest.update(index_entries[raw_path])
        elif raw_path in index_entries:
            digest.update(b"missing\0")
            digest.update(index_entries[raw_path])
        else:
            fail(f"source path is not a file or symlink: {relative}")
        digest.update(b"\0")
    return {
        "commit": git_output("rev-parse", "HEAD"),
        "dirty": bool(git_bytes("status", "--porcelain", "-z", "--untracked-files=all")),
        "contentSha256": digest.hexdigest(),
        "fileCount": len(paths),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        fail(f"could not hash required file {path}: {error}")
    return digest.hexdigest()


def sealed_payload(payload: dict[str, Any]) -> dict[str, Any]:
    value = dict(payload)
    canonical = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    value["seal"] = {
        "algorithm": "sha256",
        "canonicalPayloadSha256": hashlib.sha256(canonical).hexdigest(),
    }
    return value


def verify_sealed_payload(payload: dict[str, Any]) -> bool:
    seal = payload.get("seal")
    if not isinstance(seal, dict) or seal.get("algorithm") != "sha256":
        return False
    unsealed = dict(payload)
    del unsealed["seal"]
    expected = sealed_payload(unsealed)["seal"]["canonicalPayloadSha256"]
    return seal.get("canonicalPayloadSha256") == expected


def write_json_atomic(path: Path, payload: dict[str, Any], *, seal: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    value = sealed_payload(payload) if seal else payload
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def evidence_digest(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    if path.is_file():
        return {
            "kind": "file",
            "name": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
    if not path.is_dir():
        fail(f"evidence path is neither a file nor directory: {path}")
    digest = hashlib.sha256()
    file_count = 0
    total_bytes = 0
    for child in sorted(path.rglob("*")):
        relative = str(child.relative_to(path))
        if child.is_symlink():
            target = os.readlink(child)
            digest.update(f"symlink\0{relative}\0{target}\0".encode("utf-8"))
        elif child.is_file():
            size = child.stat().st_size
            child_hash = sha256_file(child)
            digest.update(
                f"file\0{relative}\0{size}\0{child_hash}\0".encode("utf-8")
            )
            file_count += 1
            total_bytes += size
    return {
        "kind": "directory",
        "name": path.name,
        "fileCount": file_count,
        "bytes": total_bytes,
        "treeSha256": digest.hexdigest(),
    }


def product_hashes(root: Path) -> list[dict[str, Any]]:
    artifacts = []
    if root.is_dir():
        for path in sorted(root.rglob("*")):
            if path.is_symlink():
                artifacts.append(
                    {
                        "path": str(path.relative_to(root)),
                        "kind": "symlink",
                        "target": os.readlink(path),
                    }
                )
            elif path.is_file():
                artifacts.append(
                    {
                        "path": str(path.relative_to(root)),
                        "kind": "file",
                        "bytes": path.stat().st_size,
                        "sha256": sha256_file(path),
                    }
                )
    return artifacts


def build_manifest_payload(
    *,
    catalog: Path,
    products: Path,
    scheme: str,
    toolchain: str,
    simulator_id: str,
) -> dict[str, Any]:
    artifacts = product_hashes(products)
    if not artifacts:
        fail(f"test products contain no hashable files: {products}")
    return {
        "schemaVersion": 1,
        "source": source_identity(),
        "catalogSha256": catalog_hash(catalog),
        "packageResolvedSha256": sha256_file(PACKAGE_RESOLVED),
        "scheme": scheme,
        "toolchain": toolchain,
        "platform": "iOS Simulator",
        "sdk": "iphonesimulator",
        "buildDestinationSimulatorId": simulator_id,
        "productArtifacts": artifacts,
    }


def verify_build_manifest_payload(
    manifest: dict[str, Any],
    *,
    catalog: Path,
    products: Path,
    scheme: str,
    toolchain: str,
) -> str | None:
    if not verify_sealed_payload(manifest):
        return "build manifest seal is invalid"
    if manifest.get("schemaVersion") != 1:
        return "build manifest schemaVersion must be 1"
    expected = {
        "source": source_identity(),
        "catalogSha256": catalog_hash(catalog),
        "packageResolvedSha256": sha256_file(PACKAGE_RESOLVED),
        "scheme": scheme,
        "toolchain": toolchain,
        "platform": "iOS Simulator",
        "sdk": "iphonesimulator",
        "productArtifacts": product_hashes(products),
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            return f"build manifest {key} does not match the current candidate"
    return None


def receipt_attestation_error(
    catalog: dict[str, Any], plan: str, attestations: Any
) -> str | None:
    if not isinstance(attestations, dict):
        return "receipt is missing evidence attestations"
    journeys = selected_journeys(catalog, plan)
    credential_policies = {
        journey.get("credentials", "none") for journey in journeys
    }
    if len(credential_policies) != 1:
        return f"plan {plan} mixes credential requirements"
    credentials_required = credential_policies == {"required"}
    expected_secret_scan = "passed" if credentials_required else "not-required"
    expected_credential_cleanup = (
        "passed" if credentials_required else "not-required"
    )
    if attestations.get("secretScan") != expected_secret_scan:
        return (
            f"plan {plan} requires secretScan={expected_secret_scan}, found "
            f"{attestations.get('secretScan')!r}"
        )
    if attestations.get("credentialCleanup") != expected_credential_cleanup:
        return (
            f"plan {plan} requires credentialCleanup={expected_credential_cleanup}, "
            f"found {attestations.get('credentialCleanup')!r}"
        )
    simulator_cleanup = attestations.get("simulatorCleanup")
    if plan == "live" and simulator_cleanup != "passed":
        return (
            "plan live requires simulatorCleanup=passed, found "
            f"{simulator_cleanup!r}"
        )
    if plan != "live" and simulator_cleanup not in {"passed", "not-owned"}:
        return f"plan {plan} has invalid simulatorCleanup={simulator_cleanup!r}"
    return None


def executed_test_evidence(
    path: Path,
    catalog: dict[str, Any],
    journeys: list[dict[str, Any]],
    repetitions: int,
) -> tuple[list[dict[str, Any]] | None, str | None]:
    try:
        tests = load_json(path)
    except ValueError as error:
        return None, str(error)
    observed: list[dict[str, Any]] = []

    def repetitions_for(test_case: dict[str, Any]) -> list[dict[str, Any]]:
        repetitions_found: list[dict[str, Any]] = []

        def visit_repetitions(value: Any) -> None:
            if isinstance(value, dict):
                if value.get("nodeType") == "Repetition":
                    repetitions_found.append(
                        {
                            "name": value.get("name"),
                            "result": value.get("result"),
                            "durationInSeconds": value.get("durationInSeconds"),
                        }
                    )
                for child in value.get("children", []):
                    visit_repetitions(child)
            elif isinstance(value, list):
                for item in value:
                    visit_repetitions(item)

        visit_repetitions(test_case.get("children", []))
        return repetitions_found

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("nodeType") == "Test Case":
                repetition_evidence = repetitions_for(value)
                observed.append(
                    {
                        "identifier": value.get("nodeIdentifier"),
                        "result": value.get("result"),
                        "durationInSeconds": value.get("durationInSeconds"),
                        "executionCount": len(repetition_evidence) or 1,
                        "repetitions": repetition_evidence,
                    }
                )
            for child in value.get("children", []):
                visit(child)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(tests.get("testNodes", []))
    class_name = catalog["suite"].split("/", maxsplit=1)[-1]
    expected = {f"{class_name}/{journey['test']}()" for journey in journeys}
    actual_identifiers = [
        item["identifier"] for item in observed if isinstance(item.get("identifier"), str)
    ]
    actual = set(actual_identifiers)
    execution_counts = {
        item["identifier"]: item["executionCount"]
        for item in observed
        if isinstance(item.get("identifier"), str)
    }
    if actual != expected or any(
        actual_identifiers.count(identifier) != 1
        or execution_counts.get(identifier) != repetitions
        for identifier in expected
    ):
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        parts = []
        if missing:
            parts.append("missing executed tests: " + ", ".join(missing))
        if unexpected:
            parts.append("unexpected executed tests: " + ", ".join(unexpected))
        wrong_counts = sorted(
            identifier
            for identifier in expected
            if actual_identifiers.count(identifier) != 1
            or execution_counts.get(identifier) != repetitions
        )
        if wrong_counts:
            parts.append(
                f"expected {repetitions} execution(s) for: " + ", ".join(wrong_counts)
            )
        return observed, "; ".join(parts)
    if any(item.get("result") != "Passed" for item in observed) or any(
        repetition.get("result") != "Passed"
        for item in observed
        for repetition in item["repetitions"]
    ):
        return observed, "one or more selected test identifiers did not pass"
    return observed, None


def unit_test_evidence(
    path: Path, required_suffixes: list[str], allowed_skip_suffixes: list[str]
) -> tuple[list[dict[str, Any]] | None, str | None]:
    try:
        tests = load_json(path)
    except ValueError as error:
        return None, str(error)
    observed: list[dict[str, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("nodeType") == "Test Case":
                observed.append(
                    {
                        "identifier": value.get("nodeIdentifier"),
                        "result": value.get("result"),
                        "durationInSeconds": value.get("durationInSeconds"),
                    }
                )
            for child in value.get("children", []):
                visit(child)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(tests.get("testNodes", []))
    identifiers = [
        item["identifier"] for item in observed if isinstance(item.get("identifier"), str)
    ]
    if len(identifiers) != len(observed):
        return observed, "unit test inventory contains a test case without an identifier"
    duplicates = sorted(
        identifier for identifier in set(identifiers) if identifiers.count(identifier) != 1
    )
    if duplicates:
        return observed, "unit test inventory contains duplicate identifiers: " + ", ".join(
            duplicates
        )
    missing = [
        suffix
        for suffix in required_suffixes
        if sum(identifier.endswith(suffix) for identifier in identifiers) != 1
    ]
    if missing:
        return observed, "required unit tests missing or duplicated: " + ", ".join(missing)
    if not observed:
        return observed, "unit test inventory contains no test cases"
    skipped = [
        item["identifier"]
        for item in observed
        if item.get("result") == "Skipped" and isinstance(item.get("identifier"), str)
    ]
    unmatched_skips = [
        identifier
        for identifier in skipped
        if not any(identifier.endswith(suffix) for suffix in allowed_skip_suffixes)
    ]
    missing_allowed_skips = [
        suffix
        for suffix in allowed_skip_suffixes
        if sum(identifier.endswith(suffix) for identifier in skipped) != 1
    ]
    if unmatched_skips or missing_allowed_skips:
        return observed, (
            "native unit skip inventory did not match the explicit allowlist: "
            f"unexpected={unmatched_skips}, missing_or_duplicated={missing_allowed_skips}"
        )
    if any(item.get("result") not in {"Passed", "Skipped"} for item in observed):
        return observed, "one or more native unit tests did not pass"
    return observed, None


def attachment_evidence(
    root: Path, journeys: list[dict[str, Any]]
) -> tuple[dict[str, Any] | None, str | None]:
    manifest_path = root / "manifest.json"
    expected = [
        (
            checkpoint,
            extension,
            {
                checkpoint,
                *journey.get("checkpointAlternatives", {}).get(checkpoint, []),
            },
        )
        for journey in journeys
        for checkpoint in journey["checkpoints"]
        for extension in ("png", "txt")
    ]
    if not manifest_path.is_file():
        return None, f"attachment manifest does not exist: {manifest_path}"
    try:
        manifest_value = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return None, f"could not read attachment manifest: {error}"
    if not isinstance(manifest_value, list):
        return None, "attachment manifest must be an array"

    observed: set[tuple[str, str]] = set()
    files = []
    for test in manifest_value:
        if not isinstance(test, dict) or not isinstance(test.get("attachments"), list):
            return None, "attachment manifest contains an invalid test entry"
        for attachment in test["attachments"]:
            if not isinstance(attachment, dict):
                return None, "attachment manifest contains an invalid attachment"
            filename = attachment.get("exportedFileName")
            suggested = attachment.get("suggestedHumanReadableName")
            if not isinstance(filename, str) or not isinstance(suggested, str):
                return None, "attachment manifest is missing attachment names"
            path = root / filename
            if not path.is_file():
                return None, f"exported attachment does not exist: {path}"
            extension = path.suffix.removeprefix(".")
            checkpoint_name = re.sub(
                r"_[0-9]+_[A-Fa-f0-9-]+\.(png|txt)$", "", suggested
            )
            checkpoint = checkpoint_name.removesuffix("-accessibility")
            observed.add((checkpoint, extension))
            files.append(
                {
                    "checkpoint": checkpoint,
                    "kind": "screenshot" if extension == "png" else "accessibility",
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    missing = sorted(
        (checkpoint, extension)
        for checkpoint, extension, accepted_names in expected
        if not any(
            (accepted_name, extension) in observed
            for accepted_name in accepted_names
        )
    )
    if missing:
        formatted = ", ".join(f"{name}.{extension}" for name, extension in missing)
        return None, f"missing required checkpoint attachments: {formatted}"
    return {"manifest": manifest_value, "artifacts": files}, None


def catalog_hash(path: Path) -> str:
    return sha256_file(path)


def command_check(args: argparse.Namespace) -> int:
    catalog = catalog_data(args.catalog, args.test_source)
    print(
        f"app-flow catalog valid: {len(catalog['journeys'])} journeys, "
        f"{len(catalog['plans'])} plans"
    )
    return 0


def command_resolve(args: argparse.Namespace) -> int:
    catalog = catalog_data(args.catalog, args.test_source)
    for journey in selected_journeys(catalog, args.plan):
        print(test_identifier(catalog, journey))
    return 0


def command_select_plan(args: argparse.Namespace) -> int:
    catalog = catalog_data(args.catalog, args.test_source)
    if args.changed_files is not None:
        try:
            changed_files = args.changed_files.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            fail(f"could not read changed-file metadata: {error}")
        comparison = {"kind": "changed-file-list", "path": str(args.changed_files)}
    else:
        if not args.base_ref:
            fail("select-plan needs --changed-files or --base-ref")
        head_ref = args.head_ref or "HEAD"
        changed_files = git_output(
            "diff", "--name-only", "--diff-filter=ACDMRTUXB", f"{args.base_ref}...{head_ref}"
        ).splitlines()
        comparison = {
            "kind": "git-diff",
            "baseRef": args.base_ref,
            "baseCommit": git_output("rev-parse", args.base_ref),
            "headRef": head_ref,
            "headCommit": git_output("rev-parse", head_ref),
        }

    normalized_files = []
    for raw_path in changed_files:
        path = raw_path.strip()
        if not path:
            continue
        if path.startswith("/") or ".." in Path(path).parts:
            fail(f"changed-file metadata contains an unsafe path: {path}")
        normalized_files.append(path)
    normalized_files = sorted(set(normalized_files))

    impact = catalog["impactSelection"]
    required_journeys: set[str] = set()
    matched_rules: dict[str, list[str]] = {}
    unmatched_files = []
    for path in normalized_files:
        path_rules = []
        for rule in impact["rules"]:
            if any(fnmatch.fnmatchcase(path, pattern) for pattern in rule["patterns"]):
                path_rules.append(rule["id"])
                required_journeys.update(rule["journeys"])
        if path_rules:
            matched_rules[path] = sorted(path_rules)
        else:
            unmatched_files.append(path)

    fast_journeys = set(catalog["plans"][impact["fastPlan"]]["journeys"])
    fallback_reasons = []
    if not normalized_files:
        fallback_reasons.append("changed-file metadata was empty")
    if unmatched_files:
        fallback_reasons.append("one or more changed files had no reviewed impact rule")
    outside_fast_plan = sorted(required_journeys - fast_journeys)
    if outside_fast_plan:
        fallback_reasons.append("required journeys are outside the fast plan")
    selected_plan = impact["fallbackPlan"] if fallback_reasons else impact["fastPlan"]
    decision = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "catalogSha256": catalog_hash(args.catalog),
        "comparison": comparison,
        "changedFiles": normalized_files,
        "matchedRulesByFile": matched_rules,
        "unmatchedFiles": unmatched_files,
        "requiredJourneys": sorted(required_journeys),
        "fastPlan": impact["fastPlan"],
        "fallbackPlan": impact["fallbackPlan"],
        "selectedPlan": selected_plan,
        "fallbackReasons": fallback_reasons,
    }
    write_json_atomic(args.output, decision, seal=True)
    print(selected_plan)
    return 0


def command_plan_field(args: argparse.Namespace) -> int:
    catalog = catalog_data(args.catalog, args.test_source)
    journeys = selected_journeys(catalog, args.plan)
    if args.field == "credentials":
        values = {journey.get("credentials", "none") for journey in journeys}
        if len(values) != 1:
            fail(f"plan {args.plan} mixes credential requirements")
        print(values.pop())
    elif args.field == "known-red":
        print("1" if all(journey.get("lane") == "known-red" for journey in journeys) else "0")
    elif args.field == "repetitions":
        print(catalog["plans"][args.plan].get("repetitions", 1))
    elif args.field == "timeout":
        repetitions = catalog["plans"][args.plan].get("repetitions", 1)
        estimate = sum(journey["estimatedSeconds"] for journey in journeys) * repetitions
        # Allow both a full second estimate and five minutes of fixed startup /
        # diagnostics headroom. The outer CI timeout remains deliberately larger.
        print(estimate + max(estimate, 300))
    return 0


def command_source_hash(_: argparse.Namespace) -> int:
    print(source_identity()["contentSha256"])
    return 0


def command_write_build_manifest(args: argparse.Namespace) -> int:
    payload = build_manifest_payload(
        catalog=args.catalog,
        products=args.test_products,
        scheme=args.scheme,
        toolchain=args.toolchain,
        simulator_id=args.simulator_id,
    )
    if payload["source"]["contentSha256"] != args.expected_source_hash:
        fail("source changed while test products were being built")
    write_json_atomic(args.output, payload, seal=True)
    print(f"app-flow build manifest: {args.output}")
    return 0


def command_verify_build_manifest(args: argparse.Namespace) -> int:
    manifest = load_json(args.manifest)
    error = verify_build_manifest_payload(
        manifest,
        catalog=args.catalog,
        products=args.test_products,
        scheme=args.scheme,
        toolchain=args.toolchain,
    )
    if error is not None:
        fail(error)
    print(f"app-flow build manifest valid: {args.manifest}")
    return 0


def command_receipt(args: argparse.Namespace) -> int:
    catalog = catalog_data(args.catalog, args.test_source)
    journeys = selected_journeys(catalog, args.plan)
    repetitions = catalog["plans"][args.plan].get("repetitions", 1)
    summary: dict[str, Any] | None = None
    summary_error: str | None = None
    if args.summary.is_file():
        try:
            summary = load_json(args.summary)
        except ValueError as error:
            summary_error = str(error)
    else:
        summary_error = f"summary does not exist: {args.summary}"

    expected_test_count = len(journeys)
    expected_execution_count = expected_test_count * repetitions
    attachments, attachment_error = attachment_evidence(args.attachments, journeys)
    executed_tests, test_inventory_error = executed_test_evidence(
        args.tests, catalog, journeys, repetitions
    )
    run_devices = summary.get("devicesAndConfigurations", []) if summary else []
    configuration_counts_valid = bool(
        len(run_devices) == 1
        and isinstance(run_devices[0], dict)
        and run_devices[0].get("passedTests") == expected_execution_count
        and run_devices[0].get("failedTests") == 0
        and run_devices[0].get("skippedTests") == 0
        and run_devices[0].get("expectedFailures") == 0
    )
    summary_valid = bool(
        summary
        and summary.get("result") == "Passed"
        and summary.get("totalTestCount") == expected_test_count
        and summary.get("passedTests") == expected_test_count
        and summary.get("failedTests") == 0
        and summary.get("skippedTests") == 0
        and summary.get("expectedFailures") == 0
        and configuration_counts_valid
    )
    run_destination = (
        run_devices[0].get("device")
        if len(run_devices) == 1 and isinstance(run_devices[0], dict)
        else None
    )
    destination_valid = bool(
        isinstance(run_destination, dict)
        and run_destination.get("deviceId") == args.simulator_id
        and (
            not args.expected_simulator_name
            or run_destination.get("deviceName") == args.expected_simulator_name
        )
        and (
            not args.expected_simulator_os
            or run_destination.get("osVersion") == args.expected_simulator_os
        )
    )
    build_manifest = load_json(args.build_manifest)
    build_manifest_error = verify_build_manifest_payload(
        build_manifest,
        catalog=args.catalog,
        products=args.test_products,
        scheme=args.scheme,
        toolchain=args.toolchain,
    )
    attestations = {
        "secretScan": args.secret_scan_status,
        "credentialCleanup": args.credential_cleanup_status,
        "simulatorCleanup": args.simulator_cleanup_status,
    }
    attestation_error = receipt_attestation_error(catalog, args.plan, attestations)
    selection_decision = None
    selection_error = None
    if args.selection_decision is not None:
        try:
            selection_decision = load_json(args.selection_decision)
        except ValueError as error:
            selection_error = str(error)
        if selection_decision is not None and (
            selection_decision.get("selectedPlan") != args.plan
            or selection_decision.get("catalogSha256") != catalog_hash(args.catalog)
        ):
            selection_error = (
                "selection decision did not match the executed plan and catalog"
            )
    passed = (
        args.xcode_status == 0
        and summary_valid
        and destination_valid
        and attachment_error is None
        and test_inventory_error is None
        and build_manifest_error is None
        and selection_error is None
        and attestation_error is None
    )
    if summary is not None and not summary_valid:
        summary_error = (
            "summary did not match the selected plan: "
            f"expected {expected_test_count} passing tests and "
            f"{expected_execution_count} passing executions with zero "
            "failed/skipped/expected failures"
        )
    if summary_error is None and not destination_valid:
        summary_error = (
            "xcresult destination did not match the selected Simulator contract: "
            f"id={args.simulator_id!r}, name={args.expected_simulator_name!r}, "
            f"os={args.expected_simulator_os!r}"
        )
    for validation_error in (
        attachment_error,
        test_inventory_error,
        build_manifest_error,
        selection_error,
        attestation_error,
    ):
        if summary_error is None and validation_error is not None:
            summary_error = validation_error

    receipt = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "verdict": "passed" if passed else "failed",
        "plan": args.plan,
        "repetitions": repetitions,
        "catalog": {
            "path": str(args.catalog.relative_to(REPO_ROOT)),
            "sha256": catalog_hash(args.catalog),
        },
        "source": build_manifest["source"],
        "impactSelection": selection_decision
        or {"kind": "direct", "selectedPlan": args.plan},
        "selection": [
            {
                "journey": journey["id"],
                "testIdentifier": test_identifier(catalog, journey),
                "persona": journey["persona"],
            }
            for journey in journeys
        ],
        "execution": {
            "xcodeStatus": args.xcode_status,
            "summary": summary,
            "executedTests": executed_tests,
            "validationError": summary_error,
            "runDestinationSimulatorId": args.simulator_id,
            "runDestination": run_destination,
            "attemptTelemetry": {
                "attemptCount": sum(
                    item.get("executionCount", 0) for item in (executed_tests or [])
                ),
                "firstAttemptPassed": all(
                    (
                        not item.get("repetitions")
                        and item.get("result") == "Passed"
                    )
                    or (
                        item.get("repetitions")
                        and item["repetitions"][0].get("result") == "Passed"
                    )
                    for item in (executed_tests or [])
                ),
                "passAfterFailure": any(
                    any(
                        repetition.get("result") != "Passed"
                        for repetition in item.get("repetitions", [])[:-1]
                    )
                    and item.get("repetitions", [])[-1].get("result") == "Passed"
                    for item in (executed_tests or [])
                ),
                "totalDurationInSeconds": sum(
                    sum(
                        repetition.get("durationInSeconds") or 0
                        for repetition in item.get("repetitions", [])
                    )
                    if item.get("repetitions")
                    else item.get("durationInSeconds") or 0
                    for item in (executed_tests or [])
                ),
            },
        },
        "evidence": {
            "resultBundle": args.result_bundle.name,
            "summary": args.summary.name,
            "testInventory": args.tests.name,
            "testProducts": args.test_products.name,
            "buildManifest": build_manifest,
            "attachments": args.attachments.name,
            "attachmentEvidence": attachments,
            "xcodeLog": args.xcode_log.name if args.xcode_log.is_file() else None,
            "retainedArtifactDigests": {
                "resultBundle": evidence_digest(args.result_bundle),
                "summary": evidence_digest(args.summary),
                "testInventory": evidence_digest(args.tests),
                "attachments": evidence_digest(args.attachments),
                "xcodeLog": evidence_digest(args.xcode_log),
            },
            "attestations": attestations,
        },
    }
    write_json_atomic(args.output, receipt, seal=True)
    print(f"app-flow receipt: {args.output}")
    if not passed:
        print(summary_error or f"xcodebuild exited {args.xcode_status}", file=sys.stderr)
        return 1
    return 0


def command_unit_receipt(args: argparse.Namespace) -> int:
    summary: dict[str, Any] | None = None
    validation_error: str | None = None
    try:
        summary = load_json(args.summary)
    except ValueError as error:
        validation_error = str(error)

    executed_tests, inventory_error = unit_test_evidence(
        args.tests, args.required_test, args.allowed_skip
    )
    if validation_error is None and inventory_error is not None:
        validation_error = inventory_error

    summary_valid = bool(
        summary
        and summary.get("result") == "Passed"
        and isinstance(summary.get("totalTestCount"), int)
        and summary["totalTestCount"] > 0
        and summary.get("passedTests")
        == summary["totalTestCount"] - len(args.allowed_skip)
        and summary.get("failedTests") == 0
        and summary.get("skippedTests") == len(args.allowed_skip)
        and summary.get("expectedFailures") == 0
        and executed_tests is not None
        and summary.get("totalTestCount") == len(executed_tests)
    )
    if validation_error is None and not summary_valid:
        validation_error = (
            "native unit summary must contain one or more passed tests with "
            "zero failures and exactly the explicitly allowed skips"
        )

    run_devices = summary.get("devicesAndConfigurations", []) if summary else []
    run_destination = (
        run_devices[0].get("device")
        if len(run_devices) == 1 and isinstance(run_devices[0], dict)
        else None
    )
    destination_valid = bool(
        isinstance(run_destination, dict)
        and run_destination.get("deviceId") == args.simulator_id
        and (
            not args.expected_simulator_name
            or run_destination.get("deviceName") == args.expected_simulator_name
        )
        and (
            not args.expected_simulator_os
            or run_destination.get("osVersion") == args.expected_simulator_os
        )
    )
    if validation_error is None and not destination_valid:
        validation_error = "native unit result destination did not match the Simulator contract"

    build_manifest = load_json(args.build_manifest)
    manifest_error = verify_build_manifest_payload(
        build_manifest,
        catalog=args.catalog,
        products=args.test_products,
        scheme=args.scheme,
        toolchain=args.toolchain,
    )
    if validation_error is None and manifest_error is not None:
        validation_error = manifest_error

    passed = (
        args.xcode_status == 0
        and summary_valid
        and destination_valid
        and inventory_error is None
        and manifest_error is None
    )
    receipt = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "verdict": "passed" if passed else "failed",
        "source": build_manifest.get("source"),
        "requiredTests": args.required_test,
        "allowedSkips": args.allowed_skip,
        "execution": {
            "xcodeStatus": args.xcode_status,
            "summary": summary,
            "executedTests": executed_tests,
            "validationError": validation_error,
            "runDestinationSimulatorId": args.simulator_id,
            "runDestination": run_destination,
        },
        "evidence": {
            "resultBundle": args.result_bundle.name,
            "summary": args.summary.name,
            "testInventory": args.tests.name,
            "testProducts": args.test_products.name,
            "buildManifest": build_manifest,
            "retainedArtifactDigests": {
                "resultBundle": evidence_digest(args.result_bundle),
                "summary": evidence_digest(args.summary),
                "testInventory": evidence_digest(args.tests),
            },
        },
    }
    write_json_atomic(args.output, receipt, seal=True)
    print(f"native unit receipt: {args.output}")
    if not passed:
        print(validation_error or f"xcodebuild exited {args.xcode_status}", file=sys.stderr)
        return 1
    return 0


def command_ledger(args: argparse.Namespace) -> int:
    components = []
    catalog = catalog_data(args.catalog, args.test_source)
    expected_plans = set(args.expected_plan)
    if len(expected_plans) != len(args.expected_plan):
        fail("expected ledger plans must be unique")
    for path in args.receipt:
        payload = load_json(path)
        if not verify_sealed_payload(payload):
            fail(f"receipt seal is invalid: {path}")
        raw_plan = payload.get("plan")
        if raw_plan is None:
            if not isinstance(payload.get("requiredTests"), list) or not isinstance(
                payload.get("allowedSkips"), list
            ):
                fail(f"receipt has no recognized plan identity: {path}")
            plan = "native-unit"
        elif isinstance(raw_plan, str) and raw_plan:
            plan = raw_plan
        else:
            fail(f"receipt has an invalid plan identity: {path}")
        telemetry = payload.get("execution", {}).get("attemptTelemetry")
        if plan == "native-unit":
            telemetry = {}
        elif (
            not isinstance(telemetry, dict)
            or not isinstance(telemetry.get("attemptCount"), int)
            or isinstance(telemetry.get("attemptCount"), bool)
            or telemetry["attemptCount"] < 1
            or not isinstance(telemetry.get("firstAttemptPassed"), bool)
            or not isinstance(telemetry.get("passAfterFailure"), bool)
            or not isinstance(telemetry.get("totalDurationInSeconds"), (int, float))
            or isinstance(telemetry.get("totalDurationInSeconds"), bool)
            or telemetry["totalDurationInSeconds"] < 0
        ):
            fail(f"receipt has incomplete attempt telemetry: {path}")
        build_manifest = payload.get("evidence", {}).get("buildManifest")
        if not isinstance(build_manifest, dict) or not verify_sealed_payload(build_manifest):
            fail(f"receipt does not contain a sealed build manifest: {path}")
        if payload.get("source") != build_manifest.get("source"):
            fail(f"receipt source does not match its build manifest: {path}")
        if plan != "native-unit":
            attestation_error = receipt_attestation_error(
                catalog, plan, payload.get("evidence", {}).get("attestations")
            )
            if attestation_error is not None:
                fail(f"receipt attestations are invalid: {path}: {attestation_error}")
        components.append(
            {
                "receipt": path.name,
                "receiptSha256": sha256_file(path),
                "verdict": payload.get("verdict"),
                "plan": plan,
                "source": payload.get("source"),
                "buildManifestSeal": build_manifest["seal"]["canonicalPayloadSha256"],
                "attemptTelemetry": telemetry,
            }
        )
    actual_plans = [component["plan"] for component in components]
    if len(actual_plans) != len(set(actual_plans)):
        fail("ledger component plans must be unique")
    if set(actual_plans) != expected_plans:
        fail(
            "ledger component plans did not match the expected set: "
            f"expected {sorted(expected_plans)}, found {sorted(actual_plans)}"
        )
    if any(not isinstance(component["source"], dict) for component in components):
        fail("ledger component is missing its source candidate")
    source_identities = {
        json.dumps(
            component["source"], sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        for component in components
    }
    if len(source_identities) != 1:
        fail("ledger components do not describe one source candidate")
    build_manifest_seals = {
        component["buildManifestSeal"] for component in components
    }
    if len(build_manifest_seals) != 1:
        fail("ledger components do not use one frozen build product")
    all_passed = all(component["verdict"] == "passed" for component in components)
    first_attempt_passed = all(
        component["attemptTelemetry"].get("firstAttemptPassed", True)
        for component in components
    )
    pass_after_failure = any(
        component["attemptTelemetry"].get("passAfterFailure", False)
        for component in components
    )
    verdict = (
        "passed"
        if all_passed and first_attempt_passed and not pass_after_failure
        else "failed"
    )
    ledger = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "policy": {
            "retryGreenAllowed": False,
            "firstAttemptRequired": True,
        },
        "components": components,
        "aggregate": {
            "componentCount": len(components),
            "allComponentsPassed": all_passed,
            "firstAttemptPassed": first_attempt_passed,
            "passAfterFailure": pass_after_failure,
            "totalRecordedDurationInSeconds": sum(
                component["attemptTelemetry"].get("totalDurationInSeconds", 0)
                for component in components
            ),
            "simulatorCleanup": args.simulator_cleanup_status,
        },
    }
    write_json_atomic(args.output, ledger, seal=True)
    print(f"verification ledger: {args.output}")
    return 0 if verdict == "passed" else 1


def command_release_receipt(args: argparse.Namespace) -> int:
    payload = load_json(args.input)
    required_strings = ("sourceCommit", "candidateContentSha256", "channel")
    if any(not isinstance(payload.get(key), str) or not payload[key] for key in required_strings):
        fail("release evidence needs sourceCommit, candidateContentSha256, and channel")
    if not re.fullmatch(r"[0-9a-f]{40}", payload["sourceCommit"]):
        fail("release sourceCommit must be a lowercase 40-character Git SHA")
    if not re.fullmatch(r"[0-9a-f]{64}", payload["candidateContentSha256"]):
        fail("release candidateContentSha256 must be a lowercase SHA-256")
    if payload["sourceCommit"] != args.expected_source_commit:
        fail("release evidence source commit did not match the protected candidate")
    if payload["candidateContentSha256"] != args.expected_candidate_content_sha256:
        fail("release evidence content hash did not match the protected candidate")
    artifact_root = args.artifact_root.resolve()
    if not artifact_root.is_dir():
        fail("release artifact root must be a directory")
    if payload["channel"] not in {"dev", "test", "testflight"}:
        fail("release channel must be dev, test, or testflight")
    build = payload.get("build")
    device = payload.get("device")
    cleanup = payload.get("cleanup")
    checks = payload.get("checks")
    if not isinstance(build, dict) or not all(
        isinstance(build.get(key), str) and build[key] for key in ("version", "number")
    ):
        fail("release evidence needs non-empty build version and number")
    if not isinstance(device, dict) or device.get("kind") != "physical" or not all(
        isinstance(device.get(key), str) and device[key]
        for key in ("id", "model", "osVersion")
    ):
        fail("release evidence must identify one physical device")
    if not isinstance(checks, list) or not checks:
        fail("release evidence needs at least one check")
    check_ids = set()
    artifact_names = set()
    for check in checks:
        if not isinstance(check, dict):
            fail("each release check must be an object")
        check_id = check.get("id")
        if not isinstance(check_id, str) or not check_id or check_id in check_ids:
            fail("release check ids must be unique non-empty strings")
        check_ids.add(check_id)
        if check.get("result") != "passed":
            fail(f"release check did not pass: {check_id}")
        evidence = check.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            fail(f"release check has no content-addressed evidence: {check_id}")
        for artifact in evidence:
            if (
                not isinstance(artifact, dict)
                or not isinstance(artifact.get("name"), str)
                or not artifact["name"]
                or not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get("sha256", "")))
            ):
                fail(f"release check has invalid evidence digest: {check_id}")
            if artifact["name"] in artifact_names:
                fail(f"release evidence artifact names must be unique: {artifact['name']}")
            artifact_names.add(artifact["name"])
            artifact_path = artifact_root / artifact["name"]
            try:
                resolved_artifact = artifact_path.resolve(strict=True)
            except OSError as error:
                fail(f"release evidence artifact is missing: {artifact['name']}: {error}")
            if artifact_root not in resolved_artifact.parents or not resolved_artifact.is_file():
                fail(f"release evidence artifact escapes its root: {artifact['name']}")
            if sha256_file(resolved_artifact) != artifact["sha256"]:
                fail(f"release evidence artifact digest changed: {artifact['name']}")
    mutations = payload.get("authorizedMutations")
    if not isinstance(mutations, list) or not all(isinstance(item, str) for item in mutations):
        fail("authorizedMutations must be a string array")
    if not isinstance(cleanup, dict) or cleanup.get("status") != "passed":
        fail("release evidence must attest successful cleanup")
    if payload["channel"] == "testflight" and payload.get("fixtureLaunchDisabled") is not True:
        fail("TestFlight evidence must attest that fixture launch is disabled")
    receipt = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "verdict": "passed",
        "kind": "physical-device-release-evidence",
        "candidate": {
            "sourceCommit": payload["sourceCommit"],
            "contentSha256": payload["candidateContentSha256"],
            "channel": payload["channel"],
            "build": build,
        },
        "device": device,
        "fixtureLaunchDisabled": payload.get("fixtureLaunchDisabled"),
        "authorizedMutations": mutations,
        "checks": checks,
        "cleanup": cleanup,
    }
    write_json_atomic(args.output, receipt, seal=True)
    print(f"release evidence receipt: {args.output}")
    return 0


def validate_live_backend_manifest(path: Path) -> dict[str, Any]:
    manifest = load_json(path)
    forbidden_keys = {"token", "server", "credential", "credentials", "secret"}

    def check_keys(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key.lower() in forbidden_keys:
                    fail(f"live backend manifest contains forbidden secret field: {key}")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)

    check_keys(manifest)
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("disposable") is not True
        or manifest.get("projectName") != "App Flow Regression Fixture"
        or not isinstance(manifest.get("backendId"), str)
        or not manifest["backendId"]
    ):
        fail("live backend manifest does not describe the required disposable seed")
    allowed_keys = {"schemaVersion", "disposable", "backendId", "projectName"}
    unexpected_keys = set(manifest) - allowed_keys
    if unexpected_keys:
        fail(
            "live backend manifest contains non-whitelisted fields: "
            + ", ".join(sorted(unexpected_keys))
        )
    return manifest


def command_validate_live_backend_manifest(args: argparse.Namespace) -> int:
    validate_live_backend_manifest(args.manifest)
    print(f"live backend manifest valid: {args.manifest}")
    return 0


def command_live_backend_receipt(args: argparse.Namespace) -> int:
    manifest = validate_live_backend_manifest(args.manifest)
    actual_adapter_sha = sha256_file(args.adapter)
    if actual_adapter_sha != args.expected_adapter_sha256:
        fail("live backend adapter digest changed")
    component = load_json(args.component_receipt)
    if (
        not verify_sealed_payload(component)
        or component.get("verdict") != "passed"
        or component.get("plan") != "live"
    ):
        fail("live component receipt is not a sealed passing live receipt")
    if args.cleanup_status != "passed":
        fail("disposable backend cleanup did not pass")
    receipt = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "verdict": "passed",
        "kind": "owned-disposable-live-backend",
        "adapter": {"name": args.adapter.name, "sha256": actual_adapter_sha},
        "backend": manifest,
        "componentReceipt": {
            "name": args.component_receipt.name,
            "sha256": sha256_file(args.component_receipt),
        },
        "cleanup": {"status": args.cleanup_status},
    }
    write_json_atomic(args.output, receipt, seal=True)
    print(f"live backend receipt: {args.output}")
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    result.add_argument("--test-source", type=Path, default=DEFAULT_TEST_SOURCE)
    commands = result.add_subparsers(dest="command", required=True)

    check = commands.add_parser("check")
    check.set_defaults(run=command_check)

    resolve = commands.add_parser("resolve")
    resolve.add_argument("--plan", required=True)
    resolve.set_defaults(run=command_resolve)

    select_plan = commands.add_parser("select-plan")
    selection_input = select_plan.add_mutually_exclusive_group(required=True)
    selection_input.add_argument("--changed-files", type=Path)
    selection_input.add_argument("--base-ref")
    select_plan.add_argument("--head-ref", default="HEAD")
    select_plan.add_argument("--output", type=Path, required=True)
    select_plan.set_defaults(run=command_select_plan)

    field = commands.add_parser("plan-field")
    field.add_argument("--plan", required=True)
    field.add_argument(
        "--field",
        required=True,
        choices=["credentials", "known-red", "repetitions", "timeout"],
    )
    field.set_defaults(run=command_plan_field)

    source_hash = commands.add_parser("source-hash")
    source_hash.set_defaults(run=command_source_hash)

    build_manifest = commands.add_parser("write-build-manifest")
    build_manifest.add_argument("--output", type=Path, required=True)
    build_manifest.add_argument("--test-products", type=Path, required=True)
    build_manifest.add_argument("--scheme", required=True)
    build_manifest.add_argument("--toolchain", required=True)
    build_manifest.add_argument("--simulator-id", required=True)
    build_manifest.add_argument("--expected-source-hash", required=True)
    build_manifest.set_defaults(run=command_write_build_manifest)

    verify_manifest = commands.add_parser("verify-build-manifest")
    verify_manifest.add_argument("--manifest", type=Path, required=True)
    verify_manifest.add_argument("--test-products", type=Path, required=True)
    verify_manifest.add_argument("--scheme", required=True)
    verify_manifest.add_argument("--toolchain", required=True)
    verify_manifest.set_defaults(run=command_verify_build_manifest)

    receipt = commands.add_parser("receipt")
    receipt.add_argument("--plan", required=True)
    receipt.add_argument("--summary", type=Path, required=True)
    receipt.add_argument("--tests", type=Path, required=True)
    receipt.add_argument("--output", type=Path, required=True)
    receipt.add_argument("--result-bundle", type=Path, required=True)
    receipt.add_argument("--test-products", type=Path, required=True)
    receipt.add_argument("--attachments", type=Path, required=True)
    receipt.add_argument("--build-manifest", type=Path, required=True)
    receipt.add_argument("--scheme", required=True)
    receipt.add_argument("--toolchain", required=True)
    receipt.add_argument("--simulator-id", required=True)
    receipt.add_argument("--expected-simulator-name", default="")
    receipt.add_argument("--expected-simulator-os", default="")
    receipt.add_argument("--xcode-log", type=Path, required=True)
    receipt.add_argument("--xcode-status", type=int, required=True)
    receipt.add_argument("--selection-decision", type=Path)
    receipt.add_argument(
        "--secret-scan-status",
        choices=["passed", "not-required"],
        required=True,
    )
    receipt.add_argument(
        "--credential-cleanup-status",
        choices=["passed", "not-required", "failed"],
        required=True,
    )
    receipt.add_argument(
        "--simulator-cleanup-status",
        choices=["passed", "not-owned", "failed"],
        required=True,
    )
    receipt.set_defaults(run=command_receipt)

    unit_receipt = commands.add_parser("unit-receipt")
    unit_receipt.add_argument("--summary", type=Path, required=True)
    unit_receipt.add_argument("--tests", type=Path, required=True)
    unit_receipt.add_argument("--output", type=Path, required=True)
    unit_receipt.add_argument("--result-bundle", type=Path, required=True)
    unit_receipt.add_argument("--test-products", type=Path, required=True)
    unit_receipt.add_argument("--build-manifest", type=Path, required=True)
    unit_receipt.add_argument("--scheme", required=True)
    unit_receipt.add_argument("--toolchain", required=True)
    unit_receipt.add_argument("--simulator-id", required=True)
    unit_receipt.add_argument("--expected-simulator-name", default="")
    unit_receipt.add_argument("--expected-simulator-os", default="")
    unit_receipt.add_argument("--required-test", action="append", required=True)
    unit_receipt.add_argument("--allowed-skip", action="append", default=[])
    unit_receipt.add_argument("--xcode-status", type=int, required=True)
    unit_receipt.set_defaults(run=command_unit_receipt)

    ledger = commands.add_parser("ledger")
    ledger.add_argument("--receipt", type=Path, action="append", required=True)
    ledger.add_argument("--expected-plan", action="append", required=True)
    ledger.add_argument("--output", type=Path, required=True)
    ledger.add_argument(
        "--simulator-cleanup-status",
        choices=["passed", "not-owned"],
        required=True,
    )
    ledger.set_defaults(run=command_ledger)

    release_receipt = commands.add_parser("release-receipt")
    release_receipt.add_argument("--input", type=Path, required=True)
    release_receipt.add_argument("--output", type=Path, required=True)
    release_receipt.add_argument("--artifact-root", type=Path, required=True)
    release_receipt.add_argument("--expected-source-commit", required=True)
    release_receipt.add_argument(
        "--expected-candidate-content-sha256", required=True
    )
    release_receipt.set_defaults(run=command_release_receipt)

    live_backend_receipt = commands.add_parser("live-backend-receipt")
    live_backend_receipt.add_argument("--manifest", type=Path, required=True)
    live_backend_receipt.add_argument("--adapter", type=Path, required=True)
    live_backend_receipt.add_argument("--expected-adapter-sha256", required=True)
    live_backend_receipt.add_argument("--component-receipt", type=Path, required=True)
    live_backend_receipt.add_argument("--cleanup-status", choices=["passed", "failed"], required=True)
    live_backend_receipt.add_argument("--output", type=Path, required=True)
    live_backend_receipt.set_defaults(run=command_live_backend_receipt)

    validate_live_backend = commands.add_parser("validate-live-backend-manifest")
    validate_live_backend.add_argument("--manifest", type=Path, required=True)
    validate_live_backend.set_defaults(run=command_validate_live_backend_manifest)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        return args.run(args)
    except ValueError as error:
        print(f"app-flow: error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
