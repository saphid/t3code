import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  compareTreeEntries,
  describeRead,
  describeSaveState,
  describeSearch,
  describeSnapshot,
  filterEntries,
  mediaPreviewNotice,
  parentPath,
  previewKind,
  sortTreeEntries,
  toggleExpanded,
  visibleRows,
} from "./viewModel.ts";

const fixture = [
  { path: "src/lib", kind: "directory" },
  { path: "README.md", kind: "file" },
  { path: "src", kind: "directory" },
  { path: "src/lib/deep.ts", kind: "file" },
  { path: "src/app.ts", kind: "file" },
  { path: "docs", kind: "directory" },
  { path: "docs/guide.md", kind: "file" },
];

NodeTest.describe("files view model", () => {
  NodeTest.it("sorts directories before files within the same parent", () => {
    NodeAssert.deepEqual(
      sortTreeEntries([
        { path: "b.ts", kind: "file" },
        { path: "a", kind: "directory" },
        { path: "a.ts", kind: "file" },
      ]).map((entry) => entry.path),
      ["a", "a.ts", "b.ts"],
    );
    NodeAssert.ok(
      compareTreeEntries({ path: "z", kind: "directory" }, { path: "a", kind: "file" }) < 0,
    );
  });

  NodeTest.it("orders nested paths depth-first under their parent", () => {
    NodeAssert.deepEqual(
      sortTreeEntries(fixture).map((entry) => entry.path),
      ["docs", "docs/guide.md", "src", "src/lib", "src/lib/deep.ts", "src/app.ts", "README.md"],
    );
  });

  NodeTest.it("hides children of collapsed directories and reports depth", () => {
    const rows = visibleRows(fixture, new Set(["src"]));
    NodeAssert.deepEqual(
      rows.map((row) => [row.entry.path, row.depth]),
      [
        ["docs", 0],
        ["src", 0],
        ["src/lib", 1],
        ["src/app.ts", 1],
        ["README.md", 0],
      ],
    );
    NodeAssert.equal(rows.find((row) => row.entry.path === "src")?.expandable, true);
    NodeAssert.equal(rows.find((row) => row.entry.path === "README.md")?.expandable, false);
  });

  NodeTest.it("toggles expansion immutably", () => {
    const expanded = new Set(["src"]);
    const collapsed = toggleExpanded(expanded, "src");
    NodeAssert.equal(collapsed.has("src"), false);
    NodeAssert.equal(expanded.has("src"), true);
    NodeAssert.equal(toggleExpanded(expanded, "docs").has("docs"), true);
  });

  NodeTest.it("filter keeps matches plus ancestors and ignores expansion", () => {
    const keep = filterEntries(fixture, "deep");
    NodeAssert.deepEqual([...keep].sort(), ["src", "src/lib", "src/lib/deep.ts"]);
    const rows = visibleRows(fixture, new Set(), "DEEP");
    NodeAssert.deepEqual(
      rows.map((row) => row.entry.path),
      ["src", "src/lib", "src/lib/deep.ts"],
    );
  });

  NodeTest.it("parentPath climbs to the root", () => {
    NodeAssert.equal(parentPath("a/b/c.ts"), "a/b");
    NodeAssert.equal(parentPath("a"), null);
  });
});

NodeTest.describe("preview classification", () => {
  NodeTest.it("maps media extensions to media kinds, unknowns to text", () => {
    NodeAssert.equal(previewKind("src/app.ts"), "text");
    NodeAssert.equal(previewKind("README"), "text");
    NodeAssert.equal(previewKind(".gitignore"), "text");
    NodeAssert.equal(previewKind("docs/photo.PNG"), "image");
    NodeAssert.equal(previewKind("clip.mov"), "video");
    NodeAssert.equal(previewKind("song.MP3"), "audio");
    NodeAssert.equal(previewKind("font.woff2"), "font");
    NodeAssert.equal(previewKind("archive.tar.gz"), "binary");
    NodeAssert.equal(previewKind("module.wasm"), "binary");
    NodeAssert.equal(previewKind("data.unknownext"), "text");
  });
});

NodeTest.describe("describeRead", () => {
  NodeTest.it("reports a full read with the file byte length", () => {
    const described = describeRead({ contents: "hello\n", byteLength: 6, truncated: false });
    NodeAssert.equal(described.truncated, false);
    NodeAssert.equal(described.shownByteLength, 6);
    NodeAssert.equal(described.status, "File loaded — 6 bytes (read only)");
  });

  NodeTest.it("marks truncation honestly with shown vs true byte length", () => {
    const described = describeRead({
      contents: "a".repeat(48000),
      byteLength: 60_000,
      truncated: true,
    });
    NodeAssert.equal(described.truncated, true);
    NodeAssert.equal(described.shownByteLength, 48000);
    NodeAssert.equal(
      described.status,
      "File truncated — showing first 48,000 of 60,000 bytes (read only)",
    );
  });

  NodeTest.it("measures shown bytes in UTF-8, not chars", () => {
    const described = describeRead({ contents: "é".repeat(10), byteLength: 40, truncated: true });
    NodeAssert.equal(described.shownByteLength, 20);
    NodeAssert.match(described.status, /showing first 20 of 40 bytes/);
  });
});

NodeTest.describe("describeSearch", () => {
  NodeTest.it("is empty while the query is blank and pending before results land", () => {
    NodeAssert.equal(describeSearch(null, "  ", 100), "");
    NodeAssert.equal(describeSearch(null, "app", 100), "Searching for “app”");
  });

  NodeTest.it("reports no-match and exact-match states", () => {
    NodeAssert.equal(
      describeSearch({ entries: [], truncated: false }, "zzz", 100),
      "No matches for “zzz”",
    );
    NodeAssert.equal(
      describeSearch(
        { entries: [{ path: "src/app.ts", kind: "file" }], truncated: false },
        "app",
        100,
      ),
      "1 match for “app” (limit 100)",
    );
  });

  NodeTest.it("marks wire truncation honestly instead of claiming completeness", () => {
    const result = {
      entries: Array.from({ length: 100 }, (_, i) => ({
        path: `f${i}.ts`,
        kind: "file",
      })),
      truncated: true,
    };
    NodeAssert.equal(
      describeSearch(result, "f", 100),
      "100+ matches for “f” (limit 100) — showing first 100, refine the query",
    );
  });
});

NodeTest.describe("mediaPreviewNotice", () => {
  NodeTest.it("names the missing contract instead of faking a preview", () => {
    for (const kind of ["image", "video", "audio", "font", "binary"]) {
      NodeAssert.match(mediaPreviewNotice(kind), new RegExp(`^${kind} preview is not public yet`));
      NodeAssert.match(mediaPreviewNotice(kind), /t3\.workspace\/resources/);
    }
  });
});

NodeTest.describe("describeSnapshot", () => {
  NodeTest.it("opens editable snapshots with contents and revision", () => {
    NodeAssert.deepEqual(
      describeSnapshot({
        kind: "editable",
        contents: "hello\n",
        revision: "a".repeat(64),
      }),
      { editable: true, contents: "hello\n", revision: "a".repeat(64) },
    );
  });

  NodeTest.it(
    "names the 24000-byte bound for oversized files — read-only, never silent truncation",
    () => {
      const open = describeSnapshot({ kind: "not-editable", reason: "oversized" });
      NodeAssert.equal(open.editable, false);
      NodeAssert.equal(open.reason, "oversized");
      NodeAssert.match(open.message, /24,000-byte editable bound/);
      NodeAssert.match(open.message, /read only/);
    },
  );

  NodeTest.it("names binary and invalid-utf8 as read-only reasons", () => {
    NodeAssert.match(
      describeSnapshot({ kind: "not-editable", reason: "binary" }).message,
      /Binary file/,
    );
    NodeAssert.match(
      describeSnapshot({ kind: "not-editable", reason: "invalid-utf8" }).message,
      /not valid UTF-8/,
    );
  });
});

NodeTest.describe("describeSaveState", () => {
  NodeTest.it("labels every coordinator state", () => {
    NodeAssert.equal(describeSaveState({ kind: "clean" }), "No unsaved changes");
    NodeAssert.equal(describeSaveState({ kind: "dirty" }), "Unsaved changes");
    NodeAssert.equal(describeSaveState({ kind: "saving" }), "Saving");
    NodeAssert.equal(describeSaveState({ kind: "saved" }), "Saved");
    NodeAssert.match(describeSaveState({ kind: "conflict" }), /changed on disk/);
    NodeAssert.match(
      describeSaveState({ kind: "error", message: "io" }),
      /Save failed: io.*changes are kept/,
    );
  });
});
