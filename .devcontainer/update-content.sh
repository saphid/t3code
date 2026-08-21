#!/usr/bin/env bash
# Runs at creation and on every prebuild content refresh, so codespaces start
# with deps installed and caches warm. Everything here is idempotent.
set -euo pipefail

vp i
# Repairs electron's path.txt and exec bits after install, same as CI.
vp run --filter @t3tools/desktop ensure:electron
# Pre-warms Vite's dep optimizer (cache is keyed on the absolute path, which
# is stable inside the container).
node apps/web/scripts/warm-dep-cache.ts

# The perf harness (packages/perf-analyzer) pins playwright-core and drives a
# matching Chromium. Lives here rather than on-create so the browser appears,
# and tracks version bumps, as soon as the package does. Cached, so re-runs
# are cheap no-ops.
if [ -f packages/perf-analyzer/package.json ]; then
  playwright_version=$(node -p "require('./packages/perf-analyzer/package.json').dependencies['playwright-core']")
  npx -y "playwright@${playwright_version}" install --with-deps chromium
fi
