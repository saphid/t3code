#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
SCHEME="${T3_SWIFT_SCHEME:-T3Code}"
SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}"
DERIVED_DATA_ROOT="${RUNNER_TEMP:-${APP_DIR}/.derivedData}"
DERIVED_DATA_PATH="${T3_SWIFT_DERIVED_DATA_PATH:-${DERIVED_DATA_ROOT}/swift-ios-app-flow}"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_BUNDLE_PATH="${T3_SWIFT_RESULT_BUNDLE_PATH:-${REPO_ROOT}/.t3/evidence/swift-ios-app-flow-${RUN_STAMP}.xcresult}"
KNOWN_FAILURE_AUDIT="${T3_APP_FLOW_RUN_KNOWN_FAILURES:-0}"

die() {
  printf '[swift-ios-app-flow] error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd awk
require_cmd date
require_cmd xcodebuild
require_cmd xcrun

if [[ -z "${SIMULATOR_ID}" ]]; then
  SIMULATOR_ID="$(
    xcrun simctl list devices available \
      | awk '
          /^[[:space:]]+iPhone/ {
            line = $0
            while (match(line, /\([[:xdigit:]-]+\)/)) {
              value = substr(line, RSTART + 1, RLENGTH - 2)
              if (value ~ /^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$/) {
                candidate = value
              }
              line = substr(line, RSTART + RLENGTH)
            }
          }
          END { print candidate }
        '
  )"
fi

[[ -n "${SIMULATOR_ID}" ]] || die "no available iPhone simulator was found"
[[ ! -e "${RESULT_BUNDLE_PATH}" ]] || die "result bundle already exists: ${RESULT_BUNDLE_PATH}"
mkdir -p "$(dirname "${RESULT_BUNDLE_PATH}")"

printf '[swift-ios-app-flow] simulator: %s\n' "${SIMULATOR_ID}"
printf '[swift-ios-app-flow] scheme: %s\n' "${SCHEME}"
printf '[swift-ios-app-flow] result bundle: %s\n' "${RESULT_BUNDLE_PATH}"
printf '[swift-ios-app-flow] known-failure audit: %s\n' "${KNOWN_FAILURE_AUDIT}"

TEST_RUNNER_T3_APP_FLOW_RUN_KNOWN_FAILURES="${KNOWN_FAILURE_AUDIT}" xcodebuild test \
  -project "${APP_DIR}/T3Code.xcodeproj" \
  -scheme "${SCHEME}" \
  -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  -resultBundlePath "${RESULT_BUNDLE_PATH}" \
  -maximum-concurrent-test-simulator-destinations 1 \
  -parallel-testing-enabled NO \
  -collect-test-diagnostics on-failure \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 90 \
  -maximum-test-execution-time-allowance 180 \
  -only-testing:T3CodeUITests
