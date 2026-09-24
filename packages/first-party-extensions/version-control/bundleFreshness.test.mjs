import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";
import { committedBundles, staleBundleFiles } from "../scripts/check-bundles.mjs";

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

NodeTest.test("gate discovery fails closed on a bundle committed without its receipt", () => {
  NodeAssert.deepEqual(
    committedBundles([
      "packages/first-party-extensions/diff/.t3-extension/client.mjs",
      "packages/first-party-extensions/diff/.t3-extension/receipt.json",
      "packages/extension-sdk/examples/counter/.t3-extension/receipt.json",
      "packages/first-party-extensions/files/.t3-extension/client.mjs",
      "packages/first-party-extensions/files/viewModel.ts",
    ]),
    {
      packs: ["packages/extension-sdk/examples/counter", "packages/first-party-extensions/diff"],
      missingReceipt: ["packages/first-party-extensions/files"],
    },
  );
});

NodeTest.test("a wedged pack build fails with a timeout instead of hanging", () => {
  const packageDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
  NodeAssert.throws(() => staleBundleFiles(packageDir, { timeoutMs: 1 }), /timed out after 1ms/);
});
