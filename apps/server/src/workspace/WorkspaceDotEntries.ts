// @effect-diagnostics nodeBuiltinImport:off
import * as NodeConstants from "node:constants";
import type * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import ignore, { type Ignore } from "ignore";

import type { ProjectEntry } from "@t3tools/contracts";

const MAX_DOT_ENTRIES = 25_000;
const MAX_SCANNED_ENTRIES = 100_000;

const IGNORED_DIRECTORY_NAMES = new Set([
  ".build",
  ".cache",
  ".convex",
  ".dart_tool",
  ".expo",
  ".git",
  ".gradle",
  ".hg",
  ".next",
  ".mypy_cache",
  ".npm",
  ".pnpm-store",
  ".pytest_cache",
  ".ruff_cache",
  ".svn",
  ".swiftpm",
  ".terraform",
  ".tox",
  ".turbo",
  ".venv",
  ".yarn",
  "DerivedData",
  "__pycache__",
  "node_modules",
  "venv",
]);

const IGNORED_FILE_NAMES = new Set([".DS_Store", ".localized"]);

const IGNORED_DIRECTORY_PATHS = new Set([
  "Library/Application Support",
  "Library/Caches",
  "Library/Containers",
  "Library/Group Containers",
  "target/criterion",
  "target/debug",
  "target/release",
  "target/rust-analyzer",
]);

type IgnoreScope = {
  readonly directory: string;
  readonly matcher: Ignore;
};

export type WorkspaceDotEntriesResult = {
  readonly entries: ReadonlyArray<ProjectEntry>;
  readonly truncated: boolean;
};

function joinRelativePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function isSafetyIgnoredDirectory(relativePath: string, name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name) || IGNORED_DIRECTORY_PATHS.has(relativePath);
}

function isIgnored(
  scopes: ReadonlyArray<IgnoreScope>,
  relativePath: string,
  isDirectory: boolean,
): boolean {
  let ignored = false;
  for (const scope of scopes) {
    if (scope.directory && !relativePath.startsWith(`${scope.directory}/`)) {
      continue;
    }
    const scopedPath = scope.directory
      ? relativePath.slice(scope.directory.length + 1)
      : relativePath;
    const result = scope.matcher.test(isDirectory ? `${scopedPath}/` : scopedPath);
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  return ignored;
}

async function readIgnoreFile(path: string): Promise<string> {
  try {
    return await NodeFSP.readFile(path, "utf8");
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return "";
    throw cause;
  }
}

async function localIgnoreScope(
  absoluteDirectory: string,
  relativeDirectory: string,
  dirents: ReadonlyArray<NodeFS.Dirent>,
): Promise<IgnoreScope | null> {
  const ignoreFileNames = dirents
    .filter((dirent) => dirent.isFile() && [".gitignore", ".ignore"].includes(dirent.name))
    .map((dirent) => dirent.name);
  const patterns = (
    await Promise.all(
      ignoreFileNames.map((name) => readIgnoreFile(NodePath.join(absoluteDirectory, name))),
    )
  ).join("\n");
  return patterns.trim() ? { directory: relativeDirectory, matcher: ignore().add(patterns) } : null;
}

export async function scanWorkspaceDotEntries(
  cwd: string,
  signal: AbortSignal,
): Promise<WorkspaceDotEntriesResult> {
  const entries: ProjectEntry[] = [];
  let scannedEntries = 0;
  let truncated = false;

  const walk = async (
    absoluteDirectory: string,
    relativeDirectory: string,
    insideDotDirectory: boolean,
    parentScopes: ReadonlyArray<IgnoreScope>,
    recordDirectory: boolean,
  ): Promise<void> => {
    signal.throwIfAborted();
    let dirents: NodeFS.Dirent[];
    try {
      dirents = await NodeFSP.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM" || code === "ENOENT") return;
      throw cause;
    }

    if (recordDirectory) {
      entries.push({ path: relativeDirectory, kind: "directory" });
      if (entries.length >= MAX_DOT_ENTRIES) {
        truncated = true;
        return;
      }
    }

    const scope = await localIgnoreScope(absoluteDirectory, relativeDirectory, dirents);
    const scopes = scope ? [...parentScopes, scope] : parentScopes;
    for (const dirent of dirents.toSorted((left, right) => left.name.localeCompare(right.name))) {
      signal.throwIfAborted();
      scannedEntries += 1;
      if (scannedEntries > MAX_SCANNED_ENTRIES) {
        truncated = true;
        return;
      }

      const relativePath = joinRelativePath(relativeDirectory, dirent.name);
      const absolutePath = NodePath.join(absoluteDirectory, dirent.name);
      const inDotTree = insideDotDirectory || dirent.name.startsWith(".");

      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (isSafetyIgnoredDirectory(relativePath, dirent.name)) continue;
        if (isIgnored(scopes, relativePath, true)) continue;
        await walk(absolutePath, relativePath, inDotTree, scopes, inDotTree);
      } else if (
        dirent.isFile() &&
        inDotTree &&
        !IGNORED_FILE_NAMES.has(dirent.name) &&
        !isIgnored(scopes, relativePath, false)
      ) {
        try {
          await NodeFSP.access(absolutePath, NodeConstants.R_OK);
          entries.push({ path: relativePath, kind: "file" });
        } catch {
          continue;
        }
        if (entries.length >= MAX_DOT_ENTRIES) {
          truncated = true;
          return;
        }
      }

      if (truncated) return;
    }
  };

  await walk(cwd, "", false, [], false);
  return { entries, truncated };
}
