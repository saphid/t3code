import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  compareTreeEntries,
  filterEntries,
  parentPath,
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
