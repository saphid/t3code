#!/bin/bash
# Daily full perf run on the Mac (real GPU attribution), publishing to the
# shared Grafana on lxs02. Installed as a launchd agent
# (~/Library/LaunchAgents/com.t3code.perf-daily.plist).
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin"
PKG="/Users/aus-m5p-as/projects/t3code-contrib/packages/perf-analyzer"
cd "$PKG"
echo "=== daily full $(date -Is) ===" >> results/daily.log
node src/cli.ts --suite full --otlp http://192.168.1.221:4318 >> results/daily.log 2>&1
echo "=== daily done exit=$? $(date -Is) ===" >> results/daily.log
node src/report.ts >> results/daily.log 2>&1
# Keep the last 30 result files.
ls -t results/perf-*.json 2>/dev/null | tail -n +31 | sed "s/\.json$//" | xargs -I{} rm -f {}.json {}.md
