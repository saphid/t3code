#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/lib/swift-ios-common.sh"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SCHEME="${T3_SWIFT_SCHEME:-T3Code}"
XCODE_TEST_PLAN="${T3_SWIFT_XCODE_TEST_PLAN:-Focused}"
SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}"
DERIVED_DATA_ROOT="${RUNNER_TEMP:-${APP_DIR}/.derivedData}"
DERIVED_DATA_PATH="${T3_SWIFT_DERIVED_DATA_PATH:-${DERIVED_DATA_ROOT}/swift-ios-ci}"
CLONED_SOURCE_PACKAGES_PATH="${T3_SWIFT_CLONED_SOURCE_PACKAGES_PATH:-$HOME/.t3/cache/swift-ios/source-packages}"
RESULT_BUNDLE_PATH="${T3_SWIFT_RESULT_BUNDLE_PATH:-${REPO_ROOT}/.t3/evidence/swift-ios-native-${RUN_STAMP}.xcresult}"
TEST_PRODUCTS_PATH="${T3_SWIFT_TEST_PRODUCTS_PATH:-${RESULT_BUNDLE_PATH%.xcresult}.xctestproducts}"
BUILD_MANIFEST_PATH="${T3_SWIFT_BUILD_MANIFEST_PATH:-${TEST_PRODUCTS_PATH}.manifest.json}"
REUSE_TEST_PRODUCTS="${T3_SWIFT_REUSE_TEST_PRODUCTS:-0}"
XCODEBUILD_COMMAND="${T3_SWIFT_XCODEBUILD_COMMAND:-xcodebuild}"
TIMEOUT_SECONDS="${T3_SWIFT_TEST_TIMEOUT_SECONDS:-600}"
BUILD_TIMEOUT_SECONDS="${T3_SWIFT_BUILD_TIMEOUT_SECONDS:-900}"
TOOLCHAIN_ID="${T3_SWIFT_TOOLCHAIN_ID:-}"
CATALOG_TOOL="${SCRIPT_DIR}/app-flow.py"

die() {
  printf '[swift-ios-ci] error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd awk
require_cmd find
require_cmd grep
require_cmd "${XCODEBUILD_COMMAND}"
require_cmd xcrun
require_cmd python3
mkdir -p "${CLONED_SOURCE_PACKAGES_PATH}"

if [[ -z "${SIMULATOR_ID}" ]]; then
  # simctl groups devices by runtime. Keeping the last available iPhone picks
  # the newest installed iOS runtime without coupling CI to a device model.
  SIMULATOR_ID="$(t3_select_available_iphone_simulator)"
fi

[[ -n "${SIMULATOR_ID}" ]] || die "no available iPhone simulator was found"

case "${XCODE_TEST_PLAN}" in
  Focused | CandidateJourneys | TestTrain | DevPromotion | UpstreamPR | OfficialRelease) ;;
  *) die "unknown checked-in Xcode test plan: ${XCODE_TEST_PLAN}" ;;
esac

ACTUAL_TOOLCHAIN_ID="$("${XCODEBUILD_COMMAND}" -version | tr '\n' ' ')"
if [[ -n "${TOOLCHAIN_ID}" && "${TOOLCHAIN_ID}" != "${ACTUAL_TOOLCHAIN_ID}" ]]; then
  die "configured toolchain identity does not match ${XCODEBUILD_COMMAND}"
fi
TOOLCHAIN_ID="${ACTUAL_TOOLCHAIN_ID}"
printf '[swift-ios-ci] Xcode: %s\n' "${TOOLCHAIN_ID}"
printf '[swift-ios-ci] simulator: %s\n' "${SIMULATOR_ID}"

[[ "${TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || die "test timeout must be a positive integer"
[[ "${BUILD_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || die "build timeout must be a positive integer"
[[ "${RESULT_BUNDLE_PATH}" == *.xcresult ]] || die "result bundle must end in .xcresult"
[[ "${TEST_PRODUCTS_PATH}" == *.xctestproducts ]] || die "test products path must end in .xctestproducts"
[[ ! -e "${RESULT_BUNDLE_PATH}" ]] || die "result bundle already exists: ${RESULT_BUNDLE_PATH}"
mkdir -p "$(dirname "${RESULT_BUNDLE_PATH}")"

if [[ -e "${TEST_PRODUCTS_PATH}" ]]; then
  [[ "${REUSE_TEST_PRODUCTS}" == "1" ]] \
    || die "test products already exist; set T3_SWIFT_REUSE_TEST_PRODUCTS=1 to reuse them"
  [[ -f "${BUILD_MANIFEST_PATH}" ]] \
    || die "reused test products have no build manifest: ${BUILD_MANIFEST_PATH}"
else
  [[ ! -e "${BUILD_MANIFEST_PATH}" ]] \
    || die "build manifest exists without test products: ${BUILD_MANIFEST_PATH}"
  SOURCE_HASH_BEFORE="$(python3 "${CATALOG_TOOL}" source-hash)"
  python3 "${SCRIPT_DIR}/run-with-timeout.py" --seconds "${BUILD_TIMEOUT_SECONDS}" -- \
    "${XCODEBUILD_COMMAND}" build-for-testing \
    -project "${APP_DIR}/T3Code.xcodeproj" \
    -scheme "${SCHEME}" \
    -testPlan "${XCODE_TEST_PLAN}" \
    -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
    -derivedDataPath "${DERIVED_DATA_PATH}" \
    -clonedSourcePackagesDirPath "${CLONED_SOURCE_PACKAGES_PATH}" \
    -disablePackageRepositoryCache \
    -testProductsPath "${TEST_PRODUCTS_PATH}" \
    -maximum-concurrent-test-simulator-destinations 1 \
    -parallel-testing-enabled NO \
    CODE_SIGNING_ALLOWED=NO
  python3 "${CATALOG_TOOL}" write-build-manifest \
    --output "${BUILD_MANIFEST_PATH}" \
    --test-products "${TEST_PRODUCTS_PATH}" \
    --scheme "${SCHEME}" \
    --toolchain "${TOOLCHAIN_ID}" \
    --simulator-id "${SIMULATOR_ID}" \
    --expected-source-hash "${SOURCE_HASH_BEFORE}"
fi

python3 "${CATALOG_TOOL}" verify-build-manifest \
  --manifest "${BUILD_MANIFEST_PATH}" \
  --test-products "${TEST_PRODUCTS_PATH}" \
  --scheme "${SCHEME}" \
  --toolchain "${TOOLCHAIN_ID}" >/dev/null \
  || die "test products do not match the current source/toolchain"
find "${TEST_PRODUCTS_PATH}" -type d -name 'T3CodeTests.xctest' -print -quit \
  | grep -q . || die "test products do not contain T3CodeTests.xctest"

printf '[swift-ios-ci] scheme: %s\n' "${SCHEME}"
printf '[swift-ios-ci] Xcode test plan: %s\n' "${XCODE_TEST_PLAN}"
printf '[swift-ios-ci] test products: %s\n' "${TEST_PRODUCTS_PATH}"
printf '[swift-ios-ci] result bundle: %s\n' "${RESULT_BUNDLE_PATH}"

python3 "${SCRIPT_DIR}/run-with-timeout.py" --seconds "${TIMEOUT_SECONDS}" -- \
  "${XCODEBUILD_COMMAND}" test-without-building \
  -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  -testProductsPath "${TEST_PRODUCTS_PATH}" \
  -resultBundlePath "${RESULT_BUNDLE_PATH}" \
  -maximum-concurrent-test-simulator-destinations 1 \
  -parallel-testing-enabled NO \
  -collect-test-diagnostics never \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 30 \
  -maximum-test-execution-time-allowance 60 \
  -only-testing:T3CodeTests
