import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { test } from "vitest";

import { comparePatches, formatReport } from "./ov2-nightly-status.mjs";

test(
  "reports exact and rebased commits without matching titles or dirty files",
  async (t) => {
    const repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ov2-nightly-status-"));
    t.onTestFinished(() => NodeFS.rmSync(repo, { recursive: true, force: true }));
    const git = (...args) =>
      NodeChildProcess.execFileSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      }).trim();
    const commit = (file, content, subject) => {
      NodeFS.writeFileSync(NodePath.join(repo, file), content);
      git("add", file);
      git("commit", "-m", subject);
      return git("rev-parse", "HEAD");
    };
    git("init", "-b", "nightly");
    git("config", "user.name", "Report test");
    git("config", "user.email", "report@example.invalid");
    const original = commit("original", "included\n", "Original feature");
    const rebased = commit("rebased", "included after cherry-pick\n", "Rebased feature");
    const missing = commit("missing", "not ported\n", "Matching title");
    const manifest = {
      patches: [original, rebased, missing].map((sha) => ({
        type: "commit",
        sha,
        repository: "test/fork",
      })),
    };
    NodeFS.mkdirSync(NodePath.join(repo, ".github"));
    commit(".github/downstream-nightly.json", JSON.stringify(manifest), "Nightly manifest");
    git("checkout", "-b", "ov2", original);
    commit("ov2", "different parent\n", "OV2 base");
    git("cherry-pick", rebased);
    const rebasedTarget = git("rev-parse", "HEAD");
    NodeAssert.notEqual(rebasedTarget, rebased);
    commit("different", "unrelated change\n", "Matching title");
    NodeFS.writeFileSync(NodePath.join(repo, "missing"), "not ported\n");
    const before = git("status", "--porcelain");

    const report = await comparePatches(repo, "ov2", "nightly");
    NodeAssert.deepEqual(
      report.patches.map((patch) => patch.status),
      ["detected", "detected", "not_detected"],
    );
    NodeAssert.equal(report.patches[0].evidence, "original commit");
    NodeAssert.equal(report.patches[1].targetCommit, rebasedTarget);
    NodeAssert.equal(report.patches[1].evidence, "equivalent rebased patch");
    NodeAssert.equal(report.patches[2].targetCommit, null);
    NodeAssert.match(formatReport(report), /Detected: 2\/3\. Not detected: 1\./);
    NodeAssert.equal(git("status", "--porcelain"), before);
    NodeAssert.equal(git("branch", "--show-current"), "ov2");

    NodeFS.rmSync(NodePath.join(repo, "missing"));
    git("checkout", "nightly");
    const allIncluded = await comparePatches(repo, "nightly", "nightly");
    NodeAssert.ok(allIncluded.patches.every((patch) => patch.status === "detected"));
    manifest.patches[0].sha = "f".repeat(40);
    commit(".github/downstream-nightly.json", JSON.stringify(manifest), "Missing source pin");
    await NodeAssert.rejects(
      comparePatches(repo, "ov2", "nightly"),
      /Missing Nightly source commit/,
    );

    manifest.patches = [
      { type: "pull_request", headSha: rebased, repository: "test/fork", number: 1 },
    ];
    commit(".github/downstream-nightly.json", JSON.stringify(manifest), "PR manifest entry");
    await NodeAssert.rejects(
      comparePatches(repo, "ov2", "nightly"),
      /resolve its full commit series/,
    );
  },
);
