#!/usr/bin/env python3
"""Fail when the project-owned SwiftUI delivery package escapes the repo."""

import json
import re
import sys
from pathlib import Path


PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parents[1]
MANIFEST = json.loads((PACKAGE / "package-manifest.json").read_text())
ABSOLUTE_SOURCE = re.compile("/" + r"(?:Users|home)/[^/\s'\"<]+/")


def audit():
    errors = []
    for relative in MANIFEST["requiredFiles"]:
        path = REPO / relative
        if not path.is_file():
            errors.append("required repository file is missing: %s" % relative)
    scanned = []
    for relative_root in MANIFEST["sourceRoots"]:
        root = REPO / relative_root
        if not root.is_dir():
            errors.append("required source root is missing: %s" % relative_root)
            continue
        for path in sorted(item for item in root.rglob("*") if item.is_file() and
                           "__pycache__" not in item.parts):
            if path.suffix not in ("", ".html", ".md", ".json", ".py", ".sh", ".yaml", ".yml"):
                continue
            scanned.append(path)
            text = path.read_text(errors="replace")
            relative = path.relative_to(REPO)
            if ABSOLUTE_SOURCE.search(text):
                errors.append("checkout-specific source path in %s" % relative)
    for relative_document in MANIFEST.get("auditedDocuments", []):
        path = REPO / relative_document
        if not path.is_file():
            errors.append("audited document is missing: %s" % relative_document)
            continue
        scanned.append(path)
        text = path.read_text(errors="replace")
        if (ABSOLUTE_SOURCE.search(text) and
                relative_document not in MANIFEST.get("absolutePathAllowlist", [])):
            errors.append("checkout-specific source path in %s" % relative_document)
    for retired in MANIFEST["forbiddenPackagePaths"]:
        if (REPO / retired).exists():
            errors.append("retired orchestration path still exists: %s" % retired)
    return errors, scanned


if __name__ == "__main__":
    failures, files = audit()
    print(json.dumps({"ok": not failures, "filesScanned": len(files), "errors": failures},
                     indent=2, sort_keys=True))
    sys.exit(0 if not failures else 1)
