#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
ADAPTER="${T3_APP_FLOW_BACKEND_ADAPTER:-}"
EXPECTED_ADAPTER_SHA256="${T3_APP_FLOW_BACKEND_ADAPTER_SHA256:-}"
XCRUN_COMMAND="${T3_SWIFT_XCRUN_COMMAND:-xcrun}"
XCODEBUILD_COMMAND="${T3_SWIFT_XCODEBUILD_COMMAND:-xcodebuild}"
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="${T3_SWIFT_EVIDENCE_DIR:-${REPO_ROOT}/.t3/evidence/swift-ios-live-${RUN_STAMP}}"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/t3-live-backend.XXXXXX")"
SIMULATOR_ID=""
BACKEND_PREPARED=0
BACKEND_MANIFEST_VALIDATED=0

die() {
  printf '[swift-ios-live] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  local backend_cleanup_status=0
  trap - EXIT
  set +e
  if [[ "${BACKEND_PREPARED}" -eq 1 ]]; then
    "${ADAPTER}" cleanup --manifest "${RUN_DIR}/backend.json" >/dev/null 2>&1
    backend_cleanup_status=$?
  fi
  if [[ -n "${SIMULATOR_ID}" ]]; then
    "${XCRUN_COMMAND}" simctl shutdown "${SIMULATOR_ID}" >/dev/null 2>&1
    "${XCRUN_COMMAND}" simctl delete "${SIMULATOR_ID}" >/dev/null 2>&1
  fi
  rm -f -- "${RUN_DIR}/credentials.json"
  if [[ "${backend_cleanup_status}" -eq 0 ]]; then
    rm -rf -- "${RUN_DIR}"
  elif [[ "${BACKEND_MANIFEST_VALIDATED}" -eq 1 ]]; then
    printf '[swift-ios-live] backend cleanup still failed; recovery manifest retained at %s\n' \
      "${RUN_DIR}/backend.json" >&2
  else
    rm -f -- "${RUN_DIR}/backend.json"
    printf '%s\n' \
      'Backend cleanup failed after the adapter produced an unsafe manifest.' \
      "Pinned adapter SHA-256: ${EXPECTED_ADAPTER_SHA256}" \
      'The raw manifest and credentials were removed; audit the adapter and backend externally.' \
      >"${RUN_DIR}/recovery.txt"
    chmod 600 "${RUN_DIR}/recovery.txt"
    printf '[swift-ios-live] unsafe manifest removed after cleanup failure; recovery note retained at %s\n' \
      "${RUN_DIR}/recovery.txt" >&2
  fi
  exit "${status}"
}

trap cleanup EXIT

[[ -n "${ADAPTER}" && -f "${ADAPTER}" && -x "${ADAPTER}" ]] \
  || die "T3_APP_FLOW_BACKEND_ADAPTER must name an executable adapter"
[[ "${EXPECTED_ADAPTER_SHA256}" =~ ^[0-9a-f]{64}$ ]] \
  || die "T3_APP_FLOW_BACKEND_ADAPTER_SHA256 must pin the adapter"
ACTUAL_ADAPTER_SHA256="$(shasum -a 256 "${ADAPTER}" | awk '{print $1}')"
[[ "${ACTUAL_ADAPTER_SHA256}" == "${EXPECTED_ADAPTER_SHA256}" ]] \
  || die "live backend adapter digest changed"
[[ ! -e "${EVIDENCE_DIR}" ]] || die "evidence directory already exists: ${EVIDENCE_DIR}"
mkdir -p "${EVIDENCE_DIR}"

"${ADAPTER}" prepare --output-directory "${RUN_DIR}"
BACKEND_PREPARED=1
[[ -f "${RUN_DIR}/backend.json" && -f "${RUN_DIR}/credentials.json" ]] \
  || die "adapter did not produce backend.json and credentials.json"
python3 "${SCRIPT_DIR}/app-flow.py" validate-live-backend-manifest \
  --manifest "${RUN_DIR}/backend.json" >/dev/null \
  || die "adapter produced an unsafe backend recovery manifest"
BACKEND_MANIFEST_VALIDATED=1

SIMULATOR_NAME="T3Code-Live-${RUN_STAMP}-$$"
CREATE_ARGUMENTS=(
  simctl create
  "${SIMULATOR_NAME}"
  "${T3_SWIFT_SIMULATOR_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro}"
)
if [[ -n "${T3_SWIFT_SIMULATOR_RUNTIME:-}" ]]; then
  CREATE_ARGUMENTS+=("${T3_SWIFT_SIMULATOR_RUNTIME}")
fi
SIMULATOR_ID="$("${XCRUN_COMMAND}" "${CREATE_ARGUMENTS[@]}")" \
  || die "could not create the disposable live Simulator"

set +e
T3_SWIFT_SIMULATOR_ID="${SIMULATOR_ID}" \
T3_SWIFT_XCRUN_COMMAND="${XCRUN_COMMAND}" \
T3_SWIFT_XCODEBUILD_COMMAND="${XCODEBUILD_COMMAND}" \
T3_SWIFT_RESULT_BUNDLE_PATH="${EVIDENCE_DIR}/app-flow-live.xcresult" \
T3_APP_FLOW_PLAN=live \
T3_APP_FLOW_LIVE_CREDENTIALS_FILE="${RUN_DIR}/credentials.json" \
T3_APP_FLOW_LIVE_DISPOSABLE_SIMULATOR=1 \
"${SCRIPT_DIR}/ci-app-flow-test.sh"
RUN_STATUS=$?
set -e
if [[ "${RUN_STATUS}" -eq 0 ]]; then
  SIMULATOR_ID=""
fi

set +e
"${ADAPTER}" cleanup --manifest "${RUN_DIR}/backend.json"
CLEANUP_STATUS=$?
set -e
rm -f -- "${RUN_DIR}/credentials.json"
[[ "${RUN_STATUS}" -eq 0 ]] || die "live app-flow component failed with status ${RUN_STATUS}"
[[ "${CLEANUP_STATUS}" -eq 0 ]] || die "disposable backend cleanup failed"
BACKEND_PREPARED=0

python3 "${SCRIPT_DIR}/app-flow.py" live-backend-receipt \
  --manifest "${RUN_DIR}/backend.json" \
  --adapter "${ADAPTER}" \
  --expected-adapter-sha256 "${EXPECTED_ADAPTER_SHA256}" \
  --component-receipt "${EVIDENCE_DIR}/app-flow-live.receipt.json" \
  --cleanup-status passed \
  --output "${EVIDENCE_DIR}/live-backend.receipt.json"
cp "${RUN_DIR}/backend.json" "${EVIDENCE_DIR}/live-backend.manifest.json"

printf '[swift-ios-live] passed; evidence: %s\n' "${EVIDENCE_DIR}"
