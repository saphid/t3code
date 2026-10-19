#!/usr/bin/env node
// Research prototype: filename discovery plus a local documentation reference graph.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../..");
const store = path.join(workspace, "node_modules/.pnpm");
const parserPackage = fs
  .readdirSync(store)
  .find((name) => name.startsWith("mdast-util-from-markdown@"));
const { fromMarkdown } = await import(
  pathToFileURL(path.join(store, parserPackage, "node_modules/mdast-util-from-markdown/index.js"))
);
export const seedGlobs = ["AGENTS.md", "AGENTS.*.md", "CLAUDE.md", "CLAUDE.*.md", "SKILL.md"];
// Broad prefilter only. Markdown parsing decides link boundaries, including spaces and parentheses.
export const referencePattern = "[`@/]|\\]\\s*[:(]|\\.[[:alnum:]_-]+";
const docs = /\.(md|mdx|markdown|txt|rst)$/i;
const tokenPattern =
  /(?:~\/|\.{1,2}\/|\/)?[\p{L}\p{N}_.@+-]+(?:\/[\p{L}\p{N}_.@+-]+)*(?:\.[\p{L}\p{N}_-]+)?(?::\d+(?::\d+)?)?/gu;

export function seeds(root) {
  const command = ["--no-config", "--files", "--null", "--hidden", "--no-ignore"];
  for (const glob of seedGlobs) command.push("--iglob", glob);
  command.push("--", root);
  const result = spawnSync("rg", command, { maxBuffer: 1024 ** 3 });
  if (result.error || ![0, 1].includes(result.status))
    throw result.error ?? new Error(result.stderr.toString());
  return {
    paths: result.stdout.toString().split("\0").filter(Boolean).sort(),
    command: ["rg", ...command],
  };
}

export function references(text) {
  const output = [];
  const seen = new Set();
  const add = (value, kind, line) => {
    const key = `${kind}\0${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push({ value, kind, line });
    }
  };
  function tokens(value, line) {
    for (const match of value.matchAll(tokenPattern)) {
      const token = match[0].replace(/[.,:;]+$/, "");
      if (
        token.includes("/") ||
        /\.[A-Za-z][\w-]*$/.test(token) ||
        /^(AGENTS|CLAUDE|SKILL)(\..*)?$/i.test(token)
      ) {
        add(token, "token", line);
      }
    }
  }
  function walk(node) {
    const line = node.position?.start.line;
    if (node.type === "link" || node.type === "image" || node.type === "definition")
      add(node.url, "link", line);
    if (node.type === "inlineCode") {
      add(node.value, "literal", line);
      tokens(node.value, line);
    }
    if (["text", "code", "html"].includes(node.type)) tokens(node.value, line);
    for (const child of node.children ?? []) walk(child);
  }
  walk(fromMarkdown(text));
  return output;
}

export function graph(seedPaths, root, { prefilter = false } = {}) {
  const queue = [...seedPaths];
  const visited = new Set();
  const files = new Set(seedPaths.map((p) => path.resolve(p)));
  const edges = [];
  const issues = [];
  const parseCache = new Map();
  const rootCache = new Map();
  const statCache = new Map();
  const stats = { documents: 0, parsedContents: 0, prefilterSkipped: 0 };
  const stat = (p) => {
    if (!statCache.has(p)) {
      try {
        statCache.set(p, fs.statSync(p));
      } catch (error) {
        statCache.set(p, null);
        if (!["ENOENT", "ENOTDIR"].includes(error.code))
          issues.push({ kind: "stat-error", path: p, error: error.message });
      }
    }
    return statCache.get(p);
  };
  function roots(source) {
    const folder = path.dirname(source);
    if (rootCache.has(folder)) return rootCache.get(folder);
    const candidates = [folder];
    let current = folder;
    while (true) {
      if (stat(path.join(current, "package.json"))?.isFile()) candidates.push(current);
      if (stat(path.join(current, ".git"))) {
        candidates.push(current);
        break;
      }
      if (path.dirname(current) === current) break;
      current = path.dirname(current);
    }
    // Root fallback supports repository-relative paths in nested skill prose.
    if (source.startsWith(root + path.sep)) candidates.push(root);
    const result = [...new Set(candidates)];
    rootCache.set(folder, result);
    return result;
  }
  function resolve(ref, source) {
    let value = ref.value.trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value)) return;
    if (value.startsWith("@")) value = value.slice(1);
    if (ref.kind === "link") {
      value = value.split(/[?#]/, 1)[0];
      try {
        value = decodeURIComponent(value);
      } catch {
        /* Preserve literal malformed escapes. */
      }
    } else value = value.replace(/:\d+(?::\d+)?$/, "");
    if (!value || /[\0]/.test(value)) return;
    if (/[<>${}*?]/.test(value)) {
      if (ref.kind === "link" || (ref.kind === "literal" && !/\s/.test(value)))
        issues.push({ ...ref, kind: "dynamic", source });
      return;
    }
    let candidates;
    if (value.startsWith("~/")) candidates = [path.join(os.homedir(), value.slice(2))];
    else if (path.isAbsolute(value)) candidates = [value];
    else candidates = roots(source).map((base) => path.resolve(base, value));
    const matches = [...new Set(candidates)].filter((candidate) => stat(candidate)?.isFile());
    if (matches.length) {
      if (matches.length > 1)
        issues.push({ ...ref, kind: "ambiguous", source, candidates: matches });
      return matches[0];
    }
    if (
      ref.kind === "link" ||
      (ref.kind === "literal" && !/\s/.test(value) && /[/\.]/.test(value))
    ) {
      const directory = candidates.find((candidate) => stat(candidate)?.isDirectory());
      const special = candidates.find(
        (candidate) =>
          stat(candidate) && !stat(candidate).isDirectory() && !stat(candidate).isFile(),
      );
      issues.push({
        ...ref,
        kind: directory ? "directory" : special ? "special" : "unresolved",
        source,
        ...((directory ?? special) ? { path: directory ?? special } : {}),
      });
    }
  }
  while (queue.length) {
    const batch = [];
    for (const file of queue.splice(0, 128)) {
      let canonical;
      try {
        canonical = fs.realpathSync(file);
      } catch (error) {
        issues.push({ kind: "read-error", path: file, error: error.message });
        continue;
      }
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      batch.push(canonical);
    }
    const documents = batch.filter((file) => docs.test(file));
    let selected = new Set(documents);
    if (prefilter && documents.length) {
      const args = [
        "--no-config",
        "--files-with-matches",
        "--null",
        "--text",
        "--multiline",
        "-e",
        referencePattern,
        "--",
        ...documents,
      ];
      const run = spawnSync("rg", args, { maxBuffer: 1024 ** 3 });
      if (run.error || ![0, 1].includes(run.status))
        throw run.error ?? new Error(run.stderr.toString());
      selected = new Set(run.stdout.toString().split("\0").filter(Boolean));
      stats.prefilterSkipped += documents.length - selected.size;
    }
    for (const source of selected) {
      let text;
      try {
        const bytes = fs.readFileSync(source);
        const encoding =
          bytes[0] === 0xff && bytes[1] === 0xfe
            ? "utf-16le"
            : bytes[0] === 0xfe && bytes[1] === 0xff
              ? "utf-16be"
              : "utf-8";
        text = new TextDecoder(encoding).decode(bytes);
      } catch (error) {
        issues.push({ kind: "read-error", path: source, error: error.message });
        continue;
      }
      stats.documents++;
      if (!parseCache.has(text)) {
        parseCache.set(text, references(text));
        stats.parsedContents++;
      }
      for (const ref of parseCache.get(text)) {
        const target = resolve(ref, source);
        if (!target) continue;
        edges.push({ source, target, ...ref });
        if (!files.has(target)) {
          files.add(target);
          queue.push(target);
        }
      }
    }
  }
  return { files: [...files].sort(), edges, issues, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fs.realpathSync(process.argv[2] ?? workspace);
  const start = performance.now();
  const inventory = seeds(root);
  const seedSeconds = (performance.now() - start) / 1000;
  const result = graph(inventory.paths, root, { prefilter: process.argv.includes("--prefilter") });
  result.root = root;
  result.seeds = inventory.paths;
  result.command = inventory.command;
  result.timings = { seedSeconds, totalSeconds: (performance.now() - start) / 1000 };
  const output = path.join(
    here,
    process.argv.includes("--prefilter") ? "fast-prefiltered.json" : "fast-discovery.json",
  );
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        seeds: result.seeds.length,
        files: result.files.length,
        edges: result.edges.length,
        issues: result.issues.length,
        stats: result.stats,
        timings: result.timings,
      },
      null,
      2,
    ),
  );
}
