import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizePathCase,
  validateManifest,
  validatePersonalTeamDebugSigning,
} from "./verify-project-isolation.mjs";

const approved = JSON.parse(
  readFileSync("config/t3code-typed-swiftui/project-isolation.json", "utf8"),
);

test("accepts the approved isolated namespace", () => {
  assert.deepEqual(validateManifest(approved), []);
});

test("rejects an existing SwiftUI bundle identity", () => {
  const collision = structuredClone(approved);
  collision.identities.releaseBundleId = "com.t3tools.t3code.swiftui";

  assert.match(validateManifest(collision).join("\n"), /forbidden existing-project identity/);
});

test("rejects the existing personal worktree root", () => {
  const collision = structuredClone(approved);
  collision.worktreeRoot = "/Users/saphid/.t3/worktrees/t3code-personal";

  assert.match(validateManifest(collision).join("\n"), /forbidden existing-project identity/);
});

test("rejects drift from the approved branch namespace", () => {
  const collision = structuredClone(approved);
  collision.branchPrefixes = ["personal/", "sync/upstream-"];

  assert.match(validateManifest(collision).join("\n"), /approved identity contract/);
});

test("compares macOS paths case-insensitively", () => {
  assert.equal(
    normalizePathCase("/Users/saphid/Projects/T3 Code", "darwin"),
    "/users/saphid/projects/t3 code",
  );
});

test("keeps Debug signing compatible with a Personal Team", () => {
  const projectSource = readFileSync("apps/swift-ios/T3Code.xcodeproj/project.pbxproj", "utf8");
  const devEntitlementsSource = readFileSync(
    "apps/swift-ios/Extensions/Shared/T3CodeDev.entitlements",
    "utf8",
  );

  assert.deepEqual(validatePersonalTeamDebugSigning(projectSource, devEntitlementsSource), []);
  assert.match(
    validatePersonalTeamDebugSigning(
      projectSource.replace(
        "Extensions/Shared/T3CodeDev.entitlements",
        "Extensions/Shared/T3Code.entitlements",
      ),
      devEntitlementsSource,
    ).join("\n"),
    /all three Debug app targets/,
  );
});

test("canonical-clone hook blocks direct pushes to main", () => {
  const result = spawnSync(".githooks/pre-push", ["origin", "unused"], {
    encoding: "utf8",
    input: `refs/heads/main ${"1".repeat(40)} refs/heads/main ${"0".repeat(40)}\n`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Direct pushes to protected product main are blocked/);
});

test("canonical-clone hook allows isolated product branches", () => {
  const result = spawnSync(".githooks/pre-push", ["origin", "unused"], {
    encoding: "utf8",
    input: `refs/heads/typed-swiftui/example ${"1".repeat(40)} refs/heads/typed-swiftui/example ${"0".repeat(40)}\n`,
  });

  assert.equal(result.status, 0);
});
