#!/usr/bin/env python3
"""Install the newest immutable SwiftUI builds without invoking an LLM."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path.home() / ".t3/swiftui-stream"
READY = ROOT / "ready"
RECEIPTS = ROOT / "device-receipts"
LOCK = Path.home() / ".t3/locks/swiftui-phone-install.lock"
CONFIG = ROOT / "watcher-config.json"
MINIMUM_PROVISIONING_VALIDITY = timedelta(hours=24)


def run(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=check)


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def sha256_file(path: Path) -> str | None:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as file:
        json.dump(value, file, indent=2, sort_keys=True)
        file.write("\n")
        temporary = Path(file.name)
    os.replace(temporary, path)


def notify(config: dict[str, Any], channel: str, message: str, key: str) -> None:
    state_path = ROOT / "notification-state.json"
    state = load(state_path) if state_path.exists() else {}
    digest = hashlib.sha256(key.encode()).hexdigest()
    delivered = state.get("deliveredByChannel", {})
    channel_deliveries = list(delivered.get(channel, []))
    if digest in channel_deliveries:
        return
    command = config.get("discordCommand")
    if not command:
        return
    host = config.get("discordHost", "lxso1")
    discord_channel = config.get("discordChannel", "agent-ops")
    environment = dict(os.environ)
    environment["HERMES_SSH_HOST"] = host
    result = subprocess.run(
        [command, "send", discord_channel, message],
        text=True,
        capture_output=True,
        env=environment,
    )
    if result.returncode == 0:
        channel_deliveries.append(digest)
        delivered[channel] = channel_deliveries[-100:]
    state["deliveredByChannel"] = delivered
    state["lastAttemptByChannel"] = {
        **state.get("lastAttemptByChannel", {}),
        channel: {
            "digest": digest,
            "delivered": result.returncode == 0,
            "error": result.stderr.strip()[-500:] if result.returncode else None,
        },
    }
    atomic_json(state_path, state)


def installed_build(device: str, bundle: str) -> tuple[str, int | None]:
    """Return (status, version): 'installed', 'not-installed', 'query-failed'.

    Only 'not-installed' or an older 'installed' version may authorize an
    install; every query or parse failure fails CLOSED (no install)."""
    with tempfile.TemporaryDirectory(prefix="swiftui-device-info-") as directory:
        output = Path(directory) / "apps.json"
        result = run(
            "xcrun", "devicectl", "device", "info", "apps",
            "--device", device, "--bundle-id", bundle,
            "--json-output", str(output), "--quiet",
        )
        if result.returncode or not output.exists():
            return ("query-failed", None)
        try:
            value = load(output)
        except (OSError, ValueError):
            return ("query-failed", None)
    try:
        apps = value.get("result", {}).get("apps", [])
        for app in apps:
            if app.get("bundleIdentifier") == bundle:
                return ("installed", int(app.get("bundleVersion")))
        return ("not-installed", None)
    except (AttributeError, TypeError, ValueError):
        # Any unexpected JSON shape is a failed query, never an install
        # authorization.
        return ("query-failed", None)


ALLOWED_BUILD_ROOTS = (
    Path.home() / ".t3/artifacts/swiftui-stream",
    Path.home() / ".local/share/t3/swiftui-delivery/builds",
)


def _under_allowed_root(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except OSError:
        return False
    return any(str(resolved).startswith(str(root.resolve()) + "/")
               for root in ALLOWED_BUILD_ROOTS if root.exists())


def provisioning_profiles_current(path: Path) -> tuple[bool, str | None]:
    profiles = [path / "embedded.mobileprovision"]
    profiles.extend(
        extension / "embedded.mobileprovision"
        for extension in sorted(path.glob("PlugIns/*.appex"))
    )
    if not profiles[0].is_file():
        return (False, "missing-provisioning")

    deadline = datetime.now(timezone.utc) + MINIMUM_PROVISIONING_VALIDITY
    for profile in profiles:
        if not profile.is_file():
            return (False, "missing-provisioning")
        decoded = run("security", "cms", "-D", "-i", str(profile))
        if decoded.returncode:
            return (False, "invalid-provisioning")
        try:
            value = plistlib.loads(decoded.stdout.encode())
            expiration = value["ExpirationDate"]
            if not isinstance(expiration, datetime):
                return (False, "invalid-provisioning")
            if expiration.tzinfo is None:
                expiration = expiration.replace(tzinfo=timezone.utc)
            if expiration <= deadline:
                return (False, "expiring-provisioning")
        except (KeyError, TypeError, ValueError, plistlib.InvalidFileException):
            return (False, "invalid-provisioning")
    return (True, None)


def _valid_pointer_without_profile_expiry(
    pointer: dict[str, Any],
    channel_name: str,
    config: dict[str, Any],
) -> bool:
    required = (
        "channel", "build", "sequence", "commit", "bundleId", "appPath",
        "zipPath", "sha256", "deviceId", "generationPlan", "generationReceipt",
    )
    schema = pointer.get("schemaVersion")
    if isinstance(schema, bool) or schema != 2:
        return False
    if any(key not in pointer for key in required):
        return False
    if not all(isinstance(pointer[k], str) for k in
               ("channel", "commit", "bundleId", "appPath", "zipPath",
                "sha256", "deviceId")):
        return False
    if not all(isinstance(pointer[k], int) and not isinstance(pointer[k], bool)
               for k in ("build", "sequence")):
        return False
    if pointer["channel"] != channel_name:
        return False
    path = Path(pointer["appPath"])
    archive = Path(pointer["zipPath"])
    if not path.is_dir() or not archive.is_file():
        return False
    # Both artifacts must live in one generation directory under an
    # allowed immutable build root.
    if not (_under_allowed_root(path) and _under_allowed_root(archive)
            and path.parent == archive.parent):
        return False
    plan_descriptor = pointer.get("generationPlan")
    receipt_descriptor = pointer.get("generationReceipt")
    if not generation_provenance_matches(
            pointer, path.parent, plan_descriptor, receipt_descriptor):
        return False
    expected_team = config.get("teamIdentifier")
    if not isinstance(expected_team, str) or not expected_team:
        return False  # The team pin is mandatory; unpinned configs install nothing.
    if True:
        detail = run("codesign", "-dvv", str(path))
        if ("TeamIdentifier=%s" % expected_team) not in (
                detail.stderr + detail.stdout):
            return False
    digest = hashlib.sha256()
    try:
        with archive.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return False
    if digest.hexdigest() != pointer["sha256"]:
        return False
    metadata_matches = app_metadata_matches(path, pointer)
    signature = run("codesign", "--verify", "--deep", "--strict", str(path))
    return metadata_matches and signature.returncode == 0


def generation_provenance_matches(
    pointer: dict[str, Any],
    generation_directory: Path,
    plan_descriptor: Any,
    receipt_descriptor: Any,
) -> bool:
    descriptors = (plan_descriptor, receipt_descriptor)
    if not all(isinstance(value, dict) for value in descriptors):
        return False
    resolved = []
    for descriptor in descriptors:
        raw_path = descriptor.get("path")
        expected = descriptor.get("sha256")
        if not isinstance(raw_path, str) or not isinstance(expected, str):
            return False
        if len(expected) != 64 or any(ch not in "0123456789abcdef" for ch in expected):
            return False
        candidate = Path(raw_path)
        try:
            if candidate.resolve().parent != generation_directory.resolve():
                return False
        except OSError:
            return False
        if not candidate.is_file() or sha256_file(candidate) != expected:
            return False
        resolved.append(candidate)
    try:
        plan = load(resolved[0])
        receipt_value = load(resolved[1])
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    expected_mode = "publish-test" if pointer.get("channel") == "test" else "publish-dev"
    entries = receipt_value.get("entries")
    return (
        isinstance(plan, dict)
        and plan.get("mode") == expected_mode
        and receipt_value.get("schemaVersion") == 3
        and receipt_value.get("kind") == "swiftui-generation-receipt"
        and receipt_value.get("mode") == expected_mode
        and receipt_value.get("planSha256") == plan_descriptor.get("sha256")
        and receipt_value.get("installedArtifactSha256") == pointer.get("sha256")
        and receipt_value.get("resultingCommit") == pointer.get("commit")
        and isinstance(entries, list)
        and bool(entries)
    )


def valid_pointer(pointer: dict[str, Any], channel_name: str,
                  config: dict[str, Any]) -> bool:
    if not _valid_pointer_without_profile_expiry(pointer, channel_name, config):
        return False
    profiles_current, _ = provisioning_profiles_current(Path(pointer["appPath"]))
    return profiles_current


def app_metadata_matches(path: Path, pointer: dict[str, Any]) -> bool:
    try:
        with (path / "Info.plist").open("rb") as file:
            info = plistlib.load(file)
        return (
            info.get("CFBundleIdentifier") == pointer["bundleId"]
            and int(info.get("CFBundleVersion", -1)) == int(pointer["build"])
            and info.get("T3BuildChannel") == pointer["channel"]
            and info.get("T3GitCommit") == pointer["commit"]
        )
    except (OSError, TypeError, ValueError):
        return False


def extract_verified_app(pointer: dict[str, Any], directory: Path) -> Path | None:
    # Copy the archive privately, re-hash the copy, and extract THOSE bytes:
    # closes the hash-to-extraction race on the shared path.
    private = directory / "archive.zip"
    try:
        with open(pointer["zipPath"], "rb") as src, private.open("wb") as dst:
            digest = hashlib.sha256()
            for chunk in iter(lambda: src.read(1024 * 1024), b""):
                digest.update(chunk)
                dst.write(chunk)
    except OSError:
        return None
    if digest.hexdigest() != pointer["sha256"]:
        return None
    try:
        with zipfile.ZipFile(private) as archive:
            for info in archive.infolist():
                name = Path(info.filename)
                mode = (info.external_attr >> 16) & 0o170000
                if (name.is_absolute() or ".." in name.parts
                        or mode not in (0, 0o100000, 0o040000)):
                    return None
    except (OSError, zipfile.BadZipFile):
        return None
    extracted = run("ditto", "-x", "-k", str(private), str(directory))
    if extracted.returncode:
        return None
    app = directory / "T3Code.app"
    if not app.is_dir():
        matches = list(directory.glob("**/T3Code.app"))
        if len(matches) != 1:
            return None
        app = matches[0]
    signature = run("codesign", "--verify", "--deep", "--strict", str(app))
    return app if signature.returncode == 0 and app_metadata_matches(app, pointer) else None


def receipt(
    pointer: dict[str, Any],
    device: str,
    status: str,
    launch_pending: bool,
) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "channel": pointer["channel"],
        "build": pointer["build"],
        "sequence": pointer["sequence"],
        "commit": pointer["commit"],
        "bundleId": pointer["bundleId"],
        "deviceId": device,
        "generationReceiptSha256": pointer["generationReceipt"]["sha256"],
        "status": status,
        "launchPending": launch_pending,
    }


def receipt_matches_pointer(
    pointer: dict[str, Any],
    value: dict[str, Any],
    device: str,
) -> bool:
    expected = receipt(
        pointer,
        device,
        value.get("status"),
        value.get("launchPending"),
    )
    return all(value.get(field) == expected[field] for field in expected)


def process_channel(path: Path, config: dict[str, Any]) -> None:
    # The caller holds the one global device lease. Read only the current
    # atomic pointer so an older queued invocation can never install stale work.
    pointer = load(path)
    if not _valid_pointer_without_profile_expiry(pointer, path.stem, config):
        return
    configured = config.get("deviceId")
    if configured and configured != pointer["deviceId"]:
        return
    device = configured or pointer["deviceId"]
    channel = pointer["channel"]
    receipt_path = RECEIPTS / f"{channel}.json"
    profiles_current, profile_reason = provisioning_profiles_current(
        Path(pointer["appPath"])
    )
    if not profiles_current:
        atomic_json(
            receipt_path,
            receipt(pointer, device, f"rejected-{profile_reason}", True),
        )
        return
    previous = load(receipt_path) if receipt_path.exists() else {}
    status, current = installed_build(device, pointer["bundleId"])

    if status == "query-failed":
        return
    if status == "installed" and current > int(pointer["build"]):
        return
    needs_install = status == "not-installed" or (
        status == "installed" and current < int(pointer["build"]))
    needs_launch = (
        needs_install
        or previous.get("launchPending", False)
        or previous.get("status") != "installed-and-launched"
        or not receipt_matches_pointer(pointer, previous, device)
    )
    if not needs_install and not needs_launch:
        return

    if needs_install:
        with tempfile.TemporaryDirectory(prefix="swiftui-phone-install-") as directory:
            app = extract_verified_app(pointer, Path(directory))
            if app is None:
                atomic_json(
                    receipt_path,
                    receipt(pointer, device, "rejected-invalid-signature", True),
                )
                return
            result = run(
                "xcrun", "devicectl", "device", "install", "app",
                "--device", device, str(app),
            )
            if result.returncode:
                reason = "locked" if "Locked" in (result.stderr + result.stdout) else "unavailable"
                atomic_json(
                    receipt_path,
                    receipt(pointer, device, f"waiting-{reason}", True),
                )
                notify(
                    config,
                    channel,
                    f"SwiftUI {channel.title()} build {pointer['build']} is ready. Please connect and unlock the iPhone; the deterministic watcher will install the newest build automatically. Stream: {config.get('trackingIssue', 'T3 SwiftUI stream')}",
                    f"{channel}:{pointer['build']}",
                )
                return

    launch = run(
        "xcrun", "devicectl", "device", "process", "launch",
        "--device", device, pointer["bundleId"],
    )
    locked = launch.returncode != 0 and "Locked" in (launch.stderr + launch.stdout)
    atomic_json(
        receipt_path,
        receipt(
            pointer,
            device,
            "installed-awaiting-unlock" if locked else (
                "installed-and-launched"
                if launch.returncode == 0
                else "installed-launch-failed"
            ),
            launch.returncode != 0,
        ),
    )
    if launch.returncode:
        notify(
            config,
            channel,
            f"SwiftUI {channel.title()} build {pointer['build']} is installed. Please unlock the iPhone so the watcher can launch it. Stream: {config.get('trackingIssue', 'T3 SwiftUI stream')}",
            f"{channel}:{pointer['build']}:launch",
        )


def main() -> int:
    if not CONFIG.exists():
        return 0
    config = load(CONFIG)
    paths = [path for path in (READY / "dev.json", READY / "test.json") if path.exists()]
    if not paths:
        return 0
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        for path in paths:
            try:
                process_channel(path, config)
            except (OSError, ValueError, json.JSONDecodeError) as error:
                print(f"[swiftui-phone-watch] {path.name}: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
