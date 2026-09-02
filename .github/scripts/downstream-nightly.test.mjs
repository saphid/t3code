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

  it("exposes an explicit manual repair path", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/downstream-nightly.yml"),
      "utf8",
    );

    assert.match(workflow, /force_rebuild:/);
    assert.match(workflow, /--force "\$FORCE_REBUILD"/);
  });

  it("builds and verifies an isolated fork updater identity", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/downstream-nightly.yml"),
      "utf8",
    );

    assert.match(workflow, /T3CODE_DESKTOP_DISTRIBUTION: Fork/);
    assert.match(workflow, /Verify fork macOS update identity/);
    assert.match(workflow, /com\.t3tools\.t3code\.fork-466f726b/);
    assert.match(workflow, /T3 Code \(Fork Nightly\)\.app/);
    assert.match(workflow, /packageJson\.name !== "t3code-fork-466f726b"/);
    assert.match(workflow, /--stable-mac-adhoc-signature/);
    assert.match(workflow, /codesign --verify --deep --strict/);
    assert.match(workflow, /Unexpected fork designated requirement/);
    assert.match(workflow, /--test-requirement==identifier/);
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

  it("increments past the newest fork rebuild of the same upstream Nightly", () => {
    const upstreamTag = "v0.0.38-nightly.20260831.1241";
    const previousVersion = "0.0.38-nightly.20260831.1241999998";
    const version = resolveCustomNightlyVersion(upstreamTag, "0".repeat(64), [
      {
        tag_name: `v${previousVersion}`,
        body: releaseMarker(upstreamTag, "f".repeat(64)),
      },
    ]);

    assert.equal(version, "0.0.38-nightly.20260831.1241999999");
  });

  it("reuses the newest release when it already has the selected patch stack", () => {
    const upstreamTag = "v0.0.38-nightly.20260831.1241";
    const fingerprint = "1".repeat(64);
    const existingVersion = "0.0.38-nightly.20260831.1241583174";

    assert.equal(
      resolveCustomNightlyVersion(upstreamTag, fingerprint, [
        {
          tag_name: `v${existingVersion}`,
          body: releaseMarker(upstreamTag, fingerprint),
        },
      ]),
      existingVersion,
    );
  });

  it("publishes a newer version when another stack superseded a matching release", () => {
    const upstreamTag = "v0.0.38-nightly.20260831.1241";
    const fingerprint = "2".repeat(64);
    const marker = releaseMarker(upstreamTag, fingerprint);

    assert.equal(
      resolveCustomNightlyVersion(upstreamTag, fingerprint, [
        {
          tag_name: "v0.0.38-nightly.20260831.1241999997",
          body: marker,
        },
        {
          tag_name: "v0.0.38-nightly.20260831.1241999998",
          body: releaseMarker(upstreamTag, "3".repeat(64)),
        },
      ]),
      "0.0.38-nightly.20260831.1241999999",
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
    assert.match(
      readFileSync(join(source, ".github/downstream-nightly-build.json"), "utf8"),
      new RegExp(`"commits": \\["${patchSha}"\\]`),
    );
    assert.deepEqual(git(source, "status", "--porcelain"), "");
  });
});
