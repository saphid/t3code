#!/bin/bash

set -u

if [ "${1:-}" != "--" ] || [ "$#" -lt 2 ]; then
  echo "usage: run-xcodebuild-clean.sh -- <xcodebuild arguments>" >&2
  exit 64
fi
shift

for argument in "$@"; do
  if [ "$argument" = "-derivedDataPath" ]; then
    echo "pass no -derivedDataPath; the wrapper owns its temporary path" >&2
    exit 64
  fi
done

script_dir=$(cd "$(dirname "$0")" && pwd -P) || exit 1
sweep="$script_dir/sweep-idle-xcode.sh"
lock_parent="$HOME/.local/state/t3/swiftui-delivery"
lock_dir="$lock_parent/ios-build-hygiene.lock"
mkdir -p "$lock_parent" || exit 1

acquire_lock() {
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$lock_dir/owner-pid"
    return 0
  fi
  leased_path=$(cat "$lock_dir/mcp-derived-data" 2>/dev/null || true)
  if [ -n "$leased_path" ] && [ -e "$leased_path" ]; then
    echo "native build deferred: an XcodeBuildMCP hygiene lease is active"
    return 75
  fi
  owner_pid=$(cat "$lock_dir/owner-pid" 2>/dev/null || true)
  case "$owner_pid" in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$owner_pid" 2>/dev/null; then
        echo "native build deferred: hygiene lock is owned by pid $owner_pid"
        return 75
      fi
      ;;
  esac
  find "$lock_dir" -depth -delete 2>/dev/null || return 75
  mkdir "$lock_dir" 2>/dev/null || return 75
  printf '%s\n' "$$" >"$lock_dir/owner-pid"
}

acquire_lock || exit $?

temp_base=${TMPDIR:-/private/tmp}
run_root=$(mktemp -d "${temp_base%/}/t3-xcodebuild.XXXXXX") || {
  find "$lock_dir" -depth -delete
  exit 1
}
run_root=$(realpath "$run_root") || exit 1
derived_data="$run_root/DerivedData"
mkdir -p "$derived_data"
child_pid=""

# Invoked by the EXIT trap below.
# shellcheck disable=SC2329
cleanup() {
  command_status=$?
  trap - EXIT INT TERM HUP
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  case "$run_root" in
    /private/tmp/t3-xcodebuild.*|/private/var/folders/*/t3-xcodebuild.*)
      [ -d "$run_root" ] && find "$run_root" -depth -delete
      ;;
    *)
      echo "warning: refusing unexpected private run path: $run_root" >&2
      ;;
  esac
  if [ -x "$sweep" ]; then
    "$sweep" --clones
    cleanup_status=$?
    if [ "$cleanup_status" -eq 75 ]; then
      echo "XCTest clone cleanup deferred to the final finishing test" >&2
    elif [ "$cleanup_status" -ne 0 ]; then
      echo "warning: XCTest clone cleanup failed with status $cleanup_status" >&2
    fi
  fi
  [ -d "$lock_dir" ] && find "$lock_dir" -depth -delete
  exit "$command_status"
}

# Invoked by signal traps below.
# shellcheck disable=SC2329
forward_signal() {
  signal=$1
  code=$2
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -s "$signal" "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    child_pid=""
  fi
  exit "$code"
}

trap cleanup EXIT
trap 'forward_signal INT 130' INT
trap 'forward_signal TERM 143' TERM
trap 'forward_signal HUP 129' HUP

echo "isolated DerivedData: $derived_data"
TMPDIR="$run_root" xcodebuild -derivedDataPath "$derived_data" "$@" &
child_pid=$!
wait "$child_pid"
command_status=$?
child_pid=""
exit "$command_status"
