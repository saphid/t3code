#!/usr/bin/env python3
"""Build an independent reachable-reference baseline from the seed manifest.

This intentionally uses small regular expressions instead of the repository's
extractor. It records every seed path and every extracted edge, while resolving
each source location independently even when files share identical content.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import stat
from collections import Counter, deque
from pathlib import Path
from urllib.parse import unquote, urlparse


HERE = Path(__file__).resolve().parent
BASELINE = HERE / "instruction-baseline.json"
OUTPUT = HERE / "reference-baseline.json"

DOC_EXTENSIONS = {".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"}
KNOWN_BARE = {
    "AGENTS.md",
    "CLAUDE.md",
    "SKILL.md",
    "README.md",
    "README.rst",
    "package.json",
    "tsconfig.json",
    ".mcp.json",
    "LLMS.md",
}

# Markdown links and definitions. Titles and fragments are removed later.
MD_LINK = re.compile(
    r"\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))", re.MULTILINE
)
MD_DEFINITION = re.compile(
    r"^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|([^\s]+))", re.MULTILINE
)
HTML_REF = re.compile(r"(?:href|src)\s*=\s*[\"']([^\"']+)", re.I)
AT_REF = re.compile(
    r"(?<![\w@])@((?:\.\.?/|/)?[A-Za-z0-9_.~+/@-]+)", re.MULTILINE
)
PATH_REF = re.compile(
    r"(?<![\w@])(?:\.\.?/|/|~/|[A-Za-z0-9_.-]+/)[^\s<>()[\]{}\"'`;,]+"
)
BARE_REF = re.compile(
    r"(?<![\w/.-])(?:AGENTS\.md|CLAUDE\.md|SKILL\.md|README\.[A-Za-z0-9_-]+|package\.json|tsconfig\.json|\.mcp\.json|LLMS\.md)(?![\w.-])",
    re.I,
)
FILE_REF = re.compile(
    r"(?<![\w@/.-])(?:\.?[A-Za-z0-9][A-Za-z0-9_.@+-]*\.[A-Za-z][A-Za-z0-9_-]*)(?![\w.-])"
)
DOTFILE_REF = re.compile(r"(?<![\w@/])\.[A-Za-z0-9][A-Za-z0-9_.-]*(?![\w.-])")


def display(path: str, root: str) -> str:
    """Use root-relative paths where possible, preserving lexical symlinks."""
    absolute = os.path.abspath(path)
    try:
        if os.path.commonpath((absolute, root)) == root:
            return os.path.relpath(absolute, root)
    except ValueError:
        pass
    return absolute


def is_doc(path: str) -> bool:
    return Path(path).suffix.lower() in DOC_EXTENSIONS


def nearest_checkout(path: str) -> str | None:
    current = Path(path).parent if os.path.isfile(path) else Path(path)
    for directory in (current, *current.parents):
        if os.path.exists(directory / ".git"):
            return str(directory)
    return None


def package_roots(path: str) -> list[str]:
    """Find package roots between a source and its containing checkout."""
    current = Path(path).parent if os.path.isfile(path) else Path(path)
    roots: list[str] = []
    for directory in (current, *current.parents):
        if (directory / "package.json").is_file():
            roots.append(str(directory))
        if os.path.exists(directory / ".git"):
            break
    return roots


def strip_target(raw: str) -> str:
    value = raw.strip().strip("`<>'\"()[]{}")
    value = value.rstrip(".,;:!?")
    value = unquote(value)
    if "#" in value:
        value = value.split("#", 1)[0]
    if "?" in value and not value.startswith("?"):
        value = value.split("?", 1)[0]
    return value


def classify_external(target: str) -> str | None:
    if not target:
        return "empty"
    if target.startswith("#"):
        return "anchor"
    parsed = urlparse(target)
    if parsed.scheme and parsed.scheme not in {".", ".."}:
        return "external"
    if target.startswith("//"):
        return "external"
    return None


def dynamic_target(target: str) -> bool:
    return any(mark in target for mark in ("$", "*", "?", "{", "}", "…"))


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def add_ref(refs: list[dict], seen: set[tuple], source: str, text: str,
            kind: str, raw: str, offset: int) -> None:
    target = strip_target(raw)
    key = (kind, target, line_number(text, offset))
    if not target or key in seen:
        return
    seen.add(key)
    refs.append({
        "kind": kind,
        "raw": raw,
        "target": target,
        "line": key[2],
    })


def extract_refs(source: str, text: str, skill_stems: set[str]) -> list[dict]:
    refs: list[dict] = []
    seen: set[tuple] = set()
    for pattern, kind in (
        (MD_LINK, "markdown_link"),
        (MD_DEFINITION, "markdown_definition"),
        (HTML_REF, "html_reference"),
    ):
        for match in pattern.finditer(text):
            raw = next((group for group in match.groups() if group is not None), "")
            add_ref(refs, seen, source, text, kind, raw, match.start())

    for match in AT_REF.finditer(text):
        target = match.group(1)
        # Claude-style imports are path-like. Bare @words occur frequently in
        # prose and code labels, so only retain them when they name a known
        # instruction file or contain path syntax/file punctuation.
        if (target in KNOWN_BARE or "/" in target or target.startswith(".")
                or "." in target):
            add_ref(refs, seen, source, text, "at_import", target, match.start())

    # Backtick contents include command examples. Extract path-shaped tokens
    # from them separately so the edge retains its source syntax.
    for match in re.finditer(r"`([^`]+)`", text, re.DOTALL):
        body = match.group(1)
        for token in PATH_REF.finditer(body):
            add_ref(refs, seen, source, text, "backtick_path", token.group(), match.start() + token.start())

    for match in PATH_REF.finditer(text):
        add_ref(refs, seen, source, text, "plain_path", match.group(), match.start())

    # Bare filenames occur in command examples and prose, for example
    # `Providers.ts`, `.env.example`, and `.gitignore`.
    for pattern, kind in ((FILE_REF, "plain_filename"), (DOTFILE_REF, "plain_dotfile")):
        for match in pattern.finditer(text):
            add_ref(refs, seen, source, text, kind, match.group(), match.start())

    for match in BARE_REF.finditer(text):
        add_ref(refs, seen, source, text, "bare_filename", match.group(), match.start())

    # A bare sibling skill name is useful only when the surrounding line makes
    # it clear that the word names a skill or instruction set. This avoids
    # treating ordinary prose words as paths.
    for line_match in re.finditer(r"[^\n]*(?:skill|instruction|workflow)[^\n]*", text, re.I):
        line = line_match.group()
        if not re.search(r"\b(?:skill|instruction|workflow)\b", line, re.I):
            continue
        for stem in skill_stems:
            match = re.search(rf"(?<![\w/-]){re.escape(stem)}(?![\w-])", line, re.I)
            if match:
                add_ref(refs, seen, source, text, "bare_skill", stem,
                        line_match.start() + match.start())
    return refs


def candidate_paths(source: str, target: str, root: str, skill_stems: set[str]) -> list[str]:
    source_dir = os.path.dirname(source)
    checkout = nearest_checkout(source) or root
    packages = package_roots(source)
    candidates: list[str] = []

    def add(path: str) -> None:
        normalized = os.path.abspath(os.path.normpath(path))
        if normalized not in candidates:
            candidates.append(normalized)

    if target.startswith("~/"):
        return candidates
    if target.startswith("/"):
        # Existing absolute paths are honored. Otherwise a leading slash is
        # interpreted as a path from the containing checkout root.
        if os.path.lexists(target):
            add(target)
        else:
            add(os.path.join(checkout, target.lstrip("/")))
    elif target.startswith("./") or target.startswith("../"):
        add(os.path.join(source_dir, target))
    else:
        # Bare and slash-containing paths are first sibling-relative, then
        # checkout-root-relative, then dependency-package-relative.
        add(os.path.join(source_dir, target))
        if "/" in target:
            for pkg in packages:
                add(os.path.join(pkg, target))
            add(os.path.join(checkout, target))
        else:
            for pkg in packages:
                add(os.path.join(pkg, target))
            add(os.path.join(checkout, target))

        # Bare skill names resolve to sibling directories in the containing
        # skills directory, with SKILL.md as the instruction document.
        if target in skill_stems:
            add(os.path.join(source_dir, "..", target, "SKILL.md"))
            add(os.path.join(source_dir, target, "SKILL.md"))

    return candidates


def resolve_edge(source: str, ref: dict, root: str, skill_stems: set[str]) -> dict:
    target = ref["target"]
    external = classify_external(target)
    result = {
        "source": display(source, root),
        "line": ref["line"],
        "kind": ref["kind"],
        "raw": ref["raw"],
        "target": target,
    }
    if external:
        result.update({"status": external, "resolved": None})
        return result
    if dynamic_target(target):
        result.update({"status": "dynamic", "resolved": None})
        return result

    candidates = candidate_paths(source, target, root, skill_stems)
    existing = next((candidate for candidate in candidates if os.path.exists(candidate)), None)
    if existing is None:
        result.update({
            "status": "missing",
            "resolved": None,
            "attempted": [display(candidate, root) for candidate in candidates],
        })
        return result
    if os.path.isdir(existing):
        result.update({"status": "directory", "resolved": display(existing, root)})
        return result
    mode = os.stat(existing).st_mode
    if not stat.S_ISREG(mode):
        result.update({"status": "special", "resolved": display(existing, root)})
        return result
    status = "document" if is_doc(existing) else "leaf"
    result.update({"status": status, "resolved": display(existing, root)})
    return result


def main() -> int:
    baseline = json.loads(BASELINE.read_text())
    root = os.path.abspath(baseline["root"])
    seed_items = baseline["instruction_candidates"] + baseline["skill_candidates"]
    seed_paths = [os.path.abspath(os.path.join(root, item["path"])) for item in seed_items]
    skill_stems = {
        os.path.basename(os.path.dirname(path))
        for path in (os.path.abspath(os.path.join(root, item["path"]))
                     for item in baseline["skill_candidates"])
    }
    skill_stems -= {"skill", "skills", "workflow", "workflows", "instruction", "instructions"}

    queue: deque[str] = deque(seed_paths)
    queued = set(seed_paths)
    processed: set[str] = set()
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    read_errors: list[dict] = []
    content_cache: dict[str, str] = {}

    while queue:
        source = queue.popleft()
        if source in processed:
            continue
        processed.add(source)
        node_key = display(source, root)
        node = nodes.setdefault(node_key, {"path": node_key})
        if not os.path.exists(source):
            node.update({"status": "missing", "kind": "document" if is_doc(source) else "leaf"})
            continue
        if os.path.isdir(source):
            node.update({"status": "directory", "kind": "directory"})
            continue
        node["kind"] = "document" if is_doc(source) else "leaf"
        try:
            data = Path(source).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            text = content_cache.get(digest)
            if text is None:
                text = data.decode("utf-8-sig", errors="replace")
                content_cache[digest] = text
        except OSError as error:
            node["status"] = "read_error"
            read_errors.append({"path": node_key, "error": str(error)})
            continue
        node.update({"status": "read", "sha256": digest})
        if not is_doc(source):
            continue
        refs = extract_refs(source, text, skill_stems)
        node["reference_count"] = len(refs)
        for ref in refs:
            edge = resolve_edge(source, ref, root, skill_stems)
            edges.append(edge)
            if edge["status"] == "document" and edge["resolved"]:
                next_path = os.path.abspath(os.path.join(root, edge["resolved"])) if not os.path.isabs(edge["resolved"]) else edge["resolved"]
                if next_path not in queued:
                    queued.add(next_path)
                    queue.append(next_path)

    # Seed paths remain a separate complete list, even when duplicate content
    # or duplicate lexical locations collapse into one node.
    seed_display = [display(path, root) for path in seed_paths]
    raw_edge_count = len(edges)
    grouped: dict[tuple, dict] = {}
    for edge in edges:
        key = (edge["source"], edge["kind"], edge["raw"], edge["target"], edge["status"], edge.get("resolved"))
        existing = grouped.get(key)
        if existing is None:
            existing = dict(edge)
            existing["lines"] = [edge["line"]]
            existing.pop("line", None)
            grouped[key] = existing
        elif edge["line"] not in existing["lines"]:
            existing["lines"].append(edge["line"])
    edges = sorted(grouped.values(), key=lambda edge: (edge["source"], edge["lines"][0], edge["kind"], edge["target"]))
    status_counts = Counter(edge["status"] for edge in edges)
    output = {
        "schema_version": 1,
        "root": root,
        "seed_paths": seed_display,
        "seed_count": len(seed_display),
        "unique_seed_count": len(set(seed_display)),
        "reachable_document_count": sum(1 for node in nodes.values() if node.get("kind") == "document"),
        "reachable_node_count": len(nodes),
        "content_cache_entries": len(content_cache),
        "raw_edge_count": raw_edge_count,
        "edge_count": len(edges),
        "edge_status_counts": dict(sorted(status_counts.items())),
        "nodes": sorted(nodes.values(), key=lambda node: node["path"]),
        "edges": edges,
        "read_errors": read_errors,
        "symlink_directories_skipped_count": len(baseline.get("symlink_directories", [])),
        "symlink_directory_samples": baseline.get("symlink_directories", [])[:20],
        "symlink_file_count": len(baseline.get("symlink_files", [])),
        "walk_errors_from_seed_baseline": baseline.get("walk_errors", []),
        "extraction_limits": [
            "Markdown parsing is regex-based and does not build a full CommonMark AST.",
            "Only local-looking path tokens are resolved; shell interpolation, globs, and computed paths are marked dynamic.",
            "Remote URLs, anchors, and mailto links are recorded as external edges and are not fetched.",
            "Directory targets are recorded and not traversed; script and asset targets are leaves.",
            "A leading slash is treated as checkout-root-relative unless that absolute path exists.",
            "Each lexical source path is resolved independently, although identical file bytes share decoded content cache entries.",
        ],
    }
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({
        "seed_count": output["seed_count"],
        "unique_seed_count": output["unique_seed_count"],
        "reachable_document_count": output["reachable_document_count"],
        "reachable_node_count": output["reachable_node_count"],
        "edge_count": output["edge_count"],
        "edge_status_counts": output["edge_status_counts"],
        "read_errors": len(read_errors),
        "content_cache_entries": len(content_cache),
        "output": str(OUTPUT),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
