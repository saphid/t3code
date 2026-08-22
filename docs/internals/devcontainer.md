# Dev container

> For maintainers. Using T3 Code? See [docs/user](../user/).

`.devcontainer/` gives you a ready-to-code Linux environment matching CI: Ubuntu 24.04, Node 24, pnpm, Rust stable, the global `vp` CLI, GitHub CLI, and docker-in-docker. Open the repo in VS Code and "Reopen in Container", or create a GitHub Codespace. Dependency install (`vp i`), the Electron exec-bit repair, and the Vite dep-cache warmup all run automatically before you attach.

## What works in the container

- The full dev stack: `vp run dev`, then open the pairing URL it prints through the forwarded web port (5733). The bare origin is useless without the pairing token. In VS Code the forwarded port is a true localhost, so the printed URL works as-is; in browser Codespaces the forwarded origin differs, and if the server rejects it, pass the forwarded origin via `T3CODE_DEV_ALLOWED_ORIGINS`.
- Everything the Linux CI jobs run: `vp check`, `vp run typecheck`, `vp run test`, `vp run build:desktop`, and the resource-monitor cargo build and tests. (`vpr` is not on PATH here; the curl installer only shims `vp`. Use `vp run <script>` or `node_modules/.bin/vpr` after install.)
- The perf harness (`packages/perf-analyzer`, once it is in your checkout) on the web surface, headless. Container setup installs its pinned Playwright Chromium whenever the package is present, and `T3_PERF_CHROME_ARGS` is preset with the flags Chromium needs inside containers. Without a GPU the harness reports `gpuBackend: "none"` and `gpuProcessCpuMs` becomes the rendering-cost signal; on Linux hosts with DRM or NVIDIA GPUs the `drm-fdinfo` and `nvidia-smi` backends work as-is. The same goes for the server perf benches next to `apps/server/integration/perfBench.integration.ts`: in-process and receipt-driven, so container numbers are stable enough to compare within the same machine class.

## State and safety

`T3CODE_HOME` points at the workspace's gitignored `.t3`, so all runtime state stays inside the container workspace, mirroring the worktree default. There is no live install to damage inside a container, but the test-data rule from AGENTS.md still holds: copy data in, never point at shared state.

## Caching

Two named volumes keep rebuilds fast and installs off the slow macOS/Windows bind mount: the pnpm store (shared across checkouts, mounted at pnpm's default path) and root `node_modules` (per-container, which covers the whole `.pnpm` virtual store since workspace packages just symlink into it). Deleting a container and recreating it reuses both, so a rebuild's `vp i` is seconds, not minutes. The host sees an empty `node_modules`; run host-side tooling inside the container. Codespaces prebuild snapshots exclude volumes, so if prebuilt codespaces become the primary workflow, drop the mounts and let the prebuild bake `node_modules` instead.

## Agent sandbox

`.devcontainer/agent-sandbox/` is an opt-in variant for running coding agents in the container (VS Code and Codespaces show a config picker). On top of the default setup it preinstalls claude (via Anthropic's devcontainer feature), codex, and opencode, persists agent config and shell history in per-container volumes, and locks egress behind a default-deny firewall: only DNS, SSH, the container subnet, GitHub's published CIDRs, and the allowlisted domains in `init-firewall.sh` get out. The firewall re-applies and self-verifies on every container start; restart the container (or re-run `sudo init-firewall.sh`) to refresh resolved IPs, and edit the domain list in that script to widen it.

Honest scope: this is a guardrail against accidental egress, wandering installs, and overly curious tools, not a hard boundary. The `vscode` user keeps sudo (devcontainer features and apt need it), so a genuinely hostile agent could disable the firewall. Hardening that away means dropping general sudo in a variant Dockerfile; do that if the sandbox ever hosts untrusted autonomous work. cursor-agent and grok are not preinstalled; the server's provider maintenance can npm-install them, but their endpoints then need adding to the allowlist. Docker-in-docker is deliberately absent here (dockerd's own iptables rules would fight the firewall); use the default container for the observability compose.

## Observability

The server already exports OTLP metrics and traces when told where to send them (off by default). With docker-in-docker available in the container, and once `packages/perf-analyzer` is in your checkout, its ready-made collector stack is one command away:

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

## CI, prebuilt images, and maintenance

`.github/workflows/devcontainer.yml` does two jobs. On PRs touching `.devcontainer/`, it builds the container and smoke-tests it from the inside (`vp --version` plus a focused typecheck), so config edits cannot silently break the environment. On pushes to main (and manual dispatch), it publishes a multi-arch prebuilt image, built natively on amd64 and arm64 runners and merged into one manifest, to `ghcr.io/<owner>/t3code-devcontainer`.

One-time setup after the first publish: the GHCR package is created private; flip it to public in the package settings so pulls and `cacheFrom` work without auth. To actually consume the prebuilt image, replace the `image` and `features` in `devcontainer.json` with just `"image": "ghcr.io/<owner>/t3code-devcontainer:latest"`; feature metadata rides along in the image label, and creation time drops to a pull. We have not made that switch in-repo because it would hard-code an owner; forks and upstream publish to different namespaces.

`.github/dependabot.yml` keeps the feature versions current (the `devcontainers` ecosystem updates features only; the base image pin is ours to bump).

Codespaces prebuilds are configured in repo settings, not files, and work with this config as-is: the heavy steps live in `onCreateCommand` and `updateContentCommand`, which prebuilds bake in. Restrict prebuilds to one region and one retained version; storage bills per region per version.
