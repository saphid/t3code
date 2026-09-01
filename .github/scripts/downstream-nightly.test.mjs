import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  applyPlan,
  fingerprintPlan,
  isCompleteMatchingRelease,
  parseManifest,
  releaseMarker,
  resolveCustomNightlyVersion,
  selectLatestNightlyRelease,
} from "./downstream-nightly.mjs";

function git(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
}

const manifest = {
  upstreamRepository: "pingdotgg/t3code",
  releaseRepository: "saphid/t3code",
  generatedBranch: "automation/downstream-nightly",
  patches: [
    {
      type: "pull_request",
      repository: "pingdotgg/t3code",
      number: 8857,
      headSha: "a".repeat(40),
    },
    {
      type: "commit",
      repository: "saphid/t3code",
      sha: "b".repeat(40),
    },
    {
      type: "ref",
      repository: "saphid/t3code",
      ref: "refs/heads/feature",
      expectedSha: "c".repeat(40),
    },
  ],
};

describe("Downstream Nightly manifest", () => {
  it("accepts pinned PR, commit, and ref entries", () => {
    assert.deepEqual(parseManifest(JSON.stringify(manifest)), manifest);
  });

  it("rejects an unpinned PR", () => {
    const unpinned = structuredClone(manifest);
    delete unpinned.patches[0].headSha;
    assert.throws(() => parseManifest(JSON.stringify(unpinned)), /full 40-character/);
  });

  it("rejects invalid release repositories", () => {
    assert.throws(
      () =>
        parseManifest(JSON.stringify({ ...manifest, releaseRepository: "https://github.com/x/y" })),
      /owner\/repository/,
    );
  });
});

describe("Downstream Nightly workflow", () => {
  it("fetches public upstream source without checkout action credential cleanup", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/downstream-nightly.yml"),
      "utf8",
    );
    const checkoutStart = workflow.indexOf("      - name: Checkout exact upstream Nightly\n");
    const checkoutEnd = workflow.indexOf("\n      - ", checkoutStart + 1);
    const checkout = workflow.slice(checkoutStart, checkoutEnd);

    assert.notEqual(checkoutStart, -1);
    assert.doesNotMatch(checkout, /uses: actions\/checkout/);
    assert.match(checkout, /git -C source fetch --no-tags --depth=1 upstream/);
    assert.match(checkout, /git -C source sparse-checkout set --no-cone/);
    assert.match(checkout, /!\/\.repos\//);
  });
});

describe("Downstream Nightly release selection", () => {
  it("selects the newest published upstream prerelease with a Nightly tag", () => {
    const selected = selectLatestNightlyRelease([
      {
        tag_name: "v1.2.3-nightly.20260830.40",
        prerelease: true,
        draft: false,
        published_at: "2026-08-30T01:00:00Z",
      },
      {
        tag_name: "v1.2.3",
        prerelease: false,
        draft: false,
        published_at: "2026-09-01T01:00:00Z",
      },
      {
        tag_name: "v1.2.4-nightly.20260831.41",
        prerelease: true,
        draft: false,
        published_at: "2026-08-31T01:00:00Z",
      },
    ]);
    assert.equal(selected.tag_name, "v1.2.4-nightly.20260831.41");
  });

  it("derives a deterministic custom version that sorts after its upstream Nightly", () => {
    const fingerprint = "0123456789abcdef".repeat(4);
    const version = resolveCustomNightlyVersion("v0.0.38-nightly.20260831.1241", fingerprint);
    assert.match(version, /^0\.0\.38-nightly\.20260831\.1241\d{6}$/);
    assert.equal(
      resolveCustomNightlyVersion("v0.0.38-nightly.20260831.1241", fingerprint),
      version,
    );
  });

  it("changes the fingerprint when patch order changes", () => {
    const first = [{ commits: ["a"] }, { commits: ["b"] }];
    const second = [...first].reverse();
    assert.notEqual(
      fingerprintPlan("v1.0.0-nightly.20260901.1", first),
      fingerprintPlan("v1.0.0-nightly.20260901.1", second),
    );
  });

  it("only treats a release as complete when all updater manifests exist", () => {
    const upstreamTag = "v1.0.0-nightly.20260901.1";
    const fingerprint = "f".repeat(64);
    const complete = {
      body: releaseMarker(upstreamTag, fingerprint),
      assets: [{ name: "nightly-linux.yml" }, { name: "nightly-mac.yml" }, { name: "nightly.yml" }],
    };
    assert.equal(isCompleteMatchingRelease(complete, upstreamTag, fingerprint), true);
    assert.equal(
      isCompleteMatchingRelease(
        { ...complete, assets: complete.assets.filter((asset) => asset.name !== "nightly.yml") },
        upstreamTag,
        fingerprint,
      ),
      false,
    );
  });
});

describe("Downstream Nightly assembly", () => {
  it("cherry-picks a pinned commit and records a versioned generated source commit", () => {
    const root = mkdtempSync(join(tmpdir(), "downstream-nightly-test-"));
    const source = join(root, "source");
    const patchRepository = join(root, "patch");

    for (const repository of [source, patchRepository]) {
      mkdirSync(repository);
      git(repository, "init", "--initial-branch=main");
      git(repository, "config", "user.name", "Test User");
      git(repository, "config", "user.email", "test@example.com");
      mkdirSync(join(repository, "apps/server"), { recursive: true });
      mkdirSync(join(repository, "apps/desktop"), { recursive: true });
      mkdirSync(join(repository, "apps/web"), { recursive: true });
      mkdirSync(join(repository, "packages/contracts"), { recursive: true });
      mkdirSync(join(repository, ".github"), { recursive: true });
      for (const packagePath of [
        "apps/server/package.json",
        "apps/desktop/package.json",
        "apps/web/package.json",
        "packages/contracts/package.json",
      ]) {
        writeFileSync(join(repository, packagePath), '{"version":"1.0.0"}\n');
      }
      writeFileSync(join(repository, "base.txt"), "base\n");
      git(repository, "add", ".");
      git(repository, "commit", "-m", "base");
    }

    writeFileSync(join(patchRepository, "selected.txt"), "selected\n");
    git(patchRepository, "add", "selected.txt");
    git(patchRepository, "commit", "-m", "selected patch");
    const patchSha = git(patchRepository, "rev-parse", "HEAD");
    const plan = {
      upstreamRepository: "pingdotgg/t3code",
      upstreamTag: "v1.0.0-nightly.20260901.1",
      upstreamUrl: "https://github.com/pingdotgg/t3code/releases/tag/example",
      releaseRepository: "saphid/t3code",
      fingerprint: "f".repeat(64),
      version: "1.0.0-nightly.20260901.1100000",
      tag: "v1.0.0-nightly.20260901.1100000",
      patches: [
        {
          repository: patchRepository,
          fetchUrl: patchRepository,
          fetchRef: patchSha,
          commits: [patchSha],
          label: "local patch",
        },
      ],
    };

    const generatedSha = applyPlan(plan, source);
    assert.equal(git(source, "rev-parse", "HEAD"), generatedSha);
    assert.equal(readFileSync(join(source, "selected.txt"), "utf8"), "selected\n");
    assert.equal(
      JSON.parse(readFileSync(join(source, "apps/desktop/package.json"), "utf8")).version,
      plan.version,
    );
    assert.deepEqual(git(source, "status", "--porcelain"), "");
  });
});
