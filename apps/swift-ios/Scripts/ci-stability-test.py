#!/usr/bin/env python3
"""Supplemental, unsigned regression run for the frozen stability branch."""
import hashlib
import json
import os
from pathlib import Path
import platform
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
