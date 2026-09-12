import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  MAX_EXPANDED_CONTEXT_LINES,
  binaryPathsFromPatch,
  canExpandFile,
  changeTypeLabel,
  describeSource,
  diffCapabilityState,
  displayPath,
  fileContentsInput,
  fileRows,
  fileStatLabel,
  previewState,
  renderableFromPatch,
  retainFileSelection,
  selectSource,
} from "./viewModel.ts";

// A real git-shaped working-tree patch: tracked change with two hunks
// (net +1 line, so old/new gap line numbers diverge), a deletion, an
// untracked-style addition, a pure rename, a tracked binary change, and
// an untracked binary entry (the /dev/null marker form git emits for
// `diff --no-index` synthesis).
const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,6 +1,7 @@",
  " line1",
  "-old",
  "+new",
  "+newer",
  " line3",
  " line4",
  " line5",
  " line6",
  "@@ -40,3 +41,4 @@",
  " ctx40",
  "+added",
  " ctx41",
  " ctx42",
  "diff --git a/old.txt b/old.txt",
  "deleted file mode 100644",
  "index 3333333..0000000",
  "--- a/old.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/fresh.txt b/fresh.txt",
  "new file mode 100644",
  "index 0000000..4444444",
  "--- /dev/null",
  "+++ b/fresh.txt",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "diff --git a/name.txt b/renamed.txt",
  "similarity index 100%",
  "rename from name.txt",
  "rename to renamed.txt",
  "diff --git a/logo.bin b/logo.bin",
  "index 5555555..6666666 100644",
  "Binary files a/logo.bin and b/logo.bin differ",
  "diff --git a/blob.bin b/blob.bin",
  "new file mode 100644",
  "index 0000000..7777777",
  "Binary files /dev/null and b/blob.bin differ",
  "",
].join("\n");

// Contents consistent with PATCH: old 45 lines, new 47 lines.
const OLD_LINES = (() => {
  const lines = Array.from({ length: 45 }, (_, i) => `o${i + 1}`);
  lines[0] = "line1";
  lines[1] = "old";
  lines[2] = "line3";
  lines[3] = "line4";
  lines[4] = "line5";
  lines[5] = "line6";
  lines[39] = "ctx40";
  lines[40] = "ctx41";
  lines[41] = "ctx42";
  return lines;
})();
const NEW_LINES = (() => {
  const lines = Array.from({ length: 47 }, (_, i) => `n${i + 1}`);
  lines[0] = "line1";
  lines[1] = "new";
  lines[2] = "newer";
  lines[3] = "line3";
  lines[4] = "line4";
  lines[5] = "line5";
  lines[6] = "line6";
  lines[40] = "ctx40";
  lines[41] = "added";
  lines[42] = "ctx41";
  lines[43] = "ctx42";
  lines[44] = "line45";
  lines[45] = "line46";
  lines[46] = "line47";
  return lines;
})();
const CONTENTS = { oldContents: OLD_LINES.join("\n"), newContents: NEW_LINES.join("\n") };

const source = (overrides = {}) => ({
  id: "working-tree",
  kind: "working-tree",
  title: "Dirty worktree",
  baseRef: "HEAD",
  headRef: null,
  diff: PATCH,
  diffHash: "a".repeat(64),
  truncated: false,
  ...overrides,
});

const previewResult = (sources = [source()]) => ({
  generatedAt: "2026-09-13T00:00:00.000Z",
  sources,
});

const caps = (overrides = {}) => ({
  detected: true,
  kind: "git",
  detail: null,
  driver: null,
  operations: {
    "diff.getPreview": true,
    "diff.getFileContents": true,
  },
  ...overrides,
});

// Rows carry `ordinal` (their position); assertions compare the payload.
const bare = ({ ordinal: _ordinal, ...rest }) => rest;

const filesFrom = (diff = PATCH) => {
  const renderable = renderableFromPatch(diff);
  NodeAssert.equal(renderable?.kind, "files");
  return renderable.files;
};

NodeTest.test("renderableFromPatch: null on absent and empty diffs", () => {
  NodeAssert.equal(renderableFromPatch(null), null);
  NodeAssert.equal(renderableFromPatch(undefined), null);
  NodeAssert.equal(renderableFromPatch(""), null);
  NodeAssert.equal(renderableFromPatch("   \n  "), null);
});

NodeTest.test("renderableFromPatch: honest raw fallback on unparseable text", () => {
  const renderable = renderableFromPatch("this is not a patch\njust prose");
  NodeAssert.equal(renderable?.kind, "raw");
  NodeAssert.equal(renderable.reason, "Unsupported diff format. Showing raw patch.");
  NodeAssert.equal(renderable.text, "this is not a patch\njust prose");
});

NodeTest.test("renderableFromPatch: file rows carry path, type, stats", () => {
  const files = filesFrom();
  NodeAssert.equal(files.length, 6);
  const byPath = new Map(files.map((row) => [row.path, row]));

  const app = byPath.get("src/app.ts");
  NodeAssert.equal(app.changeType, "change");
  NodeAssert.equal(app.additions, 3);
  NodeAssert.equal(app.deletions, 1);
  NodeAssert.equal(app.binary, false);
  NodeAssert.equal(app.textless, false);

  NodeAssert.equal(byPath.get("old.txt").changeType, "deleted");
  NodeAssert.equal(byPath.get("fresh.txt").changeType, "new");

  const renamed = byPath.get("renamed.txt");
  NodeAssert.equal(renamed.changeType, "rename-pure");
  NodeAssert.equal(renamed.prevPath, "name.txt");
  NodeAssert.equal(renamed.textless, true); // pure rename: no hunks, not binary
});

NodeTest.test("binary files are flagged by name, never rendered as text", () => {
  const files = filesFrom();
  const logo = files.find((row) => row.path === "logo.bin");
  const blob = files.find((row) => row.path === "blob.bin");
  NodeAssert.equal(logo.binary, true, "tracked binary marker");
  NodeAssert.equal(blob.binary, true, "untracked /dev/null binary marker");
  NodeAssert.equal(logo.textless, false, "binary is not textless");
  NodeAssert.equal(fileRows(logo).length, 0, "binary renders no fake hunk rows");
  NodeAssert.equal(canExpandFile(logo), false, "binary offers no expansion");
  NodeAssert.equal(fileStatLabel(logo), "", "binary carries no fake +/- counts");
});

NodeTest.test("binaryPathsFromPatch: both marker forms, path from the b side", () => {
  const paths = binaryPathsFromPatch(PATCH);
  NodeAssert.deepEqual([...paths].sort(), ["blob.bin", "logo.bin"]);
  NodeAssert.deepEqual([...binaryPathsFromPatch("no markers here")], []);
  const gitBinaryPatch = [
    "diff --git a/delta.bin b/delta.bin",
    "index 1..2 100644",
    "GIT binary patch",
    "literal 4",
    "abcd",
    "",
  ].join("\n");
  NodeAssert.deepEqual([...binaryPathsFromPatch(gitBinaryPatch)], ["delta.bin"]);
});

NodeTest.test("fileRows: partial patch renders hunks with a named gap row", () => {
  const app = filesFrom().find((row) => row.path === "src/app.ts");
  const rows = fileRows(app);
  // hunk 1: 1 ctx + 1 del + 2 add + 4 ctx = 8 rows; gap 33; hunk 2: 4 rows
  NodeAssert.equal(rows.length, 8 + 1 + 4);
  NodeAssert.deepEqual(bare(rows[0]), { kind: "context", text: "line1", oldLine: 1, newLine: 1 });
  NodeAssert.deepEqual(bare(rows[1]), { kind: "deletion", text: "old", oldLine: 2 });
  NodeAssert.deepEqual(bare(rows[2]), { kind: "addition", text: "new", newLine: 2 });
  NodeAssert.deepEqual(bare(rows[3]), { kind: "addition", text: "newer", newLine: 3 });
  NodeAssert.deepEqual(bare(rows[4]), { kind: "context", text: "line3", oldLine: 3, newLine: 4 });
  NodeAssert.deepEqual(bare(rows[8]), { kind: "gap", count: 33 });
  NodeAssert.deepEqual(bare(rows[9]), { kind: "context", text: "ctx40", oldLine: 40, newLine: 41 });
  NodeAssert.deepEqual(bare(rows[10]), { kind: "addition", text: "added", newLine: 42 });
});

NodeTest.test("fileRows: expansion fills gaps from delivered contents", () => {
  const app = filesFrom().find((row) => row.path === "src/app.ts");
  const rows = fileRows(app, CONTENTS);
  // hunk1 (8) + gap 33 + hunk2 (4) + tail 3 = 48 rows, no named gaps left
  NodeAssert.equal(rows.filter((row) => row.kind === "gap").length, 0);
  NodeAssert.equal(rows.length, 48);
  // Expanded gap context: new line 8 ↔ old line 7 (numbering diverged by +1).
  NodeAssert.deepEqual(bare(rows[8]), { kind: "context", text: "n8", oldLine: 7, newLine: 8 });
  NodeAssert.deepEqual(bare(rows[40]), { kind: "context", text: "n40", oldLine: 39, newLine: 40 });
  NodeAssert.deepEqual(bare(rows[41]), {
    kind: "context",
    text: "ctx40",
    oldLine: 40,
    newLine: 41,
  });
  NodeAssert.deepEqual(bare(rows[47]), {
    kind: "context",
    text: "line47",
    oldLine: 45,
    newLine: 47,
  });
});

NodeTest.test("fileRows: expansion caps context and names the remainder", () => {
  const patch = [
    "diff --git a/big.ts b/big.ts",
    "index 1..2 100644",
    "--- a/big.ts",
    "+++ b/big.ts",
    "@@ -1,2 +1,2 @@",
    " a",
    "-x",
    "+y",
    "@@ -500,2 +500,2 @@",
    " b",
    "-p",
    "+q",
    "",
  ].join("\n");
  const file = filesFrom(patch)[0];
  NodeAssert.equal(file.path, "big.ts");
  const oldContents = Array.from({ length: 600 }, (_, i) => `o${i + 1}`).join("\n");
  const newContents = Array.from({ length: 600 }, (_, i) => `n${i + 1}`).join("\n");
  const rows = fileRows(file, { oldContents, newContents }, 50);
  const gaps = rows.filter((row) => row.kind === "gap");
  // inter-hunk gap 497 and tail 99 each render 50 rows then name the rest
  NodeAssert.equal(gaps.length, 2);
  NodeAssert.deepEqual(bare(gaps[0]), { kind: "gap", count: 497 - 50 });
  NodeAssert.deepEqual(bare(gaps[1]), { kind: "gap", count: 99 - 50 });
  NodeAssert.ok(MAX_EXPANDED_CONTEXT_LINES > 0);
});

NodeTest.test("canExpandFile: only two-sided text changes expand", () => {
  const files = filesFrom();
  const byPath = new Map(files.map((row) => [row.path, row]));
  NodeAssert.equal(canExpandFile(byPath.get("src/app.ts")), true);
  NodeAssert.equal(canExpandFile(byPath.get("fresh.txt")), false, "new files carry every line");
  NodeAssert.equal(canExpandFile(byPath.get("old.txt")), false, "deleted carries every line");
  NodeAssert.equal(canExpandFile(byPath.get("renamed.txt")), false, "pure rename has nothing");
  NodeAssert.equal(canExpandFile(byPath.get("logo.bin")), false, "binary never expands");
});

NodeTest.test("fileContentsInput: renames send prevPath as oldPath", () => {
  const files = filesFrom();
  const renamed = {
    ...files.find((row) => row.path === "renamed.txt"),
    changeType: "rename-changed",
  };
  const input = fileContentsInput(
    { kind: "branch-range", baseRef: "main", headRef: "HEAD" },
    renamed,
  );
  NodeAssert.deepEqual(input, {
    sourceKind: "branch-range",
    changeType: "rename-changed",
    baseRef: "main",
    headRef: "HEAD",
    oldPath: "name.txt",
    newPath: "renamed.txt",
  });
});

NodeTest.test("selectSource: persisted id wins, working-tree default, first fallback", () => {
  const wt = source();
  const br = source({ id: "branch-range", kind: "branch-range", title: "Against main" });
  const result = previewResult([wt, br]);
  NodeAssert.equal(selectSource(result, "branch-range").id, "branch-range");
  NodeAssert.equal(selectSource(result, null).id, "working-tree");
  NodeAssert.equal(selectSource(result, "gone").id, "working-tree");
  NodeAssert.equal(selectSource(previewResult([br]), null).id, "branch-range");
  NodeAssert.equal(selectSource(previewResult([]), null), null);
  NodeAssert.equal(selectSource(null, null), null);
});

NodeTest.test("retainFileSelection keeps live keys, drops departed paths", () => {
  const files = filesFrom();
  const app = files[0];
  NodeAssert.equal(retainFileSelection(files, app.key)?.path, "src/app.ts");
  NodeAssert.equal(retainFileSelection(files, "gone x"), null);
  NodeAssert.equal(retainFileSelection(files, null), null);
});

NodeTest.test("labels: displayPath, fileStatLabel, changeTypeLabel, describeSource", () => {
  const files = filesFrom();
  const byPath = new Map(files.map((row) => [row.path, row]));
  NodeAssert.equal(displayPath(byPath.get("renamed.txt")), "name.txt → renamed.txt");
  NodeAssert.equal(displayPath(byPath.get("src/app.ts")), "src/app.ts");
  NodeAssert.equal(fileStatLabel(byPath.get("src/app.ts")), "+3 −1");
  NodeAssert.equal(fileStatLabel(byPath.get("renamed.txt")), "");
  NodeAssert.equal(changeTypeLabel("new"), "added");
  NodeAssert.equal(changeTypeLabel("rename-changed"), "renamed, modified");
  NodeAssert.equal(
    describeSource(source({ truncated: true })),
    `Dirty worktree · ${"a".repeat(12)} · truncated`,
  );
});

NodeTest.test("previewState: loading / error / empty / ready", () => {
  NodeAssert.deepEqual(previewState(null, null), { kind: "loading" });
  NodeAssert.deepEqual(previewState(null, "boom"), { kind: "error", detail: "boom" });
  NodeAssert.deepEqual(previewState(previewResult([]), null), { kind: "empty" });
  NodeAssert.equal(previewState(previewResult(), null).kind, "ready");
  NodeAssert.equal(previewState(previewResult(), "boom").kind, "error", "error wins over data");
});

NodeTest.test("diffCapabilityState: the honesty gate", () => {
  NodeAssert.deepEqual(diffCapabilityState(null, null), { kind: "loading" });
  NodeAssert.deepEqual(diffCapabilityState(null, "down"), {
    kind: "unavailable",
    detail: "down",
  });
  NodeAssert.deepEqual(diffCapabilityState(caps({ detected: false, detail: "not a repo" }), null), {
    kind: "no-repository",
    detail: "not a repo",
  });
  const noDiff = caps();
  noDiff.operations["diff.getPreview"] = false;
  const unsupported = diffCapabilityState(noDiff, null);
  NodeAssert.equal(unsupported.kind, "unsupported");
  NodeAssert.equal(unsupported.driverKind, "git");
  NodeAssert.deepEqual(diffCapabilityState(caps(), null), { kind: "ready" });
});
