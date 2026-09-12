/**
 * Pure view-model for the Diff panel skeleton (P11-A). Owns the read-side
 * model the view renders over the public `t3.vcs/diff` +
 * `t3.vcs/repository` contracts: patch → file rows, binary detection from
 * the delivered patch text, per-file hunk rows, gap expansion over
 * `getFileContents` payloads, and the capability gate.
 *
 * The parser is the vendored `@pierre/diffs` `parsePatchFiles` — the same
 * pure parser the native panel feeds (its React renderer cannot be
 * bundled: it imports react-dom, which the extension bundler rejects).
 * `hydratePartialDiff` is not a public subpath, so gap expansion is
 * re-derived here over the delivered full-file contents.
 *
 * Dispositions covered: vcs-diff-binding-disposition.md rows 30, 34, 35.
 * Turn/checkpoint diffs (rows 36/37) are the P12 boundary; diff-line
 * comments wait on t3.messages/enrichment.
 */
import type { FileDiffMetadata } from "@pierre/diffs/types";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import type {
  VcsCapabilitiesResult,
  VcsDiffFileContentsInput,
  VcsDiffPreviewResult,
  VcsDiffPreviewSource,
} from "@t3tools/extension-sdk/catalogue";

/* ---------------- paths ---------------- */

/** Strip the renderer prefix git applies (`a/` `b/`); mirrors native resolveFileDiffPath. */
export function resolveDiffPath(raw: string): string {
  if (raw.startsWith("a/") || raw.startsWith("b/")) return raw.slice(2);
  return raw;
}

/* ---------------- binary detection ---------------- */

const DIFF_GIT_BOUNDARY = /^diff --git /gm;
const BINARY_FILES_MARKER = /^Binary files .+ differ$/m;
const GIT_BINARY_MARKER = /^GIT binary patch$/m;
const BINARY_B_PATH = /^Binary files .+ and b\/(.+) differ$/m;
const HEADER_B_PATH_QUOTED = /^diff --git "a\/(?:.*)" "b\/(.*)"$/;
const HEADER_B_PATH = /^diff --git a\/.* b\/(.*)$/;

/**
 * Paths the delivered patch marks binary. Git emits either
 * `Binary files a/x and b/x differ` (the `b/` side names the file, even
 * for untracked `--no-index` entries where the a side is /dev/null) or a
 * `GIT binary patch` block (paths only on the `diff --git` header). A file
 * is named binary only when the literal marker exists for its path —
 * never inferred from missing hunks.
 */
export function binaryPathsFromPatch(diff: string): ReadonlySet<string> {
  const paths = new Set<string>();
  const boundaries = [...diff.matchAll(DIFF_GIT_BOUNDARY)].map((match) => match.index);
  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index];
    const end = index + 1 < boundaries.length ? boundaries[index + 1] : diff.length;
    const section = diff.slice(start, end);
    if (BINARY_FILES_MARKER.test(section)) {
      const path = BINARY_B_PATH.exec(section)?.[1];
      if (path !== undefined) paths.add(path);
    } else if (GIT_BINARY_MARKER.test(section)) {
      const header = section.split("\n", 1)[0] ?? "";
      const path =
        HEADER_B_PATH_QUOTED.exec(header)?.[1] ?? HEADER_B_PATH.exec(header)?.[1] ?? null;
      if (path !== null) paths.add(path);
    }
  }
  return paths;
}

/* ---------------- file rows ---------------- */

export type DiffChangeType = FileDiffMetadata["type"];

export interface DiffFileRow {
  /** Stable key for selection: prev + new path (renames differ on both). */
  readonly key: string;
  /** Workspace-relative new path (renderer prefix stripped). */
  readonly path: string;
  /** Workspace-relative old path for renames; null otherwise. */
  readonly prevPath: string | null;
  readonly changeType: DiffChangeType;
  readonly additions: number;
  readonly deletions: number;
  /** Literal binary marker in the patch — no fake text patch is rendered. */
  readonly binary: boolean;
  /** Parsed but carrying no text hunks (mode-only change, or a truncated tail). */
  readonly textless: boolean;
  readonly file: FileDiffMetadata;
}

function rowFromFile(file: FileDiffMetadata, binaryPaths: ReadonlySet<string>): DiffFileRow {
  const path = resolveDiffPath(file.name ?? file.prevName ?? "");
  const prevPath = file.prevName !== undefined ? resolveDiffPath(file.prevName) : null;
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  const binary = binaryPaths.has(path) || (prevPath !== null && binaryPaths.has(prevPath));
  return {
    key: `${prevPath ?? ""}\u0000${path}`,
    path,
    prevPath,
    changeType: file.type,
    additions,
    deletions,
    binary,
    textless: file.hunks.length === 0 && !binary,
    file,
  };
}

/* ---------------- patch → renderable ---------------- */

export type RenderableDiff =
  | { readonly kind: "files"; readonly files: readonly DiffFileRow[] }
  | { readonly kind: "raw"; readonly text: string; readonly reason: string };

/**
 * Mirrors native `getRenderablePatch` (diffRendering.ts): null on empty,
 * parsed file rows on success, and the honest `raw` fallback with a reason
 * when the delivered text is not a parseable patch.
 */
export function renderableFromPatch(diff: string | null | undefined): RenderableDiff | null {
  if (diff === null || diff === undefined) return null;
  const normalized = diff.trim();
  if (normalized.length === 0) return null;
  try {
    const files = parsePatchFiles(normalized, patchCacheKey(normalized)).flatMap(
      (patch) => patch.files,
    );
    if (files.length > 0) {
      const binaryPaths = binaryPathsFromPatch(normalized);
      return { kind: "files", files: files.map((file) => rowFromFile(file, binaryPaths)) };
    }
    return {
      kind: "raw",
      text: normalized,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalized,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

/** Content-ish key so re-parses of identical payloads stay referentially cheap downstream. */
function patchCacheKey(patch: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < patch.length; index += 1) {
    hash ^= patch.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `t3.diff:${patch.length}:${hash.toString(36)}`;
}

/* ---------------- per-file display rows ---------------- */

export type DiffDisplayRow = { readonly ordinal: number } & (
  | {
      readonly kind: "context";
      readonly text: string;
      readonly oldLine: number;
      readonly newLine: number;
    }
  | { readonly kind: "addition"; readonly text: string; readonly newLine: number }
  | { readonly kind: "deletion"; readonly text: string; readonly oldLine: number }
  /** Unmodified region: `collapsedBefore` lines, or the capped tail of an expanded gap. */
  | { readonly kind: "gap"; readonly count: number }
);

/** Upper bound on context rows an expanded gap paints before naming the remainder. */
export const MAX_EXPANDED_CONTEXT_LINES = 200;

export interface DiffFileContents {
  readonly oldContents: string;
  readonly newContents: string;
}

function splitLines(text: string): readonly string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Patch-parsed and contents-derived lines both can carry a trailing newline; display strips it. */
function lineText(lines: readonly string[], index: number): string {
  return (lines[index] ?? "").replace(/\r?\n$/, "");
}

/**
 * Unified display rows for one file. Without `contents` the hunks render
 * exactly what the patch carries and every `collapsedBefore` region is a
 * named gap row ("N unmodified lines" — the native separator). With the
 * `getFileContents` payload the same math Pierre's hydrator performs
 * (gap = additionStart-1 - previous hunk end) splices the inter-hunk
 * context back in — bounded per gap so a huge file cannot flood the DOM.
 */
export function fileRows(
  row: DiffFileRow,
  contents?: DiffFileContents,
  maxExpandedContext = MAX_EXPANDED_CONTEXT_LINES,
): readonly DiffDisplayRow[] {
  const file = row.file;
  if (file.hunks.length === 0) return [];

  const expanded = contents !== undefined;
  const additionLines = expanded ? splitLines(contents.newContents) : file.additionLines;
  const deletionLines = expanded ? splitLines(contents.oldContents) : file.deletionLines;

  const rows: DiffDisplayRow[] = [];
  const pushGap = (oldStart: number, newStart: number, count: number) => {
    // Expanded gaps render real context up to the bound, then a named remainder.
    // Text is identical on both sides (unchanged region); old/new line numbers
    // diverge after additions/deletions, so each side keeps its own offset.
    const shown = Math.min(count, maxExpandedContext);
    for (let offset = 0; offset < shown; offset += 1) {
      rows.push({
        ordinal: rows.length,
        kind: "context",
        text: lineText(additionLines, newStart + offset),
        oldLine: oldStart + offset + 1,
        newLine: newStart + offset + 1,
      });
    }
    if (count > shown) rows.push({ ordinal: rows.length, kind: "gap", count: count - shown });
  };

  let lastAdditionEnd = 0;
  let lastDeletionEnd = 0;
  for (const hunk of file.hunks) {
    if (expanded) {
      const gap = Math.max(hunk.additionStart - 1 - lastAdditionEnd, 0);
      if (gap > 0) pushGap(lastDeletionEnd, lastAdditionEnd, gap);
    } else if (hunk.collapsedBefore > 0) {
      rows.push({ ordinal: rows.length, kind: "gap", count: hunk.collapsedBefore });
    }

    // Text index into the line arrays (patch-scoped for partial diffs,
    // file-scoped once expanded) is tracked separately from the real
    // old/new file line numbers, which always come from the hunk header.
    let additionIndex = expanded ? Math.max(hunk.additionStart - 1, 0) : hunk.additionLineIndex;
    let deletionIndex = expanded ? Math.max(hunk.deletionStart - 1, 0) : hunk.deletionLineIndex;
    let newLine = hunk.additionStart;
    let oldLine = hunk.deletionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          rows.push({
            ordinal: rows.length,
            kind: "context",
            text: lineText(additionLines, additionIndex + offset),
            oldLine: oldLine + offset,
            newLine: newLine + offset,
          });
        }
        additionIndex += content.lines;
        deletionIndex += content.lines;
        oldLine += content.lines;
        newLine += content.lines;
      } else {
        for (let offset = 0; offset < content.deletions; offset += 1) {
          rows.push({
            ordinal: rows.length,
            kind: "deletion",
            text: lineText(deletionLines, deletionIndex + offset),
            oldLine: oldLine + offset,
          });
        }
        deletionIndex += content.deletions;
        oldLine += content.deletions;
        for (let offset = 0; offset < content.additions; offset += 1) {
          rows.push({
            ordinal: rows.length,
            kind: "addition",
            text: lineText(additionLines, additionIndex + offset),
            newLine: newLine + offset,
          });
        }
        additionIndex += content.additions;
        newLine += content.additions;
      }
    }
    lastAdditionEnd = hunk.additionStart + hunk.additionCount - 1;
    lastDeletionEnd = hunk.deletionStart + hunk.deletionCount - 1;
  }
  if (expanded) {
    const tail = Math.max(additionLines.length - lastAdditionEnd, 0);
    if (tail > 0) pushGap(lastDeletionEnd, lastAdditionEnd, tail);
  }
  return rows;
}

/** Only two-sided change files gain anything from the file-contents read. */
export function canExpandFile(row: DiffFileRow): boolean {
  return (
    !row.binary &&
    !row.textless &&
    (row.changeType === "change" || row.changeType === "rename-changed")
  );
}

/** The `t3.vcs/diff` `getFileContents` input for one listed file. */
export function fileContentsInput(
  source: Pick<VcsDiffPreviewSource, "kind" | "baseRef" | "headRef">,
  row: DiffFileRow,
): VcsDiffFileContentsInput {
  return {
    sourceKind: source.kind,
    changeType: row.changeType,
    baseRef: source.baseRef,
    headRef: source.headRef,
    oldPath: row.prevPath ?? row.path,
    newPath: row.path,
  };
}

/* ---------------- labels ---------------- */

export function changeTypeLabel(changeType: DiffChangeType): string {
  switch (changeType) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
      return "renamed";
    case "rename-changed":
      return "renamed, modified";
    case "change":
      return "modified";
  }
}

/** Display path for a row: `old → new` for renames, `new` otherwise. */
export function displayPath(row: DiffFileRow): string {
  return row.prevPath !== null ? `${row.prevPath} → ${row.path}` : row.path;
}

/** Per-file stat text, e.g. "+12 −4"; binary and textless rows carry no counts. */
export function fileStatLabel(row: DiffFileRow): string {
  if (row.binary || row.textless) return "";
  return `+${row.additions} −${row.deletions}`;
}

/** Source switcher label: title + delivered hash prefix + truncation marker. */
export function describeSource(source: VcsDiffPreviewSource): string {
  const hash = source.diffHash.slice(0, 12);
  return `${source.title} · ${hash}${source.truncated ? " · truncated" : ""}`;
}

/* ---------------- source + selection state ---------------- */

export const WORKING_TREE_KIND = "working-tree" as const;

/**
 * Pick the displayed source: the persisted choice when it still exists,
 * the dirty-worktree source by default (the native default scope), else
 * the first source the host delivered.
 */
export function selectSource(
  result: VcsDiffPreviewResult | null | undefined,
  wantedId: string | null | undefined,
): VcsDiffPreviewSource | null {
  const sources = result?.sources ?? [];
  if (sources.length === 0) return null;
  const wanted = wantedId !== null && wantedId !== undefined ? wantedId : WORKING_TREE_KIND;
  return sources.find((source) => source.id === wanted) ?? sources[0] ?? null;
}

/** Keep a selected file across refreshes; drops once the path leaves the list. */
export function retainFileSelection(
  files: readonly DiffFileRow[],
  selectedKey: string | null,
): DiffFileRow | null {
  if (selectedKey === null) return null;
  return files.find((row) => row.key === selectedKey) ?? null;
}

/* ---------------- preview + capability states ---------------- */

export type PreviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly detail: string }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly result: VcsDiffPreviewResult };

/**
 * `null` result with no error means the invoke has not resolved yet —
 * loading. An empty `sources` array is the host's real answer for a
 * non-repo or a preview with nothing to report — the honest empty state.
 */
export function previewState(
  result: VcsDiffPreviewResult | null,
  error: string | null,
): PreviewState {
  if (error !== null) return { kind: "error", detail: error };
  if (result === null) return { kind: "loading" };
  if (result.sources.length === 0) return { kind: "empty" };
  return { kind: "ready", result };
}

export type DiffCapabilityState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "no-repository"; readonly detail: string | null }
  | { readonly kind: "unsupported"; readonly driverKind: string; readonly detail: string }
  | { readonly kind: "ready" };

/**
 * The honesty gate (row 30): capabilities decide whether the panel renders
 * real state, a real no-repo state, or a named unsupported driver — never
 * a fabricated empty diff.
 */
export function diffCapabilityState(
  capabilities: VcsCapabilitiesResult | null,
  error: string | null,
): DiffCapabilityState {
  if (error !== null) return { kind: "unavailable", detail: error };
  if (capabilities === null) return { kind: "loading" };
  if (!capabilities.detected) {
    return { kind: "no-repository", detail: capabilities.detail };
  }
  if (!capabilities.operations["diff.getPreview"]) {
    const kind = capabilities.kind ?? "unknown";
    return {
      kind: "unsupported",
      driverKind: kind,
      detail: `The detected ${kind} driver does not serve diff previews.`,
    };
  }
  return { kind: "ready" };
}
