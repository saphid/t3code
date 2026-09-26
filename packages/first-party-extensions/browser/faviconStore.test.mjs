import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  FAVICON_CACHE_MAX_ENTRIES,
  dropCapturedFavicon,
  emptyFaviconCache,
  panelTabIndicators,
  pendingFaviconRefs,
  recordCapturedFavicon,
  faviconFallbackGlyph,
  faviconOriginKey,
  recordProviderFaviconFailure,
  resolveFavicon,
} from "./faviconStore.ts";

NodeTest.describe("faviconOriginKey", () => {
  NodeTest.it("folds loopback spellings onto localhost, keeping the port", () => {
    NodeAssert.equal(faviconOriginKey("http://127.0.0.1:3000/admin"), "http://localhost:3000");
    NodeAssert.equal(faviconOriginKey("http://[::1]:3000/"), "http://localhost:3000");
    NodeAssert.equal(faviconOriginKey("http://LOCALHOST:3000"), "http://localhost:3000");
    NodeAssert.equal(faviconOriginKey("http://0.0.0.0:8080"), "http://localhost:8080");
  });

  NodeTest.it("keeps public hosts and makes default ports explicit", () => {
    NodeAssert.equal(faviconOriginKey("https://Example.com/path?q=1"), "https://example.com:443");
    NodeAssert.equal(faviconOriginKey("http://example.com"), "http://example.com:80");
    NodeAssert.equal(faviconOriginKey("https://example.com:8443"), "https://example.com:8443");
  });

  NodeTest.it("separates origins by port", () => {
    NodeAssert.notEqual(
      faviconOriginKey("http://localhost:3000"),
      faviconOriginKey("http://localhost:5173"),
    );
  });

  NodeTest.it("rejects non-http(s), unparseable, and oversized urls", () => {
    NodeAssert.equal(faviconOriginKey("ftp://example.com"), null);
    NodeAssert.equal(faviconOriginKey("not a url"), null);
    NodeAssert.equal(faviconOriginKey(""), null);
    NodeAssert.equal(faviconOriginKey(`https://example.com/${"a".repeat(4100)}`), null);
  });
});

NodeTest.describe("recordProviderFaviconFailure", () => {
  NodeTest.it("records one entry per origin, sharing loopback spellings", () => {
    let cache = emptyFaviconCache();
    cache = recordProviderFaviconFailure(cache, "http://127.0.0.1:3000/a", 1_000);
    cache = recordProviderFaviconFailure(cache, "http://localhost:3000/b", 2_000);
    NodeAssert.deepEqual(cache.byOrigin, { "http://localhost:3000": { providerFailedAt: 2_000 } });
  });

  NodeTest.it("keeps the newest failure timestamp and no-ops otherwise", () => {
    let cache = recordProviderFaviconFailure(emptyFaviconCache(), "https://example.com/", 2_000);
    const sameRef = recordProviderFaviconFailure(cache, "https://example.com/other", 2_000);
    NodeAssert.equal(sameRef, cache);
    const older = recordProviderFaviconFailure(cache, "https://example.com/other", 1_000);
    NodeAssert.equal(older, cache);
    cache = recordProviderFaviconFailure(cache, "https://example.com/other", 3_000);
    NodeAssert.deepEqual(cache.byOrigin, {
      "https://example.com:443": { providerFailedAt: 3_000 },
    });
  });

  NodeTest.it("drops the oldest-recorded origins past the cap", () => {
    let cache = emptyFaviconCache();
    for (let port = 1; port <= FAVICON_CACHE_MAX_ENTRIES + 1; port++) {
      cache = recordProviderFaviconFailure(cache, `http://localhost:${port}`, port);
    }
    NodeAssert.equal(Object.keys(cache.byOrigin).length, FAVICON_CACHE_MAX_ENTRIES);
    NodeAssert.equal(cache.byOrigin["http://localhost:1"], undefined);
    NodeAssert.deepEqual(cache.byOrigin["http://localhost:2"], { providerFailedAt: 2 });
  });

  NodeTest.it("ignores urls without an origin key", () => {
    const cache = emptyFaviconCache();
    NodeAssert.equal(recordProviderFaviconFailure(cache, "file:///tmp/x", 1_000), cache);
  });
});

NodeTest.describe("resolveFavicon", () => {
  NodeTest.it("resolves public https origins to the provider image", () => {
    const resolution = resolveFavicon(emptyFaviconCache(), "https://example.com/some/page");
    NodeAssert.deepEqual(resolution, {
      kind: "image",
      src: "https://www.google.com/s2/favicons?domain=example.com&sz=32",
      tier: "provider",
    });
  });

  NodeTest.it("prefers the captured favicon over the provider, loopback included", () => {
    const icon = "data:image/png;base64,AAAA";
    let cache = recordCapturedFavicon(
      emptyFaviconCache(),
      "http://127.0.0.1:5173/app",
      { ref: "r1", src: icon },
      1_000,
    );
    NodeAssert.deepEqual(resolveFavicon(cache, "http://localhost:5173/other"), {
      kind: "image",
      src: icon,
      tier: "captured",
    });
    // A failed provider image does not hide a capture for the same origin.
    cache = recordProviderFaviconFailure(cache, "https://example.com/", 1_000);
    cache = recordCapturedFavicon(cache, "https://example.com/", { ref: "r2", src: icon }, 2_000);
    NodeAssert.equal(resolveFavicon(cache, "https://example.com/").tier, "captured");
  });

  NodeTest.it("falls back to the provider tier once a capture is dropped", () => {
    const icon = "data:image/png;base64,AAAA";
    const captured = recordCapturedFavicon(
      emptyFaviconCache(),
      "https://example.com/",
      { ref: "r1", src: icon },
      1_000,
    );
    NodeAssert.equal(
      recordCapturedFavicon(captured, "https://example.com/x", { ref: "r1", src: icon }, 2_000),
      captured,
    );
    const dropped = dropCapturedFavicon(captured, "https://example.com/");
    NodeAssert.equal(resolveFavicon(dropped, "https://example.com/").tier, "provider");
    NodeAssert.equal(dropCapturedFavicon(dropped, "https://example.com/"), dropped);
  });

  NodeTest.it("refuses non-image captures and caps captured origins", () => {
    const refused = recordCapturedFavicon(
      emptyFaviconCache(),
      "https://example.com/",
      { ref: "r1", src: "https://evil.example/icon.png" },
      1,
    );
    NodeAssert.deepEqual(refused.captured, {});
    let cache = emptyFaviconCache();
    for (let port = 1; port <= FAVICON_CACHE_MAX_ENTRIES + 1; port += 1)
      cache = recordCapturedFavicon(
        cache,
        `http://localhost:${port}/`,
        { ref: `r${port}`, src: "data:image/png;base64,AAAA" },
        port,
      );
    NodeAssert.equal(Object.keys(cache.captured).length, FAVICON_CACHE_MAX_ENTRIES);
    NodeAssert.equal(cache.captured["http://localhost:1"], undefined);
  });

  NodeTest.it("renders the glyph for private and loopback origins", () => {
    for (const url of ["http://localhost:3000/", "http://127.0.0.1:5173/", "http://192.168.1.4/"]) {
      NodeAssert.deepEqual(resolveFavicon(emptyFaviconCache(), url), { kind: "glyph" });
    }
  });

  NodeTest.it("renders the glyph once the provider image failed, and for null urls", () => {
    const failed = recordProviderFaviconFailure(emptyFaviconCache(), "https://example.com/", 1_000);
    NodeAssert.deepEqual(resolveFavicon(failed, "https://example.com/other/page"), {
      kind: "glyph",
    });
    NodeAssert.deepEqual(resolveFavicon(emptyFaviconCache(), null), { kind: "glyph" });
    NodeAssert.deepEqual(resolveFavicon(emptyFaviconCache(), "ftp://example.com/"), {
      kind: "glyph",
    });
  });
});

NodeTest.describe("faviconFallbackGlyph", () => {
  NodeTest.it("derives the host's first letter, uppercased", () => {
    NodeAssert.equal(faviconFallbackGlyph("https://example.com/"), "E");
    NodeAssert.equal(faviconFallbackGlyph("http://localhost:3000/app"), "L");
    NodeAssert.equal(faviconFallbackGlyph("http://192.168.1.4:8080/"), "1");
  });

  NodeTest.it("falls back to a neutral dot without a usable host letter", () => {
    NodeAssert.equal(faviconFallbackGlyph(null), "•");
    NodeAssert.equal(faviconFallbackGlyph("::::"), "•");
  });
});

const session = (overrides = {}) => ({
  tabId: "tab-1",
  requestedUrl: "http://localhost:5173/",
  navigation: { kind: "loaded", url: "http://localhost:5173/", title: "Dev" },
  canGoBack: false,
  canGoForward: false,
  viewport: { _tag: "fill" },
  engine: { state: "ready", generation: "1" },
  zoomFactor: 1,
  appearance: "system",
  audioMuted: false,
  audible: false,
  ...overrides,
});

NodeTest.describe("pendingFaviconRefs", () => {
  NodeTest.it("asks once per unresolved ref and skips recorded or attempted ones", () => {
    const sessions = [
      session({ faviconRef: "r1" }),
      session({ tabId: "tab-2", faviconRef: "r1" }),
      session({
        tabId: "tab-3",
        faviconRef: "r2",
        navigation: { kind: "loaded", url: "https://example.com/", title: "" },
      }),
      session({ tabId: "tab-4" }),
    ];
    NodeAssert.deepEqual(pendingFaviconRefs(emptyFaviconCache(), sessions, new Set()), [
      { ref: "r1", url: "http://localhost:5173/" },
      { ref: "r2", url: "https://example.com/" },
    ]);
    const recorded = recordCapturedFavicon(
      emptyFaviconCache(),
      "http://localhost:5173/",
      { ref: "r1", src: "data:image/png;base64,AAAA" },
      1,
    );
    NodeAssert.deepEqual(pendingFaviconRefs(recorded, sessions, new Set(["r2"])), []);
  });
});

NodeTest.describe("panelTabIndicators", () => {
  NodeTest.it("shows the presented page, its captured icon, and audio across sessions", () => {
    const icon = "data:image/png;base64,AAAA";
    const cache = recordCapturedFavicon(
      emptyFaviconCache(),
      "http://localhost:5173/",
      { ref: "r1", src: icon },
      1,
    );
    const presented = session();
    NodeAssert.deepEqual(
      panelTabIndicators(cache, presented, [
        presented,
        session({ tabId: "tab-2", audible: true, audioMuted: true }),
      ]),
      { pageUrl: "http://localhost:5173/", faviconDataUrl: icon, audio: "muted" },
    );
    NodeAssert.deepEqual(
      panelTabIndicators(emptyFaviconCache(), presented, [
        session({ audible: true, audioMuted: true }),
        session({ tabId: "tab-2", audible: true }),
      ]),
      { pageUrl: "http://localhost:5173/", audio: "audible" },
    );
  });

  NodeTest.it("is null with no presented page and no audio", () => {
    NodeAssert.equal(panelTabIndicators(emptyFaviconCache(), null, [session()]), null);
    NodeAssert.equal(
      panelTabIndicators(
        emptyFaviconCache(),
        session({ requestedUrl: null, navigation: { kind: "idle", url: null, title: "" } }),
        [],
      ),
      null,
    );
  });
});
