import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  GENERIC_API_CATALOGUE,
  VCS_CHANGES,
  VCS_CHANGES_API,
  VCS_DIFF,
  VCS_DIFF_API,
  VCS_MUTATE,
  VCS_READ,
  VCS_REFS,
  VCS_REFS_API,
  VCS_REPOSITORY,
  VCS_REPOSITORY_API,
  VCS_STATUS,
  VCS_STATUS_API,
  vcsChangesApi,
  vcsDiffApi,
  vcsRefsApi,
  vcsRepositoryApi,
  vcsStatusApi,
} from "../dist/catalogue.js";

const defs = {
  [VCS_STATUS]: VCS_STATUS_API,
  [VCS_REFS]: VCS_REFS_API,
  [VCS_CHANGES]: VCS_CHANGES_API,
  [VCS_DIFF]: VCS_DIFF_API,
  [VCS_REPOSITORY]: VCS_REPOSITORY_API,
};
const apis = {
  [VCS_STATUS]: vcsStatusApi,
  [VCS_REFS]: vcsRefsApi,
  [VCS_CHANGES]: vcsChangesApi,
  [VCS_DIFF]: vcsDiffApi,
  [VCS_REPOSITORY]: vcsRepositoryApi,
};
const methodsOf = (definition) =>
  Object.fromEntries((definition.methods ?? []).map((m) => [m.name, m]));

NodeTest.test("t3.vcs/* contracts are frozen 1.0.0 catalogue entries, each registered once", () => {
  for (const [id, definition] of Object.entries(defs)) {
    NodeAssert.equal(definition.id, id);
    NodeAssert.equal(definition.version, "1.0.0");
    NodeAssert.deepEqual(
      GENERIC_API_CATALOGUE.filter((d) => d.id === id),
      [definition],
    );
    NodeAssert.equal(apis[id].definition, definition);
  }
});

NodeTest.test("reads ride t3.vcs/read and mutations ride the distinct t3.vcs/mutate grant", () => {
  const expectations = {
    [VCS_STATUS]: { get: "read", refresh: "read" },
    [VCS_REFS]: { list: "read", create: "write", switch: "write" },
    [VCS_CHANGES]: { list: "read", stage: "write", unstage: "write", commit: "write" },
    [VCS_DIFF]: { getPreview: "read", getFileContents: "read" },
    [VCS_REPOSITORY]: {
      getCapabilities: "read",
      pull: "write",
      init: "write",
      createWorktree: "write",
      removeWorktree: "write",
    },
  };
  for (const [id, methods] of Object.entries(expectations)) {
    const byName = methodsOf(defs[id]);
    NodeAssert.deepEqual(Object.keys(byName).sort(), Object.keys(methods).sort());
    for (const [name, effect] of Object.entries(methods)) {
      NodeAssert.equal(byName[name].effect, effect, `${id}.${name}`);
      NodeAssert.deepEqual(
        byName[name].requiredGrants,
        [effect === "read" ? VCS_READ : VCS_MUTATE],
        `${id}.${name}`,
      );
    }
  }
});

NodeTest.test("the status stream is read-granted and carries snapshot/update/closed frames", () => {
  const streams = Object.fromEntries((VCS_STATUS_API.streams ?? []).map((s) => [s.name, s]));
  NodeAssert.deepEqual(Object.keys(streams), ["subscribe"]);
  NodeAssert.deepEqual(streams.subscribe.requiredGrants, [VCS_READ]);
  const kinds = streams.subscribe.eventSchema.oneOf.map((variant) => variant.properties.kind.const);
  NodeAssert.deepEqual(kinds, ["snapshot", "localUpdated", "remoteUpdated", "closed"]);
});

NodeTest.test("changes.list exposes honest per-path staging state", () => {
  const entry = methodsOf(defs[VCS_CHANGES]).list.outputSchema.properties.entries.items;
  NodeAssert.deepEqual([...entry.required].sort(), [
    "conflicted",
    "path",
    "staged",
    "unstaged",
    "untracked",
  ]);
  NodeAssert.equal(entry.properties.path.maxLength, 512);
  const list = methodsOf(defs[VCS_CHANGES]).list.outputSchema;
  NodeAssert.equal(list.properties.entries.maxItems, 5000);
  NodeAssert.equal(list.required.includes("truncated"), true);
});

NodeTest.test("input schemas are closed and bounded", () => {
  const changes = methodsOf(defs[VCS_CHANGES]);
  const refs = methodsOf(defs[VCS_REFS]);
  const repository = methodsOf(defs[VCS_REPOSITORY]);
  const diff = methodsOf(defs[VCS_DIFF]);
  for (const method of [
    ...Object.values(changes),
    ...Object.values(refs),
    ...Object.values(repository),
    ...Object.values(diff),
    ...Object.values(methodsOf(defs[VCS_STATUS])),
  ]) {
    NodeAssert.equal(method.inputSchema.additionalProperties, false, method.name);
  }
  NodeAssert.equal(changes.stage.inputSchema.properties.paths.maxItems, 100);
  NodeAssert.equal(changes.stage.inputSchema.properties.paths.minItems, 1);
  NodeAssert.equal(changes.stage.inputSchema.properties.paths.items.maxLength, 512);
  NodeAssert.equal(changes.commit.inputSchema.properties.message.maxLength, 10000);
  NodeAssert.equal(refs.list.inputSchema.properties.limit.maximum, 200);
  NodeAssert.equal(refs.list.inputSchema.properties.query.maxLength, 256);
  NodeAssert.equal(refs.create.inputSchema.properties.refName.maxLength, 256);
  NodeAssert.ok(refs.create.inputSchema.properties.refName.allOf.length >= 8);
  NodeAssert.equal(diff.getFileContents.inputSchema.properties.oldPath.maxLength, 512);
  NodeAssert.equal(repository.createWorktree.inputSchema.properties.path.maxLength, 32768);
  // Revision inputs must reject `-`-prefixed values — they reach git argv
  // where an option like `--output=` would write outside the workspace.
  for (const property of [
    diff.getPreview.inputSchema.properties.baseRef,
    diff.getFileContents.inputSchema.properties.baseRef,
    diff.getFileContents.inputSchema.properties.headRef,
  ]) {
    const clauses = property.allOf ?? property.anyOf.find((alt) => alt.allOf)?.allOf;
    NodeAssert.ok(
      clauses?.some(
        (clause) => clause.not && new RegExp(clause.not.pattern).test("--output=/tmp/escape"),
      ),
      "revspec schema must reject option injection",
    );
    NodeAssert.ok(
      !clauses?.some((clause) => clause.not && new RegExp(clause.not.pattern).test("HEAD~2")),
      "revspec schema must still accept ordinary revspecs",
    );
  }
});

NodeTest.test("diff outputs preserve bounded payloads and truthful truncation", () => {
  const diff = methodsOf(defs[VCS_DIFF]);
  const source = diff.getPreview.outputSchema.properties.sources.items;
  NodeAssert.equal(source.properties.diff.maxLength, 512000);
  NodeAssert.equal(source.required.includes("truncated"), true);
  NodeAssert.equal(diff.getPreview.outputSchema.properties.sources.maxItems, 8);
  NodeAssert.equal(diff.getFileContents.outputSchema.properties.oldContents.maxLength, 1048576);
  NodeAssert.equal(diff.getFileContents.outputSchema.properties.newContents.maxLength, 1048576);
});

NodeTest.test("getCapabilities reports driver kind, flags, and per-operation support", () => {
  const output = methodsOf(defs[VCS_REPOSITORY]).getCapabilities.outputSchema;
  NodeAssert.deepEqual([...output.required].sort(), [
    "detail",
    "detected",
    "driver",
    "kind",
    "operations",
  ]);
  const driver = output.properties.driver;
  NodeAssert.ok(driver.required.includes("supportsWorktrees"));
  NodeAssert.deepEqual(driver.properties.kind.enum, ["git", "jj", "unknown"]);
  const operations = output.properties.operations;
  for (const key of [
    "changes.stage",
    "changes.commit",
    "refs.switch",
    "repository.pull",
    "repository.createWorktree",
    "diff.getFileContents",
  ]) {
    NodeAssert.equal(operations.properties[key].type, "boolean", key);
  }
});
