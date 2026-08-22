#!/usr/bin/env bash
# One-time sandbox setup: firewall tooling, agent CLIs, persistent history.
# claude comes from its devcontainer feature; cursor-agent and grok are not
# preinstalled (install on demand, or let the server's provider maintenance
# npm-install them).
set -euo pipefail

sudo apt-get update
sudo apt-get install -y --no-install-recommends iptables ipset dnsutils jq
sudo install -m 0755 .devcontainer/agent-sandbox/init-firewall.sh /usr/local/bin/init-firewall.sh

# Best-effort with one retry: a rename or registry hiccup should not brick
# container creation, the server can install providers on demand later.
for pkg in @openai/codex opencode-ai; do
  npm install -g "$pkg" || npm install -g "$pkg" ||
    echo "WARN: could not preinstall $pkg" >&2
done

# Volumes arrive root-owned.
sudo chown "$(id -un):$(id -gn)" /commandhistory "$HOME/.claude"

# Persist shell history across rebuilds via the /commandhistory volume.
if ! grep -q commandhistory "$HOME/.bashrc"; then
  printf '%s\n' 'export PROMPT_COMMAND="history -a"' \
    'export HISTFILE=/commandhistory/.bash_history' >>"$HOME/.bashrc"
fi
