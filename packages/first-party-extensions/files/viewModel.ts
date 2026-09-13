import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

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
 * Named state for kinds the workspace media lease cannot mint (F1 #8). The
 * host's mint gate only accepts the image-preview and browser-document
 * extension sets, so video, audio, fonts and other binaries are honest gaps,
 * not fetch-and-hope previews.
 */
export function mediaPreviewNotice(kind: PreviewKind): string {
  return `${kind} preview is not available — the workspace media lease does not mint this file type`;
}

/* ------------------------------------------------------------------------
 * Media lease preview (F1 #8 + #24): `t3.resources/lease` mints a signed
 * `/api/assets/<token>/<name>` URL (1h TTL, token-is-the-auth at serve) that
 * the view renders document-relative. Every transition below is a pure
 * function so renewal timing and denial mapping are testable with an
 * injected clock.
 * --------------------------------------------------------------------- */

/** What the view renders for a minted lease: `<img>` or the document viewer. */
export type MediaLeasePreviewMode = "image" | "document";

/**
 * What a `workspace-file` lease can render for a path — the SAME predicate
 * the host enforces at mint (`isWorkspacePreviewEntryPath`): image-preview
 * extensions mint `workspace-file-exact` claims for `<img>`; `.pdf` mints a
 * `workspace-file` claim served as application/pdf for the built-in document
 * viewer. `.htm`/`.html` stay on the text path (`previewKind` classifies them
 * as source) — browser-document preview is t3.browser's lane. `null` is a
 * named gap; minting it would fail `AssetPreviewTypeValidationError` anyway.
 */
export function leasePreviewMode(relativePath: string): MediaLeasePreviewMode | null {
  if (isWorkspaceImagePreviewPath(relativePath)) return "image";
  if (relativePath.toLowerCase().endsWith(".pdf")) return "document";
  return null;
}

/** Mint-time denials the adapter names in ExtensionOperationError detail. */
export type MediaLeaseDenialReason =
  | "grant-denied"
  | "kind-denied"
  | "not-previewable"
  | "outside-workspace"
  | "context-missing";

export type MediaLeaseState =
  | { readonly status: "idle" }
  | { readonly status: "unsupported-kind"; readonly message: string }
  | { readonly status: "minting"; readonly url?: string; readonly expiresAt?: number }
  | {
      readonly status: "ready";
      readonly url: string;
      readonly expiresAt: number;
      /** A renewal mint failed while the current lease still serves. */
      readonly renewalError?: string;
    }
  | { readonly status: "expired"; readonly url: string }
  | {
      readonly status: "denied";
      readonly reason: MediaLeaseDenialReason;
      readonly message: string;
    }
  | { readonly status: "unavailable"; readonly message: string };

/** Re-mint this far before `expiresAt` so the rendered URL never lapses. */
export const MEDIA_LEASE_RENEWAL_SKEW_MS = 5 * 60_000;
/** Floor on the renewal delay — a short-TTL lease must not spin a mint loop. */
export const MEDIA_LEASE_MIN_RENEWAL_DELAY_MS = 30_000;

/**
 * What selecting a workspace path does to the preview. `hasThread` is the
 * `workspace-file` resource's thread scope — the contract has no
 * project-scope variant, so its absence is a named denial, not an invented
 * ref.
 */
export function selectMediaLease(input: {
  readonly path: string;
  readonly hasThread: boolean;
}): MediaLeaseState {
  if (leasePreviewMode(input.path) === null)
    return { status: "unsupported-kind", message: mediaPreviewNotice(previewKind(input.path)) };
  if (!input.hasThread)
    return {
      status: "denied",
      reason: "context-missing",
      message:
        "Media preview requires a thread-scoped context — this view was opened for a project only",
    };
  return { status: "minting" };
}

/**
 * Capability gate after `getCapabilities`: null means `workspace-file` is
 * mintable here; otherwise the named unsupported state — an absent kind is
 * never a fetch-and-hope mint.
 */
export function mediaLeaseKindGate(supportedKinds: readonly string[]): MediaLeaseState | null {
  return supportedKinds.includes("workspace-file")
    ? null
    : {
        status: "unsupported-kind",
        message:
          "Media preview is not available — this server build cannot mint workspace-file leases",
      };
}

export function mediaLeaseMinted(result: {
  readonly url: string;
  readonly expiresAt: number;
}): MediaLeaseState {
  return { status: "ready", url: result.url, expiresAt: result.expiresAt };
}

const LEASE_DENIALS: ReadonlyArray<{
  readonly name: string;
  readonly reason: MediaLeaseDenialReason;
  readonly message: string;
}> = [
  {
    name: "ResourceLeaseGrantDeniedError",
    reason: "grant-denied",
    message: "Media preview denied — the installation is missing the t3.workspace/resources grant",
  },
  {
    name: "ResourceLeaseKindDeniedError",
    reason: "kind-denied",
    message: "Media preview denied — this resource kind is not mintable on this server",
  },
  {
    name: "AssetPreviewTypeValidationError",
    reason: "not-previewable",
    message: "Media preview denied — this file type is not previewable through the workspace lease",
  },
  {
    name: "AssetWorkspacePathValidationError",
    reason: "outside-workspace",
    message: "Media preview denied — the path resolves outside the granted workspace",
  },
  {
    name: "AssetWorkspaceAssetNotFoundError",
    reason: "context-missing",
    message: "Media preview unavailable — the file no longer exists in the workspace",
  },
];

const LEASE_CONTEXT_ERRORS = new Set([
  "AssetWorkspaceContextNotFoundError",
  "AssetWorkspaceContextResolutionError",
  "AssetWorkspaceRootNormalizationError",
]);

/**
 * Mint failure → named state. Every denial the adapter names stays a `denied`
 * with its reason; an unnamed or host-side failure (including
 * `ResourceLeaseGrantCheckError`, a grant evaluation fault) is `unavailable`,
 * never coerced into a denial it isn't.
 */
export function mediaLeaseErrorState(
  error: unknown,
): Extract<MediaLeaseState, { readonly status: "denied" | "unavailable" }> {
  const text = error instanceof Error ? error.message : String(error);
  for (const denial of LEASE_DENIALS)
    if (text.includes(denial.name))
      return { status: "denied", reason: denial.reason, message: denial.message };
  for (const name of LEASE_CONTEXT_ERRORS)
    if (text.includes(name))
      return {
        status: "denied",
        reason: "context-missing",
        message: "Media preview unavailable — the workspace context could not be resolved",
      };
  return {
    status: "unavailable",
    message: `Media preview failed${text ? `: ${text.slice(0, 300)}` : ""}`,
  };
}

/**
 * A mint result failure. While a previous lease still serves (renewal in
 * flight), keep it rendered with the failure named — the signed token is
 * valid until `expiresAt` regardless of why the re-mint failed.
 */
export function mediaLeaseFailed(error: unknown, previous?: MediaLeaseState): MediaLeaseState {
  const mapped = mediaLeaseErrorState(error);
  if (
    previous?.status === "minting" &&
    previous.url !== undefined &&
    previous.expiresAt !== undefined
  )
    return {
      status: "ready",
      url: previous.url,
      expiresAt: previous.expiresAt,
      renewalError: mapped.message,
    };
  return mapped;
}

/**
 * Milliseconds until a live lease should be re-minted: `expiresAt` minus the
 * skew, floored at `MEDIA_LEASE_MIN_RENEWAL_DELAY_MS` so a mint returning an
 * already-due expiry (short-TTL host build, skewed clock) cannot spin an
 * unbounded tight mint loop.
 */
export function mediaLeaseRenewalDelay(expiresAt: number, now: number): number {
  return Math.max(MEDIA_LEASE_MIN_RENEWAL_DELAY_MS, expiresAt - MEDIA_LEASE_RENEWAL_SKEW_MS - now);
}

/** Renewal starts: the current URL keeps rendering while the re-mint runs. */
export function mediaLeaseRenewing(state: MediaLeaseState): MediaLeaseState {
  return state.status === "ready"
    ? { status: "minting", url: state.url, expiresAt: state.expiresAt }
    : state;
}

/**
 * A rendered `<img>`/document load failure. Past `expiresAt` the token simply
 * stopped serving — `expired` triggers a re-mint. Before expiry the fetch
 * failed for another reason (the file moved, the view is remote to the
 * environment, or the URL otherwise did not resolve on this origin) — named,
 * never a broken image.
 */
export function mediaLeaseAssetFailed(state: MediaLeaseState, now: number): MediaLeaseState {
  if (state.status !== "ready") return state;
  if (now >= state.expiresAt) return { status: "expired", url: state.url };
  return {
    status: "unavailable",
    message:
      "Preview could not be loaded — the minted URL did not resolve on this origin (the file may have moved, or this view is remote to the environment)",
  };
}

/** A live lease reaching its TTL with no landed renewal: go expired. */
export function mediaLeaseExpire(state: MediaLeaseState): MediaLeaseState {
  return state.status === "ready" ? { status: "expired", url: state.url } : state;
}

/**
 * The URL a media element should render: a live lease, or the previous one
 * while its renewal mint is in flight. `expired`, denials and failures carry
 * no renderable URL — the named state is the UI, never a broken element.
 */
export function mediaLeaseUrl(state: MediaLeaseState): string | null {
  if (state.status === "ready") return state.url;
  if (state.status === "minting") return state.url ?? null;
  return null;
}

const leaseTime = (expiresAt: number) =>
  new Date(expiresAt).toLocaleTimeString("en-US", { hour12: false });

/** Status line for the media preview pane. */
export function describeMediaLease(state: MediaLeaseState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "unsupported-kind":
      return state.message;
    case "minting":
      return state.url === undefined
        ? "Preparing preview — minting a media lease"
        : "Preview shown — renewing the media lease";
    case "ready":
      return state.renewalError === undefined
        ? `Preview ready — lease renews automatically (expires ${leaseTime(state.expiresAt)})`
        : `Preview shown — renewal failed (${state.renewalError}); the current lease expires ${leaseTime(state.expiresAt)}`;
    case "expired":
      return "Preview lease expired — renewing";
    case "denied":
      return state.message;
    case "unavailable":
      return state.message;
  }
}

/**
 * Editor slice (P05-D): the `t3.workspace/text-edits@1.1.0` snapshot result
 * mapped onto the panel's editing surface. The 24000-byte bound is an API
 * checkpoint; `oversized` names the deferred full-size-editing blocker (#19)
 * instead of pretending a truncated read is editable.
 */
export type SnapshotReason =
  | "not-found"
  | "not-regular-file"
  | "binary"
  | "invalid-utf8"
  | "oversized"
  | "outside-workspace"
  | "unsafe-path"
  | "changed-during-read"
  | "io-error";

export interface SnapshotRead {
  readonly kind: "editable" | "not-editable";
  readonly contents?: string;
  readonly revision?: string;
  readonly reason?: SnapshotReason;
}

export type EditorOpen =
  | { readonly editable: true; readonly contents: string; readonly revision: string }
  | { readonly editable: false; readonly reason: SnapshotReason; readonly message: string };

const EDITABLE_TEXT_MAX_BYTES = 24000;

const REASON_MESSAGES: Readonly<Record<SnapshotReason, string>> = {
  "not-found": "File does not exist in this workspace",
  "not-regular-file": "Not a regular file — only regular files can be edited",
  binary: "Binary file — editing is not supported",
  "invalid-utf8": "File is not valid UTF-8 — editing is not supported",
  oversized: `File exceeds the ${EDITABLE_TEXT_MAX_BYTES.toLocaleString("en-US")}-byte editable bound — read only (full-size editing is not public yet)`,
  "outside-workspace": "Path is outside the workspace",
  "unsafe-path": "Path is not a safe workspace-relative path",
  "changed-during-read": "File changed while it was being read — try again",
  "io-error": "File could not be read",
};

/**
 * Snapshot → editor state. Editable snapshots carry the contents and the
 * revision saves compare against; everything else is read-only with the
 * contract's named reason — never silent truncation of user edits.
 */
export function describeSnapshot(read: SnapshotRead): EditorOpen {
  if (read.kind === "editable" && typeof read.contents === "string" && read.revision)
    return { editable: true, contents: read.contents, revision: read.revision };
  const reason: SnapshotReason = read.reason ?? "io-error";
  return { editable: false, reason, message: REASON_MESSAGES[reason] };
}

export type SaveStateKind = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

/**
 * Whether the coordinator holds local work a remote refresh must not
 * clobber — the plugin-side form of the native panel's `selectedFilePending`
 * gate. `conflict` is the latched case; `dirty`/`saving`/`error` are the same
 * "unresolved local edits" pending.
 */
export function editorSavePending(kind: SaveStateKind): boolean {
  return kind === "dirty" || kind === "saving" || kind === "conflict" || kind === "error";
}

/**
 * Mutation-refresh gate for `t3.workspace/changes`, mirroring the native
 * `useWorkspaceMutationRefresh` handled-token semantics: a seq different from
 * the handled one fires exactly one refresh; while `enabled` is false the
 * bump stays unhandled, so it still fires when the latch opens.
 */
export function shouldHandleMutation(input: {
  readonly enabled: boolean;
  readonly mutationSeq: number;
  readonly handledSeq: number | null;
}): boolean {
  return input.enabled && input.mutationSeq !== input.handledSeq;
}

/** Status line for the coordinator's observable state. */
export function describeSaveState(state: {
  readonly kind: SaveStateKind;
  readonly message?: string;
}): string {
  switch (state.kind) {
    case "clean":
      return "No unsaved changes";
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "conflict":
      return "File changed on disk — reload it or keep your version";
    case "error":
      return `Save failed${state.message ? `: ${state.message}` : ""} — your changes are kept`;
  }
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
