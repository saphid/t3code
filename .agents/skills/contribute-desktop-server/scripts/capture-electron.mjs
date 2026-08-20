// Capture a PNG screenshot of a running T3 Code desktop window over the
// Chrome DevTools Protocol. The app must have been started with
// T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT set (see the contribute-desktop-server
// skill). Requires Node >= 22 for the global WebSocket.
//
// Usage: node capture-electron.mjs <cdp-port> <out.png> [url-substring]
//   url-substring optionally selects among multiple page targets.

import { writeFile } from "node:fs/promises";

const [portArg, outPath, urlFilter] = process.argv.slice(2);
if (!portArg || !outPath) {
  console.error("Usage: node capture-electron.mjs <cdp-port> <out.png> [url-substring]");
  process.exit(1);
}

const listResponse = await fetch(`http://127.0.0.1:${portArg}/json/list`);
if (!listResponse.ok) {
  console.error(`CDP endpoint returned ${listResponse.status}; is the app running with T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT=${portArg}?`);
  process.exit(1);
}
const targets = await listResponse.json();
const pages = targets.filter((t) => t.type === "page");
const target = urlFilter ? pages.find((t) => t.url.includes(urlFilter)) : pages[0];
if (!target) {
  console.error(`No page target${urlFilter ? ` matching "${urlFilter}"` : ""}. Targets: ${targets.map((t) => `${t.type} ${t.url}`).join(", ") || "none"}`);
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const screenshot = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("CDP screenshot timed out after 15s")), 15_000);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.data);
  });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    reject(new Error("WebSocket connection to CDP target failed"));
  });
});
socket.close();

await writeFile(outPath, Buffer.from(screenshot, "base64"));
console.log(`Saved ${outPath} (${target.url})`);
