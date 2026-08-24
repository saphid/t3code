#!/usr/bin/env bash
set -euo pipefail

work_dir="$(mktemp -d /tmp/t3perf-aus-remap.XXXXXX)"
trap 'rm -rf -- "$work_dir"' EXIT

curl --fail --silent --show-error \
  https://registry.npmjs.org/t3 \
  --output "$work_dir/npm-t3-packument.json"

docker exec observability-prometheus-1 \
  promtool tsdb dump \
  --match='{__name__=~"t3perf_.*",host="AUS-M5P-AS",time_basis!="release"}' \
  /prometheus \
  | gzip > "$work_dir/prometheus-aus.txt.gz"

python3 /home/saphid/t3-perf-fleet/harness/scripts/prometheus-release-remap.py \
  --dump-gzip "$work_dir/prometheus-aus.txt.gz" \
  --registry-json "$work_dir/npm-t3-packument.json" \
  --host AUS-M5P-AS \
  --otlp http://127.0.0.1:4318 \
  --state-file /home/saphid/t3-perf-fleet/control/aus-release-remap-state.json
