import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";
import { staleBundleFiles } from "../scripts/check-bundles.mjs";

NodeTest.test("committed .t3-extension matches a fresh build of the source", () => {
  // The bundle inlines SDK and shared code, so a change outside this package
  // can stale it; `t3-extension check` alone would not notice.
  const packageDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
  NodeAssert.deepEqual(
    staleBundleFiles(packageDir),
    [],
    "run `vp run build` in " + NodePath.basename(packageDir) + " and commit .t3-extension",
  );
});
