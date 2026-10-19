## What Changed

`.devcontainer/` now produces a working, CI-matching dev environment: Ubuntu 24.04 with the Node 24, Rust, and GitHub CLI features, the global `vp` CLI installed on create, and `vp i` plus the Electron exec-bit repair and Vite dep-cache warmup on content updates (so Codespaces prebuilds bake them in). Named volumes for the pnpm store and root `node_modules` make rebuild installs take seconds and keep the heavy tree off slow macOS bind mounts. Dev ports are forwarded with pairing guidance, runtime state stays in the workspace's gitignored `.t3`, and `docs/internals/devcontainer.md` documents what works in the container and what stays host-only (windowed Electron, mobile native builds, tailnet sharing).

This PR only touches `.devcontainer/` and the two docs pages. No app code, contracts, providers, or CI workflows change.

## Why

The current `devcontainer.json` landed alongside an unrelated web styling change (0b1ce5882) and does not produce a working environment: `bun install` bypasses `vp i`, so the pnpm catalogs and the 16 patched dependencies are never applied; the node feature is a major version behind; nothing installs `vp`, so no repo script can run; there is no Rust toolchain for `native/resource-monitor`; no ports are forwarded; and everything runs as root. Rebuilding it around the documented setup (`docs/internals/scripts.md`: global `vp`, then `vp i`) is the smallest correct fix; each choice in the config carries a comment explaining it. No open issue tracks this, so this PR carries the motivation.

## Verification

All checks ran against a clean clone of this branch using the Dev Container CLI (`@devcontainers/cli` via `devcontainer up` / `exec`), on Docker 29.7.2, Apple Silicon (linux/arm64):

- Cold create on a clean clone with no pre-existing volumes: outcome success, `vp i` in 1m 27.9s, lifecycle completed through the dep-cache warmup.
- In-container toolchain probes: `vp` on PATH, Node v24.19.0, pnpm 11.10.0, rustfmt present, gh present, first-run notice rendered.
- In-container CI-parity checks: `vp run --filter @t3tools/contracts typecheck` passed; `cargo fmt --manifest-path native/resource-monitor/Cargo.toml -- --check` passed.
- Container recreate with volumes intact: `vp i` in 10.5s.
- Cache proof: after wiping only the node_modules volume, `vp i` reinstalled from the warm store volume in 58.1s (store volume held 919MB).
- Nothing user-visible changes in the product itself, so there are no UI screenshots; the container is the deliverable.

## Checklist

- [x] This PR is small and focused
- [x] I explained what changed and why
- [ ] I included before/after screenshots for any UI changes (no UI changes)
- [ ] I included a video for animation/interaction changes (no motion changes)

Implementation and verification used Claude Fable 5 in Claude Code.
