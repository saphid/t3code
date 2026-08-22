#!/usr/bin/env python3
"""Preserve and verify reusable SwiftUI app builds by content hash."""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_manifest(root):
    root = Path(root)
    entries = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        entries.append({
            "path": path.relative_to(root).as_posix(),
            "sha256": file_hash(path),
            "size": path.stat().st_size,
        })
    digest = hashlib.sha256(json.dumps(entries, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    return entries, digest, sum(item["size"] for item in entries)


def receipt_identity(product, commit, configuration, platform, binary_relative_path):
    identity = {
        "product": product,
        "commit": commit,
        "configuration": configuration,
        "platform": platform,
        "binaryRelativePath": binary_relative_path,
    }
    return hashlib.sha256(
        json.dumps(identity, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest()


def preserve(source, store, commit, configuration, platform, binary_relative_path=None):
    source = Path(source).expanduser().resolve()
    if not source.is_dir() or source.suffix != ".app":
        raise ValueError("source must be an existing .app directory")
    if not isinstance(commit, str) or COMMIT_RE.fullmatch(commit) is None:
        raise ValueError("commit must be a lowercase 40-character hash")
    if not isinstance(configuration, str) or not configuration.strip():
        raise ValueError("configuration is required")
    if not isinstance(platform, str) or not platform.strip():
        raise ValueError("platform is required")
    binary_relative_path = binary_relative_path or source.stem
    source_binary = source / binary_relative_path
    if not source_binary.is_file():
        raise ValueError("app executable is missing: %s" % binary_relative_path)
    files, tree_hash, size = tree_manifest(source)
    destination = Path(store).expanduser() / tree_hash / source.name
    identity = receipt_identity(source.name, commit, configuration, platform,
                                binary_relative_path)
    receipt_path = destination.parent / "receipts" / (identity + ".json")
    if destination.exists():
        copied_files, copied_hash, copied_size = tree_manifest(destination)
        if copied_hash != tree_hash or copied_size != size or copied_files != files:
            raise RuntimeError("existing content-addressed build does not match source bytes")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.parent / (source.name + ".incoming-%d" % os.getpid())
        shutil.copytree(source, temporary, symlinks=True)
        copied_files, copied_hash, copied_size = tree_manifest(temporary)
        if copied_hash != tree_hash or copied_size != size:
            shutil.rmtree(temporary)
            raise RuntimeError("copied build did not match source bytes")
        try:
            os.replace(temporary, destination)
        except OSError:
            if not destination.is_dir():
                raise
            shutil.rmtree(temporary)
            copied_files, copied_hash, copied_size = tree_manifest(destination)
            if copied_hash != tree_hash or copied_size != size or copied_files != files:
                raise RuntimeError(
                    "concurrent content-addressed build does not match source bytes")
    if receipt_path.is_file():
        receipt = json.loads(receipt_path.read_text())
        verify(receipt_path)
        return receipt_path, receipt, "already-preserved"
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt = {
        "schemaVersion": 1,
        "kind": "swiftui-preserved-build",
        "commit": commit,
        "configuration": configuration,
        "platform": platform,
        "product": source.name,
        "binaryRelativePath": binary_relative_path,
        "binarySha256": file_hash(source_binary),
        "treeSha256": tree_hash,
        "byteSize": size,
        "fileCount": len(files),
        "storedPath": str(destination),
        "retainedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "retention": "retain-until-explicit-reviewed-eviction",
        "files": files,
    }
    temporary_receipt = receipt_path.parent / (receipt_path.name + ".incoming-%d" % os.getpid())
    temporary_receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    os.replace(temporary_receipt, receipt_path)
    return receipt_path, receipt, "preserved"


def verify(receipt_path):
    receipt_path = Path(receipt_path).expanduser().resolve()
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("kind") != "swiftui-preserved-build":
        raise ValueError("not a SwiftUI preserved-build receipt")
    stored = Path(receipt["storedPath"])
    if not stored.is_dir():
        raise ValueError("stored build is missing")
    files, tree_hash, size = tree_manifest(stored)
    if tree_hash != receipt.get("treeSha256") or size != receipt.get("byteSize"):
        raise ValueError("stored build bytes no longer match receipt")
    if files != receipt.get("files"):
        raise ValueError("stored build file manifest no longer matches receipt")
    binary = stored / receipt.get("binaryRelativePath", "")
    if not binary.is_file() or file_hash(binary) != receipt.get("binarySha256"):
        raise ValueError("stored app executable no longer matches receipt")
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    keep = sub.add_parser("preserve")
    keep.add_argument("source")
    keep.add_argument("--store", default="~/.local/share/t3/swiftui-delivery/builds")
    keep.add_argument("--commit", required=True)
    keep.add_argument("--configuration", required=True)
    keep.add_argument("--platform", required=True)
    keep.add_argument("--binary-relative-path")
    check = sub.add_parser("verify")
    check.add_argument("receipt")
    args = parser.parse_args(argv)
    try:
        if args.command == "preserve":
            path, receipt, status = preserve(args.source, args.store, args.commit,
                                             args.configuration, args.platform,
                                             args.binary_relative_path)
            print(json.dumps({"ok": True, "status": status, "receipt": str(path),
                              "treeSha256": receipt["treeSha256"],
                              "byteSize": receipt["byteSize"]}, indent=2, sort_keys=True))
        else:
            receipt = verify(args.receipt)
            print(json.dumps({"ok": True, "storedPath": receipt["storedPath"],
                              "treeSha256": receipt["treeSha256"]}, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)]}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
