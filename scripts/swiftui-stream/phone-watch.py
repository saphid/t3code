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
from pathlib import Path
from typing import Any

ROOT = Path.home() / ".t3/swiftui-stream"
READY = ROOT / "ready"
RECEIPTS = ROOT / "device-receipts"
LOCK = Path.home() / ".t3/locks/swiftui-phone-install.lock"
CONFIG = ROOT / "watcher-config.json"


def run(*args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=check)


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


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
    channel_deliveries = set(delivered.get(channel, []))
    if digest in channel_deliveries:
        return
    command = config.get("discordCommand", "/Users/saphid/bin/hermes-discord")
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
        channel_deliveries.add(digest)
        delivered[channel] = sorted(channel_deliveries)[-100:]
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


def installed_build(device: str, bundle: str) -> int | None:
    with tempfile.TemporaryDirectory(prefix="swiftui-device-info-") as directory:
        output = Path(directory) / "apps.json"
        result = run(
            "xcrun", "devicectl", "device", "info", "apps",
            "--device", device, "--bundle-id", bundle,
            "--json-output", str(output), "--quiet",
        )
        if result.returncode or not output.exists():
            return None
        value = load(output)
    apps = value.get("result", {}).get("apps", [])
    for app in apps:
        if app.get("bundleIdentifier") == bundle:
            try:
                return int(app.get("bundleVersion"))
            except (TypeError, ValueError):
                return None
    return None


def valid_pointer(pointer: dict[str, Any]) -> bool:
    required = (
        "channel", "build", "sequence", "commit", "bundleId", "appPath",
        "zipPath", "sha256", "deviceId",
    )
    if pointer.get("schemaVersion") != 1 or any(key not in pointer for key in required):
        return False
    path = Path(pointer["appPath"])
    archive = Path(pointer["zipPath"])
    if not path.is_dir() or not archive.is_file():
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
    try:
        with zipfile.ZipFile(pointer["zipPath"]) as archive:
            if any(
                Path(name).is_absolute() or ".." in Path(name).parts
                for name in archive.namelist()
            ):
                return None
    except (OSError, zipfile.BadZipFile):
        return None
    extracted = run("ditto", "-x", "-k", pointer["zipPath"], str(directory))
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


def receipt(pointer: dict[str, Any], status: str, launch_pending: bool) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "channel": pointer["channel"],
        "build": pointer["build"],
        "sequence": pointer["sequence"],
        "commit": pointer["commit"],
        "bundleId": pointer["bundleId"],
        "status": status,
        "launchPending": launch_pending,
    }


def process_channel(path: Path, config: dict[str, Any]) -> None:
    # The caller holds the one global device lease. Read only the current
    # atomic pointer so an older queued invocation can never install stale work.
    pointer = load(path)
    if not valid_pointer(pointer):
        return
    device = config.get("deviceId") or pointer["deviceId"]
    channel = pointer["channel"]
    receipt_path = RECEIPTS / f"{channel}.json"
    previous = load(receipt_path) if receipt_path.exists() else {}
    current = installed_build(device, pointer["bundleId"])

    if current is not None and current > int(pointer["build"]):
        return
    needs_install = current is None or current < int(pointer["build"])
    needs_launch = needs_install or previous.get("launchPending", False)
    if not needs_install and not needs_launch:
        return

    if needs_install:
        with tempfile.TemporaryDirectory(prefix="swiftui-phone-install-") as directory:
            app = extract_verified_app(pointer, Path(directory))
            if app is None:
                atomic_json(receipt_path, receipt(pointer, "rejected-invalid-signature", True))
                return
            result = run(
                "xcrun", "devicectl", "device", "install", "app",
                "--device", device, str(app),
            )
            if result.returncode:
                reason = "locked" if "Locked" in (result.stderr + result.stdout) else "unavailable"
                atomic_json(receipt_path, receipt(pointer, f"waiting-{reason}", True))
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
    atomic_json(receipt_path, receipt(
        pointer,
        "installed-awaiting-unlock" if locked else (
            "installed-and-launched" if launch.returncode == 0 else "installed-launch-failed"
        ),
        launch.returncode != 0,
    ))
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
