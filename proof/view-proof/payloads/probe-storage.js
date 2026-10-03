// Tries to reach app state: parent DOM, storage, cookies, preload/IPC, native bridges.
(async () => {
  const { port } = await window.t3View.port;
  const results = [];
  const attempt = async (name, run) => {
    try {
      const detail = await run();
      results.push({ name, outcome: detail === undefined ? "blocked" : "LEAKED", detail: String(detail) });
    } catch (error) {
      results.push({ name, outcome: "blocked", detail: error.name + ": " + error.message });
    }
  };
  const note = (name, value) => results.push({ name, outcome: "info", detail: String(value) });
  await attempt("parent.document", () => parent.document.title);
  await attempt("top.location.href (read)", () => top.location.href);
  await attempt("parent.localStorage", () => parent.localStorage.length);
  // WebKit returns "" instead of throwing; only a visible cookie is a leak.
  await attempt("document.cookie (read)", () => document.cookie || undefined);
  await attempt("document.cookie (write)", () => { document.cookie = "view=1"; return document.cookie.includes("view=1") ? document.cookie : undefined; });
  await attempt("localStorage", () => localStorage.length);
  await attempt("sessionStorage", () => sessionStorage.length);
  await attempt("indexedDB.open", () => new Promise((resolve, reject) => {
    const request = indexedDB.open("view-proof");
    request.onsuccess = () => resolve("opened");
    request.onerror = () => reject(request.error);
  }));
  await attempt("caches.keys", async () => (await caches.keys()).length);
  await attempt("serviceWorker.register", async () => {
    if (!navigator.serviceWorker) return undefined;
    await navigator.serviceWorker.register("/sw.js");
    return "registered";
  });
  await attempt("window.desktopBridge (preload)", () => window.desktopBridge === undefined ? undefined : Object.keys(window.desktopBridge).join(","));
  await attempt("parent.desktopBridge (preload)", () => parent.desktopBridge === undefined ? undefined : "reachable");
  await attempt("process / require", () => (typeof process !== "undefined" || typeof require !== "undefined") ? "present" : undefined);
  // WKWebView exposes script message handlers per content world, not per frame.
  await attempt("window.webkit.messageHandlers.ReactNativeWebView.postMessage", () => {
    const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView;
    if (!handler) return undefined;
    handler.postMessage("forged message from sandboxed view");
    return "posted to the native bridge";
  });
  await attempt("window.ReactNativeWebView", () => window.ReactNativeWebView ? "present" : undefined);
  await attempt("document.referrer", () => document.referrer === "" ? undefined : document.referrer);
  await attempt("window.opener", () => window.opener === null ? undefined : "present");
  await attempt("navigator.clipboard.readText", () => navigator.clipboard.readText());
  note("self.origin", self.origin);
  note("location.ancestorOrigins", location.ancestorOrigins ? Array.from(location.ancestorOrigins).join(",") : "unsupported");
  port.postMessage({ type: "report", results });
})();
