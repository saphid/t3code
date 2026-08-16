#!/usr/bin/env python3
"""Validate exact commit attribution for an installed SwiftUI Test build."""

from __future__ import annotations

import argparse
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
DEFAULT_ATTRIBUTION = SCRIPT_DIR / "test-build-attribution-54.json"
TEST_BUNDLE_ID = "com.alxs.t3code.typed-swiftui.dev"
TEST_CHANNEL = "test"
BASELINE_BRANCH = "origin/personal/swiftui-dev"
OBSERVED_TEST_BRANCH = "origin/personal/swiftui-test"
VALID_CATEGORIES = {"candidate", "integration", "metadata", "revert", "anomaly"}
INTEGRATION_CHANGED_PATHS_RULE = "Diff the merge tree against its first parent."
CLASSIFICATION_RULE = {
    "anomaly": "No exact source citation or structural rule supports another classification.",
    "candidate": "The exact commit is cited by a checked-in source record.",
    "integration": "The commit has two or more parents.",
    "metadata": "The commit subject is chore(...) and only scripts/swiftui-stream/stream.json changes.",
    "revert": "The commit subject starts with Revert.",
}
OBSERVED_TEST_TIP_NOTE = (
    "The remote Test branch moved to this commit after the build 54 attribution "
    "snapshot. It is not part of installed Test build 54 and was not reconciled here."
)
SOURCE_SNAPSHOT_PATHS = {
    "legacyManifest": "scripts/t3-swift-approved/manifest.json",
    "streamManifest": "scripts/swiftui-stream/stream.json",
}
ACKNOWLEDGED_ANOMALY_COMMITS = frozenset(
    {
        "08c052d9dbd80707355b32a962b282783e5a8d1f",
        "f76b4eab816dc9815611218747f1feade007430f",
        "50309eba7cbcba03ca5f27033006f0d580ccadb5",
        "28de749152b86976781acd0c06870dba33d3386e",
        "ba8c7240425fa4f5642c453347e00dbd0a20f8c1",
        "d041f5ad2013bcbe43c29c8f7545b4e1fe04f795",
        "cb31705e3663c0810a44775c63a44b29cb8e471f",
        "b8df15b91d56a9dd4505f479596c33c520802621",
        "fa3ba1d16fd02b42d3624c7ecd2cd4a17aa5aadb",
        "35ea2789de8c403227431717d817c6ed37bb02a7",
        "cfe7eb025ab4a606782154892461f3e8f7ff9c44",
        "4637e756914dd88fb8feb60fb1707176466b306b",
        "9522aa0ae5bc2dd80f114a2058ad9ba8d4d538a8",
        "945c98851d77364c72c1a6ff5b893cef302d2f62",
        "c4a4bd0e4946fde52ec9e250940a8e94e22db94f",
        "40fceb60f124c1b61a6457e360135e48b63304cc",
        "8ef974258b9d2b38af5bcb02f680da4e23579704",
        "f7850b5444051aa6ce913382ca5165ab93b96af2",
        "d79d498f546c888971ca2f6807b7618c7d972ecb",
        "1976e870b0e9fa57ca05c98c33370fc21030b8e2",
        "5febace3bbee95b5ca2533f6bf082c30934321c3",
        "3129ef8488e73b4cbff9ed1e8005b9db2da40200",
        "ead6fa15233c78cdc784eb09586faee24fe6b087",
        "cbae942274d6fcd62cfc365a32e1c9f7d826510d",
        "2789aad6bda8a916cca9023b84420f46cf84c2ef",
        "7f95310c3d407f92883b3c7e83b0e015a46b92c6",
        "4764e6bf5be64e472da24a3aa8f73d3142d46276",
        "353d533ef02c28cc250fe8e45eb11538abf4c210",
        "11e99d6f5debc88c6f4b0d2e733321ff144327a0",
        "5a46ed73f8afa118714921ff1fd32768e3cedd4e",
    }
)


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


def stable_patch_id(repo: Path, patch: str, description: str) -> str:
    result = subprocess.run(
        ["git", "patch-id", "--stable"],
        cwd=repo,
        input=patch,
        text=True,
        capture_output=True,
    )
    if result.returncode or not result.stdout.strip():
        raise ValueError(f"cannot calculate patch id for {description}")
    return result.stdout.split()[0]


def patch_id(repo: Path, commit: str) -> str:
    patch = run_git(
        repo,
        "show",
        "--pretty=format:",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        commit,
        "--",
    )
    return stable_patch_id(repo, patch, commit)


def inverse_patch_id(repo: Path, commit: str) -> str:
    patch = run_git(
        repo,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        commit,
        f"{commit}^",
        "--",
    )
    return stable_patch_id(repo, patch, f"inverse of {commit}")


def changed_paths(repo: Path, commit: str, parents: list[str]) -> list[str]:
    arguments = [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
    ]
    if parents:
        arguments.extend((parents[0], commit, "--"))
    else:
        arguments.extend(("--root", commit, "--"))
    return sorted(set(run_git(repo, *arguments).splitlines()))


def merge_evidence(repo: Path, commit: str, parents: list[str]) -> dict[str, Any]:
    if len(parents) != 2:
        raise ValueError("an integration commit must have two parents")
    actual_tree = run_git(
        repo, "rev-parse", "--verify", "--end-of-options", f"{commit}^{{tree}}"
    ).strip()
    repository_objects = Path(
        run_git(repo, "rev-parse", "--git-path", "objects").strip()
    )
    if not repository_objects.is_absolute():
        repository_objects = (repo / repository_objects).resolve()
    with tempfile.TemporaryDirectory(prefix="t3-attribution-objects-") as object_dir:
        environment = os.environ.copy()
        alternates = [str(repository_objects)]
        inherited_alternates = environment.get("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        if inherited_alternates:
            alternates.append(inherited_alternates)
        environment["GIT_OBJECT_DIRECTORY"] = object_dir
        environment["GIT_ALTERNATE_OBJECT_DIRECTORIES"] = os.pathsep.join(alternates)
        result = subprocess.run(
            [
                "git",
                "-c",
                "merge.renames=false",
                "-c",
                "merge.directoryRenames=false",
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


def is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", "--", ancestor, descendant],
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
    key = reference.get("key")
    value = reference.get("value")
    return next(
        (item for item in records if isinstance(item, dict) and item.get(key) == value),
        None,
    )


def reference_cites_commit(record: dict[str, Any], reference: dict[str, Any], commit: str) -> bool:
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


def is_commit_id(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def validate(
    value: Any,
    repo: Path = REPO_ROOT,
    receipt: Optional[dict[str, Any]] = None,
) -> list[str]:
    if not isinstance(value, dict):
        return ["attribution must be an object"]
    errors: list[str] = []
    if value.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    if value.get("integrationChangedPathsRule") != INTEGRATION_CHANGED_PATHS_RULE:
        errors.append("integrationChangedPathsRule does not use the first-parent rule")
    if value.get("classificationRule") != CLASSIFICATION_RULE:
        errors.append("classificationRule does not match the required rule")

    baseline = value.get("baseline", {})
    installed = value.get("installedTestBuild", {})
    if not isinstance(baseline, dict):
        errors.append("baseline must be an object")
        baseline = {}
    if not isinstance(installed, dict):
        errors.append("installedTestBuild must be an object")
        installed = {}
    if baseline.get("branch") != BASELINE_BRANCH:
        errors.append("baseline.branch does not identify SwiftUI Dev")
    dev_commit = baseline.get("devCommit")
    test_commit = installed.get("commit")
    if not is_commit_id(dev_commit):
        errors.append("baseline.devCommit must be 40 lowercase hex characters")
    if not is_commit_id(test_commit):
        errors.append("installedTestBuild.commit must be 40 lowercase hex characters")
    if not is_commit_id(dev_commit) or not is_commit_id(test_commit):
        return errors
    if receipt is None:
        errors.append("device receipt is required")
    elif not isinstance(receipt, dict):
        errors.append("device receipt must be an object")
        receipt = None
    if installed.get("bundleId") != TEST_BUNDLE_ID:
        errors.append("installedTestBuild.bundleId must identify the Test app")
    if installed.get("channel") != TEST_CHANNEL:
        errors.append("installedTestBuild.channel must be test")

    observed_tip = value.get("observedTestTip", {})
    if not isinstance(observed_tip, dict):
        errors.append("observedTestTip must be an object")
        observed_tip = {}
    observed_commit = observed_tip.get("commit")
    if observed_tip.get("branch") != OBSERVED_TEST_BRANCH:
        errors.append("observedTestTip.branch does not identify SwiftUI Test")
    if not is_commit_id(observed_commit):
        errors.append("observedTestTip.commit must be 40 lowercase hex characters")
    if observed_tip.get("note") != OBSERVED_TEST_TIP_NOTE:
        errors.append("observedTestTip.note does not match the frozen note")

    try:
        if not is_ancestor(repo, dev_commit, test_commit):
            errors.append(
                "baseline.devCommit must be an ancestor of installedTestBuild.commit"
            )
        if is_commit_id(observed_commit) and not is_ancestor(
            repo, test_commit, observed_commit
        ):
            errors.append(
                "installedTestBuild.commit must be an ancestor of observedTestTip.commit"
            )
        actual_commits = run_git(
            repo, "rev-list", "--reverse", f"{dev_commit}..{test_commit}", "--"
        ).splitlines()
    except ValueError as error:
        return errors + [str(error)]

    records = value.get("commits", [])
    if not isinstance(records, list):
        return errors + ["commits must be a list"]
    record_items: list[dict[str, Any]] = []
    for index, item in enumerate(records):
        if not isinstance(item, dict):
            errors.append(f"commit record {index} must be an object")
            continue
        record_items.append(item)
    recorded_commits = [item.get("commit") for item in record_items]
    if recorded_commits != actual_commits:
        errors.append(
            "commit records do not match the commit list from Dev to the installed Test build"
        )
    valid_recorded_commits = [
        commit for commit in recorded_commits if is_commit_id(commit)
    ]
    if len(valid_recorded_commits) != len(set(valid_recorded_commits)):
        errors.append("commit records contain duplicate commit ids")
    acknowledged_anomalies = value.get("acknowledgedAnomalies", [])
    acknowledged_anomalies_are_valid = isinstance(
        acknowledged_anomalies, list
    ) and all(is_commit_id(commit) for commit in acknowledged_anomalies)
    if (
        not acknowledged_anomalies_are_valid
        or len(acknowledged_anomalies) != len(set(acknowledged_anomalies))
        or set(acknowledged_anomalies) != ACKNOWLEDGED_ANOMALY_COMMITS
    ):
        errors.append("acknowledgedAnomalies does not match the frozen anomaly set")
    anomaly_commits = {
        item.get("commit")
        for item in record_items
        if item.get("category") == "anomaly" and is_commit_id(item.get("commit"))
    }
    if anomaly_commits != ACKNOWLEDGED_ANOMALY_COMMITS:
        errors.append("anomaly records do not match the frozen anomaly set")

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
        snapshot_commit = snapshot.get("commit")
        if not is_commit_id(snapshot_commit):
            errors.append(
                f"source snapshot {name} commit must be 40 lowercase hex characters"
            )
            continue
        try:
            if not is_ancestor(repo, snapshot_commit, test_commit):
                errors.append(
                    f"source snapshot {name} commit must be an ancestor of "
                    "installedTestBuild.commit"
                )
                continue
            text = run_git(repo, "show", f"{snapshot_commit}:{snapshot['path']}")
            snapshots[name] = json.loads(text)
        except (KeyError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"cannot load source snapshot {name}: {error}")

    source_candidate_commits = candidate_source_commits(snapshots)

    for item in record_items:
        commit = item.get("commit")
        if not is_commit_id(commit):
            errors.append(
                "commit id must be 40 lowercase hex characters"
            )
            continue
        category = item.get("category")
        if category not in VALID_CATEGORIES:
            errors.append(f"{commit}: invalid category {category!r}")
            continue
        try:
            description = run_git(
                repo, "show", "-s", "--format=%s%n%P", commit, "--"
            ).splitlines()
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
        recorded_parents = item.get("parents")
        if not isinstance(recorded_parents, list) or not all(
            is_commit_id(parent) for parent in recorded_parents
        ):
            errors.append(
                f"{commit}: parents must contain 40-character lowercase hex ids"
            )
        if item.get("changedPaths") != paths:
            errors.append(f"{commit}: changed paths do not match Git")
        expected_patch = item.get("patchId")
        if len(parents) == 1:
            if not is_commit_id(expected_patch):
                errors.append(
                    f"{commit}: patchId must be 40 lowercase hex characters"
                )
            try:
                if expected_patch != patch_id(repo, commit):
                    errors.append(f"{commit}: patch id does not match Git")
            except ValueError as error:
                errors.append(str(error))
        elif expected_patch is not None:
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
        if subject.startswith("Revert ") and category != "revert":
            errors.append(f"{commit}: revert commit must be classified as revert")
        if len(parents) >= 2 and category != "integration":
            errors.append(f"{commit}: merge commit must be classified as integration")
        if category == "integration" and len(parents) < 2:
            errors.append(f"{commit}: integration is not a merge commit")
        if category == "integration":
            try:
                expected_merge_evidence = merge_evidence(repo, commit, parents)
                if item.get("mergeEvidence") != expected_merge_evidence:
                    errors.append(f"{commit}: merge evidence does not match Git")
            except ValueError as error:
                errors.append(f"{commit}: {error}")
        if category == "metadata":
            if not subject.startswith("chore("):
                errors.append(f"{commit}: metadata subject is not a chore")
            if not paths or set(paths) != {"scripts/swiftui-stream/stream.json"}:
                errors.append(f"{commit}: metadata changes files outside stream.json")
        if category == "revert" and not subject.startswith("Revert "):
            errors.append(f"{commit}: revert subject is not explicit")
        if category == "revert":
            revert_target = item.get("revertTarget")
            if not is_commit_id(revert_target):
                errors.append(
                    f"{commit}: revertTarget must be 40 lowercase hex characters"
                )
            elif revert_target not in actual_commits:
                errors.append(f"{commit}: revertTarget is not in the validated range")
            else:
                try:
                    if patch_id(repo, commit) != inverse_patch_id(repo, revert_target):
                        errors.append(
                            f"{commit}: revert patch does not invert revertTarget"
                        )
                except ValueError as error:
                    errors.append(str(error))
        if category == "anomaly" and not item.get("anomaly"):
            errors.append(f"{commit}: anomaly has no reason")
        if category == "anomaly" and (
            has_exact_source_evidence or commit in source_candidate_commits
        ):
            errors.append(f"{commit}: anomaly has exact candidate source evidence")

    if receipt is not None:
        for field in (
            "schemaVersion",
            "channel",
            "build",
            "sequence",
            "commit",
            "bundleId",
        ):
            if receipt.get(field) != installed.get(field):
                errors.append(f"device receipt {field} does not match installedTestBuild")
        if receipt.get("status") != "installed-and-launched":
            errors.append("device receipt does not show installed-and-launched")
        if receipt.get("launchPending") is not False:
            errors.append("device receipt has a pending launch")
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
    except ValueError as error:
        errors = [str(error)]
    if errors:
        for error in errors:
            print(f"[test-attribution] error: {error}", file=sys.stderr)
        return 1
    counts: dict[str, int] = {}
    for item in value["commits"]:
        counts[item["category"]] = counts.get(item["category"], 0) + 1
    print(
        json.dumps(
            {
                "acknowledgedAnomalyCount": len(ACKNOWLEDGED_ANOMALY_COMMITS),
                "attributionStatus": "incomplete",
                "categories": counts,
                "commitCount": len(value["commits"]),
                "message": (
                    "Attribution is incomplete. The record has acknowledged anomalies."
                ),
                "validationStatus": "valid",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
