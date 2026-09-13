import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  CONNECTING_DIFF_STATUS,
  MAX_EXPANDED_CONTEXT_LINES,
  areAllDiffFilesCollapsed,
  binaryPathsFromPatch,
  buildBaseRefChoices,
  canExpandFile,
  changeTypeLabel,
  collectFileContentsStream,
  collectPreviewStream,
  contentsDeliveryKey,
  describePresentation,
  describeSource,
  diffCapabilityState,
  diffTreeRows,
  displayPath,
  fetchDiffPreview,
  fetchFileContents,
  fileContentsInput,
  fileRows,
  fileStatLabel,
  filterBaseRefChoices,
  foldDiffStatusEvent,
  isEnvelopeRejection,
  localStatusFingerprint,
  presentationPath,
  previewDeliveryKey,
  previewState,
  renderableFromPatch,
  retainFileSelection,
  selectSource,
  toggleAllDiffFiles,
  toggleCollapsedKey,
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

/* ---------------- stream fixtures ---------------- */

const sha256Hex = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const utf8Length = (text) => new TextEncoder().encode(text).length;

/** Split a body into fixed UTF-16-unit chunks, exactly like the adapter. */
const chunkBody = (body, units = 8_192) => {
  const chunks = [];
  for (let offset = 0; offset < body.length; offset += units) {
    chunks.push(body.slice(offset, offset + units));
  }
  return chunks;
};

/** A valid streamPreview event sequence for the given source bodies. */
const previewFixture = async (bodies, { units = 8_192 } = {}) => {
  const perSource = bodies.map((body, index) => ({
    id: index === 0 ? "working-tree" : `source-${index}`,
    kind: index === 0 ? "working-tree" : "branch-range",
    title: `Source ${index}`,
    baseRef: "HEAD",
    headRef: null,
    truncated: false,
    diffHash: null, // filled below
    diffByteLength: utf8Length(body),
    chunks: chunkBody(body, units),
  }));
  const sources = await Promise.all(
    perSource.map(async ({ chunks, ...rest }) => ({
      ...rest,
      chunkCount: chunks.length,
      diffHash: await sha256Hex(chunks.join("")),
    })),
  );
  const events = [
    {
      kind: "manifest",
      generatedAt: "2026-09-14T00:00:00.000Z",
      sources: sources.map(({ chunks: _chunks, ...rest }) => rest),
    },
  ];
  sources.forEach((source, sourceIndex) => {
    perSource[sourceIndex].chunks.forEach((data, chunkIndex) => {
      events.push({ kind: "chunk", sourceIndex, chunkIndex, data });
    });
  });
  events.push({ kind: "complete", payloadSha256: await sha256Hex(bodies.join("")) });
  return { events, bodies };
};

const fileContentsFixture = async (oldBody, newBody, { units = 8_192 } = {}) => {
  const oldChunks = chunkBody(oldBody, units);
  const newChunks = chunkBody(newBody, units);
  const events = [
    {
      kind: "manifest",
      oldByteLength: utf8Length(oldBody),
      oldChunkCount: oldChunks.length,
      newByteLength: utf8Length(newBody),
      newChunkCount: newChunks.length,
    },
    ...oldChunks.map((data, chunkIndex) => ({ kind: "chunk", side: "old", chunkIndex, data })),
    ...newChunks.map((data, chunkIndex) => ({ kind: "chunk", side: "new", chunkIndex, data })),
    { kind: "complete", oldSha256: await sha256Hex(oldBody), newSha256: await sha256Hex(newBody) },
  ];
  return { events, oldBody, newBody };
};

/** Async iterable over frame values; `onReturn` fires when abandoned. */
const fakeStream = (events, onReturn) => ({
  async *[Symbol.asyncIterator]() {
    try {
      for (const [index, event] of events.entries()) {
        yield { value: event, streamId: "s", sequence: index, type: "data" };
      }
    } finally {
      onReturn?.();
    }
  },
});

const SIGNAL_OK = new AbortController().signal;

/* ---------------- preview stream reassembly ---------------- */

NodeTest.test("collectPreviewStream: manifest → ordered chunks → complete verifies", async () => {
  const small = "diff --git a/a.txt b/a.txt\n+after\n";
  const large = "x".repeat(20_000); // 3 chunks at 8,192 units
  const { events, bodies } = await previewFixture([small, large]);
  const outcome = await collectPreviewStream(fakeStream(events), SIGNAL_OK);
  NodeAssert.equal(outcome.kind, "verified");
  NodeAssert.equal(outcome.result.sources.length, 2);
  NodeAssert.equal(outcome.result.sources[0].diff, bodies[0]);
  NodeAssert.equal(outcome.result.sources[1].diff, bodies[1]);
  NodeAssert.equal(outcome.result.generatedAt, "2026-09-14T00:00:00.000Z");
  NodeAssert.equal(outcome.result.sources[1].truncated, false);
});

NodeTest.test(
  "collectPreviewStream: multibyte bodies split mid-surrogate reassemble losslessly",
  async () => {
    // Emoji and CJK across chunk seams: UTF-16 unit splits land inside
    // surrogate pairs; joining restores them, and the byte-level sha256
    // over the reassembled body still verifies.
    const body = `🙂`.repeat(6_000) + "漢字テキスト".repeat(500) + "tail\n";
    const { events } = await previewFixture([body], { units: 7_777 });
    const outcome = await collectPreviewStream(fakeStream(events), SIGNAL_OK);
    NodeAssert.equal(outcome.kind, "verified");
    NodeAssert.equal(outcome.result.sources[0].diff, body);
  },
);

NodeTest.test("collectPreviewStream: empty-body source with chunkCount 0 verifies", async () => {
  const { events } = await previewFixture([""]);
  const outcome = await collectPreviewStream(fakeStream(events), SIGNAL_OK);
  NodeAssert.equal(outcome.kind, "verified");
  NodeAssert.equal(outcome.result.sources[0].diff, "");
});

NodeTest.test(
  "collectPreviewStream: out-of-order and duplicate chunks are protocol failures",
  async () => {
    const { events } = await previewFixture(["ab".repeat(9_000)]);
    const chunks = events.filter((e) => e.kind === "chunk");
    const swapped = [events[0], chunks[1], chunks[0], ...chunks.slice(2), events.at(-1)];
    NodeAssert.equal((await collectPreviewStream(fakeStream(swapped), SIGNAL_OK)).kind, "protocol");
    const duplicated = [events[0], chunks[0], chunks[0], ...chunks.slice(1), events.at(-1)];
    NodeAssert.equal(
      (await collectPreviewStream(fakeStream(duplicated), SIGNAL_OK)).kind,
      "protocol",
    );
  },
);

NodeTest.test("collectPreviewStream: undeclared sourceIndex / chunkIndex rejected", async () => {
  const { events } = await previewFixture(["body"]);
  const badSource = [
    events[0],
    { kind: "chunk", sourceIndex: 9, chunkIndex: 0, data: "x" },
    events.at(-1),
  ];
  const outcome = await collectPreviewStream(fakeStream(badSource), SIGNAL_OK);
  NodeAssert.equal(outcome.kind, "protocol");
  NodeAssert.match(outcome.detail, /sourceIndex 9/);
  const badIndex = [
    events[0],
    { kind: "chunk", sourceIndex: 0, chunkIndex: 5, data: "x" },
    events.at(-1),
  ];
  NodeAssert.equal((await collectPreviewStream(fakeStream(badIndex), SIGNAL_OK)).kind, "protocol");
});

NodeTest.test("collectPreviewStream: ordering violations are protocol failures", async () => {
  const { events } = await previewFixture(["body"]);
  NodeAssert.equal(
    (await collectPreviewStream(fakeStream(events.slice(1)), SIGNAL_OK)).kind,
    "protocol",
    "chunk before manifest",
  );
  NodeAssert.equal(
    (await collectPreviewStream(fakeStream([events[0], events[0], ...events.slice(1)]), SIGNAL_OK))
      .kind,
    "protocol",
    "duplicate manifest",
  );
  NodeAssert.equal(
    (
      await collectPreviewStream(
        fakeStream([...events, { kind: "chunk", sourceIndex: 0, chunkIndex: 1, data: "x" }]),
        SIGNAL_OK,
      )
    ).kind,
    "protocol",
    "frame after complete",
  );
});

NodeTest.test(
  "collectPreviewStream: missing terminal frame is incomplete, never verified",
  async () => {
    const { events } = await previewFixture(["body"]);
    const outcome = await collectPreviewStream(fakeStream(events.slice(0, -1)), SIGNAL_OK);
    NodeAssert.equal(outcome.kind, "incomplete");
    NodeAssert.match(outcome.detail, /complete frame/);
    NodeAssert.equal(
      (await collectPreviewStream(fakeStream([]), SIGNAL_OK)).kind,
      "incomplete",
      "empty stream ends before the manifest",
    );
  },
);

NodeTest.test("collectPreviewStream: fewer chunks than declared is incomplete", async () => {
  const { events } = await previewFixture(["ab".repeat(9_000)]); // 3 chunks
  const dropped = events.filter((e) => !(e.kind === "chunk" && e.chunkIndex === 2));
  const outcome = await collectPreviewStream(fakeStream(dropped), SIGNAL_OK);
  NodeAssert.equal(outcome.kind, "incomplete");
  NodeAssert.match(outcome.detail, /received 2 of 3/);
});

NodeTest.test("collectPreviewStream: hash and byte-length mismatches never verify", async () => {
  const { events } = await previewFixture(["delivered body"]);
  // Manifest hash that does not describe the delivered bytes.
  const badHash = events.map((e) =>
    e.kind === "manifest" ? { ...e, sources: [{ ...e.sources[0], diffHash: "f".repeat(64) }] } : e,
  );
  const hashOutcome = await collectPreviewStream(fakeStream(badHash), SIGNAL_OK);
  NodeAssert.equal(hashOutcome.kind, "mismatch");
  NodeAssert.match(hashOutcome.detail, /manifest hash/);
  // Manifest byte length that does not describe the delivered bytes.
  const badLength = events.map((e) =>
    e.kind === "manifest" ? { ...e, sources: [{ ...e.sources[0], diffByteLength: 1 }] } : e,
  );
  const lengthOutcome = await collectPreviewStream(fakeStream(badLength), SIGNAL_OK);
  NodeAssert.equal(lengthOutcome.kind, "mismatch");
  NodeAssert.match(lengthOutcome.detail, /byte length/);
  // Terminal checksum that does not describe the payload.
  const badComplete = [...events.slice(0, -1), { kind: "complete", payloadSha256: "0".repeat(64) }];
  const completeOutcome = await collectPreviewStream(fakeStream(badComplete), SIGNAL_OK);
  NodeAssert.equal(completeOutcome.kind, "mismatch");
  NodeAssert.match(completeOutcome.detail, /terminal checksum/);
});

NodeTest.test(
  "collectPreviewStream: abort abandons the iterator and yields cancelled",
  async () => {
    const controller = new AbortController();
    let abandoned = false;
    const stream = {
      async *[Symbol.asyncIterator]() {
        try {
          yield { value: { kind: "manifest", generatedAt: "t", sources: [] } };
          controller.abort();
          yield { value: { kind: "chunk", sourceIndex: 0, chunkIndex: 0, data: "x" } };
        } finally {
          abandoned = true;
        }
      },
    };
    const outcome = await collectPreviewStream(stream, controller.signal);
    NodeAssert.equal(outcome.kind, "cancelled");
    NodeAssert.equal(abandoned, true, "leaving the loop abandons the iterator");
  },
);

/* ---------------- file contents stream reassembly ---------------- */

NodeTest.test("collectFileContentsStream: per-side ordering and sha256 verified", async () => {
  const oldBody = "old-line\n".repeat(2_000); // spans chunk boundaries
  const newBody = "new-line\n".repeat(1_500);
  const { events, oldBody: o, newBody: n } = await fileContentsFixture(oldBody, newBody);
  const outcome = await collectFileContentsStream(fakeStream(events), SIGNAL_OK);
  NodeAssert.equal(outcome.kind, "verified");
  NodeAssert.equal(outcome.result.oldContents, o);
  NodeAssert.equal(outcome.result.newContents, n);
});

NodeTest.test(
  "collectFileContentsStream: out-of-order side chunk is a protocol failure",
  async () => {
    const { events } = await fileContentsFixture("a".repeat(9_000), "b");
    const oldChunks = events.filter((e) => e.kind === "chunk" && e.side === "old");
    const swapped = events.map((e) =>
      e === oldChunks[0] ? oldChunks[1] : e === oldChunks[1] ? oldChunks[0] : e,
    );
    const outcome = await collectFileContentsStream(fakeStream(swapped), SIGNAL_OK);
    NodeAssert.equal(outcome.kind, "protocol");
    NodeAssert.match(outcome.detail, /out-of-order old chunk 1 \(expected 0\)/);
  },
);

NodeTest.test("collectFileContentsStream: missing terminal + hash mismatch", async () => {
  const { events } = await fileContentsFixture("old", "new");
  NodeAssert.equal(
    (await collectFileContentsStream(fakeStream(events.slice(0, -1)), SIGNAL_OK)).kind,
    "incomplete",
  );
  const badComplete = [
    ...events.slice(0, -1),
    { kind: "complete", oldSha256: "0".repeat(64), newSha256: events.at(-1).newSha256 },
  ];
  const outcome = await collectFileContentsStream(fakeStream(badComplete), SIGNAL_OK);
  NodeAssert.equal(outcome.kind, "mismatch");
  NodeAssert.match(outcome.detail, /old side/);
});

/* ---------------- delivery policy ---------------- */

NodeTest.test("isEnvelopeRejection: named transport error only", () => {
  NodeAssert.equal(
    isEnvelopeRejection(new Error("Payload exceeds byte limit (72,000 > 65,536): sources[0].diff")),
    true,
  );
  NodeAssert.equal(isEnvelopeRejection(new Error("some other failure")), false);
  NodeAssert.equal(isEnvelopeRejection("Payload exceeds byte limit"), false, "non-Error rejected");
  NodeAssert.equal(isEnvelopeRejection(null), false);
});

NodeTest.test("delivery keys encode the full input identity", () => {
  NodeAssert.equal(previewDeliveryKey({}), "|");
  NodeAssert.equal(previewDeliveryKey({ baseRef: "main" }), "main|");
  NodeAssert.equal(previewDeliveryKey({ ignoreWhitespace: true }), "|w");
  NodeAssert.equal(previewDeliveryKey({ baseRef: "main", ignoreWhitespace: true }), "main|w");
  NodeAssert.equal(
    contentsDeliveryKey({ id: "working-tree", diffHash: "abc" }, { key: "k" }),
    "working-tree:abc:k",
  );
});

NodeTest.test("fetchDiffPreview: unary success never touches the stream", async () => {
  const result = previewResult();
  let streamed = false;
  const outcome = await fetchDiffPreview({
    input: {},
    invoke: async () => result,
    stream: () => {
      streamed = true;
      return fakeStream([]);
    },
    streamKeys: new Set(),
    signal: SIGNAL_OK,
  });
  NodeAssert.deepEqual(outcome, { kind: "ready", result, via: "unary" });
  NodeAssert.equal(streamed, false);
});

NodeTest.test(
  "fetchDiffPreview: envelope rejection falls back to the verified stream",
  async () => {
    const { events, bodies } = await previewFixture(["big body"]);
    const streamKeys = new Set();
    const calls = { invoke: 0, stream: 0 };
    const fetcher = () =>
      fetchDiffPreview({
        input: {},
        invoke: async () => {
          calls.invoke += 1;
          throw new Error("Payload exceeds byte limit: sources[0].diff");
        },
        stream: () => {
          calls.stream += 1;
          return fakeStream(events);
        },
        streamKeys,
        signal: SIGNAL_OK,
      });
    const first = await fetcher();
    NodeAssert.equal(first.kind, "ready");
    NodeAssert.equal(first.via, "stream");
    NodeAssert.equal(first.result.sources[0].diff, bodies[0]);
    NodeAssert.ok(streamKeys.has(previewDeliveryKey({})), "stream verdict recorded");
    // The sticky verdict: the next fetch for the same input goes straight
    // to the stream instead of paying the doomed invoke again.
    const second = await fetcher();
    NodeAssert.equal(second.via, "stream");
    NodeAssert.equal(calls.invoke, 1, "no second doomed invoke");
    NodeAssert.equal(calls.stream, 2);
  },
);

NodeTest.test(
  "fetchDiffPreview: non-envelope invoke errors surface without streaming",
  async () => {
    let streamed = false;
    const outcome = await fetchDiffPreview({
      input: {},
      invoke: async () => {
        throw new Error("configured workspace root is required");
      },
      stream: () => {
        streamed = true;
        return fakeStream([]);
      },
      streamKeys: new Set(),
      signal: SIGNAL_OK,
    });
    NodeAssert.deepEqual(outcome, {
      kind: "error",
      detail: "configured workspace root is required",
    });
    NodeAssert.equal(streamed, false);
  },
);

NodeTest.test("fetchDiffPreview: stream verification failure is an honest error", async () => {
  const { events } = await previewFixture(["body"]);
  const tampered = events.map((e) =>
    e.kind === "manifest" ? { ...e, sources: [{ ...e.sources[0], diffHash: "0".repeat(64) }] } : e,
  );
  const outcome = await fetchDiffPreview({
    input: {},
    invoke: async () => {
      throw new Error("Payload exceeds byte limit");
    },
    stream: () => fakeStream(tampered),
    streamKeys: new Set(),
    signal: SIGNAL_OK,
  });
  NodeAssert.equal(outcome.kind, "error");
  NodeAssert.match(outcome.detail, /verification failed.*Nothing is shown/i);
});

NodeTest.test("fetchDiffPreview: incomplete stream reports a retryable failure", async () => {
  const { events } = await previewFixture(["body"]);
  const outcome = await fetchDiffPreview({
    input: {},
    invoke: async () => {
      throw new Error("Payload exceeds byte limit");
    },
    stream: () => fakeStream(events.slice(0, -1)),
    streamKeys: new Set(),
    signal: SIGNAL_OK,
  });
  NodeAssert.equal(outcome.kind, "error");
  NodeAssert.match(outcome.detail, /ended before completing.*Refresh to retry/);
});

NodeTest.test("fetchDiffPreview: abort mid-fetch is silent cancellation", async () => {
  const controller = new AbortController();
  const outcome = await fetchDiffPreview({
    input: {},
    invoke: async () => {
      controller.abort();
      return previewResult();
    },
    stream: () => fakeStream([]),
    streamKeys: new Set(),
    signal: controller.signal,
  });
  NodeAssert.equal(outcome.kind, "cancelled");
});

NodeTest.test("fetchFileContents: unary-first, envelope fallback, sticky verdict", async () => {
  const input = {
    sourceKind: "working-tree",
    changeType: "change",
    baseRef: "HEAD",
    headRef: null,
    oldPath: "big.txt",
    newPath: "big.txt",
  };
  const small = { oldContents: "o", newContents: "n" };
  let calls = 0;
  const unary = await fetchFileContents({
    input,
    deliveryKey: "k",
    invoke: async () => small,
    stream: () => fakeStream([]),
    streamKeys: new Set(),
    signal: SIGNAL_OK,
  });
  NodeAssert.deepEqual(unary, { kind: "ready", result: small, via: "unary" });

  const { events, oldBody, newBody } = await fileContentsFixture(
    "o".repeat(9_000),
    "n".repeat(500),
  );
  const streamKeys = new Set();
  const streamed = await fetchFileContents({
    input,
    deliveryKey: "k",
    invoke: async () => {
      calls += 1;
      throw new Error("Payload exceeds byte limit");
    },
    stream: () => fakeStream(events),
    streamKeys,
    signal: SIGNAL_OK,
  });
  NodeAssert.equal(streamed.kind, "ready");
  NodeAssert.equal(streamed.via, "stream");
  NodeAssert.equal(streamed.result.oldContents, oldBody);
  NodeAssert.equal(streamed.result.newContents, newBody);
  NodeAssert.ok(streamKeys.has("k"));

  const direct = await fetchFileContents({
    input,
    deliveryKey: "k",
    invoke: async () => {
      calls += 1;
      return small;
    },
    stream: () => fakeStream(events),
    streamKeys,
    signal: SIGNAL_OK,
  });
  NodeAssert.equal(direct.via, "stream", "sticky verdict skips unary");
  NodeAssert.equal(calls, 1, "unary not retried for a stream-bound key");
});

/* ---------------- status refresh fold ---------------- */

const statusLocal = (overrides = {}) => ({
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "main",
  hasWorkingTreeChanges: true,
  workingTree: { files: [{}], insertions: 3, deletions: 1, truncated: false },
  ...overrides,
});

NodeTest.test("foldDiffStatusEvent: first snapshot baselines without refreshing", () => {
  const model = foldDiffStatusEvent(CONNECTING_DIFF_STATUS, {
    kind: "snapshot",
    local: statusLocal(),
    remote: null,
  });
  NodeAssert.equal(model.stream, "live");
  NodeAssert.equal(model.revision, 0, "baseline snapshot does not refresh");
  NodeAssert.equal(model.fingerprint, localStatusFingerprint(statusLocal()));
});

NodeTest.test("foldDiffStatusEvent: local updates refresh once per distinct fingerprint", () => {
  let model = foldDiffStatusEvent(CONNECTING_DIFF_STATUS, {
    kind: "snapshot",
    local: statusLocal(),
    remote: null,
  });
  model = foldDiffStatusEvent(model, { kind: "localUpdated", local: statusLocal() });
  NodeAssert.equal(model.revision, 0, "identical fingerprint does not refresh");
  model = foldDiffStatusEvent(model, {
    kind: "localUpdated",
    local: statusLocal({
      workingTree: { files: [{}, {}], insertions: 9, deletions: 2, truncated: false },
    }),
  });
  NodeAssert.equal(model.revision, 1, "a real workspace change refreshes once");
  model = foldDiffStatusEvent(model, {
    kind: "localUpdated",
    local: statusLocal({
      workingTree: { files: [{}, {}], insertions: 9, deletions: 2, truncated: false },
    }),
  });
  NodeAssert.equal(model.revision, 1, "repeated fingerprint stays deduped");
});

NodeTest.test("foldDiffStatusEvent: reconnect snapshot refreshes only on drift", () => {
  let model = foldDiffStatusEvent(CONNECTING_DIFF_STATUS, {
    kind: "snapshot",
    local: statusLocal(),
    remote: null,
  });
  model = foldDiffStatusEvent(model, {
    kind: "snapshot",
    local: statusLocal({ refName: "other-branch" }),
    remote: null,
  });
  NodeAssert.equal(model.revision, 1, "workspace moved while the stream was down");
});

NodeTest.test("foldDiffStatusEvent: remote updates never refresh; closed ends honestly", () => {
  let model = foldDiffStatusEvent(CONNECTING_DIFF_STATUS, {
    kind: "snapshot",
    local: statusLocal(),
    remote: null,
  });
  model = foldDiffStatusEvent(model, {
    kind: "remoteUpdated",
    remote: { hasUpstream: true, aheadCount: 2, behindCount: 0, pr: null },
  });
  NodeAssert.equal(model.revision, 0);
  model = foldDiffStatusEvent(model, { kind: "closed", reason: "overflow" });
  NodeAssert.equal(model.stream, "ended");
  NodeAssert.match(model.detail, /overflowed/);
});

/* ---------------- base-ref choices ---------------- */

const ref = (name, overrides = {}) => ({
  name,
  current: false,
  isDefault: false,
  worktreePath: null,
  ...overrides,
});

NodeTest.test("buildBaseRefChoices: local/remote pairing with origin preference", () => {
  const choices = buildBaseRefChoices([
    ref("main", { current: true }),
    ref("feature"),
    ref("origin/main", { isRemote: true, remoteName: "origin" }),
    ref("upstream/feature", { isRemote: true, remoteName: "upstream" }),
    ref("origin/feature", { isRemote: true, remoteName: "origin" }),
    ref("origin/release", { isRemote: true, remoteName: "origin" }),
  ]);
  NodeAssert.deepEqual(
    choices.map((c) => c.id),
    ["local:main", "local:feature", "remote:upstream/feature", "remote:origin/release"],
  );
  NodeAssert.equal(choices[1].remote, true, "feature paired with origin over upstream");
  NodeAssert.equal(choices[0].refName, "main");
  NodeAssert.equal(choices.at(-1).refName, "origin/release");
});

NodeTest.test("filterBaseRefChoices: substring on label and ref name", () => {
  const choices = buildBaseRefChoices([
    ref("main"),
    ref("feature/login"),
    ref("origin/feature/login", { isRemote: true, remoteName: "origin" }),
    ref("origin/release", { isRemote: true, remoteName: "origin" }),
  ]);
  // origin/feature/login pairs into the local choice; release stays remote-only.
  NodeAssert.equal(filterBaseRefChoices(choices, "").length, 3);
  NodeAssert.deepEqual(
    filterBaseRefChoices(choices, "login").map((c) => c.refName),
    ["feature/login"],
  );
  NodeAssert.deepEqual(
    filterBaseRefChoices(choices, "origin/").map((c) => c.refName),
    ["origin/release"],
  );
  NodeAssert.equal(filterBaseRefChoices(choices, "zzz").length, 0);
});

/* ---------------- file tree + collapse ---------------- */

NodeTest.test("diffTreeRows: dirs before files, indented, collapsible", () => {
  const files = filesFrom();
  const rows = diffTreeRows(files, new Set());
  const kinds = rows.map((row) => row.kind);
  // src/ is the only directory in PATCH; it precedes its child file.
  const srcDir = rows.find((row) => row.kind === "dir" && row.path === "src/");
  NodeAssert.ok(srcDir, "src/ directory row present");
  NodeAssert.equal(srcDir.fileCount, 1);
  const appFile = rows.find((row) => row.kind === "file" && row.row.path === "src/app.ts");
  NodeAssert.equal(appFile.depth, 1, "file nested under src/ indents one level");
  NodeAssert.ok(kinds.indexOf("dir") < rows.indexOf(appFile), "parent precedes child");
  const collapsed = diffTreeRows(files, new Set(["src/"]));
  NodeAssert.equal(
    collapsed.some((row) => row.kind === "file" && row.row.path === "src/app.ts"),
    false,
    "collapsed directory hides descendants",
  );
  NodeAssert.equal(collapsed.find((row) => row.kind === "dir")?.collapsed, true);
});

NodeTest.test("collapse-all toggles the full key set", () => {
  const keys = ["a", "b", "c"];
  NodeAssert.equal(areAllDiffFilesCollapsed(keys, new Set(keys)), true);
  NodeAssert.equal(areAllDiffFilesCollapsed(keys, new Set(["a"])), false);
  NodeAssert.equal(areAllDiffFilesCollapsed([], new Set()), false, "empty list is not collapsed");
  NodeAssert.deepEqual([...toggleAllDiffFiles(keys, new Set())], keys);
  NodeAssert.equal(toggleAllDiffFiles(keys, new Set(keys)).size, 0);
  NodeAssert.deepEqual([...toggleCollapsedKey(new Set(["a"]), "b")].sort(), ["a", "b"]);
  NodeAssert.equal(toggleCollapsedKey(new Set(["a"]), "a").size, 0);
});

/* ---------------- presentation helpers ---------------- */

NodeTest.test("presentationPath: workspace-relative only", () => {
  NodeAssert.equal(presentationPath("src/app.ts"), "src/app.ts");
  NodeAssert.equal(presentationPath("a/b/c.txt"), "a/b/c.txt");
  NodeAssert.equal(presentationPath("/abs/path"), null);
  NodeAssert.equal(presentationPath("../escape"), null);
  NodeAssert.equal(presentationPath("a/../b"), null);
  NodeAssert.equal(presentationPath("a\\b"), null);
  NodeAssert.equal(presentationPath(""), null);
  NodeAssert.equal(presentationPath("a//b"), null);
});

NodeTest.test("describePresentation: honest resolution report", () => {
  NodeAssert.equal(
    describePresentation({ surfaceId: "t3.files/view", placement: "side-panel" }),
    "opens in t3.files/view · side-panel",
  );
});
