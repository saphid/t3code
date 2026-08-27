#!/bin/bash
# Container entrypoint: npm-installs the requested t3 release, then execs the
# perf CLI against either the web build or the packaged Linux Electron app.
#
# Env knobs:
#   T3_VERSION  npm version or dist-tag of the t3 package (default: nightly)
#   SCENARIOS   comma-separated scenario names (default: all non-heavy)
#   SIZES       small,large (default: small)
#   RUNS        measured runs per scenario (default: 5)
#   LABEL       result label (default: the resolved t3 version)
#   BUILD       build id for the per-build dashboard axis (default: the
#               resolved t3 version, so nightlies chart as themselves)
#
# `--manifest PATH` selects the isolated manifest-v2 adapter. Every other
# argument remains on the legacy CLI path unchanged.
set -euo pipefail

version="${T3_VERSION:-nightly}"
mkdir -p /release
cd /release
npm install --no-audit --no-fund --loglevel=error "t3@${version}"
resolved="$(node -p "require('/release/node_modules/t3/package.json').version")"
echo "[t3-perf] benchmarking t3@${resolved}"

export T3_PERF_SERVER_BIN=/release/node_modules/t3/dist/bin.mjs
chrome_bins=(/ms-playwright/chromium-*/chrome-linux*/chrome)
export T3_PERF_CHROME="${chrome_bins[0]}"
# Chromium's sandbox cannot start in an unprivileged container, and the
# default 64MB /dev/shm is too small for a renderer.
export T3_PERF_CHROME_ARGS="${T3_PERF_CHROME_ARGS:---no-sandbox --disable-dev-shm-usage}"

if [ "${1:-}" = "--manifest" ]; then
  [ "$#" -eq 2 ] || { echo "manifest mode requires exactly --manifest PATH" >&2; exit 2; }
  surface="$(node -e 'const m=require(process.argv[1]); process.stdout.write(String(m.surface))' "$2")"
  if [ "$surface" = "desktop" ]; then
    desktop_path="/tmp/T3-Code-${resolved}-x86_64.AppImage"
    export T3_PERF_DESKTOP_SHA512
    T3_PERF_DESKTOP_SHA512="$(node /harness/src/desktopArtifact.ts --version "$resolved" --out "$desktop_path")"
    export T3_PERF_DESKTOP_BIN="$desktop_path"
    export APPIMAGE_EXTRACT_AND_RUN=1
    exec xvfb-run -a -s "-screen 0 1440x900x24 -nolisten tcp" \
      node /harness/src/manifestAdapter.ts --manifest "$2" --out /results
  fi
  [ "$surface" = "web" ] || { echo "unsupported manifest surface: $surface" >&2; exit 78; }
  exec node /harness/src/manifestAdapter.ts --manifest "$2" --out /results
fi

args=(--surface web --headless --size "${SIZES:-small}" --runs "${RUNS:-5}" --label "${LABEL:-${resolved}}" --build "${BUILD:-${resolved}}" --out /results)
if [ -n "${RUN_ID:-}" ]; then
  args+=(--run-id "${RUN_ID}")
fi
if [ -n "${SCENARIOS:-}" ]; then
  args+=(--scenario "${SCENARIOS}")
fi
exec node /harness/src/cli.ts "${args[@]}" "$@"
