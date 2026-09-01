#!/usr/bin/env python3
"""Audit only this checkout's SwiftUI delivery skill environment."""

import json
import sys
from pathlib import Path


PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parents[1]
PROJECT_SKILLS = (
    "file-swiftui-lane-issue",
    "swiftui-orchestrate",
    "swiftui-feature-work",
    "swiftui-deliver",
    "ios-build-hygiene",
    "share-video-evidence",
    "babysit-pr",
    "t3code-land-contribution",
)


def audit():
    errors, project_skills = [], []
    skill_root = REPO / ".agents" / "skills"
    for name in PROJECT_SKILLS:
        skill = skill_root / name
        if not (skill / "SKILL.md").is_file():
            errors.append("project skill is missing: %s" % skill)
            continue
        if skill.is_symlink():
            errors.append("project skill must be real repo source, not a symlink: %s" % skill)
        resolved = skill.resolve(strict=False)
        if REPO not in resolved.parents:
            errors.append("project skill escapes this checkout: %s -> %s" % (skill, resolved))
        for candidate in skill.rglob("*"):
            if candidate.is_symlink():
                errors.append("project skill contains a symlink: %s" %
                              candidate.relative_to(REPO))
        project_skills.append(str(skill.relative_to(REPO)))
    return errors, project_skills


if __name__ == "__main__":
    failures, skills = audit()
    print(json.dumps({"ok": not failures, "errors": failures,
                      "projectSkills": skills}, indent=2, sort_keys=True))
    sys.exit(0 if not failures else 1)
