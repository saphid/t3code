/**
 * Pure view-model for the Files tree panel. Owns F1 row #6's panel-local
 * behavior: ordering, expansion state, and name filtering over the flat entry
 * list the `t3.workspace/tree` snapshot delivers.
 */

export interface TreeEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
}

export interface TreeRow {
  readonly entry: TreeEntry;
  readonly depth: number;
  readonly expandable: boolean;
}

export function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index === -1 ? null : path.slice(0, index);
}

/**
 * Depth-first order with directories before files at every level: each path
 * segment is ranked by that entry's kind so a directory's whole subtree sorts
 * before the sibling files that follow it.
 */
function sortKey(entry: TreeEntry): string {
  const segments = entry.path.split("/");
  return segments
    .map((segment, index) => {
      const rank = index === segments.length - 1 && entry.kind === "file" ? "1" : "0";
      return rank + segment;
    })
    .join("/");
}

export function compareTreeEntries(left: TreeEntry, right: TreeEntry): number {
  const a = sortKey(left);
  const b = sortKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortTreeEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries.toSorted(compareTreeEntries);
}

export function toggleExpanded(expanded: ReadonlySet<string>, directoryPath: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(directoryPath)) next.delete(directoryPath);
  else next.add(directoryPath);
  return next;
}

/**
 * Entries matching a case-insensitive substring of the path, plus every
 * ancestor directory needed to render them as a tree.
 */
export function filterEntries(entries: readonly TreeEntry[], query: string): Set<string> {
  const needle = query.trim().toLowerCase();
  const keep = new Set<string>();
  if (!needle) return keep;
  for (const entry of entries) {
    if (!entry.path.toLowerCase().includes(needle)) continue;
    keep.add(entry.path);
    let ancestor = parentPath(entry.path);
    while (ancestor !== null) {
      keep.add(ancestor);
      ancestor = parentPath(ancestor);
    }
  }
  return keep;
}

/**
 * Flat rows in render order. An entry is visible when every ancestor
 * directory is expanded; while a filter is active, expansion is ignored and
 * only matching rows (plus their ancestors) appear.
 */
export function visibleRows(
  entries: readonly TreeEntry[],
  expanded: ReadonlySet<string>,
  query = "",
): TreeRow[] {
  const keep = query.trim() ? filterEntries(entries, query) : null;
  const rows: TreeRow[] = [];
  for (const entry of sortTreeEntries(entries)) {
    if (keep !== null && !keep.has(entry.path)) continue;
    let depth = 0;
    let hidden = false;
    let ancestor = parentPath(entry.path);
    while (ancestor !== null) {
      depth += 1;
      if (keep === null && !expanded.has(ancestor)) hidden = true;
      ancestor = parentPath(ancestor);
    }
    if (!hidden) rows.push({ entry, depth, expandable: entry.kind === "directory" });
  }
  return rows;
}
