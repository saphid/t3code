#!/usr/bin/env python3
"""Validate a Test build attribution delta and its frozen catalog evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_ATTRIBUTION = SCRIPT_DIR / "test-build-attribution-55.json"
BASE_ATTRIBUTION_COMMIT = "b8f9c6616d82880768bcc8b92583a54f1319efc4"
BASE_ATTRIBUTION_SHA256 = "c026b6bd8204a329e1147b6536bfa24b3c12be79455b097e4d03145bdebdccfc"
BASE_ATTRIBUTION_ARTIFACT = "test-build-attribution-54.json"
BASE_ATTRIBUTION_PATH = (
    "scripts/swiftui-stream/" + BASE_ATTRIBUTION_ARTIFACT
)
SCHEMA_VERSION = 1
TEST_CHANNEL = "test"
TEST_BUNDLE_ID = "com.alxs.t3code.typed-swiftui.dev"
VALID_CATEGORIES = {"candidate", "integration", "metadata", "revert", "anomaly"}
CLASSIFICATION_RULE = {
    "anomaly": "No exact source citation or structural rule supports another classification.",
    "candidate": "The exact delta commit has fewer than two parents and is cited by a checked-in build-55 source record.",
    "integration": "The delta commit has exactly two parents.",
    "metadata": "The subject is chore(...) and only the stream manifest or its focused tests change.",
    "revert": "The commit subject starts with Revert.",
}
METADATA_PATHS = {
    "scripts/swiftui-stream/stream.json",
    "scripts/swiftui-stream/test_stream.py",
}
SOURCE_SNAPSHOT_PATHS = {
    "legacyManifest": "scripts/t3-swift-approved/manifest.json",
    "prDelivery": "scripts/swiftui-stream/pr-delivery.json",
    "streamManifest": "scripts/swiftui-stream/stream.json",
}


def run_git(repo: Path, *arguments: str, stdin: Optional[str] = None) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=repo,
        input=stdin,
        text=True,
        capture_output=True,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or f"git {' '.join(arguments)} failed")
    return result.stdout


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.expanduser().read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {path}: {error}") from error


def load_base_attribution(repo: Path) -> tuple[bytes, dict[str, Any]]:
    commit_result = subprocess.run(
        ["git", "cat-file", "-e", f"{BASE_ATTRIBUTION_COMMIT}^{{commit}}"],
        cwd=repo,
        capture_output=True,
    )
    if commit_result.returncode:
        raise ValueError(
            "cannot read repaired PR #71 commit; fetch exact commit "
            f"{BASE_ATTRIBUTION_COMMIT} (the checkout may be shallow)"
        )
    result = subprocess.run(
        [
            "git",
            "show",
            f"{BASE_ATTRIBUTION_COMMIT}:{BASE_ATTRIBUTION_PATH}",
        ],
        cwd=repo,
        capture_output=True,
    )
    if result.returncode:
        raise ValueError(
            "repaired PR #71 attribution artifact is missing at the pinned commit"
        )
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"repaired PR #71 base attribution is invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError("repaired PR #71 base attribution must be an object")
    return result.stdout, value


def is_commit_id(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def patch_id(repo: Path, commit: str) -> str:
    patch = run_git(repo, "show", "--pretty=format:", "--no-ext-diff", commit)
    result = subprocess.run(
        ["git", "patch-id", "--stable"],
        cwd=repo,
        input=patch,
        text=True,
        capture_output=True,
    )
    if result.returncode or not result.stdout.strip():
        raise ValueError(f"cannot calculate patch id for {commit}")
    return result.stdout.split()[0]


def changed_paths(repo: Path, commit: str, parents: list[str]) -> list[str]:
    paths: set[str] = set()
    if not parents:
        paths.update(
            run_git(
                repo,
                "diff-tree",
                "--root",
                "--no-commit-id",
                "--name-only",
                "-r",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                commit,
                "--",
            ).splitlines()
        )
    else:
        for parent in parents:
            paths.update(
                run_git(
                    repo,
                    "diff",
                    "--name-only",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                    parent,
                    commit,
                    "--",
                ).splitlines()
            )
    return sorted(paths)


def tree_paths(repo: Path, treeish: str) -> set[str]:
    return set(
        run_git(repo, "ls-tree", "-r", "--name-only", treeish, "--").splitlines()
    )


def merge_only_paths(repo: Path, commit: str, parents: list[str]) -> list[str]:
    parent_paths: set[str] = set()
    for parent in parents:
        parent_paths.update(tree_paths(repo, parent))
    return sorted(tree_paths(repo, commit) - parent_paths)


def merge_evidence(repo: Path, commit: str, parents: list[str]) -> dict[str, Any]:
    if len(parents) != 2:
        raise ValueError("integration commits must have exactly two parents")
    merge_base_result = subprocess.run(
        ["git", "merge-base", "--", parents[0], parents[1]],
        cwd=repo,
        text=True,
        capture_output=True,
    )
    if merge_base_result.returncode == 1 or not merge_base_result.stdout.strip():
        raise ValueError("integration parents do not have a common ancestor")
    if merge_base_result.returncode:
        raise ValueError(
            merge_base_result.stderr.strip()
            or "Git cannot calculate the integration merge base"
        )
    actual_tree = run_git(
        repo, "rev-parse", "--verify", "--end-of-options", f"{commit}^{{tree}}"
    ).strip()
    repository_objects_text = run_git(
        repo, "rev-parse", "--git-path", "objects"
    ).strip()
    if os.pathsep in repository_objects_text:
        raise ValueError(
            f"repository object path contains the path separator {os.pathsep!r}"
        )
    repository_objects = Path(repository_objects_text)
    if not repository_objects.is_absolute():
        repository_objects = (repo / repository_objects).resolve()
    with tempfile.TemporaryDirectory(prefix="t3-attribution-merge-") as directory:
        isolated_git_dir = Path(directory) / "repository.git"
        environment = os.environ.copy()
        for variable in (
            "GIT_CONFIG",
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_PARAMETERS",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
            "GIT_DIR",
            "GIT_OBJECT_DIRECTORY",
            "GIT_WORK_TREE",
        ):
            environment.pop(variable, None)
        for variable in tuple(environment):
            if re.fullmatch(r"GIT_CONFIG_(?:KEY|VALUE)_\d+", variable):
                environment.pop(variable)
        environment["GIT_ATTR_NOSYSTEM"] = "1"
        environment["GIT_CONFIG_GLOBAL"] = os.devnull
        environment["GIT_CONFIG_NOSYSTEM"] = "1"
        init_result = subprocess.run(
            ["git", "init", "--bare", "--quiet", "--template=", str(isolated_git_dir)],
            cwd=repo,
            env=environment,
            text=True,
            capture_output=True,
        )
        if init_result.returncode:
            raise ValueError(
                init_result.stderr.strip()
                or "Git cannot create the isolated merge repository"
            )
        alternates = [str(repository_objects)]
        inherited_alternates = os.environ.get("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        if inherited_alternates:
            alternates.append(inherited_alternates)
        environment["GIT_DIR"] = str(isolated_git_dir)
        environment["GIT_OBJECT_DIRECTORY"] = str(isolated_git_dir / "objects")
        environment["GIT_ALTERNATE_OBJECT_DIRECTORIES"] = os.pathsep.join(alternates)
        result = subprocess.run(
            [
                "git",
                "-c",
                "core.attributesFile=",
                "-c",
                "merge.renames=false",
                "-c",
                "merge.directoryRenames=false",
                "-c",
                "merge.conflictStyle=merge",
                "-c",
                "merge.renormalize=false",
                "merge-tree",
                "--write-tree",
                "--no-messages",
                parents[0],
                parents[1],
            ],
            cwd=repo,
            env=environment,
            text=True,
            capture_output=True,
        )
    output = result.stdout.splitlines()
    if result.returncode not in (0, 1) or not output or not re.fullmatch(
        r"[0-9a-f]{40}", output[0]
    ):
        raise ValueError("Git cannot calculate the automatic merge tree")
    automatic_tree = output[0]
    automatic_merge = "clean" if result.returncode == 0 else "conflicts"
    resolution = (
        "automatic"
        if automatic_merge == "clean" and actual_tree == automatic_tree
        else "recorded"
    )
    evidence = {
        "actualTree": actual_tree,
        "automaticMerge": automatic_merge,
        "automaticTree": automatic_tree,
        "resolution": resolution,
    }
    if resolution == "recorded":
        evidence["resolutionNote"] = (
            "Git reported conflicts. The merge commit contains the recorded resolution."
            if automatic_merge == "conflicts"
            else "The merge commit differs from the automatic merge. It contains the recorded resolution."
        )
    return evidence


def attribution_message(status: str, acknowledged_anomaly_count: int) -> str:
    if acknowledged_anomaly_count == 0:
        anomaly_text = "no acknowledged anomalies"
    elif acknowledged_anomaly_count == 1:
        anomaly_text = "1 acknowledged anomaly"
    else:
        anomaly_text = f"{acknowledged_anomaly_count} acknowledged anomalies"
    return f"Attribution is {status}. The base record has {anomaly_text}."


def is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant],
        cwd=repo,
        text=True,
        capture_output=True,
    )
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    raise ValueError(
        result.stderr.strip()
        or f"cannot compare Git ancestry for {ancestor} and {descendant}"
    )


def source_record(
    snapshots: dict[str, Any], reference: dict[str, Any]
) -> Optional[dict[str, Any]]:
    snapshot = snapshots.get(reference.get("snapshot"))
    if not isinstance(snapshot, dict):
        return None
    records = snapshot.get(reference.get("collection"), [])
    if not isinstance(records, list):
        return None
    return next(
        (
            item
            for item in records
            if isinstance(item, dict)
            and item.get(reference.get("key")) == reference.get("value")
        ),
        None,
    )


def reference_cites_commit(
    record: dict[str, Any], reference: dict[str, Any], commit: str
) -> bool:
    value = record.get(reference.get("field"))
    return value == commit or (isinstance(value, list) and commit in value)


def candidate_source_commits(value: Any) -> set[str]:
    commits: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "integratedCommit" and isinstance(item, str):
                commits.add(item)
            elif key == "integratedCommits" and isinstance(item, list):
                commits.update(commit for commit in item if isinstance(commit, str))
            else:
                commits.update(candidate_source_commits(item))
    elif isinstance(value, list):
        for item in value:
            commits.update(candidate_source_commits(item))
    return commits


def pr_number(url: Any) -> Optional[int]:
    match = re.search(r"/pull/(\d+)$", url) if isinstance(url, str) else None
    return int(match.group(1)) if match else None


def durable_catalog_summary(snapshots: dict[str, Any]) -> tuple[int, dict[str, int]]:
    stream = snapshots["streamManifest"]
    legacy = snapshots["legacyManifest"]
    delivery = snapshots["prDelivery"]
    for name, snapshot in (
        ("streamManifest", stream),
        ("legacyManifest", legacy),
        ("prDelivery", delivery),
    ):
        if not isinstance(snapshot, dict):
            raise ValueError(f"source snapshot {name} content must be an object")
    stream_features = stream.get("features", [])
    delivery_records = delivery.get("pullRequests", [])
    if not isinstance(stream_features, list) or not all(
        isinstance(item, dict) for item in stream_features
    ):
        raise ValueError("streamManifest.features must be a list of objects")
    if not isinstance(delivery_records, list) or not all(
        isinstance(item, dict) for item in delivery_records
    ):
        raise ValueError("prDelivery.pullRequests must be a list of objects")
    if not all(isinstance(item.get("number"), int) for item in delivery_records):
        raise ValueError("prDelivery pull request numbers must be integers")
    delivery_by_number = {item["number"]: item for item in delivery_records}
    records = [dict(item) for item in stream_features]
    for collection in ("features", "candidates"):
        source_records = legacy.get(collection, [])
        if not isinstance(source_records, list) or not all(
            isinstance(item, dict) for item in source_records
        ):
            raise ValueError(
                f"legacyManifest.{collection} must be a list of objects"
            )
        for source in source_records:
            item = dict(source)
            number = pr_number(item.get("pullRequest"))
            delivery_record = delivery_by_number.get(number)
            item["state"] = (
                delivery_record.get("state")
                if delivery_record is not None
                else "upstream-validation"
            )
            records.append(item)
    represented = {
        number
        for item in records
        if (number := pr_number(item.get("pullRequest"))) is not None
    }
    extra_prs = [
        item
        for item in delivery_records
        if item.get("number") not in represented
    ]
    records.extend(extra_prs)
    states: dict[str, int] = {}
    for item in records:
        state = item.get("state")
        if not isinstance(state, str):
            raise ValueError("catalog record states must be strings")
        states[state] = states.get(state, 0) + 1
    return len(records), states


def validate(
    value: Any,
    repo: Path = REPO_ROOT,
    receipt: Optional[dict[str, Any]] = None,
) -> list[str]:
    if not isinstance(value, dict):
        return ["attribution must be an object"]
    errors: list[str] = []
    if value.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("schemaVersion must be 1")
    if value.get("classificationRule") != CLASSIFICATION_RULE:
        errors.append("classificationRule does not match the required rule")

    base = value.get("baseAttribution", {})
    installed = value.get("installedTestBuild", {})
    catalog = value.get("catalog", {})
    gate = value.get("deviceGate", {})
    if not isinstance(base, dict):
        errors.append("baseAttribution must be an object")
        base = {}
    if not isinstance(installed, dict):
        errors.append("installedTestBuild must be an object")
        installed = {}
    if not isinstance(catalog, dict):
        errors.append("catalog must be an object")
        catalog = {}
    if not isinstance(gate, dict):
        errors.append("deviceGate must be an object")
        gate = {}

    observed = gate.get("observedReceipt", {})
    if not isinstance(observed, dict):
        errors.append("deviceGate.observedReceipt must be an object")
        observed = {}
    live_receipt = receipt
    if receipt is not None and not isinstance(receipt, dict):
        errors.append("live device receipt must be an object")
        live_receipt = None

    records_value = value.get("commits", [])
    if not isinstance(records_value, list):
        errors.append("commits must be a list")
        records_value = []
    records: list[dict[str, Any]] = []
    for index, item in enumerate(records_value):
        if not isinstance(item, dict):
            errors.append(f"commit record {index} must be an object")
            continue
        records.append(item)

    test_commit = installed.get("commit")
    if not is_commit_id(test_commit):
        return errors + ["installedTestBuild.commit must be 40 lowercase hex characters"]
    if base.get("artifact") != BASE_ATTRIBUTION_ARTIFACT:
        errors.append(
            f"base attribution artifact must be {BASE_ATTRIBUTION_ARTIFACT}"
        )
    expected_base_sha256 = base.get("sha256", "")
    if not isinstance(expected_base_sha256, str) or not re.fullmatch(
        r"[0-9a-f]{64}", expected_base_sha256
    ):
        errors.append("base attribution sha256 is invalid")
    try:
        base_bytes, verified_base = load_base_attribution(repo)
    except ValueError as error:
        return errors + [str(error)]
    if (
        expected_base_sha256 != BASE_ATTRIBUTION_SHA256
        or hashlib.sha256(base_bytes).hexdigest() != BASE_ATTRIBUTION_SHA256
    ):
        errors.append("base attribution sha256 does not match the artifact")

    verified_installed = verified_base.get("installedTestBuild", {})
    verified_baseline = verified_base.get("baseline", {})
    verified_commits = verified_base.get("commits", [])
    verified_acknowledged = verified_base.get("acknowledgedAnomalies", [])
    if not isinstance(verified_installed, dict):
        errors.append("verified PR #71 installedTestBuild must be an object")
        verified_installed = {}
    if not isinstance(verified_baseline, dict):
        errors.append("verified PR #71 baseline must be an object")
        verified_baseline = {}
    if not isinstance(verified_commits, list) or not all(
        isinstance(item, dict) for item in verified_commits
    ):
        errors.append("verified PR #71 commits must be a list of objects")
        verified_commits = []
    verified_anomalies = [
        item.get("commit")
        for item in verified_commits
        if item.get("category") == "anomaly"
    ]
    verified_integrations = [
        item for item in verified_commits if item.get("category") == "integration"
    ]
    if (
        not isinstance(verified_acknowledged, list)
        or verified_acknowledged != verified_anomalies
    ):
        errors.append(
            "verified PR #71 anomaly acknowledgment does not match its anomaly records"
        )
        verified_acknowledged = []
    if not verified_integrations or any(
        not isinstance(item.get("mergeEvidence"), dict)
        for item in verified_integrations
    ):
        errors.append("verified PR #71 integration evidence is incomplete")

    base_installed = base.get("installedTestBuild", {})
    if not isinstance(base_installed, dict):
        errors.append("base attribution installedTestBuild must be an object")
        base_installed = {}
    expected_base_fields = {
        "schemaVersion": verified_base.get("schemaVersion"),
        "devCommit": verified_baseline.get("devCommit"),
        "commitCount": len(verified_commits),
        "sourceCommit": BASE_ATTRIBUTION_COMMIT,
        "attributionStatus": (
            "incomplete" if verified_acknowledged else "complete"
        ),
        "acknowledgedAnomalyCount": len(verified_acknowledged),
        "integrationEvidenceCount": len(verified_integrations),
    }
    for field, expected in expected_base_fields.items():
        if base.get(field) != expected:
            errors.append(
                f"base attribution {field} does not match the verified PR #71 artifact"
            )
    for field in ("build", "bundleId", "channel", "commit", "schemaVersion", "sequence"):
        if base_installed.get(field) != verified_installed.get(field):
            errors.append(
                "base attribution installedTestBuild."
                f"{field} does not match the verified PR #71 artifact"
            )

    if installed.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("installedTestBuild.schemaVersion must be 1")
    if installed.get("channel") != TEST_CHANNEL:
        errors.append("installedTestBuild.channel must be test")
    if installed.get("bundleId") != TEST_BUNDLE_ID:
        errors.append("installedTestBuild.bundleId must identify the Test app")
    base_build = verified_installed.get("build")
    base_sequence = verified_installed.get("sequence")
    if not isinstance(base_build, int) or installed.get("build") != base_build + 1:
        errors.append(
            "installedTestBuild.build must be one more than verified build 54"
        )
    if not isinstance(base_sequence, int) or installed.get("sequence") != base_sequence + 1:
        errors.append(
            "installedTestBuild.sequence must be one more than verified build 54"
        )
    if value.get("supersedesInstalledBuild") != base_build:
        errors.append("supersedesInstalledBuild must match verified build 54")

    dev_commit = verified_baseline.get("devCommit")
    base_commit = verified_installed.get("commit")
    if not is_commit_id(dev_commit) or not is_commit_id(base_commit):
        return errors + ["verified PR #71 Dev and installed Test commits are invalid"]
    try:
        if not is_ancestor(repo, dev_commit, base_commit):
            errors.append("Dev must be an ancestor of build 54")
        if base_commit == test_commit or not is_ancestor(repo, base_commit, test_commit):
            errors.append("build 55 must be a strict descendant of build 54")
        base_count = len(
            run_git(repo, "rev-list", f"{dev_commit}..{base_commit}").splitlines()
        )
        if base_count != len(verified_commits):
            errors.append("base attribution commit count does not match Git")
        actual_delta = run_git(
            repo, "rev-list", "--reverse", f"{base_commit}..{test_commit}"
        ).splitlines()
    except ValueError as error:
        return errors + [str(error)]
    if not actual_delta:
        errors.append("build 54-to-build 55 delta must contain at least one commit")

    recorded_commits = [item.get("commit") for item in records]
    if recorded_commits != actual_delta:
        errors.append("commit records do not exactly match the build-54-to-build-55 delta")
    valid_recorded_commits = [
        commit for commit in recorded_commits if is_commit_id(commit)
    ]
    if len(valid_recorded_commits) != len(set(valid_recorded_commits)):
        errors.append("commit records contain duplicate commit ids")

    if catalog.get("sourceCommit") != test_commit:
        errors.append("catalog.sourceCommit does not match installedTestBuild.commit")
    if not isinstance(catalog.get("states"), dict):
        errors.append("catalog.states must be an object")
    snapshots: dict[str, Any] = {}
    source_snapshots = value.get("sourceSnapshots", {})
    if not isinstance(source_snapshots, dict):
        errors.append("sourceSnapshots must be an object")
        source_snapshots = {}
    if set(source_snapshots) != set(SOURCE_SNAPSHOT_PATHS):
        errors.append("source snapshot names do not match the required snapshot set")
    for name, snapshot in source_snapshots.items():
        if name not in SOURCE_SNAPSHOT_PATHS:
            continue
        if not isinstance(snapshot, dict):
            errors.append(f"source snapshot {name} must be an object")
            continue
        if snapshot.get("path") != SOURCE_SNAPSHOT_PATHS[name]:
            errors.append(f"source snapshot {name} has an unexpected path")
            continue
        if snapshot.get("commit") != test_commit:
            errors.append(
                f"source snapshot {name} commit does not match installedTestBuild.commit"
            )
            continue
        try:
            content = run_git(repo, "show", f"{snapshot['commit']}:{snapshot['path']}")
            snapshot_value = json.loads(content)
            if not isinstance(snapshot_value, dict):
                raise ValueError("content must be an object")
            snapshots[name] = snapshot_value
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"cannot load source snapshot {name}: {error}")
    if all(name in snapshots for name in SOURCE_SNAPSHOT_PATHS):
        try:
            actual_count, actual_states = durable_catalog_summary(snapshots)
            if actual_count != catalog.get("durableRecordCount"):
                errors.append(
                    "durable catalog count does not match the frozen source records"
                )
            if actual_states != catalog.get("states"):
                errors.append(
                    "durable catalog states do not match the frozen source records"
                )
        except ValueError as error:
            errors.append(str(error))

    source_candidate_commits = candidate_source_commits(snapshots)

    for item in records:
        commit = item.get("commit")
        if not is_commit_id(commit):
            errors.append("commit id must be 40 lowercase hex characters")
            continue
        category = item.get("category")
        if not isinstance(category, str) or category not in VALID_CATEGORIES:
            errors.append(f"{commit}: invalid category {category!r}")
            continue
        try:
            description = run_git(repo, "show", "-s", "--format=%s%n%P", commit).splitlines()
            if not description:
                raise ValueError("Git returned no commit description")
            subject = description[0]
            parents = description[1].split() if len(description) > 1 else []
            paths = changed_paths(repo, commit, parents)
        except ValueError as error:
            errors.append(f"{commit}: {error}")
            continue
        if item.get("subject") != subject:
            errors.append(f"{commit}: subject does not match Git")
        if item.get("parents") != parents:
            errors.append(f"{commit}: parents do not match Git")
        if item.get("changedPaths") != paths:
            errors.append(f"{commit}: changed paths do not match Git")
        if len(parents) == 1:
            try:
                if item.get("patchId") != patch_id(repo, commit):
                    errors.append(f"{commit}: patch id does not match Git")
            except ValueError as error:
                errors.append(str(error))
        elif item.get("patchId") is not None:
            errors.append(f"{commit}: a merge commit cannot declare a patch id")
        references = item.get("sourceRecords", [])
        if not isinstance(references, list):
            errors.append(f"{commit}: sourceRecords must be a list")
            references = []
        has_exact_source_evidence = False
        for reference in references:
            if not isinstance(reference, dict):
                errors.append(f"{commit}: source record reference must be an object")
                continue
            if not all(
                isinstance(reference.get(field), str)
                for field in ("snapshot", "collection", "key", "value", "field")
            ):
                errors.append(f"{commit}: source record reference is malformed")
                continue
            record = source_record(snapshots, reference)
            if record is None:
                errors.append(f"{commit}: source record does not resolve")
            elif not reference_cites_commit(record, reference, commit):
                errors.append(f"{commit}: source record does not cite the commit")
            else:
                has_exact_source_evidence = True
        if category == "candidate" and not references:
            errors.append(f"{commit}: candidate has no exact source record")
        if len(parents) < 2 and category != "candidate" and (
            has_exact_source_evidence or commit in source_candidate_commits
        ):
            errors.append(
                f"{commit}: source-cited commit must be classified as candidate"
            )
        parent_count = len(parents)
        if parent_count > 2:
            errors.append(
                f"{commit}: integration commits must have exactly two parents"
            )
        elif parent_count == 2 and category != "integration":
            errors.append(f"{commit}: merge commit must be classified as integration")
        elif category == "integration" and parent_count != 2:
            errors.append(
                f"{commit}: integration commits must have exactly two parents"
            )
        elif category == "integration":
            expected_merge_evidence = None
            try:
                expected_merge_evidence = merge_evidence(repo, commit, parents)
                if item.get("mergeEvidence") != expected_merge_evidence:
                    errors.append(f"{commit}: merge evidence does not match Git")
            except ValueError as error:
                errors.append(f"{commit}: {error}")
            if commit in source_candidate_commits and not has_exact_source_evidence:
                errors.append(
                    f"{commit}: source-cited integration has no exact source record"
                )
            if (
                expected_merge_evidence is not None
                and expected_merge_evidence["resolution"] == "recorded"
            ):
                merge_only = merge_only_paths(repo, commit, parents)
                if merge_only and not has_exact_source_evidence:
                    acknowledgment = item.get("mergeOnlyContent")
                    valid_acknowledgment = (
                        isinstance(acknowledgment, dict)
                        and acknowledgment.get("acknowledgedPaths") == merge_only
                        and isinstance(acknowledgment.get("justification"), str)
                        and bool(acknowledgment["justification"].strip())
                    )
                    if not valid_acknowledgment:
                        errors.append(
                            f"{commit}: recorded merge-only paths need exact source "
                            "evidence or a frozen acknowledgment"
                        )
        if category == "metadata":
            if not subject.startswith("chore("):
                errors.append(f"{commit}: metadata subject is not a chore")
            if not paths or not set(paths).issubset(METADATA_PATHS):
                errors.append(f"{commit}: metadata changes a runtime or unclassified file")
        if category == "revert" and not subject.startswith("Revert "):
            errors.append(f"{commit}: revert subject is not explicit")
        if category == "anomaly" and not item.get("anomaly"):
            errors.append(f"{commit}: anomaly has no reason")

    for field in (
        "schemaVersion",
        "channel",
        "build",
        "sequence",
        "commit",
        "bundleId",
    ):
        if observed.get(field) != installed.get(field):
            errors.append(f"device gate receipt {field} does not match installedTestBuild")
    if gate.get("status") == "blocked":
        if gate.get("approvalEligible") is not False:
            errors.append("blocked device gate cannot be approval eligible")
        if observed.get("status") == "installed-and-launched":
            errors.append("blocked device gate contains a successful receipt")
        if live_receipt is not None and live_receipt != observed:
            errors.append("live device receipt differs from the blocked receipt snapshot")
    elif gate.get("status") == "ready":
        if gate.get("approvalEligible") is not True:
            errors.append("ready device gate must be approval eligible")
        if observed.get("launchPending") is not False:
            errors.append("ready device receipt has a pending launch")
        if live_receipt is None:
            errors.append("ready device gate requires a live receipt")
        elif live_receipt.get("status") != "installed-and-launched":
            errors.append("live device receipt does not show installed-and-launched")
        elif live_receipt != observed:
            errors.append("live device receipt differs from the ready receipt snapshot")
    else:
        errors.append("device gate status must be blocked or ready")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--attribution", default=str(DEFAULT_ATTRIBUTION))
    parser.add_argument("--receipt")
    arguments = parser.parse_args()
    try:
        value = load_json(Path(arguments.attribution))
        receipt = load_json(Path(arguments.receipt)) if arguments.receipt else None
        errors = validate(value, receipt=receipt)
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        errors = [str(error)]
    if errors:
        for error in errors:
            print(f"[test-attribution] error: {error}", file=sys.stderr)
        return 1
    attribution_status = value["baseAttribution"]["attributionStatus"]
    acknowledged_anomaly_count = value["baseAttribution"][
        "acknowledgedAnomalyCount"
    ]
    print(
        json.dumps(
            {
                "acknowledgedAnomalyCount": acknowledged_anomaly_count,
                "attributionStatus": attribution_status,
                "deltaCommitCount": len(value["commits"]),
                "catalogRecordCount": value["catalog"]["durableRecordCount"],
                "deviceGate": value["deviceGate"]["status"],
                "message": attribution_message(
                    attribution_status, acknowledged_anomaly_count
                ),
                "validationStatus": "valid",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
