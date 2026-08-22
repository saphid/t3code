#!/bin/bash

set -u

if [ "${1:-}" != "--" ] || [ "$#" -lt 2 ]; then
  echo "usage: run-xcodebuild-clean.sh -- <xcodebuild arguments>" >&2
  exit 64
fi
shift

for argument in "$@"; do
  if [ "$argument" = "-derivedDataPath" ] ||
     [ "$argument" = "-clonedSourcePackagesDirPath" ] ||
     [ "$argument" = "-packageCachePath" ]; then
    echo "pass no private build paths; the wrapper owns DerivedData and package state" >&2
    exit 64
  fi
done

script_dir=$(cd "$(dirname "$0")" && pwd -P) || exit 1
sweep="$script_dir/sweep-idle-xcode.sh"
derived_data=$("$script_dir/new-build-lane.sh" --kind direct) || exit $?
run_root=${derived_data%/DerivedData}
source_packages="$run_root/SourcePackages"
package_cache="$run_root/PackageCache"
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
  if [ -x "$sweep" ]; then
    "$sweep" --derived-data "$derived_data" --clones
    cleanup_status=$?
    if [ "$cleanup_status" -eq 75 ]; then
      echo "XCTest clone cleanup deferred to the final finishing test" >&2
    elif [ "$cleanup_status" -ne 0 ]; then
      echo "warning: XCTest clone cleanup failed with status $cleanup_status" >&2
    fi
  fi
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

echo "isolated build roots: $derived_data ; $source_packages ; $package_cache"
TMPDIR="$run_root" xcodebuild \
  -derivedDataPath "$derived_data" \
  -clonedSourcePackagesDirPath "$source_packages" \
  -packageCachePath "$package_cache" \
  "$@" &
child_pid=$!
wait "$child_pid"
command_status=$?
child_pid=""
exit "$command_status"
