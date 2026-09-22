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
// esbuild stamps each bundled module's resolved path — relative to the
// process working directory — into `//` banner comments, CommonJS wrapper
// keys ("../../dep/index.js"(exports, module){…}), synthetic glob-expansion
// module names (`require("<pattern>") in <importer>`), and jsxdev fileName
// metadata, so emitted bytes (and every receipt hash) used to depend on
// where the build ran and where the checkout lived. Resolution stays
// native (realpath'd): preserveSymlinks made labels pretty but stopped
// finding dependencies installed beside a linked package's real target
// and bundled two spellings of one module as separate singletons. Instead
// the builds pin absWorkingDir to the realpath'd package directory, then
// each dep label is rewritten to its canonical form — node_modules/<name>/
// plus the path inside the package, read from the nearest enclosing
// package.json — so the emitted identity is the package's own name,
// identical whether the module was reached through a store link, a
// workspace symlink, or a real install. The emitted text is scanned
// lexically: only `//` comments outside string/template literals (esbuild
// strips source comments, so surviving ones are module banners), string
// literals in generated label positions — `"<name>"(…) {` method keys and
// the `fileName: "…", lineNumber:` signature inside jsxDEV calls — are
// candidates, each decoded from JavaScript escapes before matching and
// re-encoded afterward, so path-shaped user data and escaped filenames
// like café.cjs both behave. A dep file with no named package above it
// falls back to the path suffix starting at its last node_modules/
// segment; one outside both (a file: link to a bare directory) keeps its
// emitted label — that residue is location-dependent, and deliberately so
// rather than guessed at.
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
// Decode the raw contents of a JavaScript string literal — the text between
// its quotes, escapes intact — into the value it denotes. Emitted labels are
// ASCII-escaped (café.cjs arrives as caf\xE9.cjs), so matching raw metafile
// spellings would miss them.
const decodeJsString = (raw) => {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") {
      out += raw[i];
      continue;
    }
    const e = raw[++i];
    if (e === undefined) break;
    if (e === "n") out += "\n";
    else if (e === "r") out += "\r";
    else if (e === "t") out += "\t";
    else if (e === "b") out += "\b";
    else if (e === "f") out += "\f";
    else if (e === "v") out += "\v";
    else if (e === "0") out += "\0";
    else if (e === "x") {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === "u") {
      if (raw[i + 1] === "{") {
        const end = raw.indexOf("}", i + 2);
        if (end === -1) {
          out += "\\u";
          continue;
        }
        out += String.fromCodePoint(parseInt(raw.slice(i + 2, end), 16));
        i = end;
      } else {
        out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
        i += 4;
      }
    } else if (e === "\n") {
      // Line continuation — contributes nothing.
    } else if (e === "\r") {
      if (raw[i + 1] === "\n") i++;
    } else out += e; // \\ \' \" \` \$ \/ and other passthrough escapes
  }
  return out;
};
// Re-encode a canonical label into a string literal, keeping the quote
// character esbuild chose (it picks ' when the name contains ") and
// escaping non-ASCII the way it does: \xNN, \uNNNN, \u{NNNNN}.
const encodeJsString = (value, quote) => {
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
  return quote + out + quote;
};
// Glob-expansion modules get a synthetic `require("<pattern>") in
// <importer>` (or `import(...)`) name that is not itself a metafile input;
// only its trailing importer path is.
const syntheticName = (value) => {
  const match = /^(?:require|import)\((['"`])/.exec(value);
  if (!match) return null;
  const quote = match[1];
  let i = match[0].length;
  while (i < value.length && value[i] !== quote) {
    if (value[i] === "\\") i++;
    i++;
  }
  if (value.slice(i + 1, i + 6) !== ") in ") return null;
  return { head: value.slice(0, i + 1) + ") in ", importer: value.slice(i + 6) };
};
const IDENT_START = /[$_A-Za-z]/;
const IDENT_CHAR = /[$_0-9A-Za-z]/;
const isSpace = (c) => /\s/.test(c);
// Keywords after which a "/" starts a regex rather than division.
const EXPRESSION_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
const canonicalModuleIds = (text, metafile, dir) => {
  const emitted = Object.keys(metafile.inputs);
  const labels = new Map();
  const claimants = new Map();
  for (const input of emitted) {
    // Only dep inputs — paths that escape the package root — get labels;
    // the extension's own files keep their source spelling.
    if (!input.startsWith("..")) continue;
    const label =
      packageLabel(NodePath.resolve(dir, input)) ??
      (() => {
        const at = input.lastIndexOf("node_modules/");
        return at > 0 ? input.slice(at) : null;
      })();
    if (label === null) continue;
    labels.set(input, label);
    claimants.set(label, (claimants.get(label) ?? 0) + 1);
  }
  for (const [input, label] of labels) {
    // Two different real modules claiming one canonical label would merge
    // in the emitted wrapper map; likewise a label that already belongs to
    // another input. Ambiguous groups keep their emitted labels.
    if (claimants.get(label) > 1 || emitted.includes(label)) labels.delete(input);
  }
  // A decoded generated name's canonical form: the module's own label, or
  // a glob synthetic name whose importer is a known module.
  const canonicalFor = (decoded) => {
    const direct = labels.get(decoded);
    if (direct !== undefined) return direct;
    const synthetic = syntheticName(decoded);
    if (synthetic) {
      const importer = labels.get(synthetic.importer);
      if (importer !== undefined) return synthetic.head + importer;
    }
    return null;
  };
  // Lex the emitted bundle once. Label sites are only reached outside
  // string/template contents: `//` comments (esbuild strips source
  // comments — survivors are module banners) and string literals in
  // generated label positions.
  const out = [];
  const stack = [{ template: false, braces: 0 }];
  const top = () => stack[stack.length - 1];
  const triviaEnd = (pos) => {
    while (pos < text.length) {
      if (isSpace(text[pos])) {
        pos++;
      } else if (text[pos] === "/" && text[pos + 1] === "/") {
        const eol = text.indexOf("\n", pos);
        pos = eol === -1 ? text.length : eol;
      } else if (text[pos] === "/" && text[pos + 1] === "*") {
        const end = text.indexOf("*/", pos + 2);
        pos = end === -1 ? text.length : end + 2;
      } else break;
    }
    return pos;
  };
  let previous = "operator"; // whether "/" may begin a regex literal
  let fileNameKey = false; // previous tokens were `fileName` `:`
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (top().template) {
      if (c === "\\") {
        out.push(text.slice(i, i + 2));
        i += 2;
      } else if (c === "`") {
        out.push("`");
        i++;
        stack.pop();
        previous = "value";
      } else if (c === "$" && text[i + 1] === "{") {
        out.push("${");
        i += 2;
        stack.push({ template: false, braces: 0 });
        previous = "operator";
      } else {
        let j = i;
        while (
          j < text.length &&
          text[j] !== "`" &&
          text[j] !== "\\" &&
          !(text[j] === "$" && text[j + 1] === "{")
        )
          j++;
        out.push(text.slice(i, j));
        i = j;
      }
      continue;
    }
    if (isSpace(c)) {
      out.push(c);
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const eol = text.indexOf("\n", i);
      const end = eol === -1 ? text.length : eol;
      const canonical = canonicalFor(text.slice(i + 2, end).trim());
      out.push(canonical === null ? text.slice(i, end) : "// " + canonical);
      i = end;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const close = end === -1 ? text.length : end + 2;
      out.push(text.slice(i, close));
      i = close;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j++;
        j++;
      }
      const raw = text.slice(i + 1, j);
      // Generated label sites: the first member of a __commonJS/__esm/
      // __glob helper object is the module's factory method key, and
      // `fileName: "…", lineNumber:` is the jsxDEV source-metadata object.
      // A string literal anywhere else — including path-shaped user data —
      // passes through untouched.
      let labelSite = /__(?:commonJS|esm|glob)\(\s*\{\s*$/.test(text.slice(Math.max(0, i - 96), i));
      if (!labelSite && fileNameKey) {
        const after = triviaEnd(j + 1);
        labelSite = text[after] === "," && text.startsWith("lineNumber", triviaEnd(after + 1));
      }
      const canonical = labelSite ? canonicalFor(decodeJsString(raw)) : null;
      out.push(canonical === null ? text.slice(i, j + 1) : encodeJsString(canonical, c));
      i = j + 1;
      previous = "value";
      fileNameKey = false;
      continue;
    }
    if (c === "`") {
      out.push("`");
      i++;
      stack.push({ template: true });
      previous = "operator";
      fileNameKey = false;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < text.length && IDENT_CHAR.test(text[j])) j++;
      const word = text.slice(i, j);
      fileNameKey = word === "fileName" && text[triviaEnd(j)] === ":";
      previous = EXPRESSION_KEYWORDS.has(word) ? "operator" : "value";
      out.push(word);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < text.length && /[0-9A-Za-z._]/.test(text[j])) j++;
      out.push(text.slice(i, j));
      i = j;
      previous = "value";
      fileNameKey = false;
      continue;
    }
    if (c === "/" && previous !== "value") {
      // Regex literal — scan to the unescaped closing '/', honoring classes.
      let j = i + 1;
      while (j < text.length && text[j] !== "/" && text[j] !== "\n") {
        if (text[j] === "\\") {
          j++;
        } else if (text[j] === "[") {
          while (j < text.length && text[j] !== "]" && text[j] !== "\n") {
            if (text[j] === "\\") j++;
            j++;
          }
        }
        j++;
      }
      j++;
      while (j < text.length && /[a-z]/i.test(text[j])) j++;
      out.push(text.slice(i, j));
      i = j;
      previous = "value";
      fileNameKey = false;
      continue;
    }
    if (c === "{") {
      top().braces++;
      previous = "operator";
    } else if (c === "}") {
      if (top().braces === 0) {
        if (stack.length > 1) stack.pop();
      } else top().braces--;
      previous = "value";
    } else if (c === ")" || c === "]") {
      previous = "value";
    } else {
      previous = "operator";
    }
    fileNameKey = fileNameKey && c === ":";
    out.push(c);
    i++;
  }
  return out.join("");
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
    const bundle = async (contents, platform) => {
      const result = await build({
        absWorkingDir: dir,
        tsconfig: NodePath.join(dir, "tsconfig.json"),
        stdin: { contents, resolveDir: dir, sourcefile: "generated-entry.ts", loader: "ts" },
        bundle: true,
        write: false,
        metafile: true,
        platform,
        format: "esm",
        target: platform === "browser" ? "es2022" : "node24",
        logLevel: "silent",
      });
      return canonicalModuleIds(result.outputFiles[0].text, result.metafile, dir);
    };
    if (pkg.clientEntry) {
      // Evaluate dependency modules inside each factory so imported hooks share the host identity.
      const client = await build({
        absWorkingDir: dir,
        tsconfig: NodePath.join(dir, "tsconfig.json"),
        stdin: {
          contents: 'import extension from "./extension.ts"; export default extension.client;',
          resolveDir: dir,
          sourcefile: "generated-client.ts",
          loader: "ts",
        },
        bundle: true,
        write: false,
        metafile: true,
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
          canonicalModuleIds(client.outputFiles[0].text, client.metafile, dir) +
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
