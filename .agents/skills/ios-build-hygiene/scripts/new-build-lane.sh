#!/bin/bash

set -u

usage() {
  echo "usage: new-build-lane.sh --kind <direct|mcp>" >&2
}

[ "${1:-}" = "--kind" ] && [ "$#" -eq 2 ] || { usage; exit 64; }
kind=$2
case "$kind" in
  direct) prefix=t3-xcodebuild ;;
  mcp) prefix=t3-xcodebuildmcp ;;
  *) usage; exit 64 ;;
esac

state_root=${T3_IOS_BUILD_STATE_ROOT:-"$HOME/.local/state/t3/swiftui-delivery"}
capacity_root="$state_root/ios-build-capacity"
mkdir -p "$capacity_root" || exit 1
capacity=${T3_IOS_BUILD_CAPACITY:-2}
case "$capacity" in
  ''|*[!0-9]*) echo "T3_IOS_BUILD_CAPACITY must be an integer from 1 to 8" >&2; exit 64 ;;
esac
[ "$capacity" -ge 1 ] && [ "$capacity" -le 8 ] || {
  echo "T3_IOS_BUILD_CAPACITY must be an integer from 1 to 8" >&2
  exit 64
}

reclaim_interrupted_allocation() {
  candidate=$1
  [ -d "$candidate" ] || return 0
  [ ! -e "$candidate/run-root" ] || return 0
  state=$(cat "$candidate/state" 2>/dev/null || true)
  allocator=$(cat "$candidate/allocator-pid" 2>/dev/null || true)
  if [ "$state" = "allocating" ] && [ -n "$allocator" ] &&
     ! kill -0 "$allocator" 2>/dev/null; then
    find "$candidate" -depth -delete
    return 0
  fi
  if [ -z "$allocator" ]; then
    now=$(date +%s)
    modified=$(stat -f %m "$candidate") || return 0
    if [ $((now - modified)) -ge 60 ]; then
      find "$candidate" -depth -delete
    fi
  fi
}

slot_dir=""
slot=1
while [ "$slot" -le "$capacity" ]; do
  candidate="$capacity_root/slot-$slot.lock"
  reclaim_interrupted_allocation "$candidate"
  if mkdir "$candidate" 2>/dev/null; then
    slot_dir=$candidate
    printf '%s\n' "$$" >"$slot_dir/allocator-pid" || exit 1
    printf '%s\n' "allocating" >"$slot_dir/state" || exit 1
    break
  fi
  slot=$((slot + 1))
done

if [ -z "$slot_dir" ]; then
  echo "native build deferred: all $capacity isolated build slots are active" >&2
  exit 75
fi

rollback() {
  [ -n "${run_root:-}" ] && [ -d "$run_root" ] && find "$run_root" -depth -delete
  [ -d "$slot_dir" ] && find "$slot_dir" -depth -delete
}
trap rollback EXIT INT TERM HUP

temp_base=${TMPDIR:-/private/tmp}
run_root=$(mktemp -d "${temp_base%/}/$prefix.XXXXXX") || exit 1
run_root=$(realpath "$run_root") || exit 1
derived_data="$run_root/DerivedData"
source_packages="$run_root/SourcePackages"
package_cache="$run_root/PackageCache"
mkdir -p "$derived_data" "$source_packages" "$package_cache" || exit 1
printf '%s\n' "$slot_dir" >"$run_root/hygiene-slot"
printf '%s\n' "$run_root" >"$slot_dir/run-root"
printf '%s\n' "$kind" >"$slot_dir/kind"
printf '%s\n' "active" >"$slot_dir/state"

trap - EXIT INT TERM HUP
printf '%s\n' "$derived_data"
