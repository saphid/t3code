#!/usr/bin/env bash
# Default-deny egress for agent sessions, modeled on the approach in
# anthropics/claude-code. Allows loopback, established flows, DNS, SSH, the
# container's own subnet (so forwarded ports and the host gateway work),
# GitHub's published CIDRs, and the resolved IPs of the domains below.
# Runs at every container start; re-run it to refresh resolved IPs.
set -euo pipefail
IFS=$'\n\t'

ALLOWED_DOMAINS=(
  # package installs and the vp toolchain
  registry.npmjs.org
  vite.plus
  registry-bridge.viteplus.dev
  # provider APIs: claude, codex, opencode
  api.anthropic.com
  statsig.anthropic.com
  sentry.io
  api.openai.com
  auth.openai.com
  chatgpt.com
  opencode.ai
  models.dev
  # T3 Connect (optional, harmless if unused)
  relay.t3.codes
)

# Start from a clean slate so re-runs converge.
iptables -F
iptables -X
ipset destroy allowed-domains 2>/dev/null || true
ipset create allowed-domains hash:net

# GitHub's IPv4 ranges (git, api, web), fetched before lockdown.
gh_ranges=$(curl -fsSL --max-time 15 https://api.github.com/meta)
for cidr in $(echo "$gh_ranges" | jq -r '(.git + .api + .web)[]' | grep -v ':'); do
  ipset add allowed-domains "$cidr" -exist
done

for domain in "${ALLOWED_DOMAINS[@]}"; do
  ips=$(dig +short A "$domain" | grep -E '^[0-9]+\.' || true)
  if [ -z "$ips" ]; then
    echo "WARN: $domain did not resolve; skipping" >&2
    continue
  fi
  for ip in $ips; do
    ipset add allowed-domains "$ip" -exist
  done
done

# The container subnet covers the docker gateway, which is where forwarded
# ports and host traffic come from.
subnet=$(ip -4 route show dev eth0 | awk '/proto kernel/ {print $1; exit}')

iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
if [ -n "$subnet" ]; then
  iptables -A INPUT -s "$subnet" -j ACCEPT
  iptables -A OUTPUT -d "$subnet" -j ACCEPT
fi
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Self-verify, loudly: an unlisted domain must fail, an allowed one must work.
if curl -fsS --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "FAIL: firewall did not block example.com" >&2
  exit 1
fi
if ! curl -fsS --max-time 15 https://api.github.com/zen >/dev/null; then
  echo "FAIL: firewall blocked api.github.com, which should be allowed" >&2
  exit 1
fi
echo "Egress firewall active: default deny, $(ipset list allowed-domains | grep -c '^[0-9]') allowed entries."
