import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  allDirectoriesExpanded,
  buildTreePathUpdates,
  revealAncestors,
  setAllDirectoriesExpanded,
} from "./treeLogic.ts";

NodeTest.describe("native tree path logic", () => {
  NodeTest.it("preserves unchanged paths and removes subtrees recursively", () => {
    NodeAssert.deepEqual(buildTreePathUpdates(["src/", "src/old.ts"], ["src/", "src/new.ts"]), [
      { type: "remove", path: "src/old.ts" },
      { type: "add", path: "src/new.ts" },
    ]);
    NodeAssert.deepEqual(buildTreePathUpdates(["src/", "src/lib/", "src/lib/a.ts"], ["src/"]), [
      { type: "remove", path: "src/lib/", recursive: true },
    ]);
  });

  NodeTest.it("keeps Pierre directory expansion and reveal semantics", () => {
    const expanded = { "src/": false, "src/lib/": false };
    const items = new Map();
    const model = {
      getItem(path) {
        const item = items.get(path) ?? {
          isDirectory: () => true,
          isExpanded: () => expanded[path] ?? false,
          expand: () => {
            expanded[path] = true;
          },
          collapse: () => {
            expanded[path] = false;
          },
        };
        items.set(path, item);
        return item;
      },
    };
    NodeAssert.equal(allDirectoriesExpanded(model, ["src/", "src/lib/"]), false);
    setAllDirectoriesExpanded(model, ["src/", "src/lib/"], true);
    NodeAssert.equal(allDirectoriesExpanded(model, ["src/", "src/lib/"]), true);
    expanded["src/"] = false;
    expanded["src/lib/"] = false;
    revealAncestors(model, "src/lib/file.ts");
    NodeAssert.deepEqual(expanded, { "src/": true, "src/lib/": true });
  });
});
