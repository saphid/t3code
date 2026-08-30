#!/usr/bin/env python3
"""Emit and compare context-free product changes for proof rebases."""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def normalized_product_patch(repository, base, head, paths):
    command = [
        "git", "-C", str(repository), "diff", "--no-color", "--unified=0",
        base, head, "--", *paths,
    ]
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git diff failed")
    retained = []
    for line in result.stdout.splitlines():
        if line.startswith(("diff ", "index ", "---", "+++", "@@")):
            continue
        if line.startswith(("+", "-")):
            retained.append(line)
    return ("\n".join(retained) + "\n").encode()


def compare(args):
    repository = Path(args.repository).resolve()
    source = normalized_product_patch(
        repository, args.source_base, args.source_head, args.path)
    target = normalized_product_patch(
        repository, args.target_base, args.target_head, args.path)
    source_output = Path(args.source_output).resolve()
    target_output = Path(args.target_output).resolve()
    source_output.write_bytes(source)
    target_output.write_bytes(target)
    if source != target:
        raise RuntimeError("source and target product changes differ")
    if args.receipt_output:
        if not args.issue or not args.source_proof_sha256 or not args.reason:
            raise RuntimeError(
                "receipt output requires --issue, --source-proof-sha256, and --reason")
        digest = hashlib.sha256(source).hexdigest()
        receipt = {
            "schemaVersion": 1,
            "kind": "swiftui-proof-equivalence-receipt",
            "issue": args.issue,
            "sourceProofSha256": args.source_proof_sha256,
            "sourceBaseCommit": args.source_base,
            "sourceHeadCommit": args.source_head,
            "targetBaseCommit": args.target_base,
            "targetHeadCommit": args.target_head,
            "repositoryPath": str(repository),
            "productPaths": args.path,
            "sourceProductPatch": {"path": str(source_output), "sha256": digest},
            "targetProductPatch": {"path": str(target_output), "sha256": digest},
            "reason": args.reason,
            "verifiedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        Path(args.receipt_output).resolve().write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n")


def parser():
    value = argparse.ArgumentParser(
        description="Compare proof-source and rebased product changes without diff context.")
    subparsers = value.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("compare")
    command.add_argument("--repository", required=True)
    command.add_argument("--source-base", required=True)
    command.add_argument("--source-head", required=True)
    command.add_argument("--target-base", required=True)
    command.add_argument("--target-head", required=True)
    command.add_argument("--path", action="append", required=True)
    command.add_argument("--source-output", required=True)
    command.add_argument("--target-output", required=True)
    command.add_argument("--receipt-output")
    command.add_argument("--issue")
    command.add_argument("--source-proof-sha256")
    command.add_argument("--reason")
    command.set_defaults(handler=compare)
    return value


def main():
    args = parser().parse_args()
    try:
        args.handler(args)
    except RuntimeError as exc:
        raise SystemExit("proof-equivalence: %s" % exc)


if __name__ == "__main__":
    main()
