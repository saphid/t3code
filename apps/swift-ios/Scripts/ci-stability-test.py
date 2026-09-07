#!/usr/bin/env python3
"""Supplemental, unsigned regression run for the frozen stability branch."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
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
    "AppFlowStagedCredentialsTests",
    "T3ClientServerConfigTests", "FeatureOutboxStoreTests",
    "FeatureToolStateTests", "TranscriptViewportGeometryTests",
    "FeatureAttachmentUploadCoordinatorTests", "TransportReliabilityTests", "PairingServiceTests",
    "ConnectionDetailsTests", "LocalEndpointDetectionTests",
    "EnvironmentStoreVersionTests", "LocalNetworkAccessCheckerTests", "PairingTokenPrecedenceTests",
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


def discover_test_host(products, configuration):
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
    if not hosts:
        # The direct `test` action can leave products without an .xctestrun.
        hosts = {path.resolve() for path in (products / (configuration + "-iphonesimulator")).glob("*.app")
                 if (path / "PlugIns/T3CodeTests.xctest").is_dir()}
        assert all(products.resolve() in host.parents for host in hosts), "Test host escaped products"
    assert len(hosts) == 1, "Expected one exact XCTest host app: " + str(hosts)
    return hosts.pop()


def verify_simulated_entitlements(derived_data, app, info):
    candidates = sorted((derived_data / "Build/Intermediates.noindex").rglob(app.name + "-Simulated.xcent"))
    assert len(candidates) == 1, "Expected one generated host Simulator entitlement file"
    path = candidates[0]
    assert derived_data.resolve() in path.resolve().parents
    with path.open("rb") as handle:
        entitlements = plistlib.load(handle)
    identifier = entitlements.get("application-identifier")
    bundle_id = info["CFBundleIdentifier"]
    assert identifier == "NJZUMEA4BN." + bundle_id, "Unexpected Simulator application identifier"
    groups = entitlements.get("keychain-access-groups")
    assert groups is None or (isinstance(groups, list)
                              and all(isinstance(group, str) and group for group in groups)), "Invalid Simulator Keychain groups"
    default_group = groups[0] if groups else identifier
    return {"path": str(path.relative_to(derived_data)), "sha256": file_sha256(path),
            "applicationIdentifier": identifier, "keychainAccessGroups": groups,
            "effectiveDefaultKeychainGroup": default_group,
            "executableSha256": file_sha256(app / info["CFBundleExecutable"])}


def retain_tested_app(root, runner_temp, receipt):
    products = runner_temp / "swiftui-stability-derived-data/Build/Products"
    app = discover_test_host(products, receipt["configuration"])
    with (app / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    assert "iPhoneSimulator" in info.get("CFBundleSupportedPlatforms", []), "Not a Simulator app"
    assert info.get("T3GitCommit") == receipt["gitSha"], "Built commit does not match tested source"
    if receipt["configuration"] == "Test":
        assert info.get("T3BuildChannel") == receipt["expectedChannel"], "Unexpected built channel"
        assert not list(app.glob("*.debug.dylib")), "Test app contains a debug dylib"
        log = (runner_temp / "swiftui-stability-evidence/xcodebuild.log").read_text()
        compiler_lines = [line for line in log.splitlines()
                          if "swiftc " in line and " -module-name T3Code " in line]
        assert compiler_lines, "No app compiler invocation found"
        assert all(" -O " in line and " -whole-module-optimization " in line
                   and " -Onone " not in line for line in compiler_lines), "Test app was not fully optimized"
        receipt["optimizationEvidence"] = compiler_lines
    if receipt.get("identityContract"):
        contract = receipt["identityContract"]
        bundles = [app, *sorted(app.glob("PlugIns/*.appex"))]
        assert len(bundles) == 3 and len(contract["bundles"]) == 3
        identities = {}
        for bundle in bundles:
            with (bundle / "Info.plist").open("rb") as handle:
                built = plistlib.load(handle)
            identifier = built["CFBundleIdentifier"]
            assert identifier in contract["bundles"] and identifier not in identities
            for key, value in contract["bundles"][identifier].items():
                assert built.get(key) == value, (identifier, key, built.get(key), value)
            assert built["CFBundleVersion"] == contract["build"]
            assert built["CFBundleShortVersionString"] == contract["version"]
            assert not list(bundle.glob("*.debug.dylib"))
            identities[identifier] = built
        assert set(identities) == set(contract["bundles"])
        host = identities[contract["hostBundleIdentifier"]]
        assert host["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconName"] == "AppIconDev"
        assert [scheme for item in host.get("CFBundleURLTypes", [])
                for scheme in item.get("CFBundleURLSchemes", [])] == [contract["hostURLScheme"]]
        receipt["builtIdentities"] = identities
    receipt["simulatedEntitlements"] = verify_simulated_entitlements(
        runner_temp / "swiftui-stability-derived-data", app, info
    )
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
        "scheme": receipt["scheme"], "configuration": receipt["configuration"], "platform": "iphonesimulator", "runnerArchitecture": platform.machine(),
        "xcode": receipt["xcode"], "simulator": receipt["simulator"], "command": receipt["command"],
        "sourceHashes": receipt["sourceHashes"], "configurationAndDependencyHashes": input_hashes,
        "xcodeExit": receipt["xcodeExit"], "executedBySuite": receipt["executedBySuite"],
        "simulatedEntitlements": receipt["simulatedEntitlements"],
        "product": app.name, "executable": info["CFBundleExecutable"], "architectures": architectures,
        "builtIdentity": {key: info.get(key) for key in [
            "CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion",
            "CFBundleSupportedPlatforms", "DTSDKName", "DTXcode", "DTXcodeBuild", "T3GitCommit", "T3BuildChannel",
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
        scheme = os.environ.get("T3_TEST_SCHEME", "T3Code")
        configuration = os.environ.get("T3_TEST_CONFIGURATION", "Debug")
        assert (scheme, configuration) in {("T3Code", "Debug"), ("T3CodeTest", "Test")}, "Unsupported scheme/configuration pair"
        receipt.update(scheme=scheme, configuration=configuration)
        channel = os.environ.get("T3_EXPECTED_CHANNEL", "test")
        assert channel in {"test", "dev"}, "Unsupported expected channel"
        receipt["expectedChannel"] = channel
        identity_file = os.environ.get("T3_EXPECTED_IDENTITY_FILE")
        if channel == "dev":
            assert (scheme, configuration) == ("T3CodeTest", "Test")
            assert identity_file == "apps/swift-ios/Scripts/dev-archive-identity.json"
            contract = json.loads((root / identity_file).read_text())
            assert contract["hostBundleIdentifier"] == "com.saphid.t3code.swiftui.dev"
            assert contract["bundles"][contract["hostBundleIdentifier"]]["T3BuildChannel"] == channel
            receipt["identityContract"] = contract
        else:
            assert identity_file is None, "Unexpected identity file for Test channel"
        assert platform.machine() == "arm64", "Ghostty requires an ARM64 simulator runner"
        version = subprocess.check_output(["xcodebuild", "-version"], text=True)
        receipt["xcode"] = version
        receipt["disk"] = subprocess.check_output(["df", "-k", str(runner_temp)], text=True)
        receipt["memoryBytes"] = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
        assert "Xcode 26.6\n" in version and "17F113" in version, version
        receipt["gitSha"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=root, text=True
        ).strip()
        assert re.fullmatch(r"[0-9a-f]{40}", receipt["gitSha"]), "Invalid source SHA"
        assert receipt["gitSha"] == os.environ["GITHUB_SHA"], "Checkout differs from requested source"
        with (root / "apps/swift-ios/Resources/Info.plist").open("rb") as handle:
            assert plistlib.load(handle).get("T3GitCommit") == "$(T3_GIT_COMMIT)", "Commit build key is not declared"
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
            "-scheme", scheme, "-configuration", configuration, "-jobs", "2",
            "-destination", "platform=iOS Simulator,id=" + device["udid"],
            "-derivedDataPath", str(runner_temp / "swiftui-stability-derived-data"),
            "-resultBundlePath", str(result), "-parallel-testing-enabled", "NO",
            "-maximum-concurrent-test-simulator-destinations", "1",
            "-collect-test-diagnostics", "never", "-test-timeouts-enabled", "YES",
            "-default-test-execution-time-allowance", "30",
            "-maximum-test-execution-time-allowance", "60",
            *["-only-testing:T3CodeTests/" + suite for suite in SUITES],
            "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-",
            "DEVELOPMENT_TEAM=NJZUMEA4BN",
            "T3_GIT_COMMIT=" + receipt["gitSha"],
        ]
        if receipt.get("identityContract"):
            command.append("CURRENT_PROJECT_VERSION=" + receipt["identityContract"]["build"])
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
