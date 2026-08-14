#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/lib/swift-ios-common.sh"

PROFILE="${1:-}"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="${T3_SWIFT_EVIDENCE_DIR:-${REPO_ROOT}/.t3/evidence/swift-ios-verify-${RUN_STAMP}}"
SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}"
SIMULATOR_NAME="${T3_SWIFT_CREATED_SIMULATOR_NAME:-${T3_SWIFT_EXPECTED_SIMULATOR_NAME:-T3Code-Verify-${RUN_STAMP}-$$}}"
SIMULATOR_DEVICE_TYPE="${T3_SWIFT_SIMULATOR_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro}"
SIMULATOR_RUNTIME="${T3_SWIFT_SIMULATOR_RUNTIME:-}"
OWNS_SIMULATOR=0
DERIVED_DATA_PATH="${T3_SWIFT_DERIVED_DATA_PATH:-${RUNNER_TEMP:-${APP_DIR}/.derivedData}/swift-ios-verify}"
TEST_PRODUCTS_PATH="${EVIDENCE_DIR}/T3Code.xctestproducts"
CREDENTIALS_FILE=""
XCODEBUILD_COMMAND="${T3_SWIFT_XCODEBUILD_COMMAND:-xcodebuild}"
XCRUN_COMMAND="${T3_SWIFT_XCRUN_COMMAND:-xcrun}"
TOOLCHAIN_ID="${T3_SWIFT_TOOLCHAIN_ID:-}"
SIMULATOR_RESET_TIMEOUT_SECONDS="${T3_SWIFT_SIMULATOR_RESET_TIMEOUT_SECONDS:-120}"

die() {
  printf '[swift-ios-verify] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${CREDENTIALS_FILE}" && -f "${CREDENTIALS_FILE}" ]]; then
    rm -f -- "${CREDENTIALS_FILE}"
  fi
  if [[ "${OWNS_SIMULATOR}" -eq 1 && -n "${SIMULATOR_ID}" ]]; then
    "${XCRUN_COMMAND}" simctl shutdown "${SIMULATOR_ID}" >/dev/null 2>&1 || true
    if ! "${XCRUN_COMMAND}" simctl delete "${SIMULATOR_ID}" >/dev/null 2>&1; then
      printf '[swift-ios-verify] warning: could not delete owned Simulator %s\n' \
        "${SIMULATOR_ID}" >&2
    fi
  fi
}

trap cleanup EXIT

case "${PROFILE}" in
  pr | regression | stability) ;;
  *) die "usage: ci-verify.sh <pr|regression|stability>" ;;
esac

if [[ -n "${T3_SWIFT_XCODE_TEST_PLAN:-}" ]]; then
  XCODE_TEST_PLAN="${T3_SWIFT_XCODE_TEST_PLAN}"
elif [[ "${PROFILE}" == "pr" ]]; then
  XCODE_TEST_PLAN=UpstreamPR
else
  XCODE_TEST_PLAN=TestTrain
fi

command -v "${XCODEBUILD_COMMAND}" >/dev/null 2>&1 \
  || die "missing configured xcodebuild command: ${XCODEBUILD_COMMAND}"
command -v "${XCRUN_COMMAND}" >/dev/null 2>&1 \
  || die "missing configured xcrun command: ${XCRUN_COMMAND}"
[[ "${SIMULATOR_RESET_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] \
  || die "Simulator reset timeout must be a positive integer"
set +e
ACTUAL_TOOLCHAIN_LINES="$("${XCODEBUILD_COMMAND}" -version 2>&1)"
TOOLCHAIN_STATUS=$?
set -e
[[ "${TOOLCHAIN_STATUS}" -eq 0 ]] \
  || die "could not identify configured Xcode toolchain: ${ACTUAL_TOOLCHAIN_LINES}"
ACTUAL_TOOLCHAIN_ID="$(printf '%s\n' "${ACTUAL_TOOLCHAIN_LINES}" | tr '\n' ' ')"
if [[ -n "${TOOLCHAIN_ID}" && "${TOOLCHAIN_ID}" != "${ACTUAL_TOOLCHAIN_ID}" ]]; then
  die "configured toolchain identity does not match ${XCODEBUILD_COMMAND}"
fi
TOOLCHAIN_ID="${ACTUAL_TOOLCHAIN_ID}"

if [[ -n "${T3_SWIFT_EXPECTED_TOOLCHAIN:-}" ]]; then
  ACTUAL_TOOLCHAIN="$(printf '%s\n' "${ACTUAL_TOOLCHAIN_LINES}" | paste -sd '|' -)"
  [[ "${ACTUAL_TOOLCHAIN}" == "${T3_SWIFT_EXPECTED_TOOLCHAIN}" ]] \
    || die "expected toolchain ${T3_SWIFT_EXPECTED_TOOLCHAIN}, found ${ACTUAL_TOOLCHAIN}"
fi

if [[ -z "${SIMULATOR_ID}" ]]; then
  CREATE_ARGUMENTS=(simctl create "${SIMULATOR_NAME}" "${SIMULATOR_DEVICE_TYPE}")
  if [[ -n "${SIMULATOR_RUNTIME}" ]]; then
    CREATE_ARGUMENTS+=("${SIMULATOR_RUNTIME}")
  fi
  SIMULATOR_ID="$("${XCRUN_COMMAND}" "${CREATE_ARGUMENTS[@]}")" \
    || die "could not create disposable Simulator ${SIMULATOR_NAME}"
  [[ -n "${SIMULATOR_ID}" ]] || die "simctl returned an empty disposable Simulator identifier"
  OWNS_SIMULATOR=1
  printf '[swift-ios-verify] created disposable Simulator %s (%s)\n' \
    "${SIMULATOR_NAME}" "${SIMULATOR_ID}"
else
  printf '[swift-ios-verify] using caller-owned Simulator %s; caller remains responsible for deletion\n' \
    "${SIMULATOR_ID}"
fi
[[ ! -e "${EVIDENCE_DIR}" ]] || die "evidence directory already exists: ${EVIDENCE_DIR}"
mkdir -p "${EVIDENCE_DIR}"

"${SCRIPT_DIR}/ci-app-flow-test.test.sh"

T3_SWIFT_SIMULATOR_ID="${SIMULATOR_ID}" \
T3_SWIFT_XCODEBUILD_COMMAND="${XCODEBUILD_COMMAND}" \
T3_SWIFT_XCRUN_COMMAND="${XCRUN_COMMAND}" \
T3_SWIFT_DERIVED_DATA_PATH="${DERIVED_DATA_PATH}" \
T3_SWIFT_TOOLCHAIN_ID="${TOOLCHAIN_ID}" \
T3_SWIFT_XCODE_TEST_PLAN="${XCODE_TEST_PLAN}" \
T3_SWIFT_TEST_PRODUCTS_PATH="${TEST_PRODUCTS_PATH}" \
T3_SWIFT_RESULT_BUNDLE_PATH="${EVIDENCE_DIR}/app-flow-${PROFILE}.xcresult" \
T3_SWIFT_SELECTION_DECISION="${T3_SWIFT_SELECTION_DECISION:-}" \
T3_APP_FLOW_PLAN="${PROFILE}" \
"${SCRIPT_DIR}/ci-app-flow-test.sh"

T3_SWIFT_SIMULATOR_ID="${SIMULATOR_ID}" \
T3_SWIFT_XCODEBUILD_COMMAND="${XCODEBUILD_COMMAND}" \
T3_SWIFT_XCRUN_COMMAND="${XCRUN_COMMAND}" \
T3_SWIFT_DERIVED_DATA_PATH="${DERIVED_DATA_PATH}" \
T3_SWIFT_TOOLCHAIN_ID="${TOOLCHAIN_ID}" \
T3_SWIFT_XCODE_TEST_PLAN="${XCODE_TEST_PLAN}" \
T3_SWIFT_TEST_PRODUCTS_PATH="${TEST_PRODUCTS_PATH}" \
T3_SWIFT_REUSE_TEST_PRODUCTS=1 \
T3_SWIFT_RESULT_BUNDLE_PATH="${EVIDENCE_DIR}/app-flow-visual-accessibility.xcresult" \
T3_SWIFT_SELECTION_DECISION='' \
T3_APP_FLOW_PLAN=visual-accessibility \
"${SCRIPT_DIR}/ci-app-flow-test.sh"

# Long UI suites can exhaust CoreSimulator's testmanager session even after a
# reboot. Replace a job-owned destination so the app-hosted unit bundle gets a
# fresh device and testmanager boundary while reusing the frozen test product.
if [[ "${OWNS_SIMULATOR}" -eq 1 ]]; then
  PREVIOUS_SIMULATOR_ID="${SIMULATOR_ID}"
  printf '[swift-ios-verify] replacing owned Simulator before native unit tests\n'
  SIMULATOR_ID="$(t3_replace_simulator \
    "${XCRUN_COMMAND}" \
    "${PREVIOUS_SIMULATOR_ID}" \
    "${SIMULATOR_NAME}" \
    "${SIMULATOR_DEVICE_TYPE}" \
    "${SIMULATOR_RUNTIME}")" \
    || die "could not replace exhausted Simulator ${PREVIOUS_SIMULATOR_ID}"
  [[ -n "${SIMULATOR_ID}" && "${SIMULATOR_ID}" != "${PREVIOUS_SIMULATOR_ID}" ]] \
    || die "replacement Simulator did not receive a fresh identifier"
  printf '[swift-ios-verify] replacement Simulator %s (%s)\n' \
    "${SIMULATOR_NAME}" "${SIMULATOR_ID}"
else
  printf '[swift-ios-verify] rebooting caller-owned Simulator before native unit tests\n'
  t3_reboot_simulator \
    "${XCRUN_COMMAND}" \
    "${SCRIPT_DIR}/run-with-timeout.py" \
    "${SIMULATOR_ID}" \
    "${SIMULATOR_RESET_TIMEOUT_SECONDS}"
fi

set +e
T3_SWIFT_SIMULATOR_ID="${SIMULATOR_ID}" \
T3_SWIFT_XCODEBUILD_COMMAND="${XCODEBUILD_COMMAND}" \
T3_SWIFT_DERIVED_DATA_PATH="${DERIVED_DATA_PATH}" \
T3_SWIFT_TOOLCHAIN_ID="${TOOLCHAIN_ID}" \
T3_SWIFT_XCODE_TEST_PLAN="${XCODE_TEST_PLAN}" \
T3_SWIFT_TEST_PRODUCTS_PATH="${TEST_PRODUCTS_PATH}" \
T3_SWIFT_REUSE_TEST_PRODUCTS=1 \
T3_SWIFT_RESULT_BUNDLE_PATH="${EVIDENCE_DIR}/native-unit.xcresult" \
"${SCRIPT_DIR}/ci-test.sh"
NATIVE_TEST_STATUS=$?
set -e
NATIVE_SUMMARY_STATUS=1
NATIVE_TESTS_STATUS=1
if [[ -d "${EVIDENCE_DIR}/native-unit.xcresult" ]]; then
  set +e
  "${XCRUN_COMMAND}" xcresulttool get test-results summary \
    --path "${EVIDENCE_DIR}/native-unit.xcresult" \
    --format json >"${EVIDENCE_DIR}/native-unit.summary.json"
  NATIVE_SUMMARY_STATUS=$?
  "${XCRUN_COMMAND}" xcresulttool get test-results tests \
    --path "${EVIDENCE_DIR}/native-unit.xcresult" \
    --format json >"${EVIDENCE_DIR}/native-unit.tests.json"
  NATIVE_TESTS_STATUS=$?
  "${XCRUN_COMMAND}" xcresulttool export attachments \
    --path "${EVIDENCE_DIR}/native-unit.xcresult" \
    --output-path "${EVIDENCE_DIR}/native-unit.attachments" >/dev/null 2>&1
  set -e
fi

set +e
python3 "${SCRIPT_DIR}/app-flow.py" unit-receipt \
  --summary "${EVIDENCE_DIR}/native-unit.summary.json" \
  --tests "${EVIDENCE_DIR}/native-unit.tests.json" \
  --output "${EVIDENCE_DIR}/native-unit.receipt.json" \
  --result-bundle "${EVIDENCE_DIR}/native-unit.xcresult" \
  --test-products "${TEST_PRODUCTS_PATH}" \
  --build-manifest "${TEST_PRODUCTS_PATH}.manifest.json" \
  --scheme T3Code \
  --toolchain "${TOOLCHAIN_ID}" \
  --simulator-id "${SIMULATOR_ID}" \
  --expected-simulator-name "${T3_SWIFT_EXPECTED_SIMULATOR_NAME:-}" \
  --expected-simulator-os "${T3_SWIFT_EXPECTED_SIMULATOR_OS:-}" \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeAtStandardType()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeAtAccessibilityTypeInDarkMode()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeRightToLeft()' \
  --required-test 'AppFlowVisualSnapshotTests/testOnboardingWelcomeOnIPad()' \
  --allowed-skip 'TransportReliabilityTests/testLivePerMessageDeflateRoundTripWhenConfigured()' \
  --xcode-status "${NATIVE_TEST_STATUS}"
NATIVE_RECEIPT_STATUS=$?
set -e
if [[ "${NATIVE_TEST_STATUS}" -ne 0 \
  || "${NATIVE_SUMMARY_STATUS}" -ne 0 \
  || "${NATIVE_TESTS_STATUS}" -ne 0 \
  || "${NATIVE_RECEIPT_STATUS}" -ne 0 ]]; then
  die "native unit verification failed: xcode=${NATIVE_TEST_STATUS}, summary=${NATIVE_SUMMARY_STATUS}, tests=${NATIVE_TESTS_STATUS}, receipt=${NATIVE_RECEIPT_STATUS}"
fi

CREDENTIALS_FILE="$(mktemp "${TMPDIR:-/tmp}/t3-app-flow-security.XXXXXX")"
chmod 600 "${CREDENTIALS_FILE}"
printf '{"server":"http://127.0.0.1:3773","token":"23456789ABCD"}\n' \
  >"${CREDENTIALS_FILE}"

T3_SWIFT_SIMULATOR_ID="${SIMULATOR_ID}" \
T3_SWIFT_XCODEBUILD_COMMAND="${XCODEBUILD_COMMAND}" \
T3_SWIFT_XCRUN_COMMAND="${XCRUN_COMMAND}" \
T3_SWIFT_DERIVED_DATA_PATH="${DERIVED_DATA_PATH}" \
T3_SWIFT_TOOLCHAIN_ID="${TOOLCHAIN_ID}" \
T3_SWIFT_XCODE_TEST_PLAN="${XCODE_TEST_PLAN}" \
T3_SWIFT_TEST_PRODUCTS_PATH="${TEST_PRODUCTS_PATH}" \
T3_SWIFT_REUSE_TEST_PRODUCTS=1 \
T3_SWIFT_RESULT_BUNDLE_PATH="${EVIDENCE_DIR}/app-flow-security.xcresult" \
T3_SWIFT_SELECTION_DECISION='' \
T3_APP_FLOW_PLAN=security \
T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${CREDENTIALS_FILE}" \
"${SCRIPT_DIR}/ci-app-flow-test.sh"

SIMULATOR_CLEANUP_STATUS=not-owned
if [[ "${OWNS_SIMULATOR}" -eq 1 ]]; then
  "${XCRUN_COMMAND}" simctl shutdown "${SIMULATOR_ID}" >/dev/null 2>&1 || true
  "${XCRUN_COMMAND}" simctl delete "${SIMULATOR_ID}" \
    || die "could not delete disposable Simulator ${SIMULATOR_ID}"
  OWNS_SIMULATOR=0
  SIMULATOR_CLEANUP_STATUS=passed
fi

python3 "${SCRIPT_DIR}/app-flow.py" ledger \
  --receipt "${EVIDENCE_DIR}/app-flow-${PROFILE}.receipt.json" \
  --receipt "${EVIDENCE_DIR}/app-flow-visual-accessibility.receipt.json" \
  --receipt "${EVIDENCE_DIR}/native-unit.receipt.json" \
  --receipt "${EVIDENCE_DIR}/app-flow-security.receipt.json" \
  --expected-plan "${PROFILE}" \
  --expected-plan visual-accessibility \
  --expected-plan native-unit \
  --expected-plan security \
  --output "${EVIDENCE_DIR}/verification.receipt.json" \
  --simulator-cleanup-status "${SIMULATOR_CLEANUP_STATUS}"

printf '[swift-ios-verify] profile %s passed; evidence: %s\n' "${PROFILE}" "${EVIDENCE_DIR}"
