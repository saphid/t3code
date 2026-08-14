#!/usr/bin/env python3
"""Generate exact Dev/Test feature metadata for a SwiftUI app build."""

import argparse
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse


DEV_STATES = {"proved"}
TEST_STATES = {"in-test", "needs-you"}
ROLE_PRIORITY = {"source": 0, "candidate": 1, "integrated": 1}


def git(repository, *arguments):
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        text=True,
        capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def is_ancestor(repository, ancestor, descendant):
    result = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", ancestor, descendant],
        text=True,
        capture_output=True,
    )
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    raise RuntimeError(result.stderr.strip() or "git merge-base --is-ancestor failed")


def is_stream_metadata_only(repository, commit):
    changed = set(
        git(repository, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines()
    )
    return bool(changed) and changed <= {"scripts/swiftui-stream/stream.json"}


def public_repository_url(value):
    value = re.sub(r"\.git$", "", value.strip())
    if value.startswith("git@"):
        value = "https://" + value[len("git@"):].replace(":", "/", 1)
    elif value.startswith("ssh://git@"):
        value = "https://" + value[len("ssh://git@"):]
    if not value.startswith("https://"):
        return None
    return re.sub(r"^https://[^/@]+@", "https://", value)


def selected_features(stream, channel, build):
    states = DEV_STATES if channel == "dev" else TEST_STATES
    selected = []
    for feature in stream.get("features", []):
        if feature.get("state") not in states:
            continue
        if channel == "test" and (
            not isinstance(feature.get("testBuild"), int)
            or feature["testBuild"] > build
        ):
            continue
        selected.append(feature)
    return sorted(
        selected,
        key=lambda feature: (
            feature.get("reviewPriority", 1_000_000),
            feature.get("order", 1_000_000),
            feature.get("name", "").casefold(),
            feature.get("id", ""),
        ),
    )


def feature_commit_values(feature, channel="test"):
    if channel == "test":
        values = [
            (value, "integrated")
            for value in feature.get("integratedCommits", [])
            if isinstance(value, str)
        ]
        values.extend([
            (feature.get("integratedCommit"), "integrated"),
            (feature.get("sourceCommit"), "source"),
        ])
    else:
        values = [
            (value, "candidate")
            for value in feature.get("commits", [])
            if isinstance(value, str)
        ]
        values.extend([
            (feature.get("candidateCommit"), "candidate"),
            (feature.get("sourceCommit"), "source"),
        ])
    unique = []
    seen = set()
    for value, role in values:
        if isinstance(value, str) and value and value not in seen:
            seen.add(value)
            unique.append((value, role))
    return unique


def feature_thread_values(feature):
    values = []
    source = feature.get("sourceThread")
    if isinstance(source, str) and source:
        values.append({
            "id": source,
            "title": feature.get("sourceThreadTitle") or "Source T3 thread",
        })
    for related in feature.get("relatedThreads", []):
        if isinstance(related, str):
            values.append({"id": related, "title": "Related T3 thread"})
        elif isinstance(related, dict) and related.get("id"):
            values.append({
                "id": related["id"],
                "title": related.get("title") or "Related T3 thread",
            })
    unique = []
    seen = set()
    for value in values:
        key = value["id"].casefold()
        if key not in seen:
            seen.add(key)
            unique.append(value)
    return unique


def review_guidance(feature):
    guidance = {}
    for key in (
        "problem",
        "summary",
        "whatToCheck",
        "successLooksLike",
        "validationSummary",
        "knownLimitations",
        "reviewGroup",
    ):
        value = feature.get(key)
        if not isinstance(value, str) or not value.strip():
            raise RuntimeError("%s has no %s" % (feature.get("id", "feature"), key))
        guidance[key] = value.strip()
    steps = feature.get("reproductionSteps")
    if (
        not isinstance(steps, list)
        or not steps
        or any(not isinstance(step, str) or not step.strip() for step in steps)
    ):
        raise RuntimeError("%s has invalid reproductionSteps" % feature.get("id", "feature"))
    priority = feature.get("reviewPriority")
    if not isinstance(priority, int) or isinstance(priority, bool) or priority < 1:
        raise RuntimeError("%s has invalid reviewPriority" % feature.get("id", "feature"))
    guidance["reproductionSteps"] = [step.strip() for step in steps]
    guidance["reviewPriority"] = priority
    source_issue = feature.get("sourceIssue")
    parsed_issue = urlparse(source_issue) if isinstance(source_issue, str) else None
    if (
        parsed_issue is None
        or parsed_issue.scheme != "https"
        or not parsed_issue.netloc
    ):
        raise RuntimeError("%s has invalid sourceIssue" % feature.get("id", "feature"))
    return guidance


def build_manifest(repository, channel, build):
    repository = Path(repository).resolve()
    stream_path = repository / "scripts/swiftui-stream/stream.json"
    stream = json.loads(stream_path.read_text())
    features = selected_features(stream, channel, build)
    branch = git(repository, "branch", "--show-current")
    if channel == "test" and branch != "personal/swiftui-test":
        raise RuntimeError("Test metadata must be generated from personal/swiftui-test")
    if channel == "test":
        pending = [
            feature for feature in stream.get("features", [])
            if feature.get("state") in TEST_STATES
        ]
        malformed = [
            feature.get("id", "<missing-id>") for feature in pending
            if not isinstance(feature.get("testBuild"), int)
            or feature["testBuild"] < 1
        ]
        if malformed:
            raise RuntimeError(
                "pending Test features have invalid testBuild: %s"
                % ", ".join(malformed)
            )
        future = [
            feature["id"] for feature in pending
            if feature["testBuild"] > build
        ]
        if future:
            raise RuntimeError(
                "pending Test features declare a future build: %s"
                % ", ".join(future)
            )
        if pending and not features:
            raise RuntimeError("pending Test features have no eligible testBuild metadata")
    elif branch == "personal/swiftui-dev":
        features = []
    else:
        features = [
            feature for feature in features
            if feature.get("sourceBranch") == branch
        ]
        if len(features) != 1:
            raise RuntimeError(
                "a feature-branch Dev build requires exactly one proved feature "
                "whose sourceBranch matches %s" % branch
            )
        candidate = features[0].get("candidateCommit")
        if not isinstance(candidate, str) or not candidate:
            raise RuntimeError(
                "%s has no frozen candidateCommit" % features[0]["id"]
            )
        candidate_sha = git(repository, "rev-parse", "--verify", "%s^{commit}" % candidate)
        if not is_ancestor(repository, candidate_sha, "HEAD"):
            raise RuntimeError(
                "%s candidateCommit is not an ancestor of this Dev build" % features[0]["id"]
            )
        remote_source_branch = "origin/%s" % branch
        try:
            remote_source_tip = git(
                repository,
                "rev-parse",
                "--verify",
                "%s^{commit}" % remote_source_branch,
            )
        except RuntimeError as error:
            raise RuntimeError(
                "%s is not published at %s" % (features[0]["id"], remote_source_branch)
            ) from error
        if not is_ancestor(repository, "HEAD", remote_source_tip):
            raise RuntimeError(
                "%s exact Dev build revision is not published on %s"
                % (features[0]["id"], remote_source_branch)
            )
        dev_tip = git(
            repository,
            "rev-parse",
            "--verify",
            "origin/personal/swiftui-dev^{commit}",
        )
        if not is_ancestor(repository, dev_tip, "HEAD"):
            raise RuntimeError("the current remote Dev tip is not an ancestor of this build")
        starting_baseline = features[0].get("startingBaseline")
        if starting_baseline != dev_tip:
            raise RuntimeError(
                "%s startingBaseline does not match the current remote Dev tip"
                % features[0]["id"]
            )
        declared = {
            git(repository, "rev-parse", "--verify", "%s^{commit}" % value)
            for value in [*features[0].get("commits", []), candidate]
            if isinstance(value, str) and value
        }
        actual = {
            commit
            for commit in git(
                repository, "rev-list", "%s..%s" % (starting_baseline, candidate_sha)
            ).splitlines()
            if not is_stream_metadata_only(repository, commit)
        }
        if actual != declared:
            raise RuntimeError(
                "%s baseline-to-candidate range does not match its declared commits"
                % features[0]["id"]
            )
        post_candidate = git(
            repository, "rev-list", "--reverse", "%s..HEAD" % candidate_sha
        ).splitlines()
        unexpected = [
            commit for commit in post_candidate
            if not is_stream_metadata_only(repository, commit)
        ]
        if unexpected:
            raise RuntimeError(
                "the Dev build contains non-metadata commits after candidateCommit: %s"
                % ", ".join(unexpected)
            )

    entries = []
    for feature in features:
        guidance = review_guidance(feature)
        resolved_commits = {}
        for value, role in feature_commit_values(feature, channel):
            try:
                sha = git(repository, "rev-parse", "--verify", "%s^{commit}" % value)
                title = git(repository, "show", "-s", "--format=%s", sha)
            except RuntimeError:
                if role != "source":
                    raise
                sha = value
                title = "Source attribution"
            if role != "source" and not is_ancestor(repository, sha, "HEAD"):
                raise RuntimeError(
                    "%s %s commit is not in this build" % (feature["id"], role)
                )
            existing = resolved_commits.get(sha)
            if existing is None or ROLE_PRIORITY[role] > ROLE_PRIORITY[existing["role"]]:
                resolved_commits[sha] = {"sha": sha, "title": title, "role": role}
        commits = list(resolved_commits.values())
        threads = feature_thread_values(feature)
        if not commits:
            raise RuntimeError("%s has no exact commit metadata" % feature["id"])
        if not threads:
            raise RuntimeError("%s has no source T3 thread" % feature["id"])
        entries.append({
            "id": feature["id"],
            "name": feature["name"],
            **guidance,
            "state": feature["state"],
            "commits": commits,
            "threads": threads,
            "issueURL": feature.get("sourceIssue"),
            "visualEvidence": feature.get("visualEvidence", []),
        })

    remote = git(repository, "remote", "get-url", "origin")
    return {
        "schemaVersion": 1,
        "channel": channel,
        "build": build,
        "revision": git(repository, "rev-parse", "HEAD"),
        "repositoryURL": public_repository_url(remote),
        "entries": entries,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repository")
    parser.add_argument("channel", choices=("dev", "test"))
    parser.add_argument("build", type=int)
    parser.add_argument("output")
    args = parser.parse_args()
    if args.build < 1:
        parser.error("build must be positive")
    output = build_manifest(args.repository, args.channel, args.build)
    Path(args.output).write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
