// @effect-diagnostics nodeBuiltinImport:off - runs before `vp i`, so only Node built-ins exist.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

if (!process.env.T3CODE_PROJECT_ROOT) {
  throw new Error("T3CODE_PROJECT_ROOT is not set. Run this through the t3.json setup action.");
}

// Use the same source-only default and admitted opt-in actions as saved project
// scripts. Calling this raw entrypoint must not bypass their disk reservations.
const setup = NodePath.join(NodeOS.homedir(), ".local", "bin", "t3-worktree-setup");
if (!NodeFS.existsSync(setup)) {
  throw new Error("The managed t3-worktree-setup helper must be installed before worktree setup.");
}
const worktree = NodePath.dirname(import.meta.dirname);
const child = NodeChildProcess.spawnSync(process.execPath, [setup, ...process.argv.slice(2)], {
  cwd: worktree,
  env: { ...process.env, T3CODE_WORKTREE_ROOT: worktree },
  stdio: ["ignore", "inherit", "inherit"],
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
