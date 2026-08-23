# Stats for nerds

The Stats for Nerds page shows what T3 Code is costing your machine right now. Open it from the
command palette ("Stats for nerds"), from Settings → General → Stats for nerds, or at
`/settings/stats`.

**Application** lists live CPU, memory, and GPU usage for every process T3 Code runs: the desktop
shell, the server, and the agents and terminals it spawns. The busiest processes appear first; the
full process tree, I/O rates, and history live on the Diagnostics page.

GPU attribution needs the desktop app and is available on macOS (Apple Silicon) and Linux. In a
browser, or when connected to a remote environment without a desktop shell, the GPU column stays
hidden.

**This Window** measures the UI you are looking at: JavaScript heap, DOM size, frame rate, and
main-thread long tasks. It is sampled only while the page is open and visible, so leaving the page
costs nothing.

**Telemetry** summarizes the local trace file — spans, failures, and slow spans — and shows where
OpenTelemetry traces and metrics are exported when a collector is configured.
