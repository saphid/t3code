import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import React from "react";
import TestRenderer from "react-test-renderer";

const sdk = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const cli = NodePath.join(sdk, "bin/t3-extension.mjs");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A self-contained extension source: no SDK import (the fixture only proves
// bundler behavior), real JSX through the automatic transform, and a server
// entry so both emitted bundles are exercised.
const tsconfig = (jsx) =>
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      jsx,
      allowImportingTsExtensions: true,
    },
    include: ["*.ts", "*.tsx"],
  });

// Component names and list tags vary per variant because dev React dedupes
// the missing-key warning per reconciled parent fiber name — "ul" in the
// prod pass would suppress the dev pass's warning if both used it.
const component = (suffix, list) => `export function StaticList${suffix}() {
  return (
    <${list}>
      <li>static one</li>
      <li>static two</li>
    </${list}>
  );
}
export function DynamicList${suffix}() {
  return <${list}>{["a", "b"].map((item) => <li>{item}</li>)}</${list}>;
}
`;

const extension = (
  suffix,
) => `import { StaticList${suffix}, DynamicList${suffix} } from "./component.js";
const surface = (name: string) => ({
  id: "test.bundler/" + name,
  title: name,
  placements: ["side-panel"],
  clients: ["web"],
  scope: "environment",
  capabilities: [],
  stateVersion: 1,
});
const manifest = {
  id: "test.bundler",
  apiVersion: 1,
  version: "1.0.0",
  surfaces: [surface("static-${suffix.toLowerCase()}"), surface("dynamic-${suffix.toLowerCase()}")],
};
export default {
  package: {
    format: 2,
    manifest,
    clientEntry: "client.mjs",
    serverEntry: "server.mjs",
    tools: [],
    dependencies: [],
    provides: [],
    requires: [],
  },
  serverEntry: "server.ts",
  client: () => ({
    manifest,
    surfaces: [
      {
        id: "test.bundler/static-${suffix.toLowerCase()}",
        validateRestore: () => true,
        createView: () => ({ renderer: StaticList${suffix} }),
      },
      {
        id: "test.bundler/dynamic-${suffix.toLowerCase()}",
        validateRestore: () => true,
        createView: () => ({ renderer: DynamicList${suffix} }),
      },
    ],
  }),
};
`;

const SERVER = "export default { tools: [] };\n";

// Fixtures live outside the package root: `test/` is in the package's
// `files` list, so temp dirs under it would ship in `npm pack` and race the
// pack scan. A local node_modules symlink gives tsc the real React types —
// exactly what a consuming project gets from its install.
async function writeFixture(dir, jsx = "react-jsx") {
  const suffix = jsx === "react-jsxdev" ? "Dev" : "Prod";
  const list = jsx === "react-jsxdev" ? "ol" : "ul";
  await NodeFSP.mkdir(NodePath.join(dir, "node_modules", "@types"), { recursive: true });
  await NodeFSP.symlink(
    NodePath.join(sdk, "node_modules/react"),
    NodePath.join(dir, "node_modules", "react"),
  );
  await NodeFSP.symlink(
    NodePath.join(sdk, "node_modules/@types/react"),
    NodePath.join(dir, "node_modules", "@types", "react"),
  );
  await NodeFSP.writeFile(NodePath.join(dir, "tsconfig.json"), tsconfig(jsx));
  await NodeFSP.writeFile(NodePath.join(dir, "extension.ts"), extension(suffix));
  await NodeFSP.writeFile(NodePath.join(dir, "component.tsx"), component(suffix, list));
  await NodeFSP.writeFile(NodePath.join(dir, "server.ts"), SERVER);
}

function build(dir, cwd) {
  const result = NodeChildProcess.spawnSync(process.execPath, [cli, "build", dir], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0)
    throw new Error(`t3-extension build ${dir} (cwd ${cwd}) failed:\n${result.stderr}`);
}

const readBundle = (dir, entry) => NodeFSP.readFile(NodePath.join(dir, ".t3-extension", entry));

NodeTest.test("bundler output is deterministic across build cwd and checkout path", async (t) => {
  // Two fixture copies at different depths, each built from a different cwd.
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-bundler-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  for (const jsx of ["react-jsx", "react-jsxdev"]) {
    const first = NodePath.join(root, "a", jsx, "proj");
    const second = NodePath.join(root, "b", "nested", "deep", jsx, "proj");
    await writeFixture(first, jsx);
    await writeFixture(second, jsx);
    build(first, root);
    const firstBytes = await readBundle(first, "client.mjs");
    build(first, sdk);
    NodeAssert.deepEqual(
      await readBundle(first, "client.mjs"),
      firstBytes,
      `rebuild from another cwd changed bytes (${jsx})`,
    );
    build(second, first);
    NodeAssert.deepEqual(
      await readBundle(second, "client.mjs"),
      firstBytes,
      `checkout path leaked into the bundle (${jsx})`,
    );
    for (const entry of ["client.mjs", "server.mjs"]) {
      const text = (await readBundle(second, entry)).toString("utf8");
      NodeAssert.ok(
        // Module banners are single-token `// <path>` lines; esbuild's own
        // helper comments are sentences and stay.
        !/^[ \t]*\/\/ \S+$/m.test(text),
        `${entry} still embeds a module path comment (${jsx})`,
      );
    }
  }
});

NodeTest.test(
  "host-react shim marks static children validated like the real jsx runtime",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-bundler-"));
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    for (const jsx of ["react-jsx", "react-jsxdev"]) {
      const dir = NodePath.join(root, jsx, "proj");
      await writeFixture(dir, jsx);
      build(dir, root);
      const factory = (
        await import(
          NodeURL.pathToFileURL(NodePath.join(dir, ".t3-extension/client.mjs")).href +
            "?t=" +
            Date.now()
        )
      ).default;
      const extension = factory({ React });
      const suffix = jsx === "react-jsxdev" ? "Dev" : "Prod";
      const rendererFor = (id) =>
        extension.surfaces.find((surface) => surface.id === id).createView({}).renderer;

      const errors = [];
      const original = console.error;
      console.error = (...args) => errors.push(args.join(" "));
      try {
        for (const id of [
          `test.bundler/static-${suffix.toLowerCase()}`,
          `test.bundler/dynamic-${suffix.toLowerCase()}`,
        ]) {
          const Component = rendererFor(id);
          let tree;
          await TestRenderer.act(async () => {
            tree = TestRenderer.create(React.createElement(Component));
          });
          NodeAssert.ok(tree.toJSON(), `${id} rendered nothing (${jsx})`);
          await TestRenderer.act(async () => tree.unmount());
        }
      } finally {
        console.error = original;
      }
      const keyWarnings = errors.filter((line) => line.includes('unique "key" prop'));
      // The dynamic unkeyed map still warns — marking is surgical, not
      // blanket. The static sibling group must not warn at all.
      NodeAssert.equal(keyWarnings.length, 1, `warnings (${jsx}): ${keyWarnings.join(" | ")}`);
      NodeAssert.ok(
        keyWarnings[0].includes(`DynamicList${suffix}`),
        `warning should name the dynamic-list owner (${jsx}): ${keyWarnings[0]}`,
      );
    }
  },
);
