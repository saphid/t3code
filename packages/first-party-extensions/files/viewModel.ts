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

/** How the preview pane treats a selected path (F1 #1 text, #8 media). */
export type PreviewKind = "text" | "image" | "video" | "audio" | "font" | "binary";

const PREVIEW_KIND_BY_EXTENSION: Readonly<Record<string, PreviewKind>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  ico: "image",
  bmp: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  pdf: "binary",
  zip: "binary",
  gz: "binary",
  tar: "binary",
  wasm: "binary",
  bin: "binary",
  dat: "binary",
  exe: "binary",
  dylib: "binary",
  so: "binary",
};

/** Extension-based classification; unknown extensions preview as text. */
export function previewKind(relativePath: string): PreviewKind {
  const name = relativePath.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "text";
  return PREVIEW_KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "text";
}

/** The public text-read contract result, minus the path the caller already knows. */
export interface PreviewRead {
  readonly contents: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}

export interface PreviewStatus {
  readonly status: string;
  readonly shownByteLength: number;
  readonly truncated: boolean;
}

const textEncoder = new TextEncoder();

/**
 * Honest truncation state for the preview pane (F1 #1). `byteLength` is the
 * file's true size from the contract; `shownByteLength` is the UTF-8 length of
 * what was actually returned, so a truncated preview never claims to show the
 * whole file and never conflates char count with bytes.
 */
export function describeRead(read: PreviewRead): PreviewStatus {
  const shownByteLength = textEncoder.encode(read.contents).byteLength;
  if (read.truncated)
    return {
      status: `File truncated — showing first ${shownByteLength.toLocaleString("en-US")} of ${read.byteLength.toLocaleString("en-US")} bytes (read only)`,
      shownByteLength,
      truncated: true,
    };
  return {
    status: `File loaded — ${read.byteLength.toLocaleString("en-US")} bytes (read only)`,
    shownByteLength,
    truncated: false,
  };
}

/**
 * Workspace media has no public read path yet (F1 #8 defers to
 * t3.workspace/resources); the notice names the missing contract instead of
 * pretending a placeholder is a preview.
 */
export function mediaPreviewNotice(kind: PreviewKind): string {
  return `${kind} preview is not public yet — workspace media reads await the t3.workspace/resources contract`;
}

/** Kind selector values for the `t3.workspace/search` contract call. */
export type SearchKindFilter = "all" | "file" | "directory";

/** The public search-contract result mapped onto the panel's entry shape. */
export interface SearchResults {
  readonly entries: readonly TreeEntry[];
  readonly truncated: boolean;
}

/**
 * Honest status for a contract search (F1 #7): `truncated` comes straight
 * off the wire — the panel never claims completeness the index did not
 * report, and names the limit instead of silently clipping the list.
 */
export function describeSearch(result: SearchResults | null, query: string, limit: number): string {
  const needle = query.trim();
  if (!needle) return "";
  if (result === null) return `Searching for “${needle}”`;
  const count = result.entries.length;
  if (count === 0) return `No matches for “${needle}”`;
  const suffix = result.truncated ? ` — showing first ${count}, refine the query` : "";
  return `${count}${result.truncated ? "+" : ""} match${count === 1 && !result.truncated ? "" : "es"} for “${needle}” (limit ${limit})${suffix}`;
}
