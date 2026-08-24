# T3 performance fleet

The performance fleet benchmarks published T3 Code nightlies newest first and
reports results to the Grafana instance at `stats.t3play.dev`. The canonical
implementation lives in `packages/perf-analyzer`; do not edit deployed copies
without bringing the same change back here.

## Data contract

Every release-backed datapoint must satisfy all of these rules:

- `host` is the machine that ran the test and is a separate label.
- `label` and `build` are the npm version. Neither contains the host.
- `scenario`, `surface`, `size`, and `network` identify the test independently.
- `time_basis="release"` distinguishes release chronology from standalone runs.
- the sample timestamp is the version's authoritative npm publication time.

Grafana queries must retain `host`, `scenario`, `surface`, `size`, and
`network` through every aggregation and vector match. Otherwise an expensive
large/flaky test can be compared with a small/good test and produce a false
regression.

## Roles and live paths

- `lxso2` owns the scheduler, Prometheus, Grafana, and the legacy full-suite
  backlog orchestrator.
- `lxso1` and `lxso3` run the pinned container worker.
- the work Mac runs the Apple-Silicon suite. Its legacy series are normalized
  incrementally by `t3-perf-aus-release-remap.timer` on `lxso2`.
- canonical deployed harness: `/home/saphid/t3-perf-fleet/harness`
- scheduler state: `/home/saphid/t3-perf-fleet/control/fleet.sqlite`
- archived results: `/home/saphid/t3-perf-fleet/results`
- Grafana's mounted dashboards: `/home/saphid/t3-perf/observability/grafana/dashboards`

## Install or update a Linux worker

Build the pinned image from this package, then use the installer rather than
hand-writing a service:

```bash
cd packages/perf-analyzer
docker build -f docker/Dockerfile -t t3-perf-worker:t3perf-v1-node24-playwright1.60 .
sudo scripts/install-fleet-worker.sh \
  --scheduler http://SCHEDULER_HOST:9433 \
  --otlp http://SCHEDULER_HOST:4318 \
  --token-file /secure/path/to/fleet-token
```

Verify with `systemctl status t3-perf-worker.service`. A healthy idle worker
prints `no work`; it should not be restarted merely because the queue is empty.

## Scheduling

`fleetScheduler.ts` refreshes the npm registry every three hours and leases
`queued` jobs by `published_at DESC`. The separate
`t3-perf-nightly-check.timer` records discovery state at `00:45`, `03:45`, and
so on, so publication cadence can be audited independently.

The work-Mac normalizer runs every five minutes. It stores exported-series
fingerprints at
`/home/saphid/t3-perf-fleet/control/aus-release-remap-state.json`, so it scans
the legacy source but sends only newly discovered release series.

## Dashboard updates

Run the idempotent generator and focused test before deployment:

```bash
python3 packages/perf-analyzer/scripts/update-release-axis-dashboards.py
vp test run packages/perf-analyzer/src/grafanaDashboards.test.ts
```

Copy the generated dashboard JSON to Grafana's mounted dashboard directory.
The file provisioner reloads it without restarting Grafana.

## Backup and rollback

Before scheduler, dashboard, or metric-history changes, capture:

- a consistent SQLite backup using Python's `sqlite3.Connection.backup`;
- both deployed harness/config trees;
- the relevant systemd units;
- a gzipped `promtool tsdb dump` of `t3perf_.*` series;
- SHA-256 checksums verified with `sha256sum -c`.

Rollback code by redeploying the previous Git revision. Restore the scheduler
database only while the scheduler is stopped, and restore Prometheus samples
through OTLP/backfill rather than editing TSDB blocks. Never overwrite a live
database file in place.

## Health checks

Confirm all of the following before calling the fleet healthy:

- npm's `dist-tags.nightly` equals the newest scheduler job;
- the newest queued job is leased first;
- workers report recent heartbeats;
- every corrected series has `time_basis="release"` and a non-empty `host`;
- every corrected timestamp matches npm publication time;
- no host value appears inside `label`, `build`, or `scenario`;
- Build trends defaults to seven days and all six range queries return data.
