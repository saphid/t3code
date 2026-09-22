// Canonical labels for generated module metadata in esbuild output.
//
// esbuild stamps each bundled module's resolved path — relative to
// absWorkingDir — into `//` banner comments, CommonJS/ESM wrapper keys
// ("../../dep/index.js"(exports, module){…}), synthetic glob-expansion
// module names (`require("<pattern>") in <importer>`), and jsxdev fileName
// metadata, so emitted bytes (and every receipt hash) depend on where the
// build ran and where the checkout lived.
//
// The emitted JavaScript is the authoritative compile: it is never
// re-bundled. Labels are rewritten in place by parsing the output with a
// real parser and touching only syntactically generated positions:
// string keys of the object argument to a `__commonJS`/`__esm`
// helper call whose callee resolves to the bundler's own `var` helper
// (so a user shadowing the name keeps their data), the `fileName` literal
// of the source-metadata argument at position 4 of a `jsxDEV` call, and
// `//` line comments whose whole text is an emitted label. A label-shaped
// value anywhere else — user strings, ordinary {fileName, lineNumber}
// records, template contents — is unreachable by construction.
//
// A string key inside a generated helper map that is not a bundled input
// label means the emitted output contains generated metadata this file
// cannot explain; that throws rather than shipping a half-rewritten
// bundle. A dep file with no usable package identity (no named
// package.json, no node_modules/ suffix) or a canonical name claimed by
// two different modules keeps its location-dependent label — a documented
// limit, not a silent rewrite.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parse as parseJavaScript } from "acorn";

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
          : "\\u{" + cp.toString(16).toUpperCase() + "}";
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

const FUNCTION_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
// Module-map helpers: their object argument maps module labels (or
// glob-synthetic `require("<pattern>") in <label>` names) to factories.
// `__glob`'s own map is keyed by pattern-relative specifiers — lookup
// names, not module labels — so it is not a label position.
const MAP_HELPERS = new Set(["__commonJS", "__esm", "__commonJSMin", "__esmMin"]);
const SCOPES = new Set([
  ...FUNCTION_LIKE,
  "Program",
  "BlockStatement",
  "StaticBlock",
  "CatchClause",
  "SwitchStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "ClassExpression",
]);
// Every Identifier a binding pattern declares.
const patternIds = (node, out = []) => {
  if (node === null || node === undefined) return out;
  switch (node.type) {
    case "Identifier":
      out.push(node.name);
      break;
    case "RestElement":
      patternIds(node.argument, out);
      break;
    case "AssignmentPattern":
      patternIds(node.left, out);
      break;
    case "ArrayPattern":
      for (const element of node.elements) patternIds(element, out);
      break;
    case "ObjectPattern":
      for (const property of node.properties)
        patternIds(property.type === "RestElement" ? property.argument : property.value, out);
      break;
  }
  return out;
};
const childNodes = function* (node) {
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value)
        if (child !== null && typeof child === "object" && typeof child.type === "string")
          yield child;
    } else if (value !== null && typeof value === "object" && typeof value.type === "string") {
      yield value;
    }
  }
};
// var/function declarations hoisted into a function's scope — searched
// through nested blocks but never into nested functions.
const collectHoisted = (node, found) => {
  for (const child of childNodes(node)) {
    if (FUNCTION_LIKE.has(child.type)) continue;
    if (child.type === "VariableDeclaration" && child.kind === "var") {
      for (const declarator of child.declarations)
        for (const name of patternIds(declarator.id)) found.set(name, declarator);
    } else if (child.type === "FunctionDeclaration" && child.id) {
      found.set(child.id.name, "function");
    }
    collectHoisted(child, found);
  }
};
// Names bound directly at this scope level. A binding is reported as the
// VariableDeclarator when it is a `var` (its init shape distinguishes the
// bundler's helpers), "param", "import", or "lexical" otherwise.
const scopeBindings = (node) => {
  const found = new Map();
  const addPattern = (pattern, kind) => patternIds(pattern).forEach((n) => found.set(n, kind));
  const lexicalStatements = (statements) => {
    for (const statement of statements) {
      if (statement.type === "VariableDeclaration") {
        if (statement.kind === "var")
          for (const declarator of statement.declarations)
            for (const name of patternIds(declarator.id)) found.set(name, declarator);
        else for (const declarator of statement.declarations) addPattern(declarator.id, "lexical");
      } else if (statement.type === "FunctionDeclaration" && statement.id) {
        found.set(statement.id.name, "function");
      } else if (statement.type === "ClassDeclaration" && statement.id) {
        found.set(statement.id.name, "lexical");
      } else if (statement.type === "ImportDeclaration") {
        for (const specifier of statement.specifiers) found.set(specifier.local.name, "import");
      }
    }
  };
  if (FUNCTION_LIKE.has(node.type)) {
    for (const param of node.params) addPattern(param, "param");
    // A named function expression binds its own name inside its body.
    if (node.type !== "FunctionDeclaration" && node.id) found.set(node.id.name, "function");
    if (node.body.type === "BlockStatement") collectHoisted(node.body, found);
    return found;
  }
  // A named class expression binds its own name inside its body.
  if (node.type === "ClassExpression") {
    if (node.id) found.set(node.id.name, "lexical");
    return found;
  }
  if (node.type === "Program" || node.type === "BlockStatement" || node.type === "StaticBlock") {
    lexicalStatements(node.body);
    return found;
  }
  if (node.type === "CatchClause") {
    if (node.param) addPattern(node.param, "param");
    return found;
  }
  if (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const decl = node.init ?? node.left;
    if (decl && decl.type === "VariableDeclaration" && decl.kind !== "var")
      for (const declarator of decl.declarations) addPattern(declarator.id, "lexical");
    return found;
  }
  if (node.type === "SwitchStatement") {
    for (const kase of node.cases) lexicalStatements(kase.consequent);
    return found;
  }
  return found;
};
// The nearest binding for `name` visible from a position, walking scopes
// outward. `var` bindings surface their declarator so the caller can check
// whether the bundler's `var __commonJS = <function>` shape is what the
// name resolves to; everything else is user-authored or an import.
const bindingOf = (name, ancestors, scopes) => {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const scope = scopes.get(ancestors[i]);
    const binding = scope === undefined ? undefined : scope.get(name);
    if (binding !== undefined) return binding;
  }
  return undefined;
};
const isHelperBinding = (binding) =>
  typeof binding === "object" &&
  binding !== null &&
  binding.type === "VariableDeclarator" &&
  binding.init !== null &&
  FUNCTION_LIKE.has(binding.init.type);
// `(0, x.jsxDEV)` arrives as a SequenceExpression; peel grouping and comma
// layers down to the real callee.
const unwrapCallee = (expr) => {
  while (true) {
    if (expr.type === "ParenthesizedExpression") expr = expr.expression;
    else if (expr.type === "SequenceExpression")
      expr = expr.expressions[expr.expressions.length - 1];
    else return expr;
  }
};
// Rewrite the generated label positions in emitted bundle text. `inputs`
// is metafile.inputs — the exact spellings esbuild stamped, including
// plugin-namespace keys like `host-react:react` which are already
// location-independent. Returns the rewritten text; throws when a
// generated position carries a label this build cannot account for.
export const rewriteEmittedLabels = (text, inputs, dir) => {
  const labels = new Set();
  const wanted = new Map(); // emitted outside label -> canonical label
  const claimants = new Map(); // canonical label -> how many inputs want it
  const insideKeys = new Set();
  for (const key of inputs) {
    if (key.startsWith("<")) continue; // pseudo-inputs emit no labels
    labels.add(key);
    const abs = NodePath.resolve(dir, key);
    if (insideRel(dir, abs) === null) {
      const canon = canonicalLabel(abs);
      if (canon !== null) {
        wanted.set(key, canon);
        claimants.set(canon, (claimants.get(canon) ?? 0) + 1);
      }
    } else insideKeys.add(key);
  }
  // Emitted label -> canonical replacement; ambiguous or colliding labels
  // are absent so their location-dependent spelling survives untouched.
  const finals = new Map();
  for (const [label, canon] of wanted)
    if (claimants.get(canon) === 1 && !insideKeys.has(canon)) finals.set(label, canon);
  const comments = [];
  let ast;
  try {
    ast = parseJavaScript(text, {
      ecmaVersion: "latest",
      sourceType: "module",
      onComment: comments,
    });
  } catch {
    ast = parseJavaScript(text, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      onComment: comments,
    });
  }
  const edits = [];
  const editLiteral = (node, value) => {
    const quote = text[node.start];
    edits.push({
      start: node.start,
      end: node.end,
      replacement: quote + escapeLabel(value, quote) + quote,
    });
  };
  const scopes = new Map();
  const walk = (node, ancestors) => {
    if (SCOPES.has(node.type)) scopes.set(node, scopeBindings(node));
    if (node.type === "CallExpression") {
      const callee = unwrapCallee(node.callee);
      // A generated helper call iff the callee resolves to a `var` bound to
      // a function — the bundler's helper. A user declaration of the same
      // name in any enclosing scope means the call is user code and stays
      // untouched.
      const helper =
        callee.type === "Identifier" &&
        MAP_HELPERS.has(callee.name) &&
        isHelperBinding(bindingOf(callee.name, ancestors, scopes))
          ? callee.name
          : null;
      if (helper !== null) {
        const map = node.arguments[0];
        if (map && map.type === "ObjectExpression") {
          for (const property of map.properties) {
            if (property.type !== "Property" || property.computed) continue;
            const key = property.key;
            if (key.type !== "Literal" || typeof key.value !== "string") continue;
            const value = key.value;
            if (!labels.has(value)) {
              // Glob expansion gives wrapper entries synthetic names —
              // `<kind>("<pattern>") in <importer label>` — where the label
              // position is the importer suffix. A label may itself contain
              // " in ", so try every split from the right.
              let at = value.length;
              let suffix = null;
              while (at > 0) {
                at = value.lastIndexOf(" in ", at - 1);
                if (at === -1) break;
                const candidate = value.slice(at + 4);
                if (labels.has(candidate)) {
                  suffix = candidate;
                  break;
                }
              }
              if (suffix === null)
                throw new Error(
                  "t3-extension: generated module map key is not a bundled input: " +
                    JSON.stringify(value),
                );
              const target = finals.get(suffix);
              if (target !== undefined)
                editLiteral(key, value.slice(0, value.length - suffix.length) + target);
              continue;
            }
            const target = finals.get(value);
            if (target !== undefined) editLiteral(key, target);
          }
        }
      } else {
        // jsxDEV(type, props, key, isStatic, source, self): `source` —
        // argument position 4 — is the generated metadata object carrying
        // fileName. Bare `jsxDEV` is accepted only when the name is an
        // import or unbound, never a user's own function/var/param. The
        // member form requires the object to be the bundler's module
        // namespace — an import binding, or a `var` initialized by the
        // bundler's own __toESM/__toCommonJS wrapper — never a user object.
        const bare =
          callee.type === "Identifier" &&
          callee.name === "jsxDEV" &&
          ["import", undefined].includes(bindingOf(callee.name, ancestors, scopes));
        const objectBinding =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "jsxDEV" &&
          callee.object.type === "Identifier"
            ? bindingOf(callee.object.name, ancestors, scopes)
            : null;
        const member =
          objectBinding === "import" ||
          (typeof objectBinding === "object" &&
            objectBinding !== null &&
            objectBinding.init !== null &&
            objectBinding.init.type === "CallExpression" &&
            unwrapCallee(objectBinding.init.callee).type === "Identifier" &&
            ["__toESM", "__toCommonJS"].includes(unwrapCallee(objectBinding.init.callee).name) &&
            isHelperBinding(
              bindingOf(unwrapCallee(objectBinding.init.callee).name, ancestors, scopes),
            ));
        if (member || bare) {
          const source = node.arguments[4];
          if (source && source.type === "ObjectExpression") {
            for (const property of source.properties) {
              if (property.type !== "Property" || property.method || property.computed) continue;
              const named =
                (property.key.type === "Identifier" && property.key.name === "fileName") ||
                (property.key.type === "Literal" && property.key.value === "fileName");
              if (
                named &&
                property.value.type === "Literal" &&
                typeof property.value.value === "string" &&
                finals.has(property.value.value)
              )
                editLiteral(property.value, finals.get(property.value.value));
            }
          }
        }
      }
    }
    ancestors.push(node);
    for (const child of childNodes(node)) walk(child, ancestors);
    ancestors.pop();
  };
  walk(ast, []);
  for (const comment of comments) {
    if (comment.type !== "Line") continue;
    const body = comment.value.trim();
    let target = finals.get(body);
    if (target !== undefined) {
      edits.push({ start: comment.start, end: comment.end, replacement: "// " + target });
      continue;
    }
    // Glob-expansion modules get a synthetic banner: `// <kind>("pat") in
    // <label>` — the label position is the suffix.
    let at = body.length;
    while (at > 0) {
      at = body.lastIndexOf(" in ", at - 1);
      if (at === -1) break;
      const candidate = body.slice(at + 4);
      target = finals.get(candidate);
      if (target !== undefined) {
        const start =
          comment.start + 2 + (comment.value.length - comment.value.trimStart().length) + at + 4;
        edits.push({ start, end: start + candidate.length, replacement: target });
        break;
      }
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  return out;
};
