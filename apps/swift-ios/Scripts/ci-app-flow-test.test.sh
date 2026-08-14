#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SCRIPT_DIR}/ci-app-flow-test.sh"
UNIT_RUNNER="${SCRIPT_DIR}/ci-test.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/t3-app-flow-runner-test.XXXXXX")"
FAKE_XCODEBUILD="${SCRIPT_DIR}/TestFixtures/fake-xcodebuild.sh"
FAKE_XCRUN="${SCRIPT_DIR}/TestFixtures/fake-xcrun.sh"
CATALOG_TOOL="${SCRIPT_DIR}/app-flow.py"
AGENT_TOOL="${SCRIPT_DIR}/app-flow-agent.py"
LIVE_RUNNER="${SCRIPT_DIR}/ci-live-app-flow-test.sh"
source "${SCRIPT_DIR}/lib/swift-ios-common.sh"

# The real CI job pins its destination contract at job scope. Fake-tool tests
# own a synthetic destination and must never accidentally inherit those pins.
unset T3_SWIFT_EXPECTED_SIMULATOR_NAME
unset T3_SWIFT_EXPECTED_SIMULATOR_OS
unset T3_SWIFT_EXPECTED_TOOLCHAIN

cleanup() {
  rm -rf -- "${TEST_ROOT}"
}

trap cleanup EXIT

python3 - "${SCRIPT_DIR}/../TestPlans" "${SCRIPT_DIR}/../T3Code.xcodeproj/xcshareddata/xcschemes" <<'PY'
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

plans_root = Path(sys.argv[1])
schemes_root = Path(sys.argv[2])
expected_targets = {
    "Focused": {"T3CodeTests"},
    "CandidateJourneys": {"T3CodeUITests"},
    "TestTrain": {"T3CodeTests", "T3CodeUITests"},
    "DevPromotion": {"T3CodeTests", "T3CodeUITests"},
    "UpstreamPR": {"T3CodeTests", "T3CodeUITests"},
    "OfficialRelease": {"T3CodeTests", "T3CodeUITests"},
}
for name, targets in expected_targets.items():
    payload = json.loads((plans_root / f"{name}.xctestplan").read_text(encoding="utf-8"))
    assert payload["version"] == 1
    assert payload["defaultOptions"]["targetForVariableExpansion"]["name"] == "T3Code"
    assert {item["target"]["name"] for item in payload["testTargets"]} == targets

expected_defaults = {
    "T3Code.xcscheme": "UpstreamPR",
    "T3CodeDev.xcscheme": "DevPromotion",
    "T3CodeTest.xcscheme": "TestTrain",
}
for file_name, expected_default in expected_defaults.items():
    root = ET.parse(schemes_root / file_name).getroot()
    references = root.findall("./TestAction/TestPlans/TestPlanReference")
    names = {
        Path(item.attrib["reference"].removeprefix("container:")).stem
        for item in references
    }
    assert names == set(expected_targets)
    defaults = [
        Path(item.attrib["reference"].removeprefix("container:")).stem
        for item in references
        if item.attrib.get("default") == "YES"
    ]
    assert defaults == [expected_default]
PY

python3 "${CATALOG_TOOL}" check >/dev/null
[[ "$(python3 "${CATALOG_TOOL}" resolve --plan pr | wc -l | tr -d ' ')" == "4" ]]
printf '%s\n' \
  'docs/operations/swiftui-app-flow-regression-tests.md' \
  'apps/swift-ios/Features/Terminal/TerminalSurfaceView.swift' \
  >"${TEST_ROOT}/fast-changed-files.txt"
[[ "$(python3 "${CATALOG_TOOL}" select-plan \
  --changed-files "${TEST_ROOT}/fast-changed-files.txt" \
  --output "${TEST_ROOT}/fast-selection.json")" == "pr" ]]
python3 - "${TEST_ROOT}/fast-selection.json" <<'PY'
import json
import sys

decision = json.load(open(sys.argv[1], encoding="utf-8"))
assert decision["selectedPlan"] == "pr"
assert decision["requiredJourneys"] == ["thread-workspace-tools"]
assert decision["unmatchedFiles"] == []
PY
printf '%s\n' \
  'apps/swift-ios/Features/Connection/ConnectionOnboardingView.swift' \
  >"${TEST_ROOT}/broad-changed-files.txt"
[[ "$(python3 "${CATALOG_TOOL}" select-plan \
  --changed-files "${TEST_ROOT}/broad-changed-files.txt" \
  --output "${TEST_ROOT}/broad-selection.json")" == "regression" ]]
printf '%s\n' 'apps/swift-ios/Core/UnmappedProductionFile.swift' \
  >"${TEST_ROOT}/unmapped-changed-files.txt"
[[ "$(python3 "${CATALOG_TOOL}" select-plan \
  --changed-files "${TEST_ROOT}/unmapped-changed-files.txt" \
  --output "${TEST_ROOT}/unmapped-selection.json")" == "regression" ]]
: >"${TEST_ROOT}/empty-changed-files.txt"
[[ "$(python3 "${CATALOG_TOOL}" select-plan \
  --changed-files "${TEST_ROOT}/empty-changed-files.txt" \
  --output "${TEST_ROOT}/empty-selection.json")" == "regression" ]]

printf 'semantic tree\n' >"${TEST_ROOT}/agent-artifact.txt"
python3 "${AGENT_TOOL}" prepare \
  --session "${TEST_ROOT}/agent-session.json" \
  --simulator-id "00000000-0000-0000-0000-000000000001" \
  --plan pr >/dev/null
ACTION_ID="$(python3 "${AGENT_TOOL}" act \
  --session "${TEST_ROOT}/agent-session.json" \
  --selector sidebar-settings-button \
  --action tap \
  --postcondition settings-visible)"
python3 "${AGENT_TOOL}" assert \
  --session "${TEST_ROOT}/agent-session.json" \
  --action-id "${ACTION_ID}" \
  --result passed \
  --observation settings-visible >/dev/null
python3 "${AGENT_TOOL}" collect \
  --session "${TEST_ROOT}/agent-session.json" \
  --artifact "${TEST_ROOT}/agent-artifact.txt" \
  --kind accessibility-tree
python3 "${AGENT_TOOL}" promote \
  --session "${TEST_ROOT}/agent-session.json" \
  --output "${TEST_ROOT}/agent-promotion.json" \
  --journey-id settings-agent-draft \
  --test-method testSettingsAgentDraft
python3 "${AGENT_TOOL}" finish \
  --session "${TEST_ROOT}/agent-session.json" \
  --cleanup-status passed

RELEASE_ARTIFACT_ROOT="${TEST_ROOT}/release-artifacts"
mkdir -p "${RELEASE_ARTIFACT_ROOT}"
printf 'physical-device-proof\n' >"${RELEASE_ARTIFACT_ROOT}/screen-recording.mov"
RELEASE_ARTIFACT_SHA256="$(shasum -a 256 "${RELEASE_ARTIFACT_ROOT}/screen-recording.mov" | cut -d ' ' -f1)"
RELEASE_CANDIDATE_SHA256="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
python3 - \
  "${SCRIPT_DIR}/TestFixtures/release-evidence.example.json" \
  "${TEST_ROOT}/release-evidence.json" \
  "${RELEASE_ARTIFACT_SHA256}" <<'PY'
import json
from pathlib import Path
import sys

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
value["checks"][0]["evidence"][0]["sha256"] = sys.argv[3]
Path(sys.argv[2]).write_text(json.dumps(value), encoding="utf-8")
PY
python3 "${CATALOG_TOOL}" release-receipt \
  --input "${TEST_ROOT}/release-evidence.json" \
  --output "${TEST_ROOT}/release.receipt.json" \
  --artifact-root "${RELEASE_ARTIFACT_ROOT}" \
  --expected-source-commit 0123456789abcdef0123456789abcdef01234567 \
  --expected-candidate-content-sha256 "${RELEASE_CANDIDATE_SHA256}" >/dev/null
python3 - "${TEST_ROOT}/release.receipt.json" <<'PY'
import json
import sys

receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert receipt["kind"] == "physical-device-release-evidence"
assert receipt["seal"]["algorithm"] == "sha256"
PY

printf 'tampered\n' >>"${RELEASE_ARTIFACT_ROOT}/screen-recording.mov"
set +e
python3 "${CATALOG_TOOL}" release-receipt \
  --input "${TEST_ROOT}/release-evidence.json" \
  --output "${TEST_ROOT}/release-tampered.receipt.json" \
  --artifact-root "${RELEASE_ARTIFACT_ROOT}" \
  --expected-source-commit 0123456789abcdef0123456789abcdef01234567 \
  --expected-candidate-content-sha256 "${RELEASE_CANDIDATE_SHA256}" >/dev/null 2>&1
RELEASE_TAMPER_STATUS=$?
set -e
[[ "${RELEASE_TAMPER_STATUS}" -eq 1 ]]
set +e
python3 "${CATALOG_TOOL}" release-receipt \
  --input "${TEST_ROOT}/release-evidence.json" \
  --output "${TEST_ROOT}/release-identity-mismatch.receipt.json" \
  --artifact-root "${RELEASE_ARTIFACT_ROOT}" \
  --expected-source-commit ffffffffffffffffffffffffffffffffffffffff \
  --expected-candidate-content-sha256 "${RELEASE_CANDIDATE_SHA256}" >/dev/null 2>&1
RELEASE_IDENTITY_STATUS=$?
set -e
[[ "${RELEASE_IDENTITY_STATUS}" -eq 1 ]]

mkdir -p "${TEST_ROOT}/live-orchestration-container/Library/Caches"
FAKE_LIVE_ADAPTER="${SCRIPT_DIR}/TestFixtures/fake-live-backend-adapter.sh"
FAKE_LIVE_ADAPTER_SHA256="$(shasum -a 256 "${FAKE_LIVE_ADAPTER}" | cut -d ' ' -f1)"
T3_APP_FLOW_BACKEND_ADAPTER="${FAKE_LIVE_ADAPTER}" \
T3_APP_FLOW_BACKEND_ADAPTER_SHA256="${FAKE_LIVE_ADAPTER_SHA256}" \
T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
T3_SWIFT_EVIDENCE_DIR="${TEST_ROOT}/live-orchestration-evidence" \
T3_FAKE_APP_CONTAINER="${TEST_ROOT}/live-orchestration-container" \
T3_FAKE_PASSED_TESTS=1 \
"${LIVE_RUNNER}" >/dev/null
python3 - "${TEST_ROOT}/live-orchestration-evidence/live-backend.receipt.json" <<'PY'
import json
import sys

receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert receipt["cleanup"]["status"] == "passed"
assert receipt["backend"]["disposable"] is True
PY

LIVE_CLEANUP_STDERR="${TEST_ROOT}/live-cleanup-failure.stderr"
set +e
T3_APP_FLOW_BACKEND_ADAPTER="${FAKE_LIVE_ADAPTER}" \
T3_APP_FLOW_BACKEND_ADAPTER_SHA256="${FAKE_LIVE_ADAPTER_SHA256}" \
T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
T3_SWIFT_EVIDENCE_DIR="${TEST_ROOT}/live-cleanup-failure-evidence" \
T3_FAKE_APP_CONTAINER="${TEST_ROOT}/live-orchestration-container" \
T3_FAKE_PASSED_TESTS=1 \
T3_FAKE_BACKEND_CLEANUP_STATUS=9 \
"${LIVE_RUNNER}" >/dev/null 2>"${LIVE_CLEANUP_STDERR}"
LIVE_CLEANUP_FAILURE_STATUS=$?
set -e
[[ "${LIVE_CLEANUP_FAILURE_STATUS}" -eq 1 ]]
RECOVERY_MANIFEST="$(sed -n 's/.*recovery manifest retained at //p' "${LIVE_CLEANUP_STDERR}" | tail -n 1)"
[[ -n "${RECOVERY_MANIFEST}" && -f "${RECOVERY_MANIFEST}" ]]
[[ ! -e "$(dirname "${RECOVERY_MANIFEST}")/credentials.json" ]]
rm -rf -- "$(dirname "${RECOVERY_MANIFEST}")"

LIVE_SECRET_STDERR="${TEST_ROOT}/live-secret-manifest.stderr"
set +e
T3_APP_FLOW_BACKEND_ADAPTER="${FAKE_LIVE_ADAPTER}" \
T3_APP_FLOW_BACKEND_ADAPTER_SHA256="${FAKE_LIVE_ADAPTER_SHA256}" \
T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
T3_SWIFT_EVIDENCE_DIR="${TEST_ROOT}/live-secret-manifest-evidence" \
T3_FAKE_BACKEND_MANIFEST_SECRET=1 \
"${LIVE_RUNNER}" >/dev/null 2>"${LIVE_SECRET_STDERR}"
LIVE_SECRET_STATUS=$?
set -e
[[ "${LIVE_SECRET_STATUS}" -eq 1 ]]
grep -q "unsafe backend recovery manifest" "${LIVE_SECRET_STDERR}"
if grep -q "must-not-retain" "${LIVE_SECRET_STDERR}"; then
  fail "unsafe backend manifest leaked its secret to stderr"
fi

LIVE_SECRET_CLEANUP_STDERR="${TEST_ROOT}/live-secret-cleanup-failure.stderr"
set +e
T3_APP_FLOW_BACKEND_ADAPTER="${FAKE_LIVE_ADAPTER}" \
T3_APP_FLOW_BACKEND_ADAPTER_SHA256="${FAKE_LIVE_ADAPTER_SHA256}" \
T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
T3_SWIFT_EVIDENCE_DIR="${TEST_ROOT}/live-secret-cleanup-failure-evidence" \
T3_FAKE_BACKEND_MANIFEST_SECRET=1 \
T3_FAKE_BACKEND_CLEANUP_STATUS=9 \
"${LIVE_RUNNER}" >/dev/null 2>"${LIVE_SECRET_CLEANUP_STDERR}"
LIVE_SECRET_CLEANUP_STATUS=$?
set -e
[[ "${LIVE_SECRET_CLEANUP_STATUS}" -eq 1 ]]
RECOVERY_NOTE="$(sed -n 's/.*recovery note retained at //p' "${LIVE_SECRET_CLEANUP_STDERR}" | tail -n 1)"
[[ -n "${RECOVERY_NOTE}" && -f "${RECOVERY_NOTE}" ]]
[[ "$(stat -f '%Lp' "${RECOVERY_NOTE}")" == "600" ]]
grep -q "Pinned adapter SHA-256: ${FAKE_LIVE_ADAPTER_SHA256}" "${RECOVERY_NOTE}"
[[ ! -e "$(dirname "${RECOVERY_NOTE}")/backend.json" ]]
[[ ! -e "$(dirname "${RECOVERY_NOTE}")/credentials.json" ]]
if grep -R -a -q "must-not-retain" "$(dirname "${RECOVERY_NOTE}")"; then
  fail "invalid backend secret survived cleanup failure"
fi
rm -rf -- "$(dirname "${RECOVERY_NOTE}")"

LIVE_RETRY_STDERR="${TEST_ROOT}/live-cleanup-retry.stderr"
set +e
T3_APP_FLOW_BACKEND_ADAPTER="${FAKE_LIVE_ADAPTER}" \
T3_APP_FLOW_BACKEND_ADAPTER_SHA256="${FAKE_LIVE_ADAPTER_SHA256}" \
T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
T3_SWIFT_EVIDENCE_DIR="${TEST_ROOT}/live-cleanup-retry-evidence" \
T3_FAKE_APP_CONTAINER="${TEST_ROOT}/live-orchestration-container" \
T3_FAKE_PASSED_TESTS=1 \
T3_FAKE_BACKEND_CLEANUP_FAIL_ONCE_FILE="${TEST_ROOT}/cleanup-failed-once" \
"${LIVE_RUNNER}" >/dev/null 2>"${LIVE_RETRY_STDERR}"
LIVE_RETRY_STATUS=$?
set -e
[[ "${LIVE_RETRY_STATUS}" -eq 1 && -f "${TEST_ROOT}/cleanup-failed-once" ]]
if grep -q "recovery manifest retained" "${LIVE_RETRY_STDERR}"; then
  fail "cleanup retry succeeded but the runner claimed to retain recovery state"
fi
REBOOT_LOG="${TEST_ROOT}/reboot-arguments.txt"
T3_FAKE_XCRUN_ARGUMENT_LOG="${REBOOT_LOG}" t3_reboot_simulator \
  "${FAKE_XCRUN}" \
  "${SCRIPT_DIR}/run-with-timeout.py" \
  "00000000-0000-0000-0000-000000000001" \
  30
python3 - "${REBOOT_LOG}" <<'PY'
from pathlib import Path
import sys

assert Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() == [
    "simctl shutdown 00000000-0000-0000-0000-000000000001",
    "simctl boot 00000000-0000-0000-0000-000000000001",
    "simctl bootstatus 00000000-0000-0000-0000-000000000001 -b",
]
PY
REBOOT_FAILED_LOG="${TEST_ROOT}/reboot-failed-arguments.txt"
set +e
T3_FAKE_XCRUN_ARGUMENT_LOG="${REBOOT_FAILED_LOG}" \
T3_FAKE_BOOT_STATUS=9 \
t3_reboot_simulator \
  "${FAKE_XCRUN}" \
  "${SCRIPT_DIR}/run-with-timeout.py" \
  "00000000-0000-0000-0000-000000000001" \
  30
REBOOT_FAILED_STATUS=$?
set -e
[[ "${REBOOT_FAILED_STATUS}" -eq 9 ]]
python3 - "${REBOOT_FAILED_LOG}" <<'PY'
from pathlib import Path
import sys

assert Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() == [
    "simctl shutdown 00000000-0000-0000-0000-000000000001",
    "simctl boot 00000000-0000-0000-0000-000000000001",
]
PY
REBOOT_ALREADY_SHUTDOWN_LOG="${TEST_ROOT}/reboot-already-shutdown-arguments.txt"
T3_FAKE_XCRUN_ARGUMENT_LOG="${REBOOT_ALREADY_SHUTDOWN_LOG}" \
T3_FAKE_SHUTDOWN_STATUS=149 \
t3_reboot_simulator \
  "${FAKE_XCRUN}" \
  "${SCRIPT_DIR}/run-with-timeout.py" \
  "00000000-0000-0000-0000-000000000001" \
  30
python3 - "${REBOOT_ALREADY_SHUTDOWN_LOG}" <<'PY'
from pathlib import Path
import sys

assert Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() == [
    "simctl shutdown 00000000-0000-0000-0000-000000000001",
    "simctl boot 00000000-0000-0000-0000-000000000001",
    "simctl bootstatus 00000000-0000-0000-0000-000000000001 -b",
]
PY

REPLACE_LOG="${TEST_ROOT}/replace-arguments.txt"
replacement_id="$(T3_FAKE_XCRUN_ARGUMENT_LOG="${REPLACE_LOG}" t3_replace_simulator \
  "${FAKE_XCRUN}" \
  "11111111-1111-1111-1111-111111111111" \
  "Fresh Test iPhone" \
  "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" \
  "com.apple.CoreSimulator.SimRuntime.iOS-26-5")"
[[ "${replacement_id}" == "00000000-0000-0000-0000-000000000001" ]]
python3 - "${REPLACE_LOG}" <<'PY'
from pathlib import Path
import sys

assert Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() == [
    "simctl shutdown 11111111-1111-1111-1111-111111111111",
    "simctl delete 11111111-1111-1111-1111-111111111111",
    "simctl create Fresh Test iPhone com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-5",
]
PY
python3 - "${CATALOG_TOOL}" "${TEST_ROOT}/missing-Package.resolved" <<'PY'
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location("app_flow", sys.argv[1])
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
try:
    module.sha256_file(pathlib.Path(sys.argv[2]))
except ValueError as error:
    assert "could not hash required file" in str(error)
else:
    raise AssertionError("missing required file did not fail cleanly")
PY

expect_status() {
  local expected="$1"
  shift
  set +e
  "$@" >"${TEST_ROOT}/stdout" 2>"${TEST_ROOT}/stderr"
  local actual=$?
  set -e
  if [[ "${actual}" -ne "${expected}" ]]; then
    printf 'expected status %s, got %s\n' "${expected}" "${actual}" >&2
    cat "${TEST_ROOT}/stderr" >&2
    exit 1
  fi
}

RESULT="${TEST_ROOT}/raw-rejected.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_APP_FLOW_LIVE_SERVER="http://127.0.0.1:3773" \
  T3_APP_FLOW_LIVE_TOKEN="not-allowed" \
  "${RUNNER}"
grep -q "raw live credentials are not accepted" "${TEST_ROOT}/stderr"

RESULT="${TEST_ROOT}/toolchain-rejected.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_TOOLCHAIN_ID="stale Xcode identity" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  "${RUNNER}"
grep -q "configured toolchain identity does not match" "${TEST_ROOT}/stderr"

CREDENTIALS="${TEST_ROOT}/credentials.json"
printf '{"server":"http://127.0.0.1:3773","token":"23456789ABCD"}\n' >"${CREDENTIALS}"
chmod 644 "${CREDENTIALS}"
RESULT="${TEST_ROOT}/mode-rejected.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  "${RUNNER}"
grep -q "must have mode 600" "${TEST_ROOT}/stderr"

chmod 600 "${CREDENTIALS}"
RESULT="${TEST_ROOT}/non-disposable-live-rejected.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_APP_FLOW_PLAN=live \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  "${RUNNER}"
grep -q "requires an explicitly disposable Simulator" "${TEST_ROOT}/stderr"

RESULT="${TEST_ROOT}/missing-live-udid-rejected.xcresult"
expect_status 1 env \
  -u T3_SWIFT_SIMULATOR_ID \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_APP_FLOW_PLAN=live \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR=1 \
  "${RUNNER}"
grep -q "requires an explicit run-owned T3_SWIFT_SIMULATOR_ID" "${TEST_ROOT}/stderr"

RESULT="${TEST_ROOT}/missing-security-udid-rejected.xcresult"
expect_status 1 env \
  -u T3_SWIFT_SIMULATOR_ID \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  "${RUNNER}"
grep -q "security plan requires an explicit T3_SWIFT_SIMULATOR_ID" "${TEST_ROOT}/stderr"

mkdir -p "${TEST_ROOT}/live-container/Library/Caches"
RESULT="${TEST_ROOT}/disposable-live.xcresult"
expect_status 0 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_APP_CONTAINER="${TEST_ROOT}/live-container" \
  T3_APP_FLOW_PLAN=live \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR=1 \
  T3_FAKE_PASSED_TESTS=1 \
  "${RUNNER}"
python3 -c '
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert receipt["plan"] == "live"
' "${TEST_ROOT}/disposable-live.receipt.json"
DISPOSABLE_LIVE_TOOLCHAIN="$(python3 -c '
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["toolchain"])
' "${TEST_ROOT}/disposable-live.xctestproducts.manifest.json")"
expect_status 1 python3 "${CATALOG_TOOL}" receipt \
  --plan live \
  --summary "${TEST_ROOT}/disposable-live.summary.json" \
  --tests "${TEST_ROOT}/disposable-live.tests.json" \
  --output "${TEST_ROOT}/live-invalid-attestation.receipt.json" \
  --result-bundle "${TEST_ROOT}/disposable-live.xcresult" \
  --test-products "${TEST_ROOT}/disposable-live.xctestproducts" \
  --attachments "${TEST_ROOT}/disposable-live.attachments" \
  --build-manifest "${TEST_ROOT}/disposable-live.xctestproducts.manifest.json" \
  --scheme T3Code \
  --toolchain "${DISPOSABLE_LIVE_TOOLCHAIN}" \
  --simulator-id "00000000-0000-0000-0000-000000000001" \
  --xcode-log "${TEST_ROOT}/disposable-live.xcodebuild.log" \
  --xcode-status 0 \
  --secret-scan-status not-required \
  --credential-cleanup-status not-required \
  --simulator-cleanup-status passed
python3 - "${TEST_ROOT}/live-invalid-attestation.receipt.json" <<'PY'
import json
import sys

receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "failed"
assert "requires secretScan=passed" in receipt["execution"]["validationError"]
PY
python3 - \
  "${TEST_ROOT}/disposable-live.receipt.json" \
  "${TEST_ROOT}/live-resealed-invalid-attestation.receipt.json" <<'PY'
import hashlib
import json
from pathlib import Path
import sys

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
value.pop("seal")
value["evidence"]["attestations"]["secretScan"] = "not-required"
value["evidence"]["attestations"]["credentialCleanup"] = "not-required"
canonical = json.dumps(
    value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
).encode("utf-8")
value["seal"] = {
    "algorithm": "sha256",
    "canonicalPayloadSha256": hashlib.sha256(canonical).hexdigest(),
}
Path(sys.argv[2]).write_text(json.dumps(value), encoding="utf-8")
PY
expect_status 1 python3 "${CATALOG_TOOL}" ledger \
  --receipt "${TEST_ROOT}/live-resealed-invalid-attestation.receipt.json" \
  --expected-plan live \
  --output "${TEST_ROOT}/live-invalid-attestation-ledger.receipt.json" \
  --simulator-cleanup-status passed

python3 - \
  "${TEST_ROOT}/disposable-live.xctestproducts.manifest.json" \
  "${TEST_ROOT}/tampered-build-manifest.json" <<'PY'
import json
from pathlib import Path
import sys

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
value["seal"]["canonicalPayloadSha256"] = "f" * 64
Path(sys.argv[2]).write_text(json.dumps(value), encoding="utf-8")
PY
expect_status 1 python3 "${CATALOG_TOOL}" verify-build-manifest \
  --manifest "${TEST_ROOT}/tampered-build-manifest.json" \
  --test-products "${TEST_ROOT}/disposable-live.xctestproducts" \
  --scheme T3Code \
  --toolchain "${DISPOSABLE_LIVE_TOOLCHAIN}"

mkdir -p "${TEST_ROOT}/container/Library/Caches"
RESULT="${TEST_ROOT}/safe.xcresult"
expect_status 7 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_APP_CONTAINER="${TEST_ROOT}/container" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_FAKE_PASSED_TESTS=0 \
  T3_FAKE_FAILED_TESTS=1 \
  T3_FAKE_XCODE_STATUS=7 \
  "${RUNNER}"
[[ -d "${RESULT}" ]]
if grep -R -a -F "23456789ABCD" "${RESULT}" >/dev/null; then
  fail "retained result bundle contained the live credential"
fi

RESULT="${TEST_ROOT}/leaked.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_APP_CONTAINER="${TEST_ROOT}/container" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_FAKE_PASSED_TESTS=1 \
  T3_FAKE_LEAK=1 \
  "${RUNNER}"
[[ ! -e "${RESULT}" ]]
grep -q "unsafe evidence was removed" "${TEST_ROOT}/stderr"

RESULT="${TEST_ROOT}/endpoint-leaked.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_APP_CONTAINER="${TEST_ROOT}/container" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_FAKE_PASSED_TESTS=1 \
  T3_FAKE_SERVER_LEAK=1 \
  "${RUNNER}"
[[ ! -e "${RESULT}" ]]
grep -q "unsafe evidence was removed" "${TEST_ROOT}/stderr"

RESULT="${TEST_ROOT}/uninstall-failed.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_APP_CONTAINER="${TEST_ROOT}/container" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_FAKE_PASSED_TESTS=1 \
  T3_FAKE_UNINSTALL_STATUS=9 \
  "${RUNNER}"
python3 -c '
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "failed"
assert receipt["execution"]["xcodeStatus"] == 1
' "${TEST_ROOT}/uninstall-failed.receipt.json"

RESULT="${TEST_ROOT}/regression.xcresult"
ARGUMENT_LOG="${TEST_ROOT}/regression-xcodebuild-arguments.txt"
expect_status 0 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_ARGUMENT_LOG="${ARGUMENT_LOG}" \
  "${RUNNER}"
grep -A1 -q -- '-testPlan' "${ARGUMENT_LOG}"
grep -q '^CandidateJourneys$' "${ARGUMENT_LOG}"
grep -A1 -q -- '-clonedSourcePackagesDirPath' "${ARGUMENT_LOG}"
grep -q -- '-disablePackageRepositoryCache' "${ARGUMENT_LOG}"
grep -q '^COMPILATION_CACHE_CAS_PATH=' "${ARGUMENT_LOG}"
if grep -q -- '-test-iterations' "${ARGUMENT_LOG}"; then
  fail "non-stability plan unexpectedly enabled test iterations"
fi
if grep -q -- '-test-repetition-relaunch-enabled' "${ARGUMENT_LOG}"; then
  fail "non-stability plan unexpectedly enabled relaunch repetitions"
fi
grep -A1 -q -- '-default-test-execution-time-allowance' "${ARGUMENT_LOG}"
grep -q '^180$' "${ARGUMENT_LOG}"
grep -A1 -q -- '-maximum-test-execution-time-allowance' "${ARGUMENT_LOG}"
grep -q '^360$' "${ARGUMENT_LOG}"
[[ -f "${TEST_ROOT}/regression.summary.json" ]]
[[ -f "${TEST_ROOT}/regression.receipt.json" ]]
python3 -c '
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert receipt["plan"] == "regression"
assert len(receipt["selection"]) == 11
assert len(receipt["execution"]["executedTests"]) == 11
assert receipt["source"]["contentSha256"] == receipt["evidence"]["buildManifest"]["source"]["contentSha256"]
' "${TEST_ROOT}/regression.receipt.json"

T3_FAKE_PASSED_TESTS=4 T3_FAKE_SKIPPED_TESTS=1 \
  "${FAKE_XCRUN}" xcresulttool get test-results summary \
  --path "${RESULT}" --format json >"${TEST_ROOT}/native-unit.summary.json"
T3_FAKE_UNIT_TESTS=1 \
  "${FAKE_XCRUN}" xcresulttool get test-results tests \
  --path "${RESULT}" --format json >"${TEST_ROOT}/native-unit.tests.json"
FAKE_TOOLCHAIN="$(python3 -c '
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["toolchain"])
' "${TEST_ROOT}/regression.xctestproducts.manifest.json")"
python3 "${CATALOG_TOOL}" unit-receipt \
  --summary "${TEST_ROOT}/native-unit.summary.json" \
  --tests "${TEST_ROOT}/native-unit.tests.json" \
  --output "${TEST_ROOT}/native-unit.receipt.json" \
  --result-bundle "${RESULT}" \
  --test-products "${TEST_ROOT}/regression.xctestproducts" \
  --build-manifest "${TEST_ROOT}/regression.xctestproducts.manifest.json" \
  --scheme T3Code \
  --toolchain "${FAKE_TOOLCHAIN}" \
  --simulator-id "00000000-0000-0000-0000-000000000001" \
  --expected-simulator-name "Fake iPhone" \
  --expected-simulator-os "1.0" \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeAtStandardType()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeAtAccessibilityTypeInDarkMode()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeRightToLeft()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeOnIPad()' \
  --allowed-skip 'TransportReliabilityTests/testLivePerMessageDeflateRoundTripWhenConfigured()' \
  --xcode-status 0 >/dev/null
python3 -c '
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert len(receipt["execution"]["executedTests"]) == 5
assert len(receipt["allowedSkips"]) == 1
' "${TEST_ROOT}/native-unit.receipt.json"

python3 "${CATALOG_TOOL}" ledger \
  --receipt "${TEST_ROOT}/regression.receipt.json" \
  --receipt "${TEST_ROOT}/native-unit.receipt.json" \
  --expected-plan regression \
  --expected-plan native-unit \
  --output "${TEST_ROOT}/verification.receipt.json" \
  --simulator-cleanup-status passed >/dev/null
python3 - "${TEST_ROOT}/verification.receipt.json" <<'PY'
import json
import sys

receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert receipt["aggregate"]["componentCount"] == 2
PY
expect_status 1 python3 "${CATALOG_TOOL}" ledger \
  --receipt "${TEST_ROOT}/regression.receipt.json" \
  --receipt "${TEST_ROOT}/regression.receipt.json" \
  --expected-plan regression \
  --expected-plan native-unit \
  --output "${TEST_ROOT}/duplicate-ledger.receipt.json" \
  --simulator-cleanup-status passed
python3 - \
  "${TEST_ROOT}/regression.receipt.json" \
  "${TEST_ROOT}/mixed-source.receipt.json" \
  "${TEST_ROOT}/missing-telemetry.receipt.json" <<'PY'
import copy
import hashlib
import json
from pathlib import Path
import sys

def seal(value):
    value = copy.deepcopy(value)
    value.pop("seal", None)
    canonical = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    value["seal"] = {
        "algorithm": "sha256",
        "canonicalPayloadSha256": hashlib.sha256(canonical).hexdigest(),
    }
    return value

base = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
mixed = copy.deepcopy(base)
mixed["plan"] = "mixed-source"
mixed["source"]["contentSha256"] = "f" * 64
mixed["evidence"]["buildManifest"]["source"]["contentSha256"] = "f" * 64
mixed["evidence"]["buildManifest"] = seal(mixed["evidence"]["buildManifest"])
Path(sys.argv[2]).write_text(json.dumps(seal(mixed)), encoding="utf-8")

missing = copy.deepcopy(base)
missing["plan"] = "missing-telemetry"
del missing["execution"]["attemptTelemetry"]
Path(sys.argv[3]).write_text(json.dumps(seal(missing)), encoding="utf-8")
PY
expect_status 1 python3 "${CATALOG_TOOL}" ledger \
  --receipt "${TEST_ROOT}/regression.receipt.json" \
  --receipt "${TEST_ROOT}/mixed-source.receipt.json" \
  --expected-plan regression \
  --expected-plan mixed-source \
  --output "${TEST_ROOT}/mixed-source-ledger.receipt.json" \
  --simulator-cleanup-status passed
expect_status 1 python3 "${CATALOG_TOOL}" ledger \
  --receipt "${TEST_ROOT}/regression.receipt.json" \
  --receipt "${TEST_ROOT}/missing-telemetry.receipt.json" \
  --expected-plan regression \
  --expected-plan missing-telemetry \
  --output "${TEST_ROOT}/missing-telemetry-ledger.receipt.json" \
  --simulator-cleanup-status passed

python3 - "${CATALOG_TOOL}" "${TEST_ROOT}/native-unit.tests.json" <<'PY'
import copy
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("app_flow", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
path = Path(sys.argv[2])
value = json.loads(path.read_text(encoding="utf-8"))
required = [
    "AppFlowVisualSnapshotTests/testOnboardingWelcomeAtStandardType()",
    "AppFlowVisualSnapshotTests/testOnboardingWelcomeAtAccessibilityTypeInDarkMode()",
    "AppFlowVisualSnapshotTests/testOnboardingWelcomeRightToLeft()",
    "AppFlowVisualSnapshotTests/testOnboardingWelcomeOnIPad()",
]
allowed = ["TransportReliabilityTests/testLivePerMessageDeflateRoundTripWhenConfigured()"]

duplicate = copy.deepcopy(value)
duplicate["testNodes"][0]["children"].append(
    copy.deepcopy(duplicate["testNodes"][0]["children"][0])
)
duplicate_path = path.with_name("native-unit-duplicate.tests.json")
duplicate_path.write_text(json.dumps(duplicate), encoding="utf-8")
_, error = module.unit_test_evidence(duplicate_path, required, allowed)
assert error and "duplicate identifiers" in error

unexpected_skip = copy.deepcopy(value)
unexpected_skip["testNodes"][0]["children"][-1]["nodeIdentifier"] = (
    "OtherTests/testUnexpectedSkip()"
)
unexpected_path = path.with_name("native-unit-unexpected-skip.tests.json")
unexpected_path.write_text(json.dumps(unexpected_skip), encoding="utf-8")
_, error = module.unit_test_evidence(unexpected_path, required, allowed)
assert error and "skip inventory" in error
PY

python3 - "${TEST_ROOT}/native-unit.summary.json" "${TEST_ROOT}/native-unit-truncated.summary.json" <<'PY'
import json
from pathlib import Path
import sys

value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
value["totalTestCount"] = 4
value["passedTests"] = 3
Path(sys.argv[2]).write_text(json.dumps(value), encoding="utf-8")
PY
expect_status 1 python3 "${CATALOG_TOOL}" unit-receipt \
  --summary "${TEST_ROOT}/native-unit-truncated.summary.json" \
  --tests "${TEST_ROOT}/native-unit.tests.json" \
  --output "${TEST_ROOT}/native-unit-truncated.receipt.json" \
  --result-bundle "${RESULT}" \
  --test-products "${TEST_ROOT}/regression.xctestproducts" \
  --build-manifest "${TEST_ROOT}/regression.xctestproducts.manifest.json" \
  --scheme T3Code \
  --toolchain "${FAKE_TOOLCHAIN}" \
  --simulator-id "00000000-0000-0000-0000-000000000001" \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeAtStandardType()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeAtAccessibilityTypeInDarkMode()' \
  --allowed-skip 'TransportReliabilityTests/testLivePerMessageDeflateRoundTripWhenConfigured()' \
  --xcode-status 0

RESULT="${TEST_ROOT}/stability.xcresult"
expect_status 0 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_APP_FLOW_PLAN=stability \
  T3_FAKE_PASSED_TESTS=6 \
  "${RUNNER}"
python3 -c '
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
assert receipt["verdict"] == "passed"
assert receipt["repetitions"] == 3
assert [item["executionCount"] for item in receipt["execution"]["executedTests"]] == [3, 3]
assert receipt["execution"]["attemptTelemetry"]["attemptCount"] == 6
assert receipt["execution"]["attemptTelemetry"]["totalDurationInSeconds"] == 6
' "${TEST_ROOT}/stability.receipt.json"

RESULT="${TEST_ROOT}/scan-error.xcresult"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_FAKE_APP_CONTAINER="${TEST_ROOT}/container" \
  T3_APP_FLOW_PLAN=security \
  T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS}" \
  T3_FAKE_SCAN_ERROR=1 \
  "${RUNNER}"
[[ ! -e "${RESULT}" ]]
grep -q "scan failed closed" "${TEST_ROOT}/stderr"

for failure_kind in summary tests attachments; do
  RESULT="${TEST_ROOT}/${failure_kind}-extraction.xcresult"
  FAILURE_ENV=()
  case "${failure_kind}" in
    summary) FAILURE_ENV=(T3_FAKE_SUMMARY_STATUS=9) ;;
    tests) FAILURE_ENV=(T3_FAKE_TESTS_STATUS=9) ;;
    attachments) FAILURE_ENV=(T3_FAKE_ATTACHMENTS_STATUS=9) ;;
  esac
  expect_status 1 env \
    T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
    T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
    T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
    T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
    "${FAILURE_ENV[@]}" \
    "${RUNNER}"
done

RESULT="${TEST_ROOT}/tampered-reuse.xcresult"
printf 'tampered\n' >>"${TEST_ROOT}/regression.xctestproducts/Products/T3CodeTests.xctest/T3CodeTests"
expect_status 1 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_XCRUN_COMMAND="${FAKE_XCRUN}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${RESULT}" \
  T3_SWIFT_TEST_PRODUCTS_PATH="${TEST_ROOT}/regression.xctestproducts" \
  T3_SWIFT_REUSE_TEST_PRODUCTS=1 \
  "${RUNNER}"
grep -q "do not match the current source/toolchain" "${TEST_ROOT}/stderr"

UNIT_RESULT="${TEST_ROOT}/native-focused.xcresult"
UNIT_PRODUCTS="${TEST_ROOT}/native-focused.xctestproducts"
UNIT_ARGUMENT_LOG="${TEST_ROOT}/native-focused-xcodebuild-arguments.txt"
expect_status 0 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${UNIT_RESULT}" \
  T3_SWIFT_TEST_PRODUCTS_PATH="${UNIT_PRODUCTS}" \
  T3_FAKE_ARGUMENT_LOG="${UNIT_ARGUMENT_LOG}" \
  "${UNIT_RUNNER}"
[[ -d "${UNIT_RESULT}" ]]
[[ -f "${UNIT_PRODUCTS}.manifest.json" ]]
grep -q '^build-for-testing$' "${UNIT_ARGUMENT_LOG}"
grep -A1 -q -- '-clonedSourcePackagesDirPath' "${UNIT_ARGUMENT_LOG}"
grep -q -- '-disablePackageRepositoryCache' "${UNIT_ARGUMENT_LOG}"
grep -q '^COMPILATION_CACHE_CAS_PATH=' "${UNIT_ARGUMENT_LOG}"
grep -q '^test-without-building$' "${UNIT_ARGUMENT_LOG}"
grep -A1 -q -- '-testPlan' "${UNIT_ARGUMENT_LOG}"
grep -q '^Focused$' "${UNIT_ARGUMENT_LOG}"
grep -A1 -q -- '-resultBundlePath' "${UNIT_ARGUMENT_LOG}"

UNIT_REUSE_RESULT="${TEST_ROOT}/native-focused-reuse.xcresult"
UNIT_REUSE_ARGUMENT_LOG="${TEST_ROOT}/native-focused-reuse-xcodebuild-arguments.txt"
expect_status 0 env \
  T3_SWIFT_XCODEBUILD_COMMAND="${FAKE_XCODEBUILD}" \
  T3_SWIFT_SIMULATOR_ID="00000000-0000-0000-0000-000000000001" \
  T3_SWIFT_RESULT_BUNDLE_PATH="${UNIT_REUSE_RESULT}" \
  T3_SWIFT_TEST_PRODUCTS_PATH="${UNIT_PRODUCTS}" \
  T3_SWIFT_REUSE_TEST_PRODUCTS=1 \
  T3_FAKE_ARGUMENT_LOG="${UNIT_REUSE_ARGUMENT_LOG}" \
  "${UNIT_RUNNER}"
if grep -q '^build-for-testing$' "${UNIT_REUSE_ARGUMENT_LOG}"; then
  fail "native unit reuse unexpectedly rebuilt test products"
fi
grep -q '^test-without-building$' "${UNIT_REUSE_ARGUMENT_LOG}"

printf 'ci-app-flow-test safety checks passed\n'
