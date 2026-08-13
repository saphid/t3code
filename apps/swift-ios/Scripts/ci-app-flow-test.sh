#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/lib/swift-ios-common.sh"
SCHEME="${T3_SWIFT_SCHEME:-T3Code}"
SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}"
DERIVED_DATA_ROOT="${RUNNER_TEMP:-${APP_DIR}/.derivedData}"
DERIVED_DATA_PATH="${T3_SWIFT_DERIVED_DATA_PATH:-${DERIVED_DATA_ROOT}/swift-ios-app-flow}"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_BUNDLE_PATH="${T3_SWIFT_RESULT_BUNDLE_PATH:-${REPO_ROOT}/.t3/evidence/swift-ios-app-flow-${RUN_STAMP}.xcresult}"
TEST_PRODUCTS_PATH="${T3_SWIFT_TEST_PRODUCTS_PATH:-${RESULT_BUNDLE_PATH%.xcresult}.xctestproducts}"
SUMMARY_PATH="${T3_SWIFT_SUMMARY_PATH:-${RESULT_BUNDLE_PATH%.xcresult}.summary.json}"
TESTS_PATH="${T3_SWIFT_TESTS_PATH:-${RESULT_BUNDLE_PATH%.xcresult}.tests.json}"
RECEIPT_PATH="${T3_SWIFT_RECEIPT_PATH:-${RESULT_BUNDLE_PATH%.xcresult}.receipt.json}"
ATTACHMENTS_PATH="${T3_SWIFT_ATTACHMENTS_PATH:-${RESULT_BUNDLE_PATH%.xcresult}.attachments}"
BUILD_MANIFEST_PATH="${T3_SWIFT_BUILD_MANIFEST_PATH:-${TEST_PRODUCTS_PATH}.manifest.json}"
REUSE_TEST_PRODUCTS="${T3_SWIFT_REUSE_TEST_PRODUCTS:-0}"
PLAN="${T3_APP_FLOW_PLAN:-regression}"
LIVE_CREDENTIALS_FILE="${T3_APP_FLOW_LIVE_CREDENTIALS_FILE:-}"
LIVE_CREDENTIALS_SNAPSHOT=""
SECRET_PATTERN_FILE=""
XCODEBUILD_COMMAND="${T3_SWIFT_XCODEBUILD_COMMAND:-xcodebuild}"
XCRUN_COMMAND="${T3_SWIFT_XCRUN_COMMAND:-xcrun}"
TOOLCHAIN_ID="${T3_SWIFT_TOOLCHAIN_ID:-}"
EXPECTED_SIMULATOR_NAME="${T3_SWIFT_EXPECTED_SIMULATOR_NAME:-}"
EXPECTED_SIMULATOR_OS="${T3_SWIFT_EXPECTED_SIMULATOR_OS:-}"
STAGED_CREDENTIALS_PATH=""
LIVE_APP_BUNDLE_ID=""
DELETE_LIVE_SIMULATOR=0
XCODE_LOG_PATH="${RESULT_BUNDLE_PATH%.xcresult}.xcodebuild.log"
CATALOG_TOOL="${SCRIPT_DIR}/app-flow.py"
SELECTION_DECISION_PATH="${T3_SWIFT_SELECTION_DECISION:-}"
TIMEOUT_TOOL="${SCRIPT_DIR}/run-with-timeout.py"
TEST_SELECTIONS=()
SECRET_SCAN_STATUS=not-required
CREDENTIAL_CLEANUP_STATUS=not-required
SIMULATOR_CLEANUP_STATUS=not-owned

die() {
  printf '[swift-ios-app-flow] error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd awk
require_cmd cp
require_cmd date
require_cmd find
require_cmd python3
require_cmd tr
require_cmd "${XCODEBUILD_COMMAND}"
require_cmd "${XCRUN_COMMAND}"
ACTUAL_TOOLCHAIN_ID="$("${XCODEBUILD_COMMAND}" -version | tr '\n' ' ')"
if [[ -n "${TOOLCHAIN_ID}" && "${TOOLCHAIN_ID}" != "${ACTUAL_TOOLCHAIN_ID}" ]]; then
  die "configured toolchain identity does not match ${XCODEBUILD_COMMAND}"
fi
TOOLCHAIN_ID="${ACTUAL_TOOLCHAIN_ID}"

python3 "${CATALOG_TOOL}" check >/dev/null || die "app-flow catalog validation failed"
while IFS= read -r selection; do
  [[ -n "${selection}" ]] && TEST_SELECTIONS+=("${selection}")
done < <(python3 "${CATALOG_TOOL}" resolve --plan "${PLAN}")
[[ "${#TEST_SELECTIONS[@]}" -gt 0 ]] || die "app-flow plan selected no tests: ${PLAN}"
CREDENTIAL_REQUIREMENT="$(
  python3 "${CATALOG_TOOL}" plan-field --plan "${PLAN}" --field credentials
)" || die "could not resolve credential requirements for plan: ${PLAN}"
KNOWN_FAILURE_AUDIT="$(
  python3 "${CATALOG_TOOL}" plan-field --plan "${PLAN}" --field known-red
)" || die "could not resolve known-red behavior for plan: ${PLAN}"
REPETITIONS="$(
  python3 "${CATALOG_TOOL}" plan-field --plan "${PLAN}" --field repetitions
)" || die "could not resolve repetitions for plan: ${PLAN}"
TEST_TIMEOUT_SECONDS="${T3_APP_FLOW_TIMEOUT_SECONDS:-$(
  python3 "${CATALOG_TOOL}" plan-field --plan "${PLAN}" --field timeout
)}"
BUILD_TIMEOUT_SECONDS="${T3_SWIFT_BUILD_TIMEOUT_SECONDS:-900}"
SIMULATOR_BOOT_TIMEOUT_SECONDS="${T3_SWIFT_SIMULATOR_BOOT_TIMEOUT_SECONDS:-120}"
[[ "${REPETITIONS}" =~ ^[1-9][0-9]*$ ]] || die "plan repetitions must be a positive integer"
[[ "${TEST_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || die "test timeout must be a positive integer"
[[ "${BUILD_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || die "build timeout must be a positive integer"
[[ "${SIMULATOR_BOOT_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] \
  || die "Simulator boot timeout must be a positive integer"

cleanup_live_secret() {
  if [[ -n "${LIVE_CREDENTIALS_SNAPSHOT}" && -f "${LIVE_CREDENTIALS_SNAPSHOT}" ]]; then
    rm -f -- "${LIVE_CREDENTIALS_SNAPSHOT}"
  fi
  if [[ -n "${STAGED_CREDENTIALS_PATH}" && -f "${STAGED_CREDENTIALS_PATH}" ]]; then
    rm -f -- "${STAGED_CREDENTIALS_PATH}"
  fi
  if [[ -n "${SECRET_PATTERN_FILE}" && -f "${SECRET_PATTERN_FILE}" ]]; then
    rm -f -- "${SECRET_PATTERN_FILE}"
  fi
  if [[ -n "${LIVE_APP_BUNDLE_ID}" && -n "${SIMULATOR_ID}" ]]; then
    "${XCRUN_COMMAND}" simctl uninstall "${SIMULATOR_ID}" \
      "${LIVE_APP_BUNDLE_ID}" >/dev/null 2>&1 || true
  fi
  if [[ "${DELETE_LIVE_SIMULATOR}" -eq 1 && -n "${SIMULATOR_ID}" ]]; then
    "${XCRUN_COMMAND}" simctl shutdown "${SIMULATOR_ID}" >/dev/null 2>&1 || true
    "${XCRUN_COMMAND}" simctl delete "${SIMULATOR_ID}" >/dev/null 2>&1 || true
  fi
}

remove_unsafe_evidence() {
  rm -rf -- "${RESULT_BUNDLE_PATH}" "${SUMMARY_PATH}" "${TESTS_PATH}" \
    "${RECEIPT_PATH}" "${ATTACHMENTS_PATH}" "${XCODE_LOG_PATH}"
}

scan_evidence_for_secret() {
  local target="$1"
  if [[ -d "${target}" ]]; then
    grep -R -a -l -F -f "${SECRET_PATTERN_FILE}" "${target}" >/dev/null 2>&1
  else
    grep -a -l -F -f "${SECRET_PATTERN_FILE}" "${target}" >/dev/null 2>&1
  fi
}

enforce_secret_scan() {
  local target scan_status
  [[ -n "${SECRET_PATTERN_FILE}" ]] || return 0
  for target in "$@"; do
    [[ -e "${target}" ]] || continue
    set +e
    scan_evidence_for_secret "${target}"
    scan_status=$?
    set -e
    if [[ "${scan_status}" -eq 0 ]]; then
      remove_unsafe_evidence
      die "live credential detected in retained evidence; unsafe evidence was removed"
    fi
    if [[ "${scan_status}" -ne 1 ]]; then
      remove_unsafe_evidence
      die "live credential evidence scan failed closed; unsafe evidence was removed"
    fi
  done
}

trap cleanup_live_secret EXIT

if [[ -n "${T3_APP_FLOW_LIVE_SERVER:-}" || -n "${T3_APP_FLOW_LIVE_TOKEN:-}" ]]; then
  die "raw live credentials are not accepted; use T3_APP_FLOW_LIVE_CREDENTIALS_FILE"
fi

if [[ "${CREDENTIAL_REQUIREMENT}" == "required" && -z "${LIVE_CREDENTIALS_FILE}" ]]; then
  die "app-flow plan ${PLAN} requires T3_APP_FLOW_LIVE_CREDENTIALS_FILE"
fi
if [[ "${CREDENTIAL_REQUIREMENT}" == "none" && -n "${LIVE_CREDENTIALS_FILE}" ]]; then
  die "app-flow plan ${PLAN} does not accept live credentials"
fi
if [[ "${PLAN}" == "live" ]]; then
  [[ -n "${T3_SWIFT_SIMULATOR_ID:-}" ]] \
    || die "live plan requires an explicit run-owned T3_SWIFT_SIMULATOR_ID"
  [[ "${T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR:-0}" == "1" ]] \
    || die "live plan requires an explicitly disposable Simulator"
  DELETE_LIVE_SIMULATOR=1
elif [[ "${PLAN}" == "security" ]]; then
  [[ -n "${T3_SWIFT_SIMULATOR_ID:-}" ]] \
    || die "security plan requires an explicit T3_SWIFT_SIMULATOR_ID because it removes the tested app"
elif [[ -n "${T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR:-}" ]]; then
  die "T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR is accepted only by the live plan"
fi

if [[ -n "${LIVE_CREDENTIALS_FILE}" ]]; then
  require_cmd grep
  LIVE_CREDENTIALS_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/t3-app-flow-credentials.XXXXXX")"
  SECRET_PATTERN_FILE="$(mktemp "${TMPDIR:-/tmp}/t3-app-flow-secret.XXXXXX")"
  chmod 600 "${LIVE_CREDENTIALS_SNAPSHOT}" "${SECRET_PATTERN_FILE}"
  python3 - "${LIVE_CREDENTIALS_FILE}" "${LIVE_CREDENTIALS_SNAPSHOT}" \
    "${SECRET_PATTERN_FILE}" <<'PY' \
    || die "live credentials must have mode 600 and contain one valid server and token"
import json
import os
import stat
import sys
from urllib.parse import urlsplit

source, canonical, patterns = sys.argv[1:]
flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(source, flags)
try:
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise ValueError("unsafe credential file")
    with os.fdopen(descriptor, encoding="utf-8") as handle:
        descriptor = -1
        raw_payload = handle.read()
finally:
    if descriptor >= 0:
        os.close(descriptor)

def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate key: {key}")
        value[key] = item
    return value

payload = json.loads(raw_payload, object_pairs_hook=unique_object)
if not isinstance(payload, dict) or set(payload) != {"server", "token"}:
    raise ValueError("unexpected credential fields")
server = payload["server"]
token = payload["token"]
if not isinstance(server, str) or not isinstance(token, str):
    raise ValueError("credentials must be strings")
value = urlsplit(server)
valid_server = (
    server == server.strip()
    and all(0x21 <= ord(character) <= 0x7E for character in server)
    and value.geturl() == server
    and value.scheme in {"http", "https"}
    and value.hostname is not None
    and value.username is None
    and value.password is None
    and value.path in {"", "/"}
    and not value.query
    and not value.fragment
)
alphabet = set("23456789ABCDEFGHJKLMNPQRSTUVWXYZ")
if not valid_server or len(token) != 12 or any(character not in alphabet for character in token):
    raise ValueError("invalid server or token")
with open(canonical, "w", encoding="utf-8") as handle:
    json.dump({"server": server, "token": token}, handle, separators=(",", ":"))
    handle.write("\n")
with open(patterns, "w", encoding="utf-8") as handle:
    handle.write(server + "\n" + token + "\n")
PY
  SECRET_SCAN_STATUS=passed
  CREDENTIAL_CLEANUP_STATUS=failed
fi

if [[ -z "${SIMULATOR_ID}" ]]; then
  SIMULATOR_ID="$(t3_select_available_iphone_simulator)"
fi

[[ -n "${SIMULATOR_ID}" ]] || die "no available iPhone simulator was found"
[[ "${RESULT_BUNDLE_PATH}" == *.xcresult ]] || die "result bundle must end in .xcresult"
[[ "${TEST_PRODUCTS_PATH}" == *.xctestproducts ]] \
  || die "test products path must end in .xctestproducts"
[[ ! -e "${RESULT_BUNDLE_PATH}" ]] || die "result bundle already exists: ${RESULT_BUNDLE_PATH}"
[[ ! -e "${SUMMARY_PATH}" ]] || die "summary already exists: ${SUMMARY_PATH}"
[[ ! -e "${TESTS_PATH}" ]] || die "test inventory already exists: ${TESTS_PATH}"
[[ ! -e "${RECEIPT_PATH}" ]] || die "receipt already exists: ${RECEIPT_PATH}"
[[ ! -e "${ATTACHMENTS_PATH}" ]] || die "attachments path already exists: ${ATTACHMENTS_PATH}"
[[ ! -e "${XCODE_LOG_PATH}" ]] || die "xcodebuild log already exists: ${XCODE_LOG_PATH}"
if [[ -e "${TEST_PRODUCTS_PATH}" && "${REUSE_TEST_PRODUCTS}" != "1" ]]; then
  die "test products already exist; set T3_SWIFT_REUSE_TEST_PRODUCTS=1 to reuse them"
fi
if [[ -e "${TEST_PRODUCTS_PATH}" ]]; then
  [[ -f "${BUILD_MANIFEST_PATH}" ]] \
    || die "reused test products have no build manifest: ${BUILD_MANIFEST_PATH}"
else
  [[ ! -e "${BUILD_MANIFEST_PATH}" ]] \
    || die "build manifest exists without test products: ${BUILD_MANIFEST_PATH}"
fi
mkdir -p "$(dirname "${RESULT_BUNDLE_PATH}")"

printf '[swift-ios-app-flow] simulator: %s\n' "${SIMULATOR_ID}"
printf '[swift-ios-app-flow] scheme: %s\n' "${SCHEME}"
printf '[swift-ios-app-flow] plan: %s (%s journeys)\n' "${PLAN}" "${#TEST_SELECTIONS[@]}"
printf '[swift-ios-app-flow] test products: %s\n' "${TEST_PRODUCTS_PATH}"
printf '[swift-ios-app-flow] build manifest: %s\n' "${BUILD_MANIFEST_PATH}"
printf '[swift-ios-app-flow] result bundle: %s\n' "${RESULT_BUNDLE_PATH}"
printf '[swift-ios-app-flow] receipt: %s\n' "${RECEIPT_PATH}"
printf '[swift-ios-app-flow] attachments: %s\n' "${ATTACHMENTS_PATH}"
printf '[swift-ios-app-flow] known-failure audit: %s\n' "${KNOWN_FAILURE_AUDIT}"
printf '[swift-ios-app-flow] repetitions: %s\n' "${REPETITIONS}"
printf '[swift-ios-app-flow] wall-clock timeout: %ss\n' "${TEST_TIMEOUT_SECONDS}"

if [[ ! -e "${TEST_PRODUCTS_PATH}" ]]; then
  SOURCE_HASH_BEFORE="$(python3 "${CATALOG_TOOL}" source-hash)"
  python3 "${TIMEOUT_TOOL}" --seconds "${BUILD_TIMEOUT_SECONDS}" -- \
    "${XCODEBUILD_COMMAND}" build-for-testing \
    -project "${APP_DIR}/T3Code.xcodeproj" \
    -scheme "${SCHEME}" \
    -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
    -derivedDataPath "${DERIVED_DATA_PATH}" \
    -testProductsPath "${TEST_PRODUCTS_PATH}" \
    -maximum-concurrent-test-simulator-destinations 1 \
    -parallel-testing-enabled NO
  python3 "${CATALOG_TOOL}" write-build-manifest \
    --output "${BUILD_MANIFEST_PATH}" \
    --test-products "${TEST_PRODUCTS_PATH}" \
    --scheme "${SCHEME}" \
    --toolchain "${TOOLCHAIN_ID}" \
    --simulator-id "${SIMULATOR_ID}" \
    --expected-source-hash "${SOURCE_HASH_BEFORE}"
else
  printf '[swift-ios-app-flow] reusing test products\n'
fi

python3 "${CATALOG_TOOL}" verify-build-manifest \
  --manifest "${BUILD_MANIFEST_PATH}" \
  --test-products "${TEST_PRODUCTS_PATH}" \
  --scheme "${SCHEME}" \
  --toolchain "${TOOLCHAIN_ID}" >/dev/null \
  || die "test products do not match the current source/toolchain"

SELECTION_ARGUMENTS=()
if [[ -n "${SELECTION_DECISION_PATH}" ]]; then
  [[ -f "${SELECTION_DECISION_PATH}" ]] \
    || die "selection decision does not exist: ${SELECTION_DECISION_PATH}"
  SELECTION_ARGUMENTS=(--selection-decision "${SELECTION_DECISION_PATH}")
fi

if [[ -n "${LIVE_CREDENTIALS_FILE}" ]]; then
  APP_PATH="$(find "${TEST_PRODUCTS_PATH}" -type d -name 'T3Code.app' -print -quit)"
  [[ -n "${APP_PATH}" ]] || die "built T3Code.app was not found in the test products"
  LIVE_APP_BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "${APP_PATH}/Info.plist")" \
    || die "built app has no bundle identifier"
  python3 "${TIMEOUT_TOOL}" --seconds "${SIMULATOR_BOOT_TIMEOUT_SECONDS}" -- \
    "${XCRUN_COMMAND}" simctl bootstatus "${SIMULATOR_ID}" -b \
    || die "could not boot the Simulator before staging credentials"
  "${XCRUN_COMMAND}" simctl install "${SIMULATOR_ID}" "${APP_PATH}" \
    || die "could not install the built app before staging credentials"
  APP_CONTAINER="$("${XCRUN_COMMAND}" simctl get_app_container "${SIMULATOR_ID}" "${LIVE_APP_BUNDLE_ID}" data)" \
    || die "could not resolve the built app's data container"
  [[ -n "${APP_CONTAINER}" && -d "${APP_CONTAINER}" ]] \
    || die "built app data container is unavailable"
  STAGED_CREDENTIALS_PATH="${APP_CONTAINER}/Library/Caches/.t3-app-flow-credentials.json"
  mkdir -p "$(dirname "${STAGED_CREDENTIALS_PATH}")"
  cp "${LIVE_CREDENTIALS_SNAPSHOT}" "${STAGED_CREDENTIALS_PATH}"
  chmod 600 "${STAGED_CREDENTIALS_PATH}"
fi

TEST_ARGUMENTS=()
for selection in "${TEST_SELECTIONS[@]}"; do
  TEST_ARGUMENTS+=("-only-testing:${selection}")
done
REPETITION_ARGUMENTS=()
if [[ "${REPETITIONS}" -gt 1 ]]; then
  REPETITION_ARGUMENTS=(
    -test-iterations "${REPETITIONS}"
    -test-repetition-relaunch-enabled YES
  )
fi
run_selected_tests() {
  TEST_RUNNER_T3_APP_FLOW_RUN_KNOWN_FAILURES="${KNOWN_FAILURE_AUDIT}" \
  TEST_RUNNER_T3_APP_FLOW_LIVE_ENABLED="$([[ -n "${LIVE_CREDENTIALS_FILE}" ]] && printf 1 || printf 0)" \
  python3 "${TIMEOUT_TOOL}" --seconds "${TEST_TIMEOUT_SECONDS}" -- \
    "${XCODEBUILD_COMMAND}" test-without-building \
    -destination "platform=iOS Simulator,id=${SIMULATOR_ID}" \
    -derivedDataPath "${DERIVED_DATA_PATH}" \
    -testProductsPath "${TEST_PRODUCTS_PATH}" \
    -resultBundlePath "${RESULT_BUNDLE_PATH}" \
    -maximum-concurrent-test-simulator-destinations 1 \
    -parallel-testing-enabled NO \
    -collect-test-diagnostics on-failure \
    -test-timeouts-enabled YES \
    -default-test-execution-time-allowance 180 \
    -maximum-test-execution-time-allowance 360 \
    ${REPETITION_ARGUMENTS[@]+"${REPETITION_ARGUMENTS[@]}"} \
    "${TEST_ARGUMENTS[@]}"
}

set +e
if [[ -n "${LIVE_CREDENTIALS_FILE}" ]]; then
  run_selected_tests >"${XCODE_LOG_PATH}" 2>&1
else
  run_selected_tests
fi
TEST_STATUS=$?
set -e

if [[ -n "${STAGED_CREDENTIALS_PATH}" && -f "${STAGED_CREDENTIALS_PATH}" ]]; then
  rm -f -- "${STAGED_CREDENTIALS_PATH}"
  STAGED_CREDENTIALS_PATH=""
  if [[ "${TEST_STATUS}" -eq 0 ]]; then
    TEST_STATUS=1
  fi
  printf '[swift-ios-app-flow] error: app did not consume the staged credentials file\n' >&2
fi

enforce_secret_scan "${RESULT_BUNDLE_PATH}" "${XCODE_LOG_PATH}"

SUMMARY_STATUS=1
if [[ -d "${RESULT_BUNDLE_PATH}" ]]; then
  set +e
  "${XCRUN_COMMAND}" xcresulttool get test-results summary \
    --path "${RESULT_BUNDLE_PATH}" \
    --format json >"${SUMMARY_PATH}"
  SUMMARY_STATUS=$?
  set -e
fi
if [[ "${SUMMARY_STATUS}" -ne 0 && "${TEST_STATUS}" -eq 0 ]]; then
  TEST_STATUS=1
  printf '[swift-ios-app-flow] error: could not extract the xcresult summary\n' >&2
fi

TESTS_STATUS=1
if [[ -d "${RESULT_BUNDLE_PATH}" ]]; then
  set +e
  "${XCRUN_COMMAND}" xcresulttool get test-results tests \
    --path "${RESULT_BUNDLE_PATH}" \
    --format json >"${TESTS_PATH}"
  TESTS_STATUS=$?
  set -e
fi
if [[ "${TESTS_STATUS}" -ne 0 && "${TEST_STATUS}" -eq 0 ]]; then
  TEST_STATUS=1
  printf '[swift-ios-app-flow] error: could not extract the xcresult test inventory\n' >&2
fi

ATTACHMENTS_STATUS=1
if [[ -d "${RESULT_BUNDLE_PATH}" ]]; then
  set +e
  "${XCRUN_COMMAND}" xcresulttool export attachments \
    --path "${RESULT_BUNDLE_PATH}" \
    --output-path "${ATTACHMENTS_PATH}"
  ATTACHMENTS_STATUS=$?
  set -e
fi
if [[ "${ATTACHMENTS_STATUS}" -ne 0 && "${TEST_STATUS}" -eq 0 ]]; then
  TEST_STATUS=1
  printf '[swift-ios-app-flow] error: could not export xcresult attachments\n' >&2
fi

if [[ -n "${LIVE_APP_BUNDLE_ID}" ]]; then
  if ! "${XCRUN_COMMAND}" simctl uninstall "${SIMULATOR_ID}" \
    "${LIVE_APP_BUNDLE_ID}" >/dev/null; then
    printf '[swift-ios-app-flow] error: could not remove live credentials by uninstalling the app\n' >&2
    TEST_STATUS=1
  else
    LIVE_APP_BUNDLE_ID=""
    CREDENTIAL_CLEANUP_STATUS=passed
  fi
fi

if [[ "${DELETE_LIVE_SIMULATOR}" -eq 1 ]]; then
  "${XCRUN_COMMAND}" simctl shutdown "${SIMULATOR_ID}" >/dev/null 2>&1 || true
  if ! "${XCRUN_COMMAND}" simctl delete "${SIMULATOR_ID}" >/dev/null; then
    printf '[swift-ios-app-flow] error: could not delete the disposable live Simulator\n' >&2
    TEST_STATUS=1
    SIMULATOR_CLEANUP_STATUS=failed
  else
    DELETE_LIVE_SIMULATOR=0
    SIMULATOR_CLEANUP_STATUS=passed
  fi
fi

enforce_secret_scan "${RESULT_BUNDLE_PATH}" "${SUMMARY_PATH}" "${TESTS_PATH}" \
  "${ATTACHMENTS_PATH}" "${XCODE_LOG_PATH}"

set +e
python3 "${CATALOG_TOOL}" receipt \
  --plan "${PLAN}" \
  --summary "${SUMMARY_PATH}" \
  --tests "${TESTS_PATH}" \
  --output "${RECEIPT_PATH}" \
  --result-bundle "${RESULT_BUNDLE_PATH}" \
  --test-products "${TEST_PRODUCTS_PATH}" \
  --attachments "${ATTACHMENTS_PATH}" \
  --build-manifest "${BUILD_MANIFEST_PATH}" \
  --scheme "${SCHEME}" \
  --toolchain "${TOOLCHAIN_ID}" \
  --simulator-id "${SIMULATOR_ID}" \
  --expected-simulator-name "${EXPECTED_SIMULATOR_NAME}" \
  --expected-simulator-os "${EXPECTED_SIMULATOR_OS}" \
  --xcode-log "${XCODE_LOG_PATH}" \
  --xcode-status "${TEST_STATUS}" \
  --secret-scan-status "${SECRET_SCAN_STATUS}" \
  --credential-cleanup-status "${CREDENTIAL_CLEANUP_STATUS}" \
  --simulator-cleanup-status "${SIMULATOR_CLEANUP_STATUS}" \
  ${SELECTION_ARGUMENTS[@]+"${SELECTION_ARGUMENTS[@]}"}
RECEIPT_STATUS=$?
set -e
if [[ "${RECEIPT_STATUS}" -ne 0 && "${TEST_STATUS}" -eq 0 ]]; then
  TEST_STATUS=1
fi

enforce_secret_scan "${RESULT_BUNDLE_PATH}" "${SUMMARY_PATH}" "${TESTS_PATH}" \
  "${RECEIPT_PATH}" "${ATTACHMENTS_PATH}" "${XCODE_LOG_PATH}"

exit "${TEST_STATUS}"
