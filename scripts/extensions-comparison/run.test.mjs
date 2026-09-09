import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("runner preserves failed driver output, real exit status and incomplete coverage", () => {
  const root = mkdtempSync(join(tmpdir(), "t3-comparison-test-"));
  try {
    const worktree = join(root, "repo");
    mkdirSync(worktree);
    const git = (...args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("-c", "user.name=Harness Test", "-c", "user.email=test@example.invalid",
      "commit", "--quiet", "--allow-empty", "-m", "baseline");
    const baseline = git("rev-parse", "HEAD");
    git("-c", "user.name=Harness Test", "-c", "user.email=test@example.invalid",
      "commit", "--quiet", "--allow-empty", "-m", "candidate");
    const candidate = git("rev-parse", "HEAD");
    const baseTree = join(root, "baseline");
    git("worktree", "add", "--quiet", "--detach", baseTree, baseline);
    const driver = join(root, "driver.mjs");
    writeFileSync(driver, 'process.stdout.write(JSON.stringify({status:"failed", error:"observable missing"})); process.stderr.write("retained driver diagnostic"); process.exitCode=7;');
    const target = { webUrl: "http://127.0.0.1:1", electronCdpUrl: "http://127.0.0.1:2", disposableState: join(root, "state") };
    const plan = join(root, "plan.json"), output = join(root, "attempt");
    writeFileSync(plan, JSON.stringify({ seed: 7, timeoutMs: 1000,
      adapterSource: driver, adapterCommand: [process.execPath, driver],
      targets: { baseline: { ...target, worktree: baseTree, sha: baseline },
        candidate: { ...target, worktree, sha: candidate } } }));
    const invoke = () => spawnSync(process.execPath, [
      fileURLToPath(new URL("./run.mjs", import.meta.url)), plan, output,
    ], { encoding: "utf8", env: { ...process.env, T3_COMPARISON_LOCKED: "1" } });
    const result = invoke();
    assert.equal(result.status, 1, result.stderr);
    const run = JSON.parse(readFileSync(join(output, "run.json"), "utf8"));
    assert.equal(run.complete, false);
    assert.equal(run.samples.length, 1);
    assert.equal(run.samples[0].exitCode, 7);
    assert.equal(readFileSync(join(output, "0.stderr.log"), "utf8"), "retained driver diagnostic");
    assert.equal(JSON.parse(readFileSync(join(output, "analysis.json"), "utf8")).status, "failed");
    const before = readFileSync(join(output, "run.json"), "utf8");
    assert.equal(invoke().status, 1);
    assert.equal(readFileSync(join(output, "run.json"), "utf8"), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
