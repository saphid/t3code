---
name: work-on-devcontainer
description: Change and verify this repo's devcontainer (.devcontainer/ and its agent-sandbox variant). Use when editing devcontainer config, lifecycle scripts, or the devcontainer CI workflow, when a container fails to create, or when checking the sandbox firewall or caching volumes.
---

# Work on the devcontainer

`docs/internals/devcontainer.md` is the source of truth for what the container provides; the comments in `.devcontainer/**` carry the why behind each choice (store path, guarded installs, the sandbox's missing docker-in-docker). Read the comment above anything you change before changing it. The CI workflow only runs on GitHub: merge, then trigger its `workflow_dispatch`.

## Verify every change

1. Cheap checks: `bash -n` each touched script, and parse each touched config with comments stripped:

   ```bash
   node -e "for (const p of process.argv.slice(1)) JSON.parse(require('fs').readFileSync(p,'utf8').replace(/^\s*\/\/.*$/gm,''))" \
     .devcontainer/devcontainer.json .devcontainer/agent-sandbox/devcontainer.json
   ```

2. Commit locally, then smoke in a throwaway clone; an `up` against the real checkout writes container state into the developer's working tree.

   ```bash
   git clone --branch <branch> --single-branch <repo-root> /tmp/t3dc-smoke
   npx -y @devcontainers/cli@latest up --workspace-folder /tmp/t3dc-smoke
   ```

   Run it in the background: a cold create is tens of minutes (feature downloads plus a full `vp i`); warm docker layers and volumes bring it to about a minute. Re-running lifecycle scripts needs `--remove-existing-container`. Pass = `{"outcome":"success"}` with lifecycle logs ending in `warm-dep-cache`.

3. Clean up by captured IDs: container IDs from the `up` output, volume names from `docker inspect <id> --format '{{range .Mounts}}{{.Name}} {{end}}'`, the image from `{{.Config.Image}}`. Done when those containers, volumes, and images are gone along with `/tmp/t3dc-smoke`.

## When the change touches the agent sandbox

Same smoke with `--config .devcontainer/agent-sandbox/devcontainer.json` on both commands. The firewall self-verifies during `up` (startup fails loudly when egress is open or GitHub is blocked). Then probe via `exec`: `claude`, `codex`, and `opencode` on PATH; `curl https://example.com` blocked; `curl https://api.github.com/zen` allowed.

## When the change touches mounts or caching

Volumes survive `--remove-existing-container`; prove caching by wiping only the node_modules volume and timing the reinstall: about 40s from a warm store, about 4min cold. An empty `t3code-pnpm-store` volume after an install means the mount target drifted from where `vp i` actually writes.
