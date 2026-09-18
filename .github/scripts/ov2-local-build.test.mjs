import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assemble, verifySource } from "./ov2-local-build.mjs";

const git = (repo, ...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function fixture(t, conflict = false) {
  const root = mkdtempSync(join(tmpdir(), "ov2-builder-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-b", "ov2");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  mkdirSync(join(repo, ".github"));
  writeFileSync(join(repo, ".github/fixture"), "tracked directory\n");
  for (const dir of ["apps/desktop", "apps/server", "apps/web", "packages/contracts"]) {
    mkdirSync(join(repo, dir), { recursive: true });
    writeFileSync(join(repo, dir, "package.json"), JSON.stringify({ version: "0.0.42" }));
  }
  writeFileSync(join(repo, "feature"), "before\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-b", "pin");
  writeFileSync(join(repo, "feature"), "our patch\n");
  git(repo, "commit", "-am", "local-only patch");
  const pin = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "ov2");
  if (conflict) {
    writeFileSync(join(repo, "feature"), "upstream change\n");
    git(repo, "commit", "-am", "upstream change");
  }
  const manifestPath = join(root, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      upstreamRepository: "test/upstream",
      upstreamBranch: "ov2",
      releaseRepository: "test/fork",
      releaseChannel: "nightly-v2",
      generatedBranch: "automation/ov2",
      patches: [{ type: "commit", repository: "test/fork", sha: pin, name: "our feature" }],
    }),
  );
  const output = join(root, "output");
  return { repo, base, pin, manifestPath, output, upstreamUrl: repo };
}

test("replays unpublished local pins without modifying a dirty caller and rejects changed source", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, "unrelated"), "keep this\n");
  const source = assemble(f);
  assert.equal(readFileSync(join(source, "feature"), "utf8"), "our patch\n");
  assert.equal(readFileSync(join(f.repo, "feature"), "utf8"), "before\n");
  assert.equal(readFileSync(join(f.repo, "unrelated"), "utf8"), "keep this\n");
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.base);
  assert.equal(git(f.repo, "config", "user.name"), "Test");
  const build = verifySource(f.output);
  assert.equal(build.distribution, "Fork");
  assert.equal(build.releaseChannel, "nightly-v2");
  const plan = JSON.parse(readFileSync(join(f.output, "plan.json")));
  assert.equal(plan.patches[0].fetchUrl, "https://github.com/test/fork.git");
  assert.deepEqual(plan.patches[0].commits, [f.pin]);
  assert.throws(() => assemble(f), /already exists/);
  writeFileSync(join(source, "feature"), "unreviewed\n");
  assert.throws(() => verifySource(f.output), /source changed/);
});

test("preserves a failed cherry-pick for inspection and never reports a ready build", (t) => {
  const f = fixture(t, true);
  assert.throws(() => assemble(f), /failed while cherry-picking/);
  const source = join(f.output, "source");
  assert.equal(git(source, "rev-parse", "CHERRY_PICK_HEAD"), f.pin);
  assert.match(git(source, "status", "--porcelain"), /UU feature/);
  assert.throws(() => readFileSync(join(f.output, "build.json")), /ENOENT/);
});
