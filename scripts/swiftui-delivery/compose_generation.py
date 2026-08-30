#!/usr/bin/env python3
"""Materialize one phone-build source tree from Theo base plus exact overlays."""

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DELIVERY_SPEC = importlib.util.spec_from_file_location(
    "swiftui_generation_delivery_protocol", ROOT / "swiftui_delivery.py")
delivery = importlib.util.module_from_spec(DELIVERY_SPEC)
DELIVERY_SPEC.loader.exec_module(delivery)


class CompositionError(RuntimeError):
    pass


def run_git(repository, arguments, input_bytes=None, extra_environment=None):
    command = ["git", "-C", str(repository)] + list(arguments)
    environment = os.environ.copy()
    environment.update(extra_environment or {})
    result = subprocess.run(
        command, input=input_bytes, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False, env=environment)
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise CompositionError("git command failed (%d): %s\n%s" % (
            result.returncode, " ".join(command), detail))
    return result.stdout


def commit_exists(repository, commit):
    result = subprocess.run(
        ["git", "-C", str(repository), "cat-file", "-e", commit + "^{commit}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return result.returncode == 0


def is_ancestor(repository, base, head):
    result = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", base, head],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return result.returncode == 0


def resolve_remote_ref(repository, remote, ref):
    output = run_git(repository, ["ls-remote", "--exit-code", remote, ref])
    rows = [line.split() for line in output.decode().splitlines() if line.strip()]
    if len(rows) != 1 or len(rows[0]) != 2 or rows[0][1] != ref:
        raise CompositionError("remote ref did not resolve exactly once: %s %s" % (
            remote, ref))
    return rows[0][0]


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    if path.exists() or temporary.exists():
        raise CompositionError("receipt path or temporary path already exists: %s" % path)
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def compose(plan_path, repository, worktree, receipt_path):
    plan_path = Path(plan_path).expanduser().resolve()
    repository = Path(repository).expanduser().resolve()
    worktree = Path(worktree).expanduser().resolve()
    receipt_path = Path(receipt_path).expanduser().resolve()
    plan = delivery.load(plan_path)
    errors = delivery.validate_composition_plan(plan)
    if errors:
        raise CompositionError("invalid composition plan:\n- " + "\n- ".join(errors))
    if worktree.exists():
        raise CompositionError("output worktree already exists: %s" % worktree)
    if receipt_path.exists():
        raise CompositionError("receipt already exists: %s" % receipt_path)
    source = plan["sourceBase"]
    live_commit = resolve_remote_ref(repository, source["remote"], source["ref"])
    if live_commit != source["commit"]:
        raise CompositionError(
            "Theo source ref moved: plan=%s live=%s; make a new plan and re-prove overlays" %
            (source["commit"], live_commit))
    commits = [source["commit"]]
    for overlay in plan["overlays"]:
        commits.extend((overlay["baseCommit"], overlay["headCommit"]))
    missing = sorted(set(commit for commit in commits
                         if not commit_exists(repository, commit)))
    if missing:
        raise CompositionError("repository is missing planned commits: %s" %
                               ", ".join(missing))
    for overlay in plan["overlays"]:
        if not is_ancestor(repository, overlay["baseCommit"], overlay["headCommit"]):
            raise CompositionError("overlay head is not descended from Theo base: %s" %
                                   overlay["issue"])

    worktree.parent.mkdir(parents=True, exist_ok=True)
    run_git(repository, ["worktree", "add", "--detach", str(worktree), source["commit"]])
    applied = []
    for overlay in plan["overlays"]:
        patch = run_git(repository, [
            "diff", "--binary", "--full-index", "--find-renames",
            overlay["baseCommit"], overlay["headCommit"], "--"])
        if not patch:
            raise CompositionError("overlay has no changes: %s" % overlay["issue"])
        patch_sha = hashlib.sha256(patch).hexdigest()
        run_git(worktree, ["apply", "--index", "--check", "-"], patch)
        run_git(worktree, ["apply", "--index", "-"], patch)
        changed = run_git(worktree, ["diff", "--cached", "--name-only", "-z"])
        changed_files = [item.decode("utf-8", errors="surrogateescape")
                         for item in changed.split(b"\0") if item]
        message = "compose(swiftui): apply %s" % overlay["issue"]
        detail = "Source-Base: %s\nOverlay-Head: %s" % (
            overlay["baseCommit"], overlay["headCommit"])
        commit_environment = {
            "GIT_AUTHOR_DATE": source["resolvedAt"],
            "GIT_COMMITTER_DATE": source["resolvedAt"],
        }
        run_git(worktree, [
            "-c", "user.name=T3 SwiftUI Build Composer",
            "-c", "user.email=swiftui-build-composer@local.invalid",
            "commit", "--no-gpg-sign", "--no-verify", "-m", message, "-m", detail],
            extra_environment=commit_environment)
        resulting_commit = run_git(worktree, ["rev-parse", "HEAD"]).decode().strip()
        applied.append({
            "issue": overlay["issue"],
            "baseCommit": overlay["baseCommit"],
            "headCommit": overlay["headCommit"],
            "patchSha256": patch_sha,
            "changedFiles": changed_files,
            "resultingCommit": resulting_commit,
        })

    run_git(worktree, ["diff", "--check", source["commit"] + "..HEAD"])
    resulting_commit = run_git(worktree, ["rev-parse", "HEAD"]).decode().strip()
    resulting_tree = run_git(worktree, ["rev-parse", "HEAD^{tree}"]).decode().strip()
    receipt = {
        "schemaVersion": 1,
        "kind": delivery.CONTRACT["buildComposition"]["receiptKind"],
        "planSha256": delivery.sha256(plan_path),
        "sourceBase": source,
        "overlays": applied,
        "priorCompositeUsedAsBase": False,
        "resultingCommit": resulting_commit,
        "resultingTree": resulting_tree,
        "worktree": str(worktree),
        "completedAt": utc_now(),
    }
    receipt_errors = delivery.validate_composition_receipt(receipt, plan, plan_path)
    if receipt_errors:
        raise CompositionError("generated invalid receipt:\n- " +
                               "\n- ".join(receipt_errors))
    atomic_write_json(receipt_path, receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("--repository", required=True)
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args(argv)
    try:
        receipt = compose(args.plan, args.repository, args.worktree, args.receipt)
        print(json.dumps({"ok": True, "receipt": receipt}, indent=2, sort_keys=True))
        return 0
    except (CompositionError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)]}, indent=2,
                         sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
