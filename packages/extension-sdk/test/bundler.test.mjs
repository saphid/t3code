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
const component = (suffix, list) => `import DepView from "jsx-dep";
export function StaticList${suffix}() {
  return (
    <${list}>
      <li>static one</li>
      <li>static two</li>
      <DepView />
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
import uni from "uni-dep";
const text = \`before
// server.ts
after\`;
export default {
  tools: [],
  depValue: dep.value,
  text,
  values: [left, right],
  interop: inner,
  globbed: glob.feature("a"),
  plugged: glob.plugin("b"),
  quoted: glob.feature('qu"ote'),
  loadFault: glob.feature,
  uni,
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
// - glob-dep: two dynamic require globs in one importer — expanded files
//   never reach onResolve — plus non-ASCII and quote-containing filenames
//   whose emitted keys arrive JavaScript-escaped.
// - single: one physical package the fixture links under two names — the
//   bundle must wire both spellings to one instance, not two copies.
// - real-pkg: package whose own dependency (transitive-dep) exists ONLY
//   beside its real target — reachable by realpath, invisible from the
//   symlink spelling.
// - transitive-dep: pulled in solely through real-pkg's sibling lookup.
// - uni-dep: a package whose entry filename is non-ASCII — esbuild emits
//   its label ASCII-escaped, so matching must decode first.
// - jsx-dep: a package whose entry is .tsx — jsxdev emits its escaped path
//   as fileName metadata inside each jsxDEV call.
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
      "index.cjs":
        'exports.feature = (name) => require("./features/" + name + ".cjs");\n' +
        'exports.plugin = (name) => require("./plugins/" + name + ".cjs");\n',
      "features/a.cjs": 'module.exports = "loaded";\n',
      "features/fail-é.cjs": 'throw new Error("glob-fault");\n',
      'features/qu"ote.cjs': 'module.exports = "quoted";\n',
      "plugins/b.cjs": 'module.exports = "plugged";\n',
      "index.d.ts":
        "declare const load: { feature: (name: string) => unknown; plugin: (name: string) => unknown };\nexport default load;\n",
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
    w(NodePath.join(modules, "uni-dep"), {
      "package.json": JSON.stringify({
        name: "uni-dep",
        version: "1.0.0",
        type: "commonjs",
        main: "café.cjs",
        types: "index.d.ts",
      }),
      "café.cjs": 'module.exports = "café";\n',
      "index.d.ts": "declare const v: string;\nexport default v;\n",
    }),
    w(NodePath.join(modules, "jsx-dep"), {
      "package.json": JSON.stringify({
        name: "jsx-dep",
        version: "1.0.0",
        type: "module",
        main: "view.tsx",
        types: "view.d.ts",
      }),
      "view.tsx": "export default function DepView() {\n  return <b>dep</b>;\n}\n",
      "view.d.ts": "declare const v: () => null;\nexport default v;\n",
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
    ["uni-dep", "uni-dep"],
    ["jsx-dep", "jsx-dep"],
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
    const client = firstBytes.client.toString("utf8");
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
    // Escaped and quote-bearing filenames canonicalize too: esbuild emits
    // café.cjs as caf\xE9.cjs and qu"ote.cjs in single quotes — the emitted
    // spelling asserts the decoded name is canonical.
    NodeAssert.ok(
      server.includes('"node_modules/uni-dep/caf\\xE9.cjs"('),
      `escaped dep key not canonicalized: ${jsx}`,
    );
    NodeAssert.ok(
      server.includes('"node_modules/glob-dep/features/fail-\\xE9.cjs"('),
      `escaped glob-expanded key not canonicalized: ${jsx}`,
    );
    NodeAssert.ok(
      server.includes("'node_modules/glob-dep/features/qu\"ote.cjs'("),
      `quote-bearing dep key not canonicalized: ${jsx}`,
    );
    // Each glob-expansion synthetic name keeps its own require pattern with
    // a canonical importer — distinct labels, no literal "$1" interpolation
    // bug.
    NodeAssert.ok(
      server.includes("'require(\"./features/**/*.cjs\") in node_modules/glob-dep/index.cjs'("),
      `features glob synthetic name not canonical: ${jsx}`,
    );
    NodeAssert.ok(
      server.includes("'require(\"./plugins/**/*.cjs\") in node_modules/glob-dep/index.cjs'("),
      `plugins glob synthetic name not canonical: ${jsx}`,
    );
    NodeAssert.ok(
      server.includes('// require("./plugins/**/*.cjs") in node_modules/glob-dep/index.cjs'),
      `glob synthetic banner not canonical: ${jsx}`,
    );
    NodeAssert.ok(!server.includes("$1"), `literal "$1" in output: ${jsx}`);
    // No generated method key retains a checkout-relative spelling.
    NodeAssert.ok(
      !/^[\t ]*["'][^"'\n]*\.\.[^"'\n]*["']\s*\(/m.test(server),
      `checkout-relative wrapper key survived: ${jsx}`,
    );
    if (jsx === "react-jsxdev") {
      // jsxdev emits dep source paths as fileName metadata — canonical there
      // too, not just in comments and keys.
      NodeAssert.ok(
        client.includes('fileName: "node_modules/jsx-dep/view.tsx"'),
        `jsxdep fileName not canonicalized: ${jsx}`,
      );
      NodeAssert.ok(
        !/fileName:\s*["']\.{2}/.test(client),
        `checkout-relative fileName survived: ${jsx}`,
      );
    }
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
    NodeAssert.equal(built.plugged, "plugged", `second glob pattern not wired (${jsx})`);
    NodeAssert.equal(built.quoted, "quoted", `quote-named glob file not wired (${jsx})`);
    NodeAssert.equal(built.uni, "café", `non-ASCII dep entry not wired (${jsx})`);
    // A lazily required dep that throws: the runtime stack's function label
    // is the canonical module name, not the checkout-relative source path.
    // (The executing bundle's own file:// URL is expected and unrelated.)
    let fault = null;
    try {
      built.loadFault("fail-é");
    } catch (error) {
      fault = error;
    }
    NodeAssert.ok(fault, `throwing dep did not throw (${jsx})`);
    NodeAssert.ok(
      fault.stack.includes("at node_modules/glob-dep/features/fail-é.cjs"),
      `stack label not canonical (${jsx}): ${fault.stack}`,
    );
    NodeAssert.ok(
      !fault.stack.includes("shared-deps") && !/at \.{2}/.test(fault.stack),
      `checkout-relative label leaked into stack (${jsx}): ${fault.stack}`,
    );
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

NodeTest.test("canonicalization leaves path-shaped user data byte-for-byte intact", async (t) => {
  // The external dependency-relative path a bundled module is labeled
  // with can also legitimately appear in extension data — as a string
  // literal, inside a template, even as an object method name. Only
  // generated metadata positions may be rewritten.
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-bundler-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const depDir = NodePath.join(root, "shared-deps");
  await writeSharedDeps(depDir);
  const dir = NodePath.join(root, "data-probe");
  await writeFixture(dir, "react-jsx", depDir);
  // The emitted label spelling for fixture-dep's entry in this checkout —
  // an escaping path like ../shared-deps/node_modules/fixture-dep/index.cjs.
  const depLabel = NodePath.relative(
    dir,
    await NodeFSP.realpath(NodePath.join(depDir, "node_modules", "fixture-dep", "index.cjs")),
  );
  NodeAssert.ok(depLabel.startsWith(".."), "fixture does not exercise the leak shape");
  // An escaped spelling that decodes to the same path — string contents
  // are user data even when they equal a generated label's decode. The
  // source text must hold a real \x69 escape, so interpolate directly.
  const mixedLabel = depLabel.replace("index.cjs", "\\x69ndex.cjs");
  const template = `before\nfileName: "${depLabel}", lineNumber: 17\n// ${depLabel}\nafter`;
  const source = `import dep from "fixture-dep";
function user__esm(value: object) { return value; }
export default {
  tools: [],
  depValue: dep.value,
  pathLiteral: ${JSON.stringify(depLabel)},
  bannerLiteral: \`before
// ${depLabel}
after\`,
  labelKeyed: { ${JSON.stringify(depLabel)}() { return 7; } },
  // Ordinary records shaped like JSX fileName metadata are not labels.
  record: { fileName: ${JSON.stringify(depLabel)}, lineNumber: 17 },
  prefixRecord: { fileName: ${JSON.stringify(depLabel)}, lineNumberExtra: 23 },
  // A user identifier ending in a generated-suffix name is not a wrapper.
  adjacent: user__esm({ ${JSON.stringify(depLabel)}() { return 8; } }),
  // The same label inside metadata-shaped template text is still data.
  template: \`${template}\`,
  // Regex literals — including ones following control-flow parens — are
  // not string positions the rewriter may touch.
  regex: /__esm\\(\\{/.source,
  regexAfterParen: ("x".length ? ${JSON.stringify(depLabel)} : "") && /\\.\\./.test(".."),
  regexLabelBody: ${JSON.stringify(depLabel)}.length ? /\\.\\.\\/shared-deps/.source : "",
  mixed: "${mixedLabel}",
};
`;
  await NodeFSP.writeFile(NodePath.join(dir, "server.ts"), source);
  build(dir, root);
  const built = (
    await import(
      NodeURL.pathToFileURL(NodePath.join(dir, ".t3-extension/server.mjs")).href +
        "?t=" +
        Date.now()
    )
  ).default;
  NodeAssert.equal(
    built.pathLiteral,
    depLabel,
    "dependency-relative path string literal was rewritten",
  );
  NodeAssert.equal(
    built.bannerLiteral,
    `before\n// ${depLabel}\nafter`,
    "banner-shaped line inside a template literal was rewritten",
  );
  NodeAssert.equal(
    built.labelKeyed[depLabel](),
    7,
    "user object method named like a dep path was renamed",
  );
  NodeAssert.deepEqual(
    built.record,
    { fileName: depLabel, lineNumber: 17 },
    "ordinary fileName/lineNumber record was rewritten",
  );
  NodeAssert.deepEqual(
    built.prefixRecord,
    { fileName: depLabel, lineNumberExtra: 23 },
    "ordinary fileName/lineNumberExtra record was rewritten",
  );
  NodeAssert.equal(
    built.adjacent[depLabel](),
    8,
    "label-shaped key inside a __esm-suffixed user call was rewritten",
  );
  NodeAssert.equal(built.template, template, "metadata-shaped template text was rewritten");
  NodeAssert.equal(built.regex, "__esm\\(\\{", "regex literal source was rewritten");
  NodeAssert.equal(
    built.regexAfterParen,
    true,
    "regex literal after a control-flow paren was corrupted",
  );
  NodeAssert.equal(
    built.regexLabelBody,
    "\\.\\.\\/shared-deps",
    "regex literal following a label-shaped operand was corrupted",
  );
  NodeAssert.equal(
    built.mixed,
    depLabel,
    "escaped spelling of a dep path in user data was rewritten",
  );
  // The generated metadata for the same module is still canonical.
  const server = (await readBundle(dir, "server.mjs")).toString("utf8");
  NodeAssert.ok(
    server.includes('"node_modules/fixture-dep/index.cjs"'),
    "dep wrapper key lost its canonical label",
  );
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
