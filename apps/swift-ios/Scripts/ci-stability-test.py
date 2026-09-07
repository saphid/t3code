#!/usr/bin/env python3
"""Supplemental, unsigned regression run for the frozen stability branch."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import stat
import signal
import subprocess
import time

SUITES = [
    "NativeRetryIdentityTests", "HomeEnvironmentFilterTests", "DailyUXSidebarTests",
    "HomeThreadSwipeActionTests", "NativePassiveLiveShellTests",
    "NativePassiveThreadRefreshTests", "NativeMultiEnvironmentTests",
    "NativeIncrementalBootstrapTests", "NativeBootstrapRootOutboxTests",
    "NativeThreadCatchUpTests", "FeatureRootModelTests", "NativeShellProjectionTests",
    "WebSocketRPCRaceTests", "WebSocketRPCDecodingTests",
]


def executed_counts(tree):
    counts = dict.fromkeys(SUITES, 0)

    def visit(node, suite=None):
        url = node.get("nodeIdentifierURL", "")
        for candidate in SUITES:
            if url.endswith("/" + candidate):
                suite = candidate
                break
        if node.get("nodeType") == "Test Case" and suite in counts:
            if node.get("result") in {"Passed", "Failed", "Expected Failure"}:
                counts[suite] += 1
        for child in node.get("children", []):
            visit(child, suite)

    for node in tree.get("testNodes", []):
        visit(node)
    return counts


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def retain_tested_app(root, runner_temp, receipt):
    products = runner_temp / "swiftui-stability-derived-data/Build/Products"
    hosts = set()

    def find_hosts(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "TestHostPath" and isinstance(item, str):
                    path = Path(item.replace("__TESTROOT__", str(products))).resolve()
                    host = next((p for p in [path, *path.parents] if p.suffix == ".app"), None)
                    if host is not None and products.resolve() in host.parents:
                        hosts.add(host)
                else:
                    find_hosts(item)
        elif isinstance(value, list):
            for item in value:
                find_hosts(item)

    for path in products.glob("*.xctestrun"):
        with path.open("rb") as handle:
            find_hosts(plistlib.load(handle))
    assert len(hosts) == 1, "Expected one exact XCTest host app: " + str(hosts)
    app = hosts.pop()
    with (app / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    assert "iPhoneSimulator" in info.get("CFBundleSupportedPlatforms", []), "Not a Simulator app"
    executable = app / info["CFBundleExecutable"]
    architectures = subprocess.check_output(["lipo", "-archs", str(executable)], text=True, timeout=30).strip()
    assert "arm64" in architectures.split(), "Test host lacks arm64"
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"], cwd=root, text=True, timeout=30
    )
    assert not dirty, "Tracked source changed during the test run"
    tracked = subprocess.check_output([
        "git", "ls-files", "-z", "--", "apps/swift-ios",
        "apps/mobile/modules/t3-terminal/Vendor/libghostty",
    ], cwd=root, timeout=30).decode().split("\0")
    input_hashes = {
        name: file_sha256(root / name) for name in tracked if name and (root / name).is_file()
        and ("/Vendor/libghostty/" in name or Path(name).suffix in {
            ".pbxproj", ".plist", ".entitlements", ".xcscheme", ".xcconfig", ".resolved",
        })
    }
    entries = []
    for path in [app, *sorted(app.rglob("*"))]:
        metadata = path.lstat()
        entry = {"path": str(path.relative_to(app)), "mode": oct(stat.S_IMODE(metadata.st_mode))}
        if path.is_symlink():
            entry.update(type="symlink", target=os.readlink(path))
        elif path.is_file():
            entry.update(type="file", bytes=metadata.st_size, sha256=file_sha256(path))
        elif path.is_dir():
            entry.update(type="directory")
        else:
            raise RuntimeError("Unsupported app entry: " + str(path))
        entries.append(entry)
    manifest_bytes = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
    destination = runner_temp / "swiftui-stability-simulator-app"
    destination.mkdir(exist_ok=False)
    archive = destination / "simulator-app.zip"
    subprocess.run(
        ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(archive)],
        check=True, timeout=120,
    )
    provenance = {
        "schemaVersion": 1, "kind": "swiftui-hosted-simulator-build",
        "repository": os.environ["GITHUB_REPOSITORY"], "commit": receipt["gitSha"],
        "runId": os.environ["GITHUB_RUN_ID"], "runAttempt": os.environ["GITHUB_RUN_ATTEMPT"],
        "runUrl": os.environ["GITHUB_SERVER_URL"] + "/" + os.environ["GITHUB_REPOSITORY"]
            + "/actions/runs/" + os.environ["GITHUB_RUN_ID"],
        "configuration": "Debug", "platform": "iphonesimulator", "runnerArchitecture": platform.machine(),
        "xcode": receipt["xcode"], "simulator": receipt["simulator"], "command": receipt["command"],
        "sourceHashes": receipt["sourceHashes"], "configurationAndDependencyHashes": input_hashes,
        "xcodeExit": receipt["xcodeExit"], "executedBySuite": receipt["executedBySuite"],
        "product": app.name, "executable": info["CFBundleExecutable"], "architectures": architectures,
        "builtIdentity": {key: info.get(key) for key in [
            "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion",
            "CFBundleSupportedPlatforms", "DTSDKName", "DTXcode", "DTXcodeBuild", "T3GitCommit",
        ]},
        "archive": {"name": archive.name, "bytes": archive.stat().st_size, "sha256": file_sha256(archive)},
        "executableSha256": file_sha256(executable),
        "appManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "appFileBytes": sum(entry.get("bytes", 0) for entry in entries), "appManifest": entries,
    }
    assert provenance["commit"] == os.environ["GITHUB_SHA"], "Artifact commit does not match the run"
    (destination / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    receipt["simulatorArtifact"] = {
        "path": str(destination), "archive": provenance["archive"],
        "appFileBytes": provenance["appFileBytes"], "product": app.name,
        "provenanceSha256": file_sha256(destination / "provenance.json"),
    }


def main():
    root = Path(__file__).resolve().parents[3]
    runner_temp = Path(os.environ["RUNNER_TEMP"])
    evidence = runner_temp / "swiftui-stability-evidence"
    evidence.mkdir(exist_ok=False)
    result = evidence / "tests.xcresult"
    receipt = {"startedAt": time.time(), "status": "failed", "suites": SUITES}
    exit_code = 1
    try:
        assert platform.machine() == "arm64", "Ghostty requires an ARM64 simulator runner"
        version = subprocess.check_output(["xcodebuild", "-version"], text=True)
        receipt["xcode"] = version
        receipt["disk"] = subprocess.check_output(["df", "-k", str(runner_temp)], text=True)
        receipt["memoryBytes"] = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
        assert "Xcode 26.6\n" in version and "17F113" in version, version
        receipt["gitSha"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip()
        receipt["sourceHashes"] = {
            str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((root / "apps/swift-ios").rglob("*.swift"))
        }
        devices = json.loads(subprocess.check_output(
            ["xcrun", "simctl", "list", "devices", "available", "--json"], text=True
        ))["devices"].get("com.apple.CoreSimulator.SimRuntime.iOS-26-5", [])
        device = next(d for d in devices if d.get("isAvailable") and d["name"].startswith("iPhone"))
        receipt["simulator"] = device
        command = [
            "xcodebuild", "test", "-project", str(root / "apps/swift-ios/T3Code.xcodeproj"),
            "-scheme", "T3Code", "-configuration", "Debug", "-jobs", "2",
            "-destination", "platform=iOS Simulator,id=" + device["udid"],
            "-derivedDataPath", str(runner_temp / "swiftui-stability-derived-data"),
            "-resultBundlePath", str(result), "-parallel-testing-enabled", "NO",
            "-maximum-concurrent-test-simulator-destinations", "1",
            "-collect-test-diagnostics", "never", "-test-timeouts-enabled", "YES",
            "-default-test-execution-time-allowance", "30",
            "-maximum-test-execution-time-allowance", "60",
            *["-only-testing:T3CodeTests/" + suite for suite in SUITES],
            "CODE_SIGNING_ALLOWED=NO",
        ]
        receipt["command"] = command
        with (evidence / "xcodebuild.log").open("w") as log:
            process = subprocess.Popen(command, cwd=root, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            receipt["pid"] = process.pid
            try:
                receipt["xcodeExit"] = process.wait(timeout=1200)
            except subprocess.TimeoutExpired:
                receipt["timedOut"] = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    receipt["xcodeExit"] = process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    receipt["xcodeExit"] = process.wait()
        if result.exists():
            for kind in ["summary", "tests"]:
                completed = subprocess.run(
                    ["xcrun", "xcresulttool", "get", "test-results", kind,
                     "--path", str(result), "--format", "json"],
                    capture_output=True, text=True,
                )
                (evidence / (kind + ".json")).write_text(completed.stdout)
                (evidence / (kind + ".stderr.log")).write_text(completed.stderr)
                assert completed.returncode == 0, "xcresult extraction failed: " + kind
            summary = json.loads((evidence / "summary.json").read_text())
            counts = executed_counts(json.loads((evidence / "tests.json").read_text()))
            receipt["executedBySuite"] = counts
            assert all(counts.values()), "A selected suite executed zero tests: " + str(counts)
            assert summary.get("totalTestCount", 0) > 0, "No tests executed"
            assert summary.get("failedTests") == 0, "Native test failures"
        else:
            raise RuntimeError("No xcresult bundle")
        assert receipt["xcodeExit"] == 0 and not receipt.get("timedOut"), "xcodebuild failed"
        retain_tested_app(root, runner_temp, receipt)
        (evidence / "artifact-summary.json").write_text(
            json.dumps(receipt["simulatorArtifact"], indent=2) + "\n"
        )
        receipt["status"] = "passed"
        exit_code = 0
    except Exception as error:
        receipt["error"] = str(error)
    finally:
        receipt["finishedAt"] = time.time()
        (evidence / "process-summary.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
