import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

NodeTest.test(
  "runner preserves failed driver output, real exit status and incomplete coverage",
  () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-comparison-test-"));
    try {
      const worktree = NodePath.join(root, "repo");
      NodeFS.mkdirSync(worktree);
      const git = (...args) =>
        NodeChildProcess.execFileSync("git", ["-C", worktree, ...args], {
          encoding: "utf8",
        }).trim();
      git("init", "--quiet");
      git(
        "-c",
        "user.name=Harness Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "baseline",
      );
      const baseline = git("rev-parse", "HEAD");
      git(
        "-c",
        "user.name=Harness Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "--allow-empty",
        "-m",
        "candidate",
      );
      const candidate = git("rev-parse", "HEAD");
      const baseTree = NodePath.join(root, "baseline");
      git("worktree", "add", "--quiet", "--detach", baseTree, baseline);
      const driver = NodePath.join(root, "driver.mjs");
      NodeFS.writeFileSync(
        driver,
        'process.stdout.write(JSON.stringify({status:"failed", error:"observable missing"})); process.stderr.write("retained driver diagnostic"); process.exitCode=7;',
      );
      const target = {
        webUrl: "http://127.0.0.1:1",
        electronCdpUrl: "http://127.0.0.1:2",
        disposableState: NodePath.join(root, "state"),
      };
      const plan = NodePath.join(root, "plan.json");
      let output = NodePath.join(root, "attempt");
      NodeFS.writeFileSync(
        plan,
        JSON.stringify({
          seed: 7,
          timeoutMs: 1000,
          adapterSource: driver,
          adapterCommand: [process.execPath, driver],
          targets: {
            baseline: { ...target, worktree: baseTree, sha: baseline },
            candidate: { ...target, worktree, sha: candidate },
          },
        }),
      );
      const invoke = () =>
        NodeChildProcess.spawnSync(
          process.execPath,
          [NodeURL.fileURLToPath(new URL("./run.mjs", import.meta.url)), plan, output],
          { encoding: "utf8", env: { ...process.env, T3_COMPARISON_LOCKED: "1" } },
        );
      const result = invoke();
      NodeAssert.equal(result.status, 1, result.stderr);
      const run = JSON.parse(NodeFS.readFileSync(NodePath.join(output, "run.json"), "utf8"));
      NodeAssert.equal(run.complete, false);
      NodeAssert.equal(run.samples.length, 1);
      NodeAssert.equal(run.samples[0].exitCode, 7);
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(output, "0.stderr.log"), "utf8"),
        "retained driver diagnostic",
      );
      NodeAssert.equal(
        JSON.parse(NodeFS.readFileSync(NodePath.join(output, "analysis.json"), "utf8")).status,
        "failed",
      );
      const before = NodeFS.readFileSync(NodePath.join(output, "run.json"), "utf8");
      NodeAssert.equal(invoke().status, 1);
      NodeAssert.equal(NodeFS.readFileSync(NodePath.join(output, "run.json"), "utf8"), before);
      NodeFS.writeFileSync(
        driver,
        `import { readFileSync } from "node:fs";
      const request = JSON.parse(readFileSync(0, "utf8"));
      const timing = request.phase === "timing";
      process.stdout.write(JSON.stringify({
        status: timing ? "failed" : "passed", conformanceId: 999,
      }));
      process.exitCode = timing ? 7 : 0;`,
      );
      output = NodePath.join(root, "timing-attempt");
      NodeAssert.equal(invoke().status, 1);
      const phased = JSON.parse(NodeFS.readFileSync(NodePath.join(output, "run.json"), "utf8"));
      NodeAssert.deepEqual(
        phased.samples.map((row) => row.phase),
        ["conformance", "conformance", "timing"],
      );
      NodeAssert.equal(phased.samples[2].exitCode, 7);
      NodeAssert.equal(phased.samples[2].conformanceId, 999);
      NodeAssert.equal(phased.complete, false);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
