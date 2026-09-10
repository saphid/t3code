import type { FileTreeBatchOperation } from "@pierre/trees";

export type NativeTreeEntry = { readonly path: string; readonly kind: "file" | "directory" };

export function treePath(entry: NativeTreeEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/** Reused from the native panel's path reconciliation behavior. */
export function buildTreePathUpdates(
  previousPaths: readonly string[],
  nextPaths: readonly string[],
): FileTreeBatchOperation[] {
  const previous = new Set(previousPaths);
  const next = new Set(nextPaths);
  const removedDirectoryRoots: string[] = [];
  const updates: FileTreeBatchOperation[] = [];
  for (const path of previousPaths
    .filter((candidate) => !next.has(candidate))
    .toSorted((left, right) => pathDepth(left) - pathDepth(right))) {
    if (removedDirectoryRoots.some((directory) => path.startsWith(directory))) continue;
    const recursive = path.endsWith("/");
    updates.push({ type: "remove", path, ...(recursive ? { recursive: true } : {}) });
    if (recursive) removedDirectoryRoots.push(path);
  }
  for (const path of nextPaths
    .filter((candidate) => !previous.has(candidate))
    .toSorted((left, right) => pathDepth(left) - pathDepth(right))) {
    updates.push({ type: "add", path });
  }
  return updates;
}

type DirectoryHandle = {
  isDirectory(): boolean;
  isExpanded(): boolean;
  expand(): void;
  collapse(): void;
};

function directory(item: unknown): DirectoryHandle | null {
  if (typeof item !== "object" || item === null) return null;
  const candidate = item as Partial<DirectoryHandle>;
  return candidate.isDirectory?.() && candidate.isExpanded && candidate.expand && candidate.collapse
    ? (candidate as DirectoryHandle)
    : null;
}

/** Reused from the native panel's collapse-all behavior. */
export function allDirectoriesExpanded(model: TreeModelItems, paths: readonly string[]) {
  return (
    paths.length > 0 && paths.every((path) => directory(model.getItem(path))?.isExpanded() === true)
  );
}

export function setAllDirectoriesExpanded(
  model: TreeModelItems,
  paths: readonly string[],
  expanded: boolean,
): void {
  for (const path of paths) {
    const item = directory(model.getItem(path));
    if (item === null || item.isExpanded() === expanded) continue;
    if (expanded) item.expand();
    else item.collapse();
  }
}

export function revealAncestors(model: TreeModelItems, path: string): void {
  let ancestor = "";
  for (const segment of path.split("/").slice(0, -1)) {
    ancestor = ancestor ? `${ancestor}/${segment}` : segment;
    const item = model.getItem(`${ancestor}/`) ?? model.getItem(ancestor);
    if (
      typeof item === "object" &&
      item !== null &&
      "expand" in item &&
      typeof item.expand === "function"
    )
      item.expand();
  }
}
export interface TreeModelItems {
  getItem(path: string): unknown;
}
