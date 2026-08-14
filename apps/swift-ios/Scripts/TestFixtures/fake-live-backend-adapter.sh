#!/usr/bin/env bash

set -euo pipefail

case "${1:-}" in
  prepare)
    [[ "${2:-}" == "--output-directory" && -n "${3:-}" ]]
    mkdir -p "${3}"
    if [[ "${T3_FAKE_BACKEND_MANIFEST_SECRET:-0}" -eq 1 ]]; then
      printf '%s\n' '{"schemaVersion":1,"disposable":true,"backendId":"fake-backend","projectName":"App Flow Regression Fixture","token":"must-not-retain"}' >"${3}/backend.json"
    else
      printf '%s\n' '{"schemaVersion":1,"disposable":true,"backendId":"fake-backend","projectName":"App Flow Regression Fixture"}' >"${3}/backend.json"
    fi
    printf '%s\n' '{"server":"https://fixture.invalid","token":"23456789ABCD"}' >"${3}/credentials.json"
    chmod 600 "${3}/credentials.json"
    ;;
  cleanup)
    [[ "${2:-}" == "--manifest" && -f "${3:-}" ]]
    if [[ -n "${T3_FAKE_BACKEND_CLEANUP_FAIL_ONCE_FILE:-}" \
      && ! -e "${T3_FAKE_BACKEND_CLEANUP_FAIL_ONCE_FILE}" ]]; then
      : >"${T3_FAKE_BACKEND_CLEANUP_FAIL_ONCE_FILE}"
      exit 9
    fi
    exit "${T3_FAKE_BACKEND_CLEANUP_STATUS:-0}"
    ;;
  *)
    exit 2
    ;;
esac
