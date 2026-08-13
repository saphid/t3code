#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "-version" ]]; then
  printf 'Fake Xcode 1.0\nBuild version FAKE1\n'
  exit 0
fi

if [[ -n "${T3_FAKE_ARGUMENT_LOG:-}" ]]; then
  printf '%s\n' "$@" >>"${T3_FAKE_ARGUMENT_LOG}"
fi

RESULT=""
PRODUCTS=""
ACTION=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "build-for-testing" || "$1" == "test-without-building" ]]; then
    ACTION="$1"
    shift
  elif [[ "$1" == "-resultBundlePath" ]]; then
    RESULT="$2"
    shift 2
  elif [[ "$1" == "-testProductsPath" ]]; then
    PRODUCTS="$2"
    shift 2
  else
    shift
  fi
done

[[ -n "${ACTION}" && -n "${PRODUCTS}" ]]
if [[ "${ACTION}" == "build-for-testing" ]]; then
  APP="${PRODUCTS}/Products/T3Code.app"
  TEST_BUNDLE="${PRODUCTS}/Products/T3CodeUITests.xctest"
  UNIT_TEST_BUNDLE="${PRODUCTS}/Products/T3CodeTests.xctest"
  mkdir -p "${APP}"
  mkdir -p "${TEST_BUNDLE}"
  mkdir -p "${UNIT_TEST_BUNDLE}"
  plutil -create xml1 "${APP}/Info.plist"
  plutil -insert CFBundleIdentifier -string com.t3tools.t3code.swiftui.dev "${APP}/Info.plist"
  printf 'fake app executable\n' >"${APP}/T3Code"
  printf 'fake UI test executable\n' >"${TEST_BUNDLE}/T3CodeUITests"
  printf 'fake unit test executable\n' >"${UNIT_TEST_BUNDLE}/T3CodeTests"
  exit 0
fi

[[ -n "${RESULT}" ]]
if [[ -n "${T3_FAKE_APP_CONTAINER:-}" ]]; then
  rm -f -- "${T3_FAKE_APP_CONTAINER}/Library/Caches/.t3-app-flow-credentials.json"
fi
mkdir -p "${RESULT}"
if [[ "${T3_FAKE_LEAK:-0}" == "1" ]]; then
  printf '23456789ABCD\n' >"${RESULT}/diagnostic.txt"
elif [[ "${T3_FAKE_SERVER_LEAK:-0}" == "1" ]]; then
  printf 'http://127.0.0.1:3773\n' >"${RESULT}/diagnostic.txt"
else
  printf 'safe evidence\n' >"${RESULT}/diagnostic.txt"
fi
if [[ "${T3_FAKE_SCAN_ERROR:-0}" == "1" ]]; then
  mkdir -p "${RESULT}/unreadable"
  printf 'scan me\n' >"${RESULT}/unreadable/data"
  chmod 000 "${RESULT}/unreadable/data"
fi
exit "${T3_FAKE_XCODE_STATUS:-0}"
