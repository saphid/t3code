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

const extension = (suffix) => `import dep from "fixture-dep";
import { StaticList${suffix}, DynamicList${suffix} } from "./component.js";
const surface = (name: string) => ({
  id: "test.bundler/" + name,
  title: name + "-" + dep.value,
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

// The template literal embeds a line shaped exactly like a bundled-module
// banner comment — it is string data and must survive the build verbatim.
const TEXT = "before\n// server.ts\nafter";
const SERVER = `import dep from "fixture-dep";
import left from "left-dep";
import right from "right-dep";
import inner from "inner-dep";
import glob from "glob-dep";
import singleA from "alias-a";
import singleB from "alias-b";
import realPkg from "real-pkg";
const text = \`before
// server.ts
after\`;
export default {
  tools: [],
  depValue: dep.value,
  text,
  values: [left, right],
  interop: inner,
  globbed: glob("a"),
  singleA,
  singleB,
  transitive: realPkg,
};
`;

// Real external dependencies that live OUTSIDE the package directory and
// are reached through node_modules symlinks — the shapes that used to leak
// checkout-relative paths into emitted module identities. Everything sits
// under depDir/node_modules so realpath resolution lands modules on a path
// whose canonical label is the node_modules/ suffix:
// - fixture-dep: ordinary named CJS package.
// - left-dep/right-dep: nameless packages (no "name" in package.json) whose
//   index.cjs bytes are IDENTICAL but whose relative imports must resolve
//   into different sibling files — content-equal modules that must not merge.
// - inner-dep: "type": "module" package whose .js entry default-imports a
//   transpiled-looking .cjs — native interop must yield module.exports.
// - glob-dep: dynamic require glob — expanded files never reach onResolve.
// - single: one physical package the fixture links under two names — the
//   bundle must wire both spellings to one instance, not two copies.
// - real-pkg: package whose own dependency (transitive-dep) exists ONLY
//   beside its real target — reachable by realpath, invisible from the
//   symlink spelling.
// - transitive-dep: pulled in solely through real-pkg's sibling lookup.
async function writeSharedDeps(dir) {
  const w = async (pkg, files) => {
    await NodeFSP.mkdir(pkg, { recursive: true });
    await Promise.all(
      Object.entries(files).map(async ([name, body]) => {
        const file = NodePath.join(pkg, name);
        await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
        await NodeFSP.writeFile(file, body);
      }),
    );
  };
  const modules = NodePath.join(dir, "node_modules");
  await Promise.all([
    w(NodePath.join(modules, "fixture-dep"), {
      "package.json": JSON.stringify({
        name: "fixture-dep",
        version: "1.0.0",
        type: "commonjs",
        main: "index.cjs",
        types: "index.d.ts",
      }),
      "index.cjs": "module.exports = { value: 42 };\n",
      "index.d.ts": "declare const dep: { value: number };\nexport default dep;\n",
    }),
    // left-dep / right-dep (nameless, byte-identical index.cjs)
    ...["left", "right"].map((value) =>
      w(NodePath.join(modules, value), {
        "package.json": JSON.stringify({
          version: "1.0.0",
          type: "commonjs",
          main: "index.cjs",
          types: "index.d.ts",
        }),
        "index.cjs": 'module.exports = require("./value.cjs");\n',
        "value.cjs": "module.exports = " + JSON.stringify(value) + ";\n",
        "index.d.ts": "declare const v: string;\nexport default v;\n",
      }),
    ),
    w(NodePath.join(modules, "inner"), {
      "package.json": JSON.stringify({
        name: "inner-dep",
        version: "1.0.0",
        type: "module",
        main: "entry.js",
        types: "entry.d.ts",
      }),
      "entry.js": 'import dep from "./dep.cjs";\nexport default dep;\n',
      "dep.cjs":
        'exports.__esModule = true;\nexports.default = "inner";\nexports.extra = "outer";\n',
      "entry.d.ts": "declare const v: { default: string; extra: string };\nexport default v;\n",
    }),
    w(NodePath.join(modules, "glob-dep"), {
      "package.json": JSON.stringify({
        name: "glob-dep",
        version: "1.0.0",
        type: "commonjs",
        main: "index.cjs",
        types: "index.d.ts",
      }),
      "index.cjs": 'module.exports = (name) => require("./features/" + name + ".cjs");\n',
      "features/a.cjs": 'module.exports = "loaded";\n',
      "index.d.ts": "declare const load: (name: string) => unknown;\nexport default load;\n",
    }),
    // One physical package the fixture links under two spellings.
    w(NodePath.join(modules, "single"), {
      "package.json": JSON.stringify({
        name: "single-dep",
        version: "1.0.0",
        type: "commonjs",
        main: "index.cjs",
        types: "index.d.ts",
      }),
      "index.cjs": 'module.exports = { marker: "single" };\n',
      "index.d.ts": "declare const v: { marker: string };\nexport default v;\n",
    }),
    // real-pkg's require("transitive-dep") resolves only by walking up from
    // its real location — the fixture never links transitive-dep itself.
    w(NodePath.join(modules, "real-pkg"), {
      "package.json": JSON.stringify({
        name: "real-pkg",
        version: "1.0.0",
        type: "commonjs",
        main: "index.cjs",
        types: "index.d.ts",
      }),
      "index.cjs": 'module.exports = require("transitive-dep");\n',
      "index.d.ts": "declare const v: string;\nexport default v;\n",
    }),
    w(NodePath.join(modules, "transitive-dep"), {
      "package.json": JSON.stringify({
        name: "transitive-dep",
        version: "1.0.0",
        type: "commonjs",
        main: "index.cjs",
      }),
      "index.cjs": 'module.exports = "transitive-loaded";\n',
    }),
  ]);
}

// Fixtures live outside the package root: `test/` is in the package's
// `files` list, so temp dirs under it would ship in `npm pack` and race the
// pack scan. A local node_modules symlink gives tsc the real React types —
// exactly what a consuming project gets from its install.
async function writeFixture(dir, jsx = "react-jsx", depDir) {
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
  for (const [entry, target] of [
    ["fixture-dep", "fixture-dep"],
    ["left-dep", "left"],
    ["right-dep", "right"],
    ["inner-dep", "inner"],
    ["glob-dep", "glob-dep"],
    ["alias-a", "single"],
    ["alias-b", "single"],
    ["real-pkg", "real-pkg"],
  ])
    await NodeFSP.symlink(
      NodePath.join(depDir, "node_modules", target),
      NodePath.join(dir, "node_modules", entry),
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
  // Two fixture copies at different depths, each built from a different cwd,
  // each consuming the same out-of-package CommonJS dep through a symlink.
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-bundler-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const depDir = NodePath.join(root, "shared-deps");
  await writeSharedDeps(depDir);
  for (const jsx of ["react-jsx", "react-jsxdev"]) {
    const first = NodePath.join(root, "a", jsx, "proj");
    const second = NodePath.join(root, "b", "nested", "deep", jsx, "proj");
    await writeFixture(first, jsx, depDir);
    await writeFixture(second, jsx, depDir);
    build(first, root);
    const firstBytes = {
      client: await readBundle(first, "client.mjs"),
      server: await readBundle(first, "server.mjs"),
    };
    build(first, sdk);
    NodeAssert.deepEqual(
      await readBundle(first, "client.mjs"),
      firstBytes.client,
      `rebuild from another cwd changed bytes (${jsx})`,
    );
    build(second, first);
    for (const entry of ["client", "server"]) {
      NodeAssert.deepEqual(
        await readBundle(second, `${entry}.mjs`),
        firstBytes[entry],
        `checkout path leaked into ${entry}.mjs (${jsx})`,
      );
    }
    const server = firstBytes.server.toString("utf8");
    // The CommonJS wrapper key is the node_modules spelling, never the
    // depth-dependent relative path the module resolved from — including
    // glob-expanded files, which never reach an onResolve hook.
    NodeAssert.ok(
      server.includes('"node_modules/fixture-dep/index.cjs"'),
      `no canonical dep key: ${jsx}`,
    );
    NodeAssert.ok(
      server.includes('"node_modules/glob-dep/features/a.cjs"'),
      `glob-expanded file lost its canonical key: ${jsx}`,
    );
    NodeAssert.ok(
      server.includes('"node_modules/transitive-dep/index.cjs"'),
      `transitive dep beside a linked package's real target lost its canonical key: ${jsx}`,
    );
    // The built server module imports with everything intact.
    const built = (
      await import(
        NodeURL.pathToFileURL(NodePath.join(second, ".t3-extension/server.mjs")).href +
          "?t=" +
          Date.now()
      )
    ).default;
    NodeAssert.equal(built.text, TEXT, `template-literal content was eaten (${jsx})`);
    NodeAssert.equal(built.depValue, 42, `bundled dep not wired (${jsx})`);
    // Byte-identical nameless packages are distinct modules: their relative
    // imports resolve into different siblings.
    NodeAssert.deepEqual(built.values, ["left", "right"], `content-equal modules merged (${jsx})`);
    // .js inside "type": "module" keeps native interop: a default import of
    // transpiled-looking CJS yields the whole module.exports object.
    NodeAssert.deepEqual(
      built.interop,
      { __esModule: true, default: "inner", extra: "outer" },
      `package-type interop changed (${jsx})`,
    );
    NodeAssert.equal(built.globbed, "loaded", `glob-expanded dep not wired (${jsx})`);
    // Two spellings of one physical package share a single module instance —
    // preserveSymlinks bundled them as separate singletons.
    NodeAssert.equal(
      built.singleA,
      built.singleB,
      `same physical dep under two names bundled twice (${jsx})`,
    );
    // real-pkg's dependency exists only beside its real target — resolution
    // must walk the realpath, not the symlink spelling.
    NodeAssert.equal(
      built.transitive,
      "transitive-loaded",
      `dep beside a linked package's real target did not resolve (${jsx})`,
    );
    for (const entry of ["client", "server"]) {
      const text = firstBytes[entry].toString("utf8");
      for (const line of text.split("\n"))
        // Module banners are single-token `// <id>` lines; esbuild's own
        // helper comments are sentences and stay. With preserveSymlinks a
        // banner is always the import spelling — never ".." or absolute.
        if (/^[ \t]*\/\/ \S+\s*$/.test(line))
          NodeAssert.match(
            line.trim(),
            /^\/\/ (?!.*(\.\.|\/private\/|\/tmp\/|\/var\/))\S+$/,
            `${entry}.mjs embeds a location-dependent comment (${jsx}): ${line.trim()}`,
          );
    }
  }
});

NodeTest.test(
  "host-react shim marks static children validated like the real jsx runtime",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-bundler-"));
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    const depDir = NodePath.join(root, "shared-deps");
    await writeSharedDeps(depDir);
    for (const jsx of ["react-jsx", "react-jsxdev"]) {
      const dir = NodePath.join(root, jsx, "proj");
      await writeFixture(dir, jsx, depDir);
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
