#!/bin/bash

set -u

usage() {
  echo "usage: sweep-idle-xcode.sh [--derived-data <exact-path>] [--clones]" >&2
}

derived_data=""
clean_clones=0
release_mcp_lock=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --derived-data)
      [ "$#" -ge 2 ] || { usage; exit 64; }
      derived_data=$2
      shift 2
      ;;
    --clones)
      clean_clones=1
      shift
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

[ -n "$derived_data" ] || [ "$clean_clones" -eq 1 ] || { usage; exit 64; }

native_work_active() {
  pgrep -x xcodebuild >/dev/null 2>&1 ||
    pgrep -x xctest >/dev/null 2>&1 ||
    pgrep -x testmanagerd >/dev/null 2>&1
}

require_idle_tree() {
  target=$1
  command -v lsof >/dev/null 2>&1 || {
    echo "cleanup deferred: lsof is unavailable" >&2
    return 75
  }
  error_file=$(mktemp "${TMPDIR:-/private/tmp}/ios-hygiene-lsof.XXXXXX") || return 75
  lsof +D "$target" >/dev/null 2>"$error_file"
  lsof_status=$?
  if [ "$lsof_status" -eq 0 ]; then
    find "$error_file" -delete
    echo "cleanup deferred: open handles under $target"
    return 75
  fi
  if [ -s "$error_file" ]; then
    cat "$error_file" >&2
    find "$error_file" -delete
    echo "cleanup deferred: lsof could not verify $target" >&2
    return 75
  fi
  find "$error_file" -delete
  return 0
}

if [ -n "$derived_data" ]; then
  if [ ! -e "$derived_data" ]; then
    echo "generated DerivedData already absent: $derived_data"
  else
    canonical=$(realpath "$derived_data") || exit 64
    case "$canonical" in
      /private/tmp/t3-xcodebuildmcp.*/DerivedData|/private/var/folders/*/t3-xcodebuildmcp.*/DerivedData|"$HOME"/.t3/worktrees/*/.derivedData)
        ;;
      *)
        echo "refusing unrecognized DerivedData path: $canonical" >&2
        exit 64
        ;;
    esac
    if native_work_active; then
      echo "cleanup deferred: another xcodebuild, xctest, or testmanagerd process is active"
      exit 75
    fi
    require_idle_tree "$canonical" || exit $?
    native_work_active && {
      echo "cleanup deferred: native work started during the safety check"
      exit 75
    }
    find "$canonical" -depth -delete
    parent=${canonical%/DerivedData}
    case "$parent" in
      /private/tmp/t3-xcodebuildmcp.*|/private/var/folders/*/t3-xcodebuildmcp.*)
        [ -d "$parent" ] && [ -z "$(find "$parent" -mindepth 1 -print -quit)" ] && rmdir "$parent"
        ;;
    esac
    echo "removed generated DerivedData: $canonical"
  fi
  lock_dir="$HOME/.local/state/t3/swiftui-delivery/ios-build-hygiene.lock"
  leased_path=$(cat "$lock_dir/mcp-derived-data" 2>/dev/null || true)
  if [ -n "$leased_path" ] && [ "$leased_path" = "$derived_data" ]; then
    release_mcp_lock=1
  fi
fi

if [ "$clean_clones" -eq 1 ]; then
  clone_root="$HOME/Library/Developer/XCTestDevices"
  if [ ! -d "$clone_root" ]; then
    echo "XCTest device set absent"
  else
    command -v jq >/dev/null 2>&1 || {
      echo "XCTest clone cleanup deferred: jq is unavailable" >&2
      exit 75
    }
    if native_work_active; then
    echo "XCTest clone cleanup deferred: native test work is active"
    exit 75
    fi
    device_json=$(mktemp "${TMPDIR:-/private/tmp}/ios-hygiene-devices.XXXXXX") || exit 75
    if ! xcrun simctl --set "$clone_root" list devices -j >"$device_json"; then
    find "$device_json" -delete
    echo "XCTest clone cleanup deferred: simctl could not inspect the device set" >&2
    exit 75
    fi
    if ! clone_count=$(jq '[.devices[][]] | length' "$device_json"); then
      find "$device_json" -delete
      echo "XCTest clone cleanup deferred: jq could not read device data" >&2
      exit 75
    fi
    if ! busy_count=$(jq '[.devices[][] | select(.state != "Shutdown")] | length' "$device_json"); then
      find "$device_json" -delete
      echo "XCTest clone cleanup deferred: jq could not read device state" >&2
      exit 75
    fi
    find "$device_json" -delete
    if [ "$busy_count" -ne 0 ] || native_work_active; then
    echo "XCTest clone cleanup deferred: $busy_count clone(s) are not shut down or native work started"
    exit 75
    fi
    if [ "$clone_count" -gt 0 ]; then
    xcrun simctl --set "$clone_root" delete all || {
      echo "XCTest clone cleanup deferred: simctl delete failed" >&2
      exit 75
    }
    fi
    echo "removed idle XCTest clones through simctl: $clone_count"
  fi
fi

if [ "$release_mcp_lock" -eq 1 ]; then
  find "$HOME/.local/state/t3/swiftui-delivery/ios-build-hygiene.lock" -depth -delete
  echo "released XcodeBuildMCP hygiene lease"
fi

exit 0
