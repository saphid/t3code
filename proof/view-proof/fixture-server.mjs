// Benign navigation target for the self-navigation probes. Serves a page whose
// script reports back to this server, so a request log line proves the page
// committed and ran. Binds 127.0.0.1 only.
// node fixture-server.mjs <port> <logFile> [hostDir hostPort]
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [port = "7391", logFile = "/tmp/view-proof-fixture.log", hostDir, hostPort] =
  process.argv.slice(2);
writeFileSync(logFile, "");
const entries = [];

const fixturePage = `<!doctype html><meta charset="utf-8"><title>fixture</title><script>
const kase = new URLSearchParams(location.search).get("case");
new Image().src = "/marker?ran=1&case=" + kase;
addEventListener("message", (event) => {
  new Image().src = "/marker?message=1&ports=" + event.ports.length + "&case=" + kase;
});
</script><p>fixture page</p>`;

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/__log") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(entries));
    return;
  }
  const entry = {
    at: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    secFetchDest: request.headers["sec-fetch-dest"] ?? null,
    referer: request.headers.referer ?? null,
  };
  entries.push(entry);
  appendFileSync(logFile, JSON.stringify(entry) + "\n");
  if (url.pathname === "/page.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixturePage);
  } else if (url.pathname === "/redirect") {
    response.writeHead(302, { location: `/page.html?case=${url.searchParams.get("case")}` });
    response.end();
  } else {
    response.writeHead(204);
    response.end();
  }
}).listen(Number(port), "127.0.0.1");

// Optional second listener on another origin for standalone host pages.
if (hostDir && hostPort) {
  createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      const body = readFileSync(`${hostDir}${url.pathname}`);
      const csp = url.searchParams.get("csp");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        ...(csp ? { "content-security-policy": csp } : {}),
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  }).listen(Number(hostPort), "127.0.0.1");
}
console.log(`fixture server on http://127.0.0.1:${port}`);
