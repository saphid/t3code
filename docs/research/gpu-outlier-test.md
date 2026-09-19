# How the T3 GPU-outlier test works

Research note, 25 August 2026. Implementation observations below come from a
read-only inspection of the live harness on `lxso2` at
`/home/saphid/t3-perf/harness` and the provisioned Grafana JSON in
`ops/grafana-dashboards`. They are deliberately separated from claims made by
the platform owners.

## The short version

“GPU outliers” is not one synthetic GPU benchmark and it is not a statistical
anomaly detector. The harness measures the graphics cost of every user-visible
scenario inside that scenario's action window. The clearest GPU-focused
scenario, `scroll-giant-thread`, opens a large seeded conversation and drives
five seconds of alternating wheel scrolls. The dashboard then ranks scenario,
surface, fixture size, network and machine combinations by their measured GPU
cost and plots the same measurement across releases.

There are two different signals:

- **GPU busy time (`t3perf_gpu_ms_per_s`)**: milliseconds for which the app's
  Chromium GPU process was busy, normalized to one wall-clock second. On Apple
  Silicon this is derived from AGX I/O Registry counters. On a Linux host it
  comes from DRM fdinfo when the driver exports those counters, or is estimated
  from NVIDIA SM utilization when the proprietary NVIDIA path is available.
- **GPU-process CPU (`t3perf_gpu_process_cpu_ms_per_s`)**: CPU time consumed by
  Chromium's GPU helper per wall second. This is the useful rendering-cost
  proxy on headless Linux workers whose `gpu_backend` is `none`, where real
  per-process GPU attribution is unavailable and rendering falls back to
  software. A live Prometheus check during this review found AGX on the
  MacBook Pro, DRM fdinfo on `lxso2`, and `none` on `lxso1` and `lxso3`.

These values answer “which real feature and release made Chromium's graphics
path work hardest?” They do **not** directly answer power consumption, energy,
frame smoothness, or whole-machine GPU utilization.

## What the test actually does (observed implementation)

1. The runner creates an isolated web or Electron environment with a
   1440 × 900 viewport. It identifies the browser's GPU process through CDP
   `SystemInfo.getProcessInfo`; for Electron it selects the `GPU` entry from
   `app.getAppMetrics()` (`src/launch.ts`, lines 215–227, 330–360 and 479–493).
   CDP defines the returned process records as a process `type`, numeric `id`
   and cumulative CPU time; Electron likewise documents `GPU` as a process
   type in `ProcessMetric`.
2. For reused environments, the runner performs one unrecorded warm-up before
   the measured repetitions. The normal full suite records five runs per
   scenario (`src/runner.ts`, lines 107–138; `src/suites.ts`, `full.runs`).
3. Immediately around each scenario action, `MetricsWindow` starts a GPU
   sampler at a two-second interval, records the GPU-helper CPU counter on
   Linux, and records renderer counters through CDP. It stops all of them after
   the action (`src/metrics.ts`, lines 158–191 and 236–265).
4. `scroll-giant-thread` first opens the large seeded thread, puts the pointer
   over the message pane, then alternates `-600` and `+600` pixel wheel events
   with 50 ms gaps for five seconds (`src/scenarios.ts`, lines 754–769).
   Playwright specifies that `mouse.wheel` dispatches a wheel event and does
   not wait for scrolling to finish. That makes this a sustained input and
   rendering workload, rather than a sequence of scroll-and-settle steps.
5. GPU time is normalized as `appGpuMs / (measurement wallMs / 1000)`
   (`src/metrics.ts`, line 258). This makes runs of different duration
   comparable as GPU-ms/s: for example, 250 ms of attributed GPU work during a
   five-second window becomes 50 GPU-ms/s.
6. The result exporter writes a median and linearly interpolated p75 for each
   metric, with `scenario`, `surface`, `size`, `network`, `host`, `build`,
   `gpu_backend` and other labels kept separate (`src/otlpExport.ts`, lines
   61–82 and 89–152). The human report displays the median but grades the p75
   of the runs (`src/report.ts`, lines 648–687).

The scenario is representative, not exhaustive. The same metric window also
wraps GPU-heavy product paths including streaming timeline updates, terminal
output and picture-in-picture preview capture. Consequently, the GPU-outlier
dashboard is most useful as a cross-feature triage view; the scroll scenario is
the easiest controlled reproduction when an outlier needs investigation.

## How attribution works

### Why the Chromium GPU process is a sensible boundary

Chromium's own architecture describes a dedicated GPU process with raster and
compositor responsibilities, connected to browser and renderer processes.
Chromium also states that the real graphics-driver calls are made in the GPU
process. Electron inherits Chromium's multi-process model. That supports using
the typed GPU-helper PID as the app-level graphics boundary, rather than
sampling the browser root or one renderer.

Sources:

- [Chromium: Processes and Threads](https://chromium.googlesource.com/graphics-book/+/refs/heads/main/src/chrome-architecture--processes-threads.md)
- [Chromium: Debugging GPU related code](https://chromium.googlesource.com/chromium/src/+/master/docs/gpu/debugging_gpu_related_code.md)
- [Electron: Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [CDP: SystemInfo.getProcessInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/#method-getProcessInfo)
- [Electron: ProcessMetric](https://www.electronjs.org/docs/latest/api/structures/process-metric)

### Apple Silicon (`gpu_backend="agx"`)

The harness reads `AGXDeviceUserClient` entries from the macOS I/O Registry,
parses each entry's creator PID and `AppUsage.accumulatedGPUTime`, and subtracts
successive cumulative values by registry-entry ID (`src/gpu.ts`, lines 31–89).
It samples throughout the window and once at the end, then converts nanoseconds
to milliseconds (`src/gpu.ts`, lines 218–250 and 286–303).

Apple publicly documents the I/O Registry as an in-memory, dynamically updated
database of live driver objects and identifies `ioreg` as its command-line
viewer. However, the specific AGX class and the `AppUsage`,
`accumulatedGPUTime`, and `IOUserClientCreator` properties used here are **not
documented as a stable public API in the Apple material found for this
review**. The code correctly fails if `AppUsage` disappears, but the blog
should call this a measured, version-sensitive macOS implementation detail—not
an Apple-supported performance API and not “exact” without qualification.

Source: [Apple I/O Kit Fundamentals: The I/O Registry](https://developer.apple.com/library/archive/documentation/DeviceDrivers/Conceptual/IOKitFundamentals/TheRegistry/TheRegistry.html)

Known accounting limits visible in the implementation:

- a command queue created between samples contributes its cumulative value at
  the next sample;
- a queue destroyed before the next sample cannot be observed and therefore
  undercounts the app;
- work attributed to the system compositor/WindowServer is outside the app's
  GPU-process bucket, even when it was prompted by an app window;
- whole-device utilization is sampled only as ambient context and is not the
  value graphed as app GPU time.

The last two bullets are implementation interpretation. Apple’s public I/O
Registry documentation does not define those private AGX accounting fields.

### Linux DRM (`gpu_backend="drm-fdinfo"`)

The harness reads every `/proc/<gpu-pid>/fdinfo` record, sums
`drm-engine-*` nanosecond counters, and deduplicates duplicated file
descriptors by `drm-client-id` (`src/gpu.ts`, lines 131–168). The Linux kernel
specification says drivers may expose partly standardized client statistics in
fdinfo and defines `drm-engine-<keystr>` as time the engine spent busy for that
client. It also warns that this is active time, not utilization relative to the
engine's maximum frequency. Driver support is optional.

Source: [Linux kernel: DRM client usage stats](https://docs.kernel.org/gpu/drm-usage-stats.html)

### NVIDIA fallback (`gpu_backend="nvidia-smi"`)

If no DRM counters are found, the harness calls `nvidia-smi pmon -c 1 -s u`,
reads the target PID's SM percentage, and estimates GPU milliseconds over the
elapsed sample slice (`src/gpu.ts`, lines 170–198 and 253–283). NVIDIA defines
`pmon` utilization as average per-process utilization since the previous
monitoring cycle, normally at one-second frequency, and notes hardware and MIG
support limitations. Therefore this is an estimate and is not directly
equivalent in precision to cumulative DRM or AGX busy-time counters.

Source: [NVIDIA System Management Interface: Process Monitoring](https://docs.nvidia.com/deploy/nvidia-smi/index.html#process-monitoring)

### Software-rendered Linux (`gpu_backend="none"`)

With no attribution backend, `t3perf_gpu_ms_per_s` is zero by construction.
The harness instead subtracts `/proc/<pid>/stat` user and system CPU ticks for
the GPU-helper PID and normalizes that CPU time per wall second
(`src/metrics.ts`, lines 83–110 and 236–262). Do not compare this CPU proxy's
absolute value to AGX GPU busy time; compare like backend and device type, or
use it to rank Linux scenarios against each other.

## What “outlier” means in Grafana (observed implementation)

The reviewed “GPU busy per feature” bar chart originally:

- selects exported **median** series (`stat="median"`);
- finds the last sample of each release series within the dashboard range;
- collapsed releases with `max by (host, scenario, surface, size, network)`;
- sorts the result descending.

Thus each bar was the **worst release in the selected time range** for that test
combination, not necessarily the newest release and not a z-score, IQR or MAD
outlier. Prometheus defines `last_over_time` as the most recent sample in the
specified interval; the surrounding `max` is what chooses the worst release.
The “GPU busy by build” time series is the follow-up view that shows when the
step appeared.

Source: [Prometheus query functions (`last_over_time`)](https://prometheus.io/docs/prometheus/latest/querying/functions/#aggregation_over_time)

This distinction belongs in the published explanation. A good plain-language
label is “worst GPU cost seen in the selected releases,” with “outlier” treated
as a triage term rather than a statistical claim.

## Thresholds: useful heuristics, not standards

The report code explicitly labels its GPU band as derived, with no vendor
standard: good at or below 10 GPU-ms/s and poor above 100 GPU-ms/s
(`src/report.ts`, lines 411–415 and 648–663). At review time Grafana turned
orange at 10 and red at 50 while the report's poor boundary was 100. The
applied dashboard fix now shows attention at 10, investigate at 50, and poor
above 100. None is an Apple, Chromium, Electron, Linux or NVIDIA conformance
threshold.

The write-up should say:

- lower is generally better for the same scenario, surface, backend and device
  class;
- a step change across adjacent releases is stronger evidence than one large
  isolated point;
- compare AGX, DRM, NVIDIA estimates and software-rendered CPU as different
  measurement families;
- correlate GPU cost with dropped-frame and wall-time panels before claiming a
  user-visible regression;
- rerun a suspicious combination and inspect its individual samples before
  assigning a cause.

## Accuracy and presentation fixes worth making before publication

These are review findings, not descriptions of already-shipped behavior:

1. **Do not describe every `t3perf_gpu_ms_per_s` value as Apple Silicon AGX.**
   The metric supports AGX, DRM and NVIDIA. Show or filter `gpu_backend` in the
   dashboard, or describe the selected backend dynamically.
2. **Do not compare heterogeneous hosts as if they were repetitions.** Group
   analytical views by device type and retain `host` as a separate drill-down
   label. A MacBook Pro AGX result and a headless Linux CPU proxy are different
   signals.
3. **Align or explicitly distinguish 50 and 100 GPU-ms/s.** The current red
   Grafana threshold and report “poor” threshold disagree. A defensible choice
   is “investigate at 50; poor at 100,” stated in the panel and article.
4. **Expose the backend in legends/tooltips.** Without it, a zero can mean “no
   work” or “no GPU attribution,” which are radically different conclusions.
5. **Use “worst in range,” not statistical outlier.** If statistical detection
   is desired later, define a release baseline and an explicit robust rule
   (for example median absolute deviation) rather than retrofitting that claim
   onto the current maximum ranking.

## Primary sources

- Apple, [The I/O Registry](https://developer.apple.com/library/archive/documentation/DeviceDrivers/Conceptual/IOKitFundamentals/TheRegistry/TheRegistry.html)
- Chromium, [Processes and Threads](https://chromium.googlesource.com/graphics-book/+/refs/heads/main/src/chrome-architecture--processes-threads.md)
- Chromium, [Debugging GPU related code](https://chromium.googlesource.com/chromium/src/+/master/docs/gpu/debugging_gpu_related_code.md)
- Chrome DevTools Protocol, [SystemInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/)
- Chrome DevTools Protocol, [Performance](https://chromedevtools.github.io/devtools-protocol/1-3/Performance/)
- Electron, [`app.getAppMetrics()`](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)
- Electron, [`ProcessMetric`](https://www.electronjs.org/docs/latest/api/structures/process-metric)
- Electron, [Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- Linux kernel, [DRM client usage stats](https://docs.kernel.org/gpu/drm-usage-stats.html)
- NVIDIA, [`nvidia-smi` Process Monitoring](https://docs.nvidia.com/deploy/nvidia-smi/index.html#process-monitoring)
- Playwright, [`mouse.wheel`](https://playwright.dev/docs/api/class-mouse#mouse-wheel)
- Prometheus, [Query functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)
