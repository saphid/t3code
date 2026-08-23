# Distributed nightly performance fleet

The fleet benchmarks published `t3` nightlies in a pinned container and sends
comparable measurements to the shared Grafana at `https://stats.t3play.dev`.
lxso2 is the only scheduler. lxso1, lxso2, lxso3, and explicitly enrolled
developer machines are workers.

## Safety model

- The scheduler owns one SQLite database and grants one renewable lease per
  nightly. Atomic claims prevent duplicate releases. A failed worker returns
  its job to the queue, and a lost worker's lease expires after six hours.
- Registry discovery runs at scheduler startup and every three hours. Claims
  always select the greatest `published_at`, so a newly published nightly is
  the next assignment even while older releases remain queued.
- Workers reject a scheduler with a different runtime contract. The v1
  contract is Node 24, Playwright/Chromium 1.60.0, the checked-in harness, the
  web surface, and the smoke suite. Every worker runs one container at a time
  with 1 CPU, 4 GiB RAM, and 2 GiB shared memory.
- Test data is created inside the container and uploaded as JSON. It never
  reads `~/.t3`. Fleet state lives only in the dedicated paths below.
- Metrics contain no tokens or credentials. Labels are `host`, `label`
  (nightly version), `scenario`, `surface`, `size`, `network`, and `run`.

## Prerequisites

Linux workers need x86-64 Ubuntu, Docker Engine with Compose, Python 3, curl,
at least 6 GiB free disk, 4 GiB free RAM, and membership in the `docker`
group. macOS workers need Apple Silicon or Intel macOS, Docker Desktop, Python
3, 8 GiB free disk, and 4 GiB free RAM. Docker must be running during install
and while the worker is enabled.

The image build uses network access to pull the checked-in digest of
`node:24-bookworm`, install the
pinned Playwright Chromium, and later install the selected published `t3`
version. Do not enroll laptops on metered power or while doing latency-sensitive
work.

## Install or update a worker

An administrator provides a temporary copy of the binary fleet token file.
Never paste it into a shell command, issue, log, or chat. From the repository:

```bash
cd packages/perf-analyzer
./scripts/install-fleet-worker.sh \
  --scheduler http://192.168.1.221:9433 \
  --otlp http://192.168.1.221:4318 \
  --token-file /secure/path/fleet-token \
  --enable
```

Omit `--enable` to stage an optional worker without enrolling it. Add
`--no-build` when another benchmark is active and even building the image
would contaminate its measurements; build before enrollment later. Re-run the
same command to update the code and rebuild the image. On Linux, enabling or
updating a running worker restarts only `t3-perf-worker.service`; obtain the
operator's explicit confirmation first. It does not touch the legacy batch or
the observability stack.

Linux paths:

- code: `/opt/t3-perf-worker`
- credential/config: `/etc/t3-perf-worker`
- ephemeral local runs: `/var/lib/t3-perf-worker`

macOS paths:

- code: `~/.local/share/t3-perf-worker`
- credential: `~/.config/t3-perf-worker/token`
- ephemeral local runs/logs: `~/.local/state/t3-perf-worker`
- launch agent: `~/Library/LaunchAgents/dev.t3play.perf-worker.plist`

## Health checks

```bash
curl -fsS http://192.168.1.221:9433/health
sudo systemctl status t3-perf-worker.service --no-pager
sudo journalctl -u t3-perf-worker.service -n 100 --no-pager
```

On macOS, replace the last two commands with:

```bash
launchctl print "gui/$(id -u)/dev.t3play.perf-worker"
tail -100 ~/.local/state/t3-perf-worker/worker.log
```

Operators can inspect leases without exposing the token by running the
control-plane state command on lxso2:

```bash
python3 /home/saphid/t3-perf-fleet/harness/scripts/fleet-state.py \
  --scheduler http://127.0.0.1:9433 \
  --token-file /home/saphid/t3-perf-fleet/control/token
```

A healthy state has no repeated active
`version`, workers seen recently, and a registry refresh within three hours.
In Prometheus/Grafana, `t3perf_runs` must include the expected `host`, nightly
`label`, `scenario`, and `run` labels.

If a worker dies after claiming and has been stopped, an operator can recover
its leases immediately rather than waiting six hours:

```bash
python3 /home/saphid/t3-perf-fleet/harness/scripts/fleet-requeue-worker.py \
  --scheduler http://127.0.0.1:9433 \
  --token-file /home/saphid/t3-perf-fleet/control/token \
  --worker lxso1 --reason "worker stopped for repair"
```

## Stop, rollback, and uninstall

Stopping is recoverable because the lease expires or is returned on failure:

```bash
sudo systemctl stop t3-perf-worker.service
```

On macOS:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/dev.t3play.perf-worker.plist
```

To roll back, check out the previous known-good fleet commit and rerun the
installer. To uninstall code and credentials while preserving local evidence:

```bash
./scripts/install-fleet-worker.sh --uninstall
```

Add `--purge-data` only when the local run cache is no longer needed. Neither
form removes Docker images automatically, and neither touches `~/t3-perf`,
`~/t3-perf-batch`, Grafana volumes, or unrelated projects.

## Control-plane operations

lxso2 stores the scheduler under `/home/saphid/t3-perf-fleet/control` and
uploaded results under `/home/saphid/t3-perf-fleet/results`. Back up the SQLite
database with its online backup API or `VACUUM INTO`; never copy the live WAL
file alone. The bearer token is mode 0600 and must not enter Git.

Before replacing a legacy orchestrator, inventory its PID, process tree,
ledger, active version, and result counts. Import completed ledgers and hold
every version still owned by the old TSV. Stop or restart the legacy process
only after explicit confirmation. Release the holds only after its final
ledger and results have been preserved.

Capacity notes:

- lxso1 is disk constrained. Keep only the single pinned worker image and do
  not add a persistent npm cache.
- One worker per host is mandatory. Extra containers distort CPU, memory, and
  renderer measurements.
- macOS and Linux results share a schema but remain distinguishable by `host`
  and `gpu_backend`. Compare like-for-like hosts for regression decisions.
- A zero-result run is a failure, never a successful completion.
