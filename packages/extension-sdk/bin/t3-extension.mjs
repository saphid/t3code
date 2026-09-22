#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeChildProcess from "node:child_process";
import { build } from "esbuild";
import { validateEnvironmentPackage, validateServerExtension } from "../dist/environment.js";
const sdk = NodePath.resolve(NodeURL.fileURLToPath(new URL("..", import.meta.url)));
const require = NodeModule.createRequire(import.meta.url);
const [command, target = "."] = process.argv.slice(2);
const sha = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
// esbuild stamps each bundled module's resolved path — relative to
// absWorkingDir — into `//` banner comments, CommonJS wrapper keys
// ("../../dep/index.js"(exports, module){…}), synthetic glob-expansion
// module names (`require("<pattern>") in <importer>`), and jsxdev fileName
// metadata, so emitted bytes (and every receipt hash) used to depend on
// where the build ran and where the checkout lived. Resolution stays
// native (realpath'd): preserveSymlinks made labels pretty but stopped
// finding dependencies installed beside a linked package's real target
// and bundled two spellings of one module as separate singletons.
//
// Finding the generated labels inside emitted JavaScript is a losing
// game — string-shaped user data is indistinguishable from string-shaped
// metadata — so the build is staged instead. A first plain bundle run
// reports every input through metafile and a passive onResolve recorder.
// A second run then repeats the build inside a staging directory: the
// package's own files are hardlinked at their usual relative positions,
// every out-of-package input is hardlinked under a random per-build
// directory that reproduces its real absolute path (preserving each
// package's package.json, node_modules ancestry, and directory
// neighbourhood verbatim), and package-level bare imports are routed by
// symlinks in the staging root's node_modules. Every resolution in the
// staged build is native — nothing a plugin returns can lose module
// type, tsconfig, or sideEffects context — yet every label esbuild
// emits for an outside input contains the unguessable token, so the
// rewrite substitutes whole known labels without ever classifying
// emitted text. A dep file with no named package above it falls back
// to the path suffix starting at its last node_modules/ segment; one
// outside both (a file: link to a bare directory) keeps a location-
// dependent label, deliberately rather than guessed at. Any mismatch
// between the staged run's inputs and the plain run's makes the packer
// keep the plain output — wrong labels never ship.
const packageRoot = (file) => {
  let cursor = NodePath.dirname(file);
  while (true) {
    if (NodeFS.existsSync(NodePath.join(cursor, "package.json"))) return cursor;
    const parent = NodePath.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
};
const packageLabel = (file) => {
  let cursor = NodePath.dirname(file);
  while (true) {
    try {
      const pkg = JSON.parse(NodeFS.readFileSync(NodePath.join(cursor, "package.json"), "utf8"));
      if (typeof pkg.name === "string" && pkg.name.length > 0) {
        const rel = NodePath.relative(cursor, file).split(NodePath.sep).join("/");
        return `node_modules/${pkg.name}/${rel}`;
      }
    } catch {}
    const parent = NodePath.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
};
const canonicalLabel = (file) =>
  packageLabel(file) ??
  (() => {
    const path = file.split(NodePath.sep).join("/");
    const at = path.lastIndexOf("node_modules/");
    return at === -1 ? null : path.slice(at);
  })();
// Escape a label for a string literal, keeping the quote character esbuild
// chose (it picks ' when the name contains ") and escaping non-ASCII the
// way it does: \xNN, \uNNNN, \u{NNNNN}.
const escapeLabel = (value, quote) => {
  let out = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (ch === "\\" || ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f)
      out += "\\x" + cp.toString(16).toUpperCase().padStart(2, "0");
    else if (cp < 0x80) out += ch;
    else if (cp <= 0xff) out += "\\x" + cp.toString(16).toUpperCase().padStart(2, "0");
    else
      out +=
        cp <= 0xffff
          ? "\\u" + cp.toString(16).toUpperCase().padStart(4, "0")
          : "\\u{" + cp.toString(16) + "}";
  }
  return out;
};
// A path inside dir as a relative string, or null when it escapes.
const insideRel = (dir, file) => {
  const rel = NodePath.relative(dir, file);
  return rel !== ".." && !rel.startsWith(".." + NodePath.sep) && !NodePath.isAbsolute(rel)
    ? rel
    : null;
};
// "a/b/c.js" for "/a/b/c.js" (and "a\b\c.js" for "C:\a\b\c.js").
const stripRoot = (abs) => abs.slice(NodePath.parse(abs).root.length);
const isBareSpecifier = (spec) =>
  !spec.startsWith(".") &&
  !spec.startsWith("/") &&
  !spec.startsWith("#") &&
  !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec);
const specifierPackage = (spec) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
// Passive recorder: resolve exactly as a plain build would (delegating to
// esbuild's own resolver from the real importer path) and remember each
// edge, then return undefined so native resolution proceeds unchanged.
const recordResolutions = (edges) => ({
  name: "t3-record-resolutions",
  setup(api) {
    const inner = {};
    api.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData === inner) return undefined;
      const resolved = await api
        .resolve(args.path, {
          kind: args.kind,
          importer: args.importer || undefined,
          namespace: args.namespace,
          resolveDir: args.importer ? NodePath.dirname(args.importer) : args.resolveDir,
          pluginData: inner,
          with: args.with,
        })
        .catch(() => null);
      edges.push({
        importer: args.importer,
        spec: args.path,
        path:
          resolved !== null &&
          resolved.errors.length === 0 &&
          !resolved.external &&
          resolved.namespace === "file" &&
          resolved.path !== ""
            ? resolved.path
            : null,
      });
      return undefined;
    });
  },
});
// Re-run the build inside a staging directory where every out-of-package
// input sits under "<stage>/<token>/<its real absolute path>". Package
// files keep their relative positions so their emitted labels are
// unchanged, while every outside label carries the token. Returns the
// emitted text with token labels rewritten to canonical ones, or null
// when the staged module graph differs from the plain build's.
const buildStaged = (dir, inputs, edges) => {
  const tmp = NodeFS.mkdtempSync(NodePath.join(dir, ".t3stage-"));
  const fail = () => {
    NodeFS.rmSync(tmp, { recursive: true, force: true });
    return null;
  };
  try {
    const token = ".t3canon-" + NodeCrypto.randomBytes(6).toString("hex");
    const outside = new Set();
    for (const key of Object.keys(inputs)) {
      if (key.startsWith("<") || (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key) && !/^[a-zA-Z]:/.test(key)))
        continue;
      const abs = NodePath.resolve(dir, key);
      if (insideRel(dir, abs) === null) outside.add(abs);
    }
    if (outside.size === 0) return fail();
    // An importer at <stage>/<tail> whose specifier climbs past the
    // staging root probes directories between the stage and tmp. One pad
    // directory per escape level keeps those probes inside our sandbox so
    // a symlink can redirect them to the mirrored target.
    const mirrorRelOf = (real) => {
      const rel = insideRel(dir, real);
      return rel === null ? token + "/" + stripRoot(real).split(NodePath.sep).join("/") : rel;
    };
    let pads = 0;
    const escapes = [];
    for (const edge of edges) {
      if (
        edge.path === null ||
        edge.importer === "" ||
        edge.spec.startsWith("/") ||
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(edge.spec)
      )
        continue;
      const importerDir = NodePath.dirname(mirrorRelOf(edge.importer));
      const probe = NodePath.normalize(NodePath.join(importerDir, edge.spec));
      const segs = probe.split(NodePath.sep);
      let climb = 0;
      while (segs[climb] === "..") climb++;
      if (climb === 0) continue;
      pads = Math.max(pads, climb);
      escapes.push({ edge, climb });
    }
    if (pads > 16) return fail();
    let stage = tmp;
    for (let i = 0; i < pads; i++) stage = NodePath.join(stage, "pad");
    stage = NodePath.join(stage, "root");
    const depRoot = NodePath.join(stage, token);
    const mirrorAbsOf = (real) => NodePath.join(stage, mirrorRelOf(real));
    const byMirror = new Map();
    const link = (from, to) => {
      if (NodeFS.existsSync(to)) return to;
      NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
      try {
        NodeFS.linkSync(from, to);
      } catch {
        NodeFS.copyFileSync(from, to);
      }
      byMirror.set(to, from);
      return to;
    };
    // Every bundled file plus every package.json that could govern it.
    for (const key of Object.keys(inputs)) {
      if (key.startsWith("<") || (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key) && !/^[a-zA-Z]:/.test(key)))
        continue;
      const abs = NodePath.resolve(dir, key);
      try {
        if (!NodeFS.statSync(abs).isFile()) continue; // e.g. the stdin pseudo-file
      } catch {
        continue;
      }
      link(abs, mirrorAbsOf(abs));
      let cursor = NodePath.dirname(abs);
      const stop = insideRel(dir, abs) === null ? NodePath.parse(abs).root : dir;
      while (true) {
        const manifest = NodePath.join(cursor, "package.json");
        if (NodeFS.existsSync(manifest)) link(manifest, mirrorAbsOf(manifest));
        if (cursor === stop || cursor === NodePath.dirname(cursor)) break;
        cursor = NodePath.dirname(cursor);
      }
    }
    // Package files still need the extension's own package.json (or the
    // nearest one above it) for module typing at the staging root.
    if (!NodeFS.existsSync(NodePath.join(stage, "package.json"))) {
      const root = packageRoot(NodePath.join(dir, "extension.ts"));
      if (root !== null && NodeFS.existsSync(NodePath.join(root, "package.json")))
        link(NodePath.join(root, "package.json"), NodePath.join(stage, "package.json"));
    }
    // Bare imports resolve through a node_modules entry in some ancestor
    // directory. Reproduce each used entry as a symlink to the mirrored
    // package root: at the staging root for imports made from package
    // files, and at the mirrored ancestor for dep-internal imports — so
    // hoisted, nested, and symlinked layouts keep their real precedence.
    const linkEntry = (entryDir, spec, target) => {
      const linkPath = NodePath.join(entryDir, "node_modules", ...spec.split("/"));
      // Mirrored real content already resolves faithfully; only a
      // conflicting symlink would redirect the import elsewhere.
      if (NodeFS.existsSync(linkPath))
        return (
          !NodeFS.lstatSync(linkPath).isSymbolicLink() || NodeFS.realpathSync(linkPath) === target
        );
      NodeFS.mkdirSync(NodePath.dirname(linkPath), { recursive: true });
      try {
        NodeFS.symlinkSync(target, linkPath, "dir");
      } catch {
        return false;
      }
      return true;
    };
    for (const edge of edges) {
      if (edge.path === null || edge.importer === "" || !isBareSpecifier(edge.spec)) continue;
      const target = mirrorAbsOf(packageRoot(edge.path) ?? NodePath.dirname(edge.path));
      const spec = specifierPackage(edge.spec);
      if (insideRel(dir, edge.importer) !== null) {
        // A package file's bare import walks stage/node_modules first.
        // Anything that resolved inside the package is already there; a
        // name taken by real package content keeps its mirrored files.
        if (insideRel(dir, edge.path) !== null) continue;
        if (!linkEntry(stage, spec, target)) return fail();
        continue;
      }
      // A dep's import walked the importer's real ancestors; mirror the
      // entry at the first ancestor that had it — the same position the
      // staged walk reaches it.
      let cursor = NodePath.dirname(edge.importer);
      while (true) {
        if (NodeFS.existsSync(NodePath.join(cursor, "node_modules", ...spec.split("/")))) {
          if (!linkEntry(mirrorAbsOf(cursor), spec, target)) return fail();
          break;
        }
        if (cursor === NodePath.dirname(cursor)) break;
        cursor = NodePath.dirname(cursor);
      }
    }
    // Relative specifiers that climb out of the staging root would
    // resolve real files on disk; park a symlink at each probed location
    // so the same import lands on the mirror (and its label keeps the
    // token) instead.
    for (const { edge } of escapes) {
      const probe = NodePath.resolve(NodePath.dirname(mirrorAbsOf(edge.importer)), edge.spec);
      if (insideRel(tmp, probe) === null) continue;
      const realProbe = NodePath.resolve(NodePath.dirname(edge.importer), edge.spec);
      let from = mirrorAbsOf(edge.path);
      let to = probe;
      if (NodePath.basename(probe) !== NodePath.basename(edge.path)) {
        if (NodeFS.existsSync(realProbe) && NodeFS.statSync(realProbe).isDirectory()) {
          from = mirrorAbsOf(realProbe);
        } else {
          to = probe + NodePath.extname(edge.path);
        }
      }
      if (NodeFS.existsSync(to)) {
        if (NodeFS.realpathSync(to) !== from) return fail();
        continue;
      }
      NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
      try {
        NodeFS.symlinkSync(from, to, "dir");
      } catch {
        return fail();
      }
    }
    return { tmp, stage, token, depRoot, byMirror, outside };
  } catch (error) {
    NodeFS.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
};
// esbuild emits each input's label as its path relative to absWorkingDir,
// verbatim in comments and string-escaped inside generated string labels
// (café.cjs arrives as caf\xE9.cjs). Every outside input's emitted label
// carries the staging token, so a token-anchored scan rewrites exactly
// the generated spellings — raw, "…"-escaped, and '…'-escaped — and
// nothing else. Two different real modules claiming one canonical label
// (or a label already used by a package file) keep their location-
// dependent spelling rather than collapsing into one emitted name.
const rewriteEmittedLabels = (text, metafile, dir, staged) => {
  const needle = staged.token + "/";
  const entries = new Map(); // emitted tail -> real path
  const claimants = new Map(); // canonical label -> number of inputs wanting it
  const realKeys = new Set();
  for (const key of Object.keys(metafile.inputs)) {
    if (key.startsWith(needle)) {
      const real = staged.byMirror.get(NodePath.join(staged.stage, key));
      if (real === undefined) return null;
      entries.set(key.slice(needle.length), real);
      claimants.set(key.slice(needle.length), (claimants.get(key.slice(needle.length)) ?? 0) + 1);
      continue;
    }
    realKeys.add(key);
  }
  if (entries.size === 0) return null;
  const finals = new Map();
  const seen = new Map();
  for (const [tail, real] of entries) {
    const canon = canonicalLabel(real);
    if (canon !== null) claimants.set(canon, (claimants.get(canon) ?? 0) + 1);
    seen.set(tail, canon);
  }
  for (const [tail, real] of entries) {
    const canon = seen.get(tail);
    finals.set(
      tail,
      canon === null || claimants.get(canon) > 1 || realKeys.has(canon)
        ? NodePath.relative(dir, real).split(NodePath.sep).join("/")
        : canon,
    );
  }
  const variants = [];
  for (const [tail] of entries) {
    const emitted = needle + tail;
    const final = finals.get(tail);
    for (const spelling of new Set([emitted, escapeLabel(emitted, '"'), escapeLabel(emitted, "'")]))
      variants.push({ spelling, final });
  }
  variants.sort((a, b) => b.spelling.length - a.spelling.length);
  let out = "";
  let i = 0;
  while (true) {
    const at = text.indexOf(needle, i);
    if (at === -1) break;
    let match = null;
    for (const variant of variants) {
      if (text.startsWith(variant.spelling, at)) {
        match = variant;
        break;
      }
    }
    if (match === null) return null; // a token esbuild never gave us
    const end = at + match.spelling.length;
    const quote = text[end];
    out +=
      text.slice(i, at) +
      (quote === '"' || quote === "'" ? escapeLabel(match.final, quote) : match.final);
    i = end;
  }
  return out + text.slice(i);
};
// Bundle once to learn the module graph, then again inside a staging
// directory whose labels are self-identifying. Falls back to the plain
// emitted text whenever the staged build cannot be proven equivalent.
const buildCanonical = async (dir, options) => {
  const edges = [];
  const first = await build({
    ...options,
    absWorkingDir: dir,
    stdin: options.stdin ? { ...options.stdin, resolveDir: dir } : undefined,
    write: false,
    metafile: true,
    plugins: [...(options.plugins ?? []), recordResolutions(edges)],
  });
  const original = first.outputFiles[0].text;
  try {
    const staged = buildStaged(dir, first.metafile.inputs, edges);
    if (staged === null) return original;
    try {
      const second = await build({
        ...options,
        absWorkingDir: staged.stage,
        stdin: options.stdin ? { ...options.stdin, resolveDir: staged.stage } : undefined,
        write: false,
        metafile: true,
      });
      // The staged module graph must be exactly the plain one: every
      // input is either a package file at its usual relative key or an
      // outside file under the token directory.
      const expected = new Set();
      for (const key of Object.keys(first.metafile.inputs)) {
        if (
          key.startsWith("<") ||
          (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key) && !/^[a-zA-Z]:/.test(key))
        ) {
          expected.add(key);
          continue;
        }
        const abs = NodePath.resolve(dir, key);
        expected.add(
          insideRel(dir, abs) === null
            ? staged.token + "/" + stripRoot(abs).split(NodePath.sep).join("/")
            : key,
        );
      }
      const actual = Object.keys(second.metafile.inputs);
      if (actual.length !== expected.size || actual.some((key) => !expected.has(key)))
        return original;
      const rewritten = rewriteEmittedLabels(
        second.outputFiles[0].text,
        second.metafile,
        dir,
        staged,
      );
      if (rewritten === null || rewritten.includes(staged.token)) return original;
      return rewritten;
    } finally {
      NodeFS.rmSync(staged.tmp, { recursive: true, force: true });
    }
  } catch {
    return original;
  }
};
async function check(dir) {
  const pkg = validateEnvironmentPackage(
    JSON.parse(await NodeFSP.readFile(NodePath.join(dir, "t3-extension.json"), "utf8")),
  );
  const hashes = {};
  for (const name of ["t3-extension.json", pkg.clientEntry, pkg.serverEntry].filter(Boolean)) {
    const bytes = await NodeFSP.readFile(NodePath.join(dir, name));
    hashes[name] = sha(bytes);
  }
  for (const asset of pkg.format === 4 ? pkg.assets : []) {
    const bytes = await NodeFSP.readFile(NodePath.join(dir, asset.path));
    if (bytes.length !== asset.byteLength || sha(bytes) !== asset.sha256)
      throw new Error("Package asset digest mismatch: " + asset.path);
    hashes[asset.path] = asset.sha256;
  }
  if (pkg.serverEntry) {
    const server = await import(
      NodeURL.pathToFileURL(NodePath.join(dir, pkg.serverEntry)).href + "?check=" + Date.now()
    );
    validateServerExtension(pkg, server.default);
  }
  if (pkg.clientEntry) {
    const client = await import(
      NodeURL.pathToFileURL(NodePath.join(dir, pkg.clientEntry)).href + "?check=" + Date.now()
    );
    if (typeof client.default !== "function") throw new Error("clientEntry must export a factory");
    const extension = client.default({ React: require("react") });
    if (JSON.stringify(extension.manifest) !== JSON.stringify(pkg.manifest))
      throw new Error("Client manifest differs from package manifest");
    if (
      JSON.stringify(extension.surfaces.map((s) => s.id).sort()) !==
      JSON.stringify(pkg.manifest.surfaces.map((s) => s.id).sort())
    )
      throw new Error("Client surface implementations differ from declarations");
  }
  try {
    const receipt = JSON.parse(await NodeFSP.readFile(NodePath.join(dir, "receipt.json"), "utf8"));
    if (
      receipt.generator === "t3-extension" &&
      JSON.stringify(receipt.hashes) !== JSON.stringify(hashes)
    )
      throw new Error("Built files differ from receipt; rebuild the source");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    kind: "package-check",
    installed: false,
    packageId: pkg.manifest.id,
    version: pkg.manifest.version,
    hashes,
  };
}
async function main() {
  if (command === "create") {
    const dir = NodePath.resolve(target);
    await NodeFSP.mkdir(dir); // Refuse to overwrite an existing directory.
    await NodeFSP.cp(NodePath.join(sdk, "examples/start-here"), dir, { recursive: true });
    console.log(
      JSON.stringify({ created: dir, next: "Install this SDK tarball here, then npm run build." }),
    );
    return;
  }
  if (command === "check") {
    console.log(JSON.stringify(await check(NodePath.resolve(target)), null, 2));
    return;
  }
  if (command !== "build")
    throw new Error(
      "Usage: t3-extension create <new-directory> | build <source-directory> | check <built-directory>",
    );
  // Realpath so labels esbuild derives from absWorkingDir never mix
  // symlinked and physical spellings of the same directory.
  const dir = await NodeFSP.realpath(NodePath.resolve(target));
  const out = NodePath.join(dir, ".t3-extension");
  const temp = await NodeFSP.mkdtemp(NodePath.join(dir, ".t3-extension-build-"));
  const backup = temp + "-previous";
  let moved = false;
  try {
    const entry = NodePath.join(dir, "extension.ts");
    await build({
      entryPoints: [entry],
      outfile: NodePath.join(temp, "definition.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      logLevel: "silent",
    });
    const authored = (
      await import(NodeURL.pathToFileURL(NodePath.join(temp, "definition.mjs")).href)
    ).default;
    const declaredAssets = authored.assets ?? [];
    const packedAssets = [];
    const sourceRoot = await NodeFSP.realpath(dir);
    for (const declared of declaredAssets) {
      const source = NodePath.join(dir, declared.path);
      const stat = await NodeFSP.lstat(source);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("Asset source must be a regular file: " + declared.path);
      if (!(await NodeFSP.realpath(source)).startsWith(sourceRoot + NodePath.sep))
        throw new Error("Asset source escapes the source directory: " + declared.path);
      const bytes = await NodeFSP.readFile(source);
      packedAssets.push({
        path: declared.path,
        byteLength: bytes.length,
        sha256: sha(bytes),
        mediaType: declared.mediaType,
      });
      const target = NodePath.join(temp, declared.path);
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      await NodeFSP.copyFile(source, target);
    }
    const pkg = validateEnvironmentPackage(
      packedAssets.length ? { ...authored.package, assets: packedAssets } : authored.package,
    );
    if (
      authored.serverEntry &&
      (NodePath.isAbsolute(authored.serverEntry) ||
        authored.serverEntry.split(/[\\\\/]/).includes(".."))
    )
      throw new Error("serverEntry must stay inside the source directory");
    // Explicit files cannot be omitted by the author's include/exclude patterns.
    const config = NodePath.join(temp, "tsconfig.json");
    await NodeFSP.writeFile(
      config,
      JSON.stringify({
        extends: NodePath.join(dir, "tsconfig.json"),
        files: [
          entry,
          ...(authored.serverEntry ? [NodePath.resolve(dir, authored.serverEntry)] : []),
        ],
        compilerOptions: { noEmit: true, strict: true, allowJs: true, checkJs: true },
      }),
    );
    const typecheck = NodeChildProcess.spawnSync(
      process.execPath,
      [
        NodePath.join(NodePath.dirname(require.resolve("typescript/package.json")), "bin/tsc"),
        "--project",
        config,
        "--noEmit",
      ],
      { stdio: "inherit" },
    );
    if (typecheck.status !== 0)
      throw new Error("Declared entry typecheck failed (exit " + typecheck.status + ")");
    await NodeFSP.rm(config);
    const bundle = async (contents, platform) =>
      buildCanonical(dir, {
        tsconfig: NodePath.join(dir, "tsconfig.json"),
        stdin: { contents, resolveDir: dir, sourcefile: "generated-entry.ts", loader: "ts" },
        bundle: true,
        platform,
        format: "esm",
        target: platform === "browser" ? "es2022" : "node24",
        logLevel: "silent",
      });
    if (pkg.clientEntry) {
      // Evaluate dependency modules inside each factory so imported hooks share the host identity.
      const client = await buildCanonical(dir, {
        tsconfig: NodePath.join(dir, "tsconfig.json"),
        stdin: {
          contents: 'import extension from "./extension.ts"; export default extension.client;',
          resolveDir: dir,
          sourcefile: "generated-client.ts",
          loader: "ts",
        },
        bundle: true,
        platform: "browser",
        format: "iife",
        globalName: "__t3Client",
        target: "es2022",
        logLevel: "silent",
        plugins: [
          {
            name: "host-react",
            setup(build) {
              build.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => {
                if (!["react", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(path))
                  throw new Error("Unsupported host React entry: " + path);
                return { path, namespace: "host-react" };
              });
              build.onResolve({ filter: /^react-dom(?:\/.*)?$/ }, () => {
                throw new Error(
                  "React DOM imports need a public host contract; do not bundle another renderer.",
                );
              });
              build.onLoad({ filter: /.*/, namespace: "host-react" }, ({ path }) => ({
                loader: "js",
                contents:
                  path === "react"
                    ? "module.exports = __t3Host.React;"
                    : "const R = __t3Host.React; exports.Fragment = R.Fragment; " +
                      // Dev React warns for array children whose
                      // _store.validated is falsy, but createElement only
                      // marks its vararg children — the automatic runtime
                      // passes children inside props, so nothing was marked
                      // and every static sibling group warned. Mirror the
                      // real runtimes: jsxs and isStaticChildren jsxDEV
                      // mark each child element; jsx marks only the
                      // children node itself, so unkeyed dynamic lists
                      // still warn.
                      "const mark = (n) => { " +
                      "if (n && typeof n === 'object' && n._store) n._store.validated = 1; }; " +
                      "const el = (type, props, key, isStatic) => { " +
                      "const c = props == null ? undefined : props.children; " +
                      "if (Array.isArray(c)) { " +
                      "if (isStatic) { for (const x of c) mark(x); Object.freeze(c); } " +
                      "} else mark(c); " +
                      "return R.createElement(type, key === undefined ? props : { ...props, key }); " +
                      "}; " +
                      "exports.jsx = (t, p, k) => el(t, p, k, false); " +
                      "exports.jsxs = (t, p, k) => el(t, p, k, true); " +
                      "exports.jsxDEV = (t, p, k, s) => el(t, p, k, s === true);",
              }));
            },
          },
        ],
      });
      await NodeFSP.writeFile(
        NodePath.join(temp, pkg.clientEntry),
        "export default function (__t3Host) {\n" +
          client +
          "\nreturn __t3Client.default(__t3Host);\n}\n",
      );
    }
    if (pkg.serverEntry) {
      if (
        !authored.serverEntry ||
        NodePath.isAbsolute(authored.serverEntry) ||
        authored.serverEntry.split(/[\\/]/).includes("..")
      )
        throw new Error("serverEntry must stay inside the source directory");
      await NodeFSP.writeFile(
        NodePath.join(temp, pkg.serverEntry),
        await bundle(
          "import server from " +
            JSON.stringify("./" + authored.serverEntry) +
            "; export default { tools: [], ...server };",
          "node",
        ),
      );
    }
    await NodeFSP.rm(NodePath.join(temp, "definition.mjs"));
    await NodeFSP.writeFile(
      NodePath.join(temp, "t3-extension.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
    const receipt = await check(temp);
    await NodeFSP.writeFile(
      NodePath.join(temp, "receipt.json"),
      JSON.stringify(
        {
          ...receipt,
          generator: "t3-extension",
          sourceEntrySha256: sha(await NodeFSP.readFile(entry)),
        },
        null,
        2,
      ) + "\n",
    );
    try {
      const old = JSON.parse(await NodeFSP.readFile(NodePath.join(out, "receipt.json"), "utf8"));
      if (old.generator !== "t3-extension")
        throw new Error("Refusing to replace an unowned output directory");
      await NodeFSP.rename(out, backup);
      moved = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await NodeFSP.access(out);
        throw new Error("Output exists without a generated receipt", { cause: error });
      } catch (absent) {
        if (absent.code !== "ENOENT") throw absent;
      }
    }
    try {
      await NodeFSP.rename(temp, out);
    } catch (error) {
      if (moved) await NodeFSP.rename(backup, out);
      moved = false;
      throw error;
    }
    if (moved) {
      await NodeFSP.rm(backup, { recursive: true });
      moved = false;
    }
    console.log(JSON.stringify({ output: out, ...receipt }, null, 2));
  } finally {
    await NodeFSP.rm(temp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
