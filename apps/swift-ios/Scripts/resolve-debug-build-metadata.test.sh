#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(mktemp -d -t t3-debug-build-metadata.XXXXXX)"
trap 'rm -rf -- "${FIXTURE_DIR}"' EXIT

fail() {
  printf 'resolve-debug-build-metadata.test: %s\n' "$*" >&2
  exit 1
}

git -C "${FIXTURE_DIR}" init -q
git -C "${FIXTURE_DIR}" config user.email test@example.com
git -C "${FIXTURE_DIR}" config user.name Test
touch "${FIXTURE_DIR}/tracked"
git -C "${FIXTURE_DIR}" add tracked
git -C "${FIXTURE_DIR}" commit -qm base
BASE_COMMIT="$(git -C "${FIXTURE_DIR}" rev-parse HEAD)"
git -C "${FIXTURE_DIR}" update-ref \
  refs/remotes/upstream/t3code/rebuild-mobile-app-swift "${BASE_COMMIT}"
git -C "${FIXTURE_DIR}" remote add upstream git@github.com:pingdotgg/t3code.git
printf 'next\n' >> "${FIXTURE_DIR}/tracked"
git -C "${FIXTURE_DIR}" commit -qam ahead

OUTPUT="$("${SCRIPT_DIR}/resolve-debug-build-metadata.sh" "${FIXTURE_DIR}")"
IFS='|' read -r COMMIT REPOSITORY BASE AHEAD BEHIND <<< "${OUTPUT}"
[[ "${COMMIT}" == "$(git -C "${FIXTURE_DIR}" rev-parse --short HEAD)" ]] || fail "wrong commit"
[[ "${REPOSITORY}" == "https://github.com/pingdotgg/t3code" ]] || fail "wrong repository URL"
[[ "${BASE}" == "upstream/t3code/rebuild-mobile-app-swift" ]] || fail "wrong default base"
[[ "${AHEAD}" == "1" && "${BEHIND}" == "0" ]] || fail "wrong distance"

printf 'dirty\n' >> "${FIXTURE_DIR}/tracked"
OUTPUT="$("${SCRIPT_DIR}/resolve-debug-build-metadata.sh" "${FIXTURE_DIR}" missing/ref)"
IFS='|' read -r COMMIT REPOSITORY BASE AHEAD BEHIND <<< "${OUTPUT}"
[[ "${COMMIT}" == *-dirty ]] || fail "dirty worktree not marked"
[[ "${BASE}" == "missing/ref" ]] || fail "explicit missing base not preserved"
[[ -z "${AHEAD}" && -z "${BEHIND}" ]] || fail "invented distance for missing base"

SHALLOW_FILE="$(git -C "${FIXTURE_DIR}" rev-parse --absolute-git-dir)/shallow"
git -C "${FIXTURE_DIR}" rev-parse HEAD > "${SHALLOW_FILE}"
OUTPUT="$("${SCRIPT_DIR}/resolve-debug-build-metadata.sh" \
  "${FIXTURE_DIR}" upstream/t3code/rebuild-mobile-app-swift)"
IFS='|' read -r COMMIT REPOSITORY BASE AHEAD BEHIND <<< "${OUTPUT}"
[[ "${BASE}" == "upstream/t3code/rebuild-mobile-app-swift" ]] || fail "lost shallow base"
[[ -z "${AHEAD}" && -z "${BEHIND}" ]] || fail "reported incomplete shallow distance"
rm -f -- "${SHALLOW_FILE}"

git -C "${FIXTURE_DIR}" remote remove upstream
git -C "${FIXTURE_DIR}" update-ref -d refs/remotes/upstream/t3code/rebuild-mobile-app-swift
OUTPUT="$("${SCRIPT_DIR}/resolve-debug-build-metadata.sh" "${FIXTURE_DIR}")"
IFS='|' read -r COMMIT REPOSITORY BASE AHEAD BEHIND <<< "${OUTPUT}"
[[ -z "${REPOSITORY}" && -z "${BASE}" ]] || fail "invented upstream metadata"
[[ -z "${AHEAD}" && -z "${BEHIND}" ]] || fail "invented no-upstream distance"

printf 'resolve-debug-build-metadata.test: passed\n'
