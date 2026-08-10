#!/usr/bin/env bash

set -euo pipefail

REPOSITORY_PATH="${1:?usage: resolve-debug-build-metadata.sh REPOSITORY_PATH [BASE_REF]}"
REQUESTED_BASE_REF="${2:-}"
DEFAULT_BASE_REF="upstream/t3code/rebuild-mobile-app-swift"

git_value() {
  git -C "${REPOSITORY_PATH}" "$@" 2>/dev/null || true
}

GIT_COMMIT="$(git_value rev-parse --short HEAD)"
if [[ -n "${GIT_COMMIT}" ]] && [[ -n "$(git_value status --porcelain -- .)" ]]; then
  GIT_COMMIT="${GIT_COMMIT}-dirty"
fi

GIT_REPO_URL="$(git_value remote get-url upstream)"
if [[ -z "${GIT_REPO_URL}" ]]; then
  GIT_REPO_URL="$(git_value remote get-url origin)"
fi
GIT_REPO_URL="${GIT_REPO_URL%.git}"
case "${GIT_REPO_URL}" in
  https://*@*) GIT_REPO_URL="https://${GIT_REPO_URL#*@}" ;;
  ssh://git@*) GIT_REPO_URL="https://${GIT_REPO_URL#ssh://git@}" ;;
  git@*) GIT_REPO_URL="https://$(printf '%s' "${GIT_REPO_URL#git@}" | tr ':' '/')" ;;
esac
if [[ "${GIT_REPO_URL}" != https://github.com/* ]]; then
  GIT_REPO_URL=""
fi

GIT_BASE_REF="${REQUESTED_BASE_REF}"
if [[ -z "${GIT_BASE_REF}" ]] && \
   git -C "${REPOSITORY_PATH}" rev-parse --verify --quiet \
     "refs/remotes/${DEFAULT_BASE_REF}^{commit}" >/dev/null; then
  GIT_BASE_REF="${DEFAULT_BASE_REF}"
fi

GIT_AHEAD_COUNT=""
GIT_BEHIND_COUNT=""
IS_SHALLOW="$(git_value rev-parse --is-shallow-repository)"
if [[ -n "${GIT_BASE_REF}" ]] && [[ "${IS_SHALLOW}" != "true" ]] && \
   git -C "${REPOSITORY_PATH}" rev-parse --verify --quiet \
     "${GIT_BASE_REF}^{commit}" >/dev/null; then
  read -r GIT_BEHIND_COUNT GIT_AHEAD_COUNT < <(
    git -C "${REPOSITORY_PATH}" rev-list --left-right --count "${GIT_BASE_REF}...HEAD"
  ) || true
fi

printf '%s|%s|%s|%s|%s\n' \
  "${GIT_COMMIT}" \
  "${GIT_REPO_URL}" \
  "${GIT_BASE_REF}" \
  "${GIT_AHEAD_COUNT}" \
  "${GIT_BEHIND_COUNT}"
