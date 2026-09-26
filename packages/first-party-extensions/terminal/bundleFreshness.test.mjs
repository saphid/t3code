import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const packageDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const committed = NodePath.join(packageDir, ".t3-extension");
const cli = NodePath.join(packageDir, "../../extension-sdk/bin/t3-extension.mjs");

const listFiles = (root, dir = root) =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [NodePath.relative(root, path)];
  });

NodeTest.describe("committed .t3-extension bundle", () => {
  NodeTest.it("matches a fresh build of the source", () => {
    // `t3-extension check` only proves the bundle matches its own receipt, and
    // the bundle inlines SDK and shared code, so an SDK-only change can leave
    // it stale without touching this package. Rebuild a copy and compare.
    const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-terminal-fresh-"));
    try {
      const source = NodePath.join(temp, "terminal");
      NodeFS.cpSync(packageDir, source, {
        recursive: true,
        filter: (path) => {
          const name = NodePath.basename(path);
          return (
            name !== "node_modules" &&
            name !== ".t3-extension" &&
            !name.startsWith(".t3-extension-build-")
          );
        },
      });
      NodeFS.symlinkSync(
        NodePath.join(packageDir, "node_modules"),
        NodePath.join(source, "node_modules"),
      );
      NodeChildProcess.execFileSync(process.execPath, [cli, "build", source], { stdio: "pipe" });
      const built = NodePath.join(source, ".t3-extension");
      const files = listFiles(committed).sort();
      NodeAssert.deepEqual(listFiles(built).sort(), files);
      for (const file of files) {
        NodeAssert.ok(
          NodeFS.readFileSync(NodePath.join(built, file)).equals(
            NodeFS.readFileSync(NodePath.join(committed, file)),
          ),
          `${file} is stale; run \`vp run build\` in packages/first-party-extensions/terminal`,
        );
      }
    } finally {
      NodeFS.rmSync(temp, { recursive: true, force: true });
    }
  });

  NodeTest.it("declares terminal focus so host chords such as mod+n stay in the view", () => {
    // Without the claim the host does not tag the frame as terminal focus and
    // mod+n resolves to chat.new (the new-thread picker opens).
    const pkg = JSON.parse(
      NodeFS.readFileSync(NodePath.join(committed, "t3-extension.json"), "utf8"),
    );
    const view = pkg.manifest.surfaces.find((surface) => surface.id === "t3.terminal/view");
    NodeAssert.equal(view?.claimsTerminalFocus, true);
  });
});
