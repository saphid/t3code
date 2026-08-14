#!/usr/bin/env bash
set -euo pipefail

CACHE_ROOT="${T3_SWIFT_PIPELINE_BUNDLE_ROOT:-$HOME/.t3/cache/swiftui-private-ci}"
mkdir -p "$CACHE_ROOT/reports"
export BUNDLE_APP_CONFIG="$CACHE_ROOT/config"
export BUNDLE_PATH="$CACHE_ROOT/gems"
export FASTLANE_SKIP_UPDATE_CHECK=1
export FASTLANE_OPT_OUT_USAGE=1
export FASTLANE_HIDE_GITHUB_ISSUES=1
export FASTLANE_SKIP_DOCS=1
export FL_REPORT_PATH="$CACHE_ROOT/reports"

if [[ "${1:-}" == "--install" ]]; then
  shift
  exec bundle install --jobs 4 --retry 3 "$@"
fi

exec bundle exec fastlane "$@"
