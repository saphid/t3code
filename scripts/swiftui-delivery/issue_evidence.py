#!/usr/bin/env python3
"""Publish validated SwiftUI proof media to its owning GitHub issue."""

import argparse
import hashlib
import http.client
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlencode


BEGIN_MARKER = "<!-- swiftui-validated-evidence:start"
END_MARKER = "<!-- swiftui-validated-evidence:end -->"
UPLOAD_HOST = "uploads.github.com"
UPLOAD_PATH = "/user-attachments/assets"
WORK_ITEM_RE = re.compile(
    r"```swiftui-work-item-v2(?:\r?\n).*?```", re.DOTALL
)
ISSUE_RE = re.compile(r"^(?P<owner>[^/]+)/(?P<repo>[^#]+)#(?P<number>[1-9][0-9]*)$")


class PublishError(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_gh(args: Sequence[str], input_value: Optional[str] = None) -> str:
    result = subprocess.run(
        ["gh"] + list(args),
        input=input_value,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown gh error"
        raise PublishError("gh command failed: " + detail)
    return result.stdout


def parse_issue_ref(value: str) -> Tuple[str, str, int]:
    match = ISSUE_RE.fullmatch(value)
    if not match:
        raise PublishError("proof issue must look like owner/repository#123")
    return match.group("owner"), match.group("repo"), int(match.group("number"))


def work_item_blocks(body: str) -> List[str]:
    return WORK_ITEM_RE.findall(body)


def replace_evidence_section(body: str, section: str) -> str:
    start = body.find(BEGIN_MARKER)
    end = body.find(END_MARKER)
    if (start == -1) != (end == -1):
        raise PublishError("issue body has an incomplete validated-evidence marker pair")
    if start != -1:
        if end < start:
            raise PublishError("issue body validated-evidence markers are out of order")
        end += len(END_MARKER)
        return body[:start] + section + body[end:]
    separator = "\n\n" if body else ""
    return body + separator + section


def display_label(capture: Dict[str, object]) -> str:
    phase = str(capture["phase"]).capitalize()
    appearance = str(capture.get("appearance", "not-applicable"))
    suffix = "" if appearance == "not-applicable" else " — " + appearance.capitalize()
    return phase + suffix + " — " + str(capture["id"])


def build_evidence_section(
    proof: Dict[str, object],
    proof_sha256: str,
    capture_urls: Dict[str, str],
    gif_url: str,
) -> str:
    base = str(proof["baseCommit"])
    head = str(proof["headCommit"])
    lines = [
        BEGIN_MARKER + " proof-sha256=" + proof_sha256 + " -->",
        "## Validated simulator evidence",
        "",
        "Exact base `" + base + "` → exact head `" + head + "`.",
    ]
    captures = proof.get("captures")
    if not isinstance(captures, list) or not captures:
        raise PublishError("proof has no captures")

    for phase in ("before", "after"):
        phase_captures = [capture for capture in captures if capture.get("phase") == phase]
        if not phase_captures:
            raise PublishError("proof has no " + phase + " captures")
        lines.extend(["", "### " + phase.capitalize()])
        for capture in phase_captures:
            capture_id = str(capture["id"])
            url = capture_urls[capture_id]
            lines.extend(["", "#### " + display_label(capture), ""])
            if capture.get("kind") == "image":
                lines.append("![" + capture_id + "](" + url + ")")
            elif capture.get("kind") == "video":
                lines.append(url)
            else:
                raise PublishError("unsupported capture kind for " + capture_id)

    lines.extend(
        [
            "",
            "### Animated comparison",
            "",
            "![animated-comparison](" + gif_url + ")",
            "",
            END_MARKER,
        ]
    )
    return "\n".join(lines)


def detect_content_type(path: Path) -> str:
    content_type, _ = mimetypes.guess_type(str(path))
    if not content_type or not (
        content_type.startswith("image/") or content_type.startswith("video/")
    ):
        raise PublishError("GitHub bearer upload only supports image/video: " + str(path))
    return content_type


def validate_attachment_url(url: str) -> str:
    if not url.startswith("https://github.com/user-attachments/assets/"):
        raise PublishError("reuse asset has an unexpected GitHub attachment URL")
    return url


def upload_asset(token: str, repository_id: int, path: Path) -> str:
    content_type = detect_content_type(path)
    query = urlencode(
        {
            "name": path.name,
            "content_type": content_type,
            "repository_id": str(repository_id),
        }
    )
    size = path.stat().st_size
    connection = http.client.HTTPSConnection(UPLOAD_HOST, timeout=120)
    try:
        with path.open("rb") as handle:
            connection.request(
                "POST",
                UPLOAD_PATH + "?" + query,
                body=handle,
                headers={
                    "Authorization": "Bearer " + token,
                    "Accept": "application/json",
                    "Content-Type": content_type,
                    "Content-Length": str(size),
                    "User-Agent": "t3-swiftui-delivery-issue-evidence",
                },
            )
            response = connection.getresponse()
            payload = response.read()
    except (OSError, http.client.HTTPException) as error:
        raise PublishError("GitHub attachment upload failed: " + str(error)) from error
    finally:
        connection.close()
    if response.status != 201:
        detail = payload.decode("utf-8", errors="replace")[:300]
        raise PublishError(
            "GitHub attachment upload returned HTTP "
            + str(response.status)
            + ": "
            + detail
        )
    try:
        url = json.loads(payload)["url"]
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise PublishError("GitHub attachment response has no URL") from error
    if not isinstance(url, str):
        raise PublishError("GitHub returned an unexpected attachment URL")
    return validate_attachment_url(url)


def validate_artifacts(proof_path: Path, inspection_path: Path) -> None:
    command = Path(__file__).resolve().parent / "scripts" / "swiftui-delivery"
    for args in (
        ["validate-proof", str(proof_path)],
        ["validate-inspection", str(inspection_path), "--proof", str(proof_path)],
    ):
        result = subprocess.run([str(command)] + args)
        if result.returncode != 0:
            raise PublishError("artifact validation failed: " + " ".join(args))


def load_json(path: Path) -> Dict[str, object]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise PublishError("cannot read JSON " + str(path) + ": " + str(error)) from error
    if not isinstance(value, dict):
        raise PublishError("expected a JSON object at " + str(path))
    return value


def parse_reuse(values: Sequence[str]) -> Dict[str, str]:
    result = {}
    for value in values:
        path, separator, url = value.partition("=")
        if not separator or not path or not url:
            raise PublishError("--reuse-asset must be PATH=URL")
        result[str(Path(path).resolve())] = validate_attachment_url(url)
    return result


def reuse_from_receipt(path_value: Optional[str]) -> Dict[str, str]:
    if not path_value:
        return {}
    receipt = load_json(Path(path_value).resolve())
    if receipt.get("kind") != "swiftui-issue-evidence-publication-receipt":
        raise PublishError("reuse receipt has the wrong kind")
    assets = receipt.get("assets")
    if not isinstance(assets, list):
        raise PublishError("reuse receipt has no assets array")
    result = {}
    for asset in assets:
        if not isinstance(asset, dict) or "path" not in asset or "url" not in asset:
            raise PublishError("reuse receipt has an invalid asset row")
        path = Path(str(asset["path"])).resolve()
        if not path.is_file() or asset.get("sha256") != sha256_file(path):
            raise PublishError("reuse receipt asset no longer matches " + str(path))
        result[str(path)] = validate_attachment_url(str(asset["url"]))
    return result


def atomic_write_json(path: Path, value: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise PublishError("publication receipt already exists: " + str(path))
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=str(path.parent), delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        try:
            os.link(str(temporary), str(path))
        except FileExistsError as error:
            raise PublishError(
                "publication receipt already exists: " + str(path)
            ) from error
    finally:
        if temporary.exists():
            temporary.unlink()


def publish(args: argparse.Namespace) -> Dict[str, object]:
    proof_path = Path(args.proof).resolve()
    inspection_path = Path(args.inspection).resolve()
    gif_path = Path(args.gif).resolve()
    receipt_path = Path(args.receipt).resolve()
    if receipt_path.exists():
        raise PublishError("publication receipt already exists: " + str(receipt_path))
    if args.reuse_receipt and Path(args.reuse_receipt).resolve() == receipt_path:
        raise PublishError("--reuse-receipt and --receipt must name different files")
    validate_artifacts(proof_path, inspection_path)
    proof = load_json(proof_path)
    owner, repo, issue_number = parse_issue_ref(str(proof.get("issue", "")))
    proof_sha = sha256_file(proof_path)
    inspection_sha = sha256_file(inspection_path)

    repository = json.loads(run_gh(["api", "repos/" + owner + "/" + repo]))
    permissions = repository.get("permissions", {})
    if not isinstance(permissions, dict) or not permissions.get("push"):
        raise PublishError("the active gh account cannot push to " + owner + "/" + repo)
    repository_id = int(repository["id"])
    token = run_gh(["auth", "token"]).strip()
    if not token:
        raise PublishError("gh auth token returned no token")

    issue_api = "repos/" + owner + "/" + repo + "/issues/" + str(issue_number)
    before_issue = json.loads(run_gh(["api", issue_api]))
    before_body = str(before_issue.get("body") or "")
    before_blocks = work_item_blocks(before_body)
    if len(before_blocks) != 1:
        raise PublishError("issue body must contain exactly one swiftui-work-item-v2 block")

    reuse = reuse_from_receipt(args.reuse_receipt)
    reuse.update(parse_reuse(args.reuse_asset))
    assets = []
    capture_urls = {}
    captures = proof.get("captures")
    if not isinstance(captures, list):
        raise PublishError("proof captures must be an array")
    for capture in captures:
        artifact = capture.get("artifact")
        if not isinstance(artifact, dict) or "path" not in artifact:
            raise PublishError("capture has no artifact path")
        path = Path(str(artifact["path"])).resolve()
        if not path.is_file():
            raise PublishError("capture artifact is missing: " + str(path))
        url = reuse.get(str(path)) or upload_asset(token, repository_id, path)
        capture_id = str(capture["id"])
        capture_urls[capture_id] = url
        assets.append(
            {
                "id": capture_id,
                "phase": capture.get("phase"),
                "kind": capture.get("kind"),
                "appearance": capture.get("appearance"),
                "path": str(path),
                "sha256": sha256_file(path),
                "url": url,
            }
        )

    if not gif_path.is_file():
        raise PublishError("animated comparison is missing: " + str(gif_path))
    gif_url = reuse.get(str(gif_path)) or upload_asset(token, repository_id, gif_path)
    assets.append(
        {
            "id": "animated-comparison",
            "kind": "image",
            "path": str(gif_path),
            "sha256": sha256_file(gif_path),
            "url": gif_url,
        }
    )

    section = build_evidence_section(proof, proof_sha, capture_urls, gif_url)
    latest_issue = json.loads(run_gh(["api", issue_api]))
    latest_body = str(latest_issue.get("body") or "")
    latest_blocks = work_item_blocks(latest_body)
    if latest_blocks != before_blocks:
        raise PublishError("the work-item block changed while evidence was uploading")
    updated_body = replace_evidence_section(latest_body, section)
    if work_item_blocks(updated_body) != latest_blocks:
        raise PublishError("evidence edit would change the work-item block")

    update_payload = json.dumps({"body": updated_body})
    run_gh(["api", "--method", "PATCH", issue_api, "--input", "-"], update_payload)
    verified_issue = json.loads(run_gh(["api", issue_api]))
    verified_body = str(verified_issue.get("body") or "")
    if verified_body != updated_body:
        raise PublishError("GitHub issue body did not round-trip exactly")
    if work_item_blocks(verified_body) != latest_blocks:
        raise PublishError("GitHub issue update changed the work-item block")
    missing_urls = [asset["url"] for asset in assets if asset["url"] not in verified_body]
    if missing_urls:
        raise PublishError("GitHub issue body is missing uploaded asset URLs")

    published_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    receipt = {
        "schemaVersion": 1,
        "kind": "swiftui-issue-evidence-publication-receipt",
        "issue": str(proof["issue"]),
        "issueUrl": str(verified_issue["html_url"]),
        "publishedAt": published_at,
        "proof": {"path": str(proof_path), "sha256": proof_sha},
        "inspection": {"path": str(inspection_path), "sha256": inspection_sha},
        "baseCommit": proof["baseCommit"],
        "headCommit": proof["headCommit"],
        "body": {
            "beforeSha256": sha256_bytes(latest_body.encode("utf-8")),
            "afterSha256": sha256_bytes(verified_body.encode("utf-8")),
            "workItemBlockSha256": sha256_bytes(latest_blocks[0].encode("utf-8")),
        },
        "uploader": {
            "endpoint": "https://" + UPLOAD_HOST + UPLOAD_PATH,
            "authentication": "gh OAuth bearer token",
        },
        "assets": assets,
    }
    atomic_write_json(receipt_path, receipt)
    return receipt


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Upload validated proof media and embed it in its GitHub issue."
    )
    parser.add_argument("--proof", required=True)
    parser.add_argument("--inspection", required=True)
    parser.add_argument("--gif", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument(
        "--reuse-asset",
        action="append",
        default=[],
        metavar="PATH=URL",
        help="reuse a previously uploaded asset URL for one exact local path",
    )
    parser.add_argument(
        "--reuse-receipt",
        help="reuse path-to-URL bindings from a prior publication receipt",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        receipt = publish(args)
    except PublishError as error:
        print("issue evidence publication failed: " + str(error), file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "issue": receipt["issue"],
                "issueUrl": receipt["issueUrl"],
                "receipt": str(Path(args.receipt).resolve()),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
