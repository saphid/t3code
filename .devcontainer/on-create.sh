#!/usr/bin/env bash
# One-time container setup, baked into prebuilds. Per-checkout work (vp i,
# electron repair, dep-cache warmup) lives in updateContentCommand instead.
set -euo pipefail

# The Vite+ CLI is the repo task runner (vp i, vp run dev, vp test run).
# VP_NODE_MANAGER=no skips its interactive node-manager prompt; Node comes
# from the devcontainer feature. Symlink the shims so non-login lifecycle
# shells and CI-style invocations find them without sourcing a profile.
VP_NODE_MANAGER=no bash -c "$(curl -fsSL https://vite.plus)"
sudo ln -sf "$HOME/.vite-plus/bin/"* /usr/local/bin/

# The perf harness (packages/perf-analyzer) pins playwright-core and drives a
# matching Chromium. Install it plus system deps only when the package exists,
# so the image stays lean on checkouts that predate it.
if [ -f packages/perf-analyzer/package.json ]; then
  playwright_version=$(node -p "require('./packages/perf-analyzer/package.json').dependencies['playwright-core']")
  npx -y "playwright@${playwright_version}" install --with-deps chromium
fi
