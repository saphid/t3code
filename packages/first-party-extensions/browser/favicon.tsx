/**
 * Favicon rendering for the Browser panel's surfaces. The image tier is the
 * public-provider fallback resolved per origin (`faviconStore.ts` — capture
 * is engine-blocked, no contract carries a page favicon); a load failure is
 * recorded in the shared per-origin cache so every surface — the session
 * tab strip, the recents list — falls back to the glyph together and the
 * dead origin stops being requested until the failure ages out.
 */
import { useSyncExternalStore } from "react";

import {
  type FaviconCache,
  type FaviconResolution,
  emptyFaviconCache,
  expireProviderFaviconFailure,
  FAVICON_FAILURE_TTL_MS,
  faviconFallbackGlyph,
  recordProviderFaviconFailure,
  resolveFavicon,
} from "./faviconStore.js";

const muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";

const listeners = new Set<() => void>();
let cache: FaviconCache = emptyFaviconCache();
let version = 0;

function publish(next: FaviconCache): void {
  if (next === cache) return;
  cache = next;
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * `<img onError>` entry point — shared by every surface's favicon. The
 * failure ages out after `FAVICON_FAILURE_TTL_MS`, and the next render
 * requests the provider image once more.
 */
export function faviconImageFailed(rawUrl: string): void {
  const at = Date.now();
  const next = recordProviderFaviconFailure(cache, rawUrl, at);
  if (next === cache) return;
  publish(next);
  setTimeout(
    () => publish(expireProviderFaviconFailure(cache, rawUrl, at)),
    FAVICON_FAILURE_TTL_MS,
  );
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
      onError={() => faviconImageFailed(props.url ?? "")}
    />
  );
}
