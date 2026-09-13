/**
 * Per-project URL history for the Browser panel — the package-owned port of
 * the native browserHistoryStore's semantics (binding table row #8 in
 * docs/internals/extensions/browser-binding-disposition.md).
 *
 * Native keeps one localStorage blob keyed `byProjectKey` with pending
 * per-thread buffers; the plugin instead persists through the surface's
 * `session.save` channel, whose record already carries project/thread scope —
 * so this module is the pure entry list: normalize, dedupe by visit key,
 * MRU order, cap 50, sanitize on restore. The loopback/`0.0.0.0` → "local"
 * folding in the dedupe key is preserved; the environment-hostname fold is
 * kept in the signature for the coming sessions contract but has no caller
 * today (no public read of the environment URL).
 */
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { isLocalLoopbackHost, normalizeHostname } from "@t3tools/shared/hostClassification";

export type BrowserHistoryEntry = { url: string; lastVisitedAt: number; title?: string };

export const BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT = 50;
export const BROWSER_HISTORY_MAX_URL_LENGTH = 2048;
export const BROWSER_HISTORY_MAX_TITLE_LENGTH = 512;
const MAX_VALID_DATE_MS = 8_640_000_000_000_000;

/**
 * Recents shown in the empty state — `PreviewEmptyState` renders at most 8
 * of the stored MRU list (native PreviewEmptyState.tsx:32).
 */
export const PREVIEW_RECENT_URL_DISPLAY_LIMIT = 8;

export function isValidHistoryTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_VALID_DATE_MS
  );
}

export function normalizeHistoryUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(normalizePreviewUrl(raw));
  } catch {
    return null;
  }
  parsed.username = parsed.password = "";
  return parsed.href.length > BROWSER_HISTORY_MAX_URL_LENGTH ? null : parsed.href;
}

function titleLookupKey(normalized: string, environmentHostname?: string | null): string {
  const parsed = new URL(visitLookupKey(normalized, environmentHostname));
  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/"))
    parsed.pathname = parsed.pathname.slice(0, -1);
  return parsed.href;
}

function visitLookupKey(normalized: string, environmentHostname?: string | null): string {
  const parsed = new URL(normalized);
  const host = normalizeHostname(parsed.hostname);
  const environmentHost = environmentHostname && normalizeHostname(environmentHostname);
  if (isLocalLoopbackHost(host) || host === "0.0.0.0" || host === environmentHost)
    parsed.hostname = "local";
  return parsed.href;
}

function isStableLocalUrl(normalized: string): boolean {
  const host = normalizeHostname(new URL(normalized).hostname);
  return isLocalLoopbackHost(host) || host === "0.0.0.0";
}

export function upsertHistoryEntry(
  entries: ReadonlyArray<BrowserHistoryEntry>,
  url: string,
  at: number,
  options?: { insertOrdered?: boolean; environmentHostname?: string | null },
): BrowserHistoryEntry[] {
  const key = visitLookupKey(url, options?.environmentHostname);
  const existing = entries.find(
    (candidate) => visitLookupKey(candidate.url, options?.environmentHostname) === key,
  );
  const rest = entries.filter(
    (candidate) => visitLookupKey(candidate.url, options?.environmentHostname) !== key,
  );
  const visitedAt =
    options?.insertOrdered && existing && existing.lastVisitedAt > at ? existing.lastVisitedAt : at;
  const storedUrl =
    existing && (isStableLocalUrl(existing.url) || !isStableLocalUrl(url)) ? existing.url : url;
  const entry: BrowserHistoryEntry = existing
    ? { ...existing, url: storedUrl, lastVisitedAt: visitedAt }
    : { url, lastVisitedAt: visitedAt };
  if (!options?.insertOrdered)
    return [entry, ...rest].slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
  const index = rest.findIndex((candidate) => candidate.lastVisitedAt < entry.lastVisitedAt);
  const next = index === -1 ? [...rest, entry] : rest.toSpliced(index, 0, entry);
  return next.slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
}

/** recordVisit: normalize, then upsert; unrecordable urls are dropped. */
export function recordHistoryVisit(
  entries: ReadonlyArray<BrowserHistoryEntry>,
  rawUrl: string,
  at: number,
  options?: { insertOrdered?: boolean; environmentHostname?: string | null },
): BrowserHistoryEntry[] {
  const normalized = normalizeHistoryUrl(rawUrl);
  return normalized ? upsertHistoryEntry(entries, normalized, at, options) : [...entries];
}

/** Update-only title write: never creates an entry, no-ops when unchanged. */
export function setHistoryEntryTitle(
  entries: ReadonlyArray<BrowserHistoryEntry>,
  rawUrl: string,
  title: string,
  environmentHostname?: string | null,
): BrowserHistoryEntry[] {
  const normalized = normalizeHistoryUrl(rawUrl);
  const trimmed = title.trim().slice(0, BROWSER_HISTORY_MAX_TITLE_LENGTH);
  if (!normalized || trimmed.length === 0) return [...entries];
  const key = titleLookupKey(normalized, environmentHostname);
  const index = entries.findIndex(
    (candidate) => titleLookupKey(candidate.url, environmentHostname) === key,
  );
  if (index === -1 || entries[index]?.title === trimmed) return [...entries];
  return entries.map((candidate, candidateIndex) =>
    candidateIndex === index ? { ...candidate, title: trimmed } : candidate,
  );
}

/** removeUrl: exact normalized-URL match (not the folding visit key). */
export function removeHistoryUrl(
  entries: ReadonlyArray<BrowserHistoryEntry>,
  rawUrl: string,
): BrowserHistoryEntry[] {
  const normalized = normalizeHistoryUrl(rawUrl);
  return normalized ? entries.filter((candidate) => candidate.url !== normalized) : [...entries];
}

/**
 * Restore-side migration — the per-project branch of the native
 * `migratePersistedBrowserHistoryState`:
 * malformed entries are dropped, urls re-normalized, timestamps validated,
 * titles clamped, then sorted MRU-first, deduped by visit key and capped.
 * Never throws; a corrupt persisted list restores as an empty one.
 */
export function sanitizeHistoryEntries(value: unknown): BrowserHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seenUrls = new Set<string>();
  return value
    .flatMap<BrowserHistoryEntry>((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const { url, lastVisitedAt, title } = candidate as Record<string, unknown>;
      if (typeof url !== "string") return [];
      const normalizedUrl = normalizeHistoryUrl(url);
      if (!normalizedUrl) return [];
      if (!isValidHistoryTimestamp(lastVisitedAt)) return [];
      return [
        {
          url: normalizedUrl,
          lastVisitedAt,
          ...(typeof title === "string" && title.length > 0
            ? { title: title.slice(0, BROWSER_HISTORY_MAX_TITLE_LENGTH) }
            : {}),
        },
      ];
    })
    .toSorted((a, b) => b.lastVisitedAt - a.lastVisitedAt)
    .filter((entry) => {
      const key = visitLookupKey(entry.url);
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    })
    .slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
}

/** The display slice the empty state renders (native shows ≤ 8). */
export function recentHistoryEntries(
  entries: ReadonlyArray<BrowserHistoryEntry>,
  limit = PREVIEW_RECENT_URL_DISPLAY_LIMIT,
): BrowserHistoryEntry[] {
  return entries.filter((entry) => URL.canParse(entry.url)).slice(0, limit);
}

/**
 * session.save serializes through the SDK's bounded JSON envelope, which
 * localStorage-backed native history never had to fit. Drops the oldest
 * entries until `record` (with `history` attached) serializes under the
 * budget, so a worst-case 50 × 2048-char list can never make save throw.
 */
export const HISTORY_SAVE_BUDGET_BYTES = 56_000;

export function fitHistoryToSaveBudget(
  record: Readonly<Record<string, unknown>>,
  entries: ReadonlyArray<BrowserHistoryEntry>,
  budgetBytes = HISTORY_SAVE_BUDGET_BYTES,
): BrowserHistoryEntry[] {
  let next = entries.slice(0, BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT);
  while (next.length > 0 && JSON.stringify({ ...record, history: next }).length > budgetBytes)
    next = next.slice(0, -1);
  return next;
}
