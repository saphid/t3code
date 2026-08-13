#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/swift-ios-common.sh"
SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}"
DERIVED_DATA_ROOT="${RUNNER_TEMP:-${APP_DIR}/.derivedData}"
DERIVED_DATA_PATH="${T3_SWIFT_DERIVED_DATA_PATH:-${DERIVED_DATA_ROOT}/swift-ios-ci}"
TEST_PRODUCTS_PATH="${T3_SWIFT_TEST_PRODUCTS_PATH:-}"
RESULT_BUNDLE_PATH="${T3_SWIFT_RESULT_BUNDLE_PATH:-}"
XCODEBUILD_COMMAND="${T3_SWIFT_XCODEBUILD_COMMAND:-xcodebuild}"
TIMEOUT_SECONDS="${T3_SWIFT_TEST_TIMEOUT_SECONDS:-600}"
TOOLCHAIN_ID="${T3_SWIFT_TOOLCHAIN_ID:-}"

die() {
  printf '[swift-ios-ci] error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd awk
require_cmd "${XCODEBUILD_COMMAND}"
require_cmd xcrun
require_cmd python3

if [[ -z "${SIMULATOR_ID}" ]]; then
  # simctl groups devices by runtime. Keeping the last available iPhone picks
  # the newest installed iOS runtime without coupling CI to a device model.
  SIMULATOR_ID="$(t3_select_available_iphone_simulator)"
fi

[[ -n "${SIMULATOR_ID}" ]] || die "no available iPhone simulator was found"

ACTUAL_TOOLCHAIN_ID="$("${XCODEBUILD_COMMAND}" -version | tr '\n' ' ')"
if [[ -n "${TOOLCHAIN_ID}" && "${TOOLCHAIN_ID}" != "${ACTUAL_TOOLCHAIN_ID}" ]]; then
  die "configured toolchain identity does not match ${XCODEBUILD_COMMAND}"
fi
TOOLCHAIN_ID="${ACTUAL_TOOLCHAIN_ID}"
printf '[swift-ios-ci] Xcode: %s\n' "${TOOLCHAIN_ID}"
printf '[swift-ios-ci] simulator: %s\n' "${SIMULATOR_ID}"

[[ "${TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || die "test timeout must be a positive integer"
if [[ -n "${RESULT_BUNDLE_PATH}" ]]; then
  [[ "${RESULT_BUNDLE_PATH}" == *.xcresult ]] || die "result bundle must end in .xcresult"
  [[ ! -e "${RESULT_BUNDLE_PATH}" ]] || die "result bundle already exists: ${RESULT_BUNDLE_PATH}"
fi

RESULT_ARGUMENTS=()
if [[ -n "${RESULT_BUNDLE_PATH}" ]]; then
  RESULT_ARGUMENTS=(-resultBundlePath "${RESULT_BUNDLE_PATH}")
fi

if [[ -n "${TEST_PRODUCTS_PATH}" ]]; then
  [[ -d "${TEST_PRODUCTS_PATH}" ]] || die "test products path does not exist"
  python3 "${SCRIPT_DIR}/run-with-timeout.py" --seconds "${TIMEOUT_SECONDS}" -- \
    "${XCODEBUILD_COMMAND}" test-without-building \
    -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
    -derivedDataPath "${DERIVED_DATA_PATH}" \
    -testProductsPath "${TEST_PRODUCTS_PATH}" \
    ${RESULT_ARGUMENTS[@]+"${RESULT_ARGUMENTS[@]}"} \
    -maximum-concurrent-test-simulator-destinations 1 \
    -parallel-testing-enabled NO \
    -collect-test-diagnostics never \
    -test-timeouts-enabled YES \
    -default-test-execution-time-allowance 30 \
    -maximum-test-execution-time-allowance 60 \
    -only-testing:T3CodeTests
  exit $?
fi

python3 "${SCRIPT_DIR}/run-with-timeout.py" --seconds "${TIMEOUT_SECONDS}" -- \
  "${XCODEBUILD_COMMAND}" test \
  -project "${APP_DIR}/T3Code.xcodeproj" \
  -scheme T3Code \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  ${RESULT_ARGUMENTS[@]+"${RESULT_ARGUMENTS[@]}"} \
  -maximum-concurrent-test-simulator-destinations 1 \
  -parallel-testing-enabled NO \
  -collect-test-diagnostics never \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 30 \
  -maximum-test-execution-time-allowance 60 \
  -only-testing:T3CodeTests \
  CODE_SIGNING_ALLOWED=NO
