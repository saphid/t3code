import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePathCase, validateManifest } from "./verify-project-isolation.mjs";

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
