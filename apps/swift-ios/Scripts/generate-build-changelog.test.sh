#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(mktemp -d -t t3-build-changelog.XXXXXX)"
trap 'rm -rf -- "${FIXTURE_DIR}"' EXIT
fail() {
  printf 'generate-build-changelog.test: %s\n' "$*" >&2
  exit 1
}
git -C "${FIXTURE_DIR}" init -q
git -C "${FIXTURE_DIR}" config user.email test@example.com
git -C "${FIXTURE_DIR}" config user.name Test
touch "${FIXTURE_DIR}/tracked"
git -C "${FIXTURE_DIR}" add tracked
git -C "${FIXTURE_DIR}" commit -qm base
BASE_COMMIT="$(git -C "${FIXTURE_DIR}" rev-parse HEAD)"
git -C "${FIXTURE_DIR}" update-ref refs/remotes/upstream/swift-base "${BASE_COMMIT}"
git -C "${FIXTURE_DIR}" remote add upstream \
  https://secret-token@github.com/pingdotgg/t3code.git
printf 'next\n' >> "${FIXTURE_DIR}/tracked"
git -C "${FIXTURE_DIR}" add tracked
git -C "${FIXTURE_DIR}" commit -qm 'fix(swift-ios): keep drafts safe (#42)' \
  -m 'Restores the draft after reconnecting.'
OUTPUT="${FIXTURE_DIR}/changelog.json"
xcrun swift "${SCRIPT_DIR}/generate-build-changelog.swift" \
  "${FIXTURE_DIR}" upstream/swift-base "${OUTPUT}" 1.2.3 456
[[ "$(plutil -extract marketingVersion raw -o - "${OUTPUT}")" == "1.2.3" ]] \
  || fail "wrong marketing version"
[[ "$(plutil -extract buildNumber raw -o - "${OUTPUT}")" == "456" ]] \
  || fail "wrong build number"
[[ "$(plutil -extract repositoryURL raw -o - "${OUTPUT}")" == \
  "https://github.com/pingdotgg/t3code" ]] || fail "repository credentials leaked"
[[ "$(plutil -extract entries.0.title raw -o - "${OUTPUT}")" == \
  "Keep drafts safe" ]] || fail "commit title was not made user-facing"
[[ "$(plutil -extract entries.0.summary raw -o - "${OUTPUT}")" == \
  "Restores the draft after reconnecting." ]] || fail "missing summary"
[[ "$(plutil -extract entries.0.pullRequest raw -o - "${OUTPUT}")" == "42" ]] \
  || fail "missing pull request"
xcrun swift "${SCRIPT_DIR}/generate-build-changelog.swift" \
  "${FIXTURE_DIR}" missing/ref "${OUTPUT}" "" 457
[[ "$(plutil -extract buildNumber raw -o - "${OUTPUT}")" == "457" ]] \
  || fail "missing-history changelog lost build identity"
[[ "$(plutil -extract entries raw -o - "${OUTPUT}")" == "0" ]] \
  || fail "missing history invented entries"
INSTALL_SCRIPT="${SCRIPT_DIR}/install-device.sh"
bash -n "${INSTALL_SCRIPT}"
trap_line="$(grep -n '^trap cleanup EXIT$' "${INSTALL_SCRIPT}" | cut -d: -f1)"
generate_line="$(grep -n 'generate-build-changelog.swift' "${INSTALL_SCRIPT}" | cut -d: -f1)"
device_line="$(grep -n '^[[:space:]]*xcrun devicectl list devices --json-output' \
  "${INSTALL_SCRIPT}" | cut -d: -f1)"
validate_line="$(grep -n 'validate-device-build-number.sh' "${INSTALL_SCRIPT}" | cut -d: -f1)"
build_line="$(grep -n '^xcodebuild build' "${INSTALL_SCRIPT}" | cut -d: -f1)"
[[ "${trap_line}" -lt "${generate_line}" && \
   "${generate_line}" -lt "${device_line}" && \
   "${device_line}" -lt "${validate_line}" && \
   "${validate_line}" -lt "${build_line}" ]] \
  || fail "install metadata, recovery, validation, and build order changed"
grep -q 'INSTALLED_APPS_JSON' "${INSTALL_SCRIPT}" \
  || fail "installed-build cleanup was lost"
printf 'generate-build-changelog.test: passed\n'
