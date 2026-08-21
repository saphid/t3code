# Dev container

> For maintainers. Using T3 Code? See [docs/user](../user/).

`.devcontainer/` gives you a ready-to-code Linux environment matching CI: Ubuntu 24.04, Node 24, pnpm, Rust stable, the global `vp` CLI, GitHub CLI, and docker-in-docker. Open the repo in VS Code and "Reopen in Container", or create a GitHub Codespace. Dependency install (`vp i`), the Electron exec-bit repair, and the Vite dep-cache warmup all run automatically before you attach.

## What works in the container

- The full dev stack: `vp run dev`, then open the pairing URL it prints through the forwarded web port (5733). The bare origin is useless without the pairing token.
- Everything the Linux CI jobs run: `vp check`, `vpr typecheck`, `vp run test`, `vp run build:desktop`, and the resource-monitor cargo build and tests.
- The server perf benches in `apps/server/integration/` (`cd apps/server && vp test run integration/<name>.integration.test.ts`). They are in-process and receipt-driven, so container numbers are stable enough to compare within the same machine class.
- The perf harness (`packages/perf-analyzer`) on the web surface, headless. Container setup installs its pinned Playwright Chromium when the package is present, and `T3_PERF_CHROME_ARGS` is preset with the flags Chromium needs inside containers. Without a GPU the harness reports `gpuBackend: "none"` and `gpuProcessCpuMs` becomes the rendering-cost signal; on Linux hosts with DRM or NVIDIA GPUs the `drm-fdinfo` and `nvidia-smi` backends work as-is.

## State and safety

`T3CODE_HOME` points at the workspace's gitignored `.t3`, so all runtime state stays inside the container workspace, mirroring the worktree default. There is no live install to damage inside a container, but the test-data rule from AGENTS.md still holds: copy data in, never point at shared state.

## Observability

The server already exports OTLP metrics and traces when told where to send them (off by default). With docker-in-docker available in the container, the ready-made collector stack from the perf harness is one command away:

```bash
docker compose -f packages/perf-analyzer/observability/docker-compose.yml up -d
export T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics
export T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces
vp run dev
```

Grafana lands on the forwarded port 3000 with the dashboards already provisioned. The perf harness feeds the same collector with `--otlp http://localhost:4318`, and `otlpBackfill.ts` imports on-disk result directories after the fact. If the compose stack is more than you need, the no-stack path still works: results land as self-contained JSON, markdown, and `report.html` under the harness's results directories.

## Out of scope

- Windowed Electron development is host-only. Building and verifying the desktop bundle works fine in the container (CI does exactly that, headless); launching the app needs a display.
- Mobile native builds are host-only (Xcode for iOS, Android SDK for Android). Typecheck, lint, and the mobile static checks run fine.
- `vp run dev --share` needs a tailscale binary and a tailnet; not provisioned here.

## Prebuilds

Container creation from scratch does a full `vp i` plus toolchain installs, which is worth prebuilding. Codespaces prebuilds pick this config up as-is (the heavy steps are in `onCreateCommand` and `updateContentCommand`, which prebuilds bake in). Outside Codespaces, the Dev Container CLI can push a prebuilt image:

```bash
devcontainer build --workspace-folder . --push true --image-name <registry>/t3code-devcontainer:latest
```
