#!/bin/bash

set -u

lock_parent="$HOME/.local/state/t3/swiftui-delivery"
lock_dir="$lock_parent/ios-build-hygiene.lock"
mkdir -p "$lock_parent" || exit 1
if ! mkdir "$lock_dir" 2>/dev/null; then
  existing=$(cat "$lock_dir/mcp-derived-data" 2>/dev/null || true)
  if [ -n "$existing" ] && [ -e "$existing" ]; then
    echo "native build deferred: XcodeBuildMCP lease owns $existing" >&2
    exit 75
  fi
  owner_pid=$(cat "$lock_dir/owner-pid" 2>/dev/null || true)
  case "$owner_pid" in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$owner_pid" 2>/dev/null; then
        echo "native build deferred: direct xcodebuild lease is active" >&2
        exit 75
      fi
      ;;
  esac
  find "$lock_dir" -depth -delete 2>/dev/null || exit 75
  mkdir "$lock_dir" 2>/dev/null || exit 75
fi

temp_base=${TMPDIR:-/private/tmp}
run_root=$(mktemp -d "${temp_base%/}/t3-xcodebuildmcp.XXXXXX") || {
  find "$lock_dir" -depth -delete
  exit 1
}
run_root=$(realpath "$run_root") || {
  find "$lock_dir" -depth -delete
  exit 1
}
derived_data="$run_root/DerivedData"
mkdir -p "$derived_data" || {
  find "$run_root" -depth -delete
  find "$lock_dir" -depth -delete
  exit 1
}
printf '%s\n' "$derived_data" >"$lock_dir/mcp-derived-data"
printf '%s\n' "$derived_data"
