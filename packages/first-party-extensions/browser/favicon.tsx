/**
 * Favicon rendering for the Browser panel's surfaces, over the shared
 * per-origin cache (`faviconStore.ts`): the captured tier (session
 * `faviconRef`s resolved through `sessions.getFavicon`) ahead of the
 * public-provider tier. A load failure drops that tier for the origin on
 * every surface — the session tab strip, the recents list, the host tab —
 * together, so a dead image stops being requested.
 */
import type { BrowserSession, browserSessionsApi } from "@t3tools/extension-sdk/catalogue";
import { useSyncExternalStore } from "react";

import {
  type FaviconCache,
  type FaviconResolution,
  dropCapturedFavicon,
  emptyFaviconCache,
  faviconFallbackGlyph,
  pendingFaviconRefs,
  recordCapturedFavicon,
  recordProviderFaviconFailure,
  resolveFavicon,
} from "./faviconStore.js";
import type { BoundApi } from "./uiContracts.js";

const muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";

const listeners = new Set<() => void>();
let cache: FaviconCache = emptyFaviconCache();
let version = 0;

/** Refs already read (or refused) this client lifetime; never re-requested. */
const attemptedRefs = new Set<string>();
const MAX_ATTEMPTED_REFS = 256;

function commit(next: FaviconCache): void {
  if (next === cache) return;
  cache = next;
  version += 1;
  for (const listener of listeners) listener();
}

/** `<img onError>` entry point — shared by every surface's favicon. */
export function faviconImageFailed(rawUrl: string, tier: "captured" | "provider"): void {
  commit(
    tier === "captured"
      ? dropCapturedFavicon(cache, rawUrl)
      : recordProviderFaviconFailure(cache, rawUrl, Date.now()),
  );
}

/**
 * Resolves the sessions' new favicon refs, once each. Driven by session
 * events, never a timer. A miss (`BrowserFaviconNotFound`: evicted, restarted
 * server) or any other failure leaves the origin on the provider tier.
 */
export function resolveSessionFavicons(
  api: BoundApi<typeof browserSessionsApi>,
  sessions: readonly BrowserSession[],
  signal: AbortSignal,
): void {
  for (const { ref, url } of pendingFaviconRefs(cache, sessions, attemptedRefs)) {
    if (attemptedRefs.size >= MAX_ATTEMPTED_REFS) attemptedRefs.clear();
    attemptedRefs.add(ref);
    api.invoke("getFavicon", { ref }, signal).then(
      (favicon) =>
        commit(recordCapturedFavicon(cache, url, { ref, src: favicon.dataUrl }, Date.now())),
      () => {
        // A cancelled read may be retried by the next view.
        if (signal.aborted) attemptedRefs.delete(ref);
      },
    );
  }
}

/** The current cache, re-read on every change. */
export function useFaviconCache(): FaviconCache {
  useSyncExternalStore(subscribe, () => version);
  return cache;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useFaviconResolution(url: string | null): FaviconResolution {
  useSyncExternalStore(subscribe, () => version);
  return resolveFavicon(cache, url);
}

/**
 * One favicon slot: the provider image when the origin resolves one, the
 * fallback glyph otherwise. Failures record into the shared cache, so the
 * next render of any surface for that origin shows the glyph.
 */
export function BrowserFavicon(props: { url: string | null; size?: number }) {
  const size = props.size ?? 12;
  const resolution = useFaviconResolution(props.url);
  const box = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: 3,
  } as const;
  if (resolution.kind === "glyph")
    return (
      <span
        aria-hidden="true"
        style={{
          ...box,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.max(8, size - 3),
          lineHeight: 1,
          color: muted,
        }}
      >
        {faviconFallbackGlyph(props.url)}
      </span>
    );
  return (
    <img
      src={resolution.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      style={{ ...box, objectFit: "contain" }}
      onError={() => faviconImageFailed(props.url ?? "", resolution.tier)}
    />
  );
}
