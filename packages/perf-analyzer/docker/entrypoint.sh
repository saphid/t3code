#!/bin/bash
# Container entrypoint: npm-installs the requested t3 release, then execs the
# perf CLI headless on the web surface (the only surface a container has).
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
# Any docker-run arguments are appended to the CLI verbatim (e.g. --heavy).
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

args=(--surface web --headless --size "${SIZES:-small}" --runs "${RUNS:-5}" --label "${LABEL:-${resolved}}" --build "${BUILD:-${resolved}}" --out /results)
if [ -n "${SCENARIOS:-}" ]; then
  args+=(--scenario "${SCENARIOS}")
fi
exec node /harness/src/cli.ts "${args[@]}" "$@"
