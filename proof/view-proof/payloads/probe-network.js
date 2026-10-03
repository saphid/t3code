// Tries to reach authenticated server endpoints and any other network egress.
(async () => {
  const { port, init } = await window.t3View.port;
  const results = [];
  const violations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push(event.effectiveDirective + " " + event.blockedURI);
  });
  const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
  const attempt = async (name, run) => {
    try {
      const detail = await run();
      results.push({ name, outcome: detail === undefined ? "blocked" : "LEAKED", detail: String(detail) });
    } catch (error) {
      results.push({ name, outcome: "blocked", detail: error.name + ": " + error.message });
    }
  };
  const server = init.serverOrigin;
  const readable = async (response) => response.status + " " + (await response.text()).slice(0, 80);
  await attempt("fetch /api/projects credentials:include", async () => readable(await fetch(server + "/api/projects", { credentials: "include" })));
  await attempt("fetch /api/projects credentials:omit", async () => readable(await fetch(server + "/api/projects", { credentials: "omit" })));
  await attempt("fetch /api/auth/session (relative URL)", async () => readable(await fetch("/api/auth/session", { credentials: "include" })));
  await attempt("fetch no-cors /api/auth/websocket-ticket POST", async () => { await fetch(server + "/api/auth/websocket-ticket", { method: "POST", mode: "no-cors", credentials: "include" }); return "request sent"; });
  await attempt("fetch /.well-known/t3/environment (public)", async () => readable(await fetch(server + "/.well-known/t3/environment")));
  await attempt("fetch https://example.com", async () => readable(await fetch("https://example.com/")));
  await attempt("XMLHttpRequest /api/projects", () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;
    xhr.open("GET", server + "/api/projects");
    xhr.onload = () => resolve(xhr.status + " " + xhr.responseText.slice(0, 80));
    xhr.onerror = () => reject(new Error("xhr error"));
    xhr.send();
  }));
  await attempt("WebSocket /ws", () => Promise.race([new Promise((resolve, reject) => {
    const socket = new WebSocket(server.replace(/^http/, "ws") + "/ws");
    socket.onopen = () => { socket.close(); resolve("open"); };
    socket.onerror = () => reject(new Error("socket error"));
  }), timeout(3000).then(() => undefined)]));
  await attempt("EventSource /api/projects", () => Promise.race([new Promise((resolve, reject) => {
    const source = new EventSource(server + "/api/projects", { withCredentials: true });
    source.onopen = () => { source.close(); resolve("open"); };
    source.onerror = () => { source.close(); reject(new Error("eventsource error")); };
  }), timeout(3000).then(() => undefined)]));
  // sendBeacon reports queueing, not delivery; the network log decides this row.
  results.push({ name: "navigator.sendBeacon", outcome: "unverified", detail: "returned " + navigator.sendBeacon(server + "/api/projects?beacon=1", "x") });
  await attempt("img beacon", () => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve("loaded");
    image.onerror = () => reject(new Error("img error"));
    image.src = server + "/api/projects?img=1";
  }));
  await attempt("link prefetch", () => new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = server + "/api/projects?prefetch=1";
    link.onload = () => resolve("loaded");
    link.onerror = () => reject(new Error("prefetch error"));
    document.head.append(link);
    setTimeout(() => reject(new Error("no load event")), 2000);
  }));
  await attempt("CSS background url", () => new Promise((resolve) => {
    const div = document.createElement("div");
    div.style.backgroundImage = "url(" + server + "/api/projects?css=1)";
    document.body.append(div);
    getComputedStyle(div).backgroundImage;
    setTimeout(() => resolve(undefined), 500);
  }));
  await timeout(100);
  port.postMessage({ type: "report", results, violations });
})();
