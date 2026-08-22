#!/bin/bash

set -u

usage() {
  echo "usage: sweep-idle-xcode.sh [--derived-data <exact-path>] [--clones]" >&2
}

derived_data=""
clean_clones=0
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

clone_work_active() {
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
    case "$derived_data" in
      /private/tmp/t3-xcodebuildmcp.*/DerivedData|/private/var/folders/*/t3-xcodebuildmcp.*/DerivedData|/private/tmp/t3-xcodebuild.*/DerivedData|/private/var/folders/*/t3-xcodebuild.*/DerivedData|"$HOME"/.t3/worktrees/*/.derivedData)
        ;;
      *)
        echo "refusing unrecognized absent DerivedData path: $derived_data" >&2
        exit 64
        ;;
    esac
    parent=${derived_data%/DerivedData}
    state_root=${T3_IOS_BUILD_STATE_ROOT:-"$HOME/.local/state/t3/swiftui-delivery"}
    capacity_root="$state_root/ios-build-capacity"
    matched_slot=""
    if [ -d "$capacity_root" ]; then
      canonical_capacity=$(realpath "$capacity_root") || exit 75
      for candidate in "$canonical_capacity"/slot-[1-8].lock; do
        [ -d "$candidate" ] || continue
        expected=$(cat "$candidate/run-root" 2>/dev/null || true)
        if [ "$expected" = "$parent" ]; then
          [ -z "$matched_slot" ] || {
            echo "cleanup deferred: several slots claim $parent" >&2
            exit 75
          }
          matched_slot=$candidate
        fi
      done
    fi
    if [ -n "$matched_slot" ]; then
      for entry in "$matched_slot"/*; do
        [ -e "$entry" ] || continue
        case "${entry##*/}" in
          allocator-pid|state|run-root|kind) ;;
          *)
            echo "cleanup deferred: build slot contains unexpected files" >&2
            exit 75
            ;;
        esac
      done
      if [ -d "$parent" ]; then
        reciprocal=$(cat "$parent/hygiene-slot" 2>/dev/null || true)
        [ -n "$reciprocal" ] && reciprocal=$(realpath "$reciprocal" 2>/dev/null || true)
        [ "$reciprocal" = "$matched_slot" ] || {
          echo "cleanup deferred: partial build tree has no reciprocal slot" >&2
          exit 75
        }
        require_idle_tree "$parent" || exit $?
        find "$parent" -depth -delete
      fi
      find "$matched_slot" -depth -delete
      echo "removed partial isolated build state: $parent"
    else
      echo "generated DerivedData and reciprocal slot already absent: $derived_data"
    fi
  else
    canonical=$(realpath "$derived_data") || exit 64
    case "$canonical" in
      /private/tmp/t3-xcodebuildmcp.*/DerivedData|/private/var/folders/*/t3-xcodebuildmcp.*/DerivedData|/private/tmp/t3-xcodebuild.*/DerivedData|/private/var/folders/*/t3-xcodebuild.*/DerivedData|"$HOME"/.t3/worktrees/*/.derivedData)
        ;;
      *)
        echo "refusing unrecognized DerivedData path: $canonical" >&2
        exit 64
        ;;
    esac
    case "$canonical" in
      "$HOME"/.t3/worktrees/*/.derivedData)
        require_idle_tree "$canonical" || exit $?
        find "$canonical" -depth -delete
        echo "removed generated worktree DerivedData: $canonical"
        ;;
      *)
        parent=${canonical%/DerivedData}
        require_idle_tree "$parent" || exit $?
        slot_dir=$(cat "$parent/hygiene-slot" 2>/dev/null || true)
        state_root=${T3_IOS_BUILD_STATE_ROOT:-"$HOME/.local/state/t3/swiftui-delivery"}
        if [ -z "$slot_dir" ]; then
          capacity_root="$state_root/ios-build-capacity"
          [ -d "$capacity_root" ] || {
            echo "cleanup deferred: build tree has no reciprocal capacity root" >&2
            exit 75
          }
          canonical_capacity=$(realpath "$capacity_root") || exit 75
          for candidate in "$canonical_capacity"/slot-[1-8].lock; do
            [ -d "$candidate" ] || continue
            expected=$(cat "$candidate/run-root" 2>/dev/null || true)
            [ -n "$expected" ] && expected=$(realpath "$expected" 2>/dev/null || true)
            if [ "$expected" = "$parent" ]; then
              [ -z "$slot_dir" ] || {
                echo "cleanup deferred: several slots claim $parent" >&2
                exit 75
              }
              slot_dir=$candidate
            fi
          done
          [ -n "$slot_dir" ] || {
            echo "cleanup deferred: build tree has no reciprocal slot" >&2
            exit 75
          }
        fi
        if [ -n "$slot_dir" ]; then
          [ -d "$slot_dir" ] || {
            echo "cleanup deferred: recorded build slot is absent" >&2
            exit 75
          }
          capacity_root=$(realpath "$state_root/ios-build-capacity") || exit 75
          canonical_slot=$(realpath "$slot_dir") || exit 75
          case "$canonical_slot" in
            "$capacity_root"/slot-[1-8].lock) ;;
            *)
              echo "cleanup deferred: build slot is outside the capacity root" >&2
              exit 75
              ;;
          esac
          expected=$(cat "$canonical_slot/run-root" 2>/dev/null || true)
          [ -n "$expected" ] && expected=$(realpath "$expected" 2>/dev/null || true)
          if [ "$expected" != "$parent" ]; then
            echo "cleanup deferred: build slot does not match $parent" >&2
            exit 75
          fi
          slot_dir=$canonical_slot
        fi
        find "$parent" -depth -delete
        if [ -n "$slot_dir" ] && [ -d "$slot_dir" ]; then
          find "$slot_dir" -depth -delete
        fi
        echo "removed isolated build tree: $parent"
        ;;
    esac
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
    if clone_work_active; then
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
    if [ "$busy_count" -ne 0 ] || clone_work_active; then
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

exit 0
