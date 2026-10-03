// Headless proof run against an owned dev server. Never prints credentials.
// node run-playwright.mjs <chromium|webkit> <webOrigin> <devLog> <payloadRoot> <outDir> <authStatePath>
import { chromium, webkit } from "../../apps/desktop/node_modules/playwright-core/index.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [browserName, webOrigin, devLog, root, outDir, authState] = process.argv.slice(2);
const browserType = browserName === "webkit" ? webkit : chromium;
mkdirSync(outDir, { recursive: true });

// "electron" attaches to an owned dev Electron started with a remote debugging
// port (webOrigin is then the CDP endpoint). Browsers use cached builds when the
// matching revision is not installed.
const isElectron = browserName === "electron";
const executablePath = process.env.VIEW_PROOF_BROWSER_PATH || undefined;
const browser = isElectron
  ? await chromium.connectOverCDP(webOrigin)
  : await browserType.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = isElectron
  ? browser.contexts()[0]
  : await browser.newContext(existsSync(authState) ? { storageState: authState } : {});
const page = isElectron
  ? (context.pages().find((candidate) => !candidate.url().startsWith("devtools:")) ??
    context.pages()[0])
  : await context.newPage();
// Custom schemes report an "null" origin in Node; rebuild it from the parts.
const appOrigin = isElectron
  ? `${new URL(page.url()).protocol}//${new URL(page.url()).host}`
  : webOrigin;

if (!isElectron && !existsSync(authState)) {
  const pairingUrl = /https?:\/\/\S+\/pair#\S+/.exec(readFileSync(devLog, "utf8"))?.[0];
  if (!pairingUrl) throw new Error("no pairing URL in dev log");
  await page.goto(pairingUrl);
  await page.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 60_000 });
  await context.storageState({ path: authState });
}

const requests = [];
const requestRecords = new Map();
page.on("request", (request) => {
  const frame = request.frame();
  const record = {
    url: request.url().replace(/([?#&](token|ticket)=)[^&#]+/g, "$1<redacted>"),
    method: request.method(),
    type: request.resourceType(),
    fromChildFrame: frame !== page.mainFrame(),
    frameName: frame === page.mainFrame() ? "main" : frame.name() || frame.url().slice(0, 40),
    result: "pending",
  };
  requestRecords.set(request, record);
  requests.push(record);
});
// A request event alone does not mean bytes left the browser: CSP and CORS
// failures surface as requestfailed. Record what actually happened.
page.on("requestfailed", (request) => {
  const record = requestRecords.get(request);
  if (record) record.result = `failed: ${request.failure()?.errorText ?? "unknown"}`;
});
page.on("response", (response) => {
  const record = requestRecords.get(response.request());
  if (record) record.result = `response ${response.status()}`;
});
const popups = [];
page.on("popup", (popup) => popups.push(popup.url()));
const consoleLines = [];
page.on("console", (message) =>
  consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 300)),
);

// Desktop uses hash history; web uses path history.
const proofPath = `/view-proof?root=${encodeURIComponent(root)}`;
const documentResponse = await page.goto(
  isElectron ? `${appOrigin}/#${proofPath}` : `${appOrigin}${proofPath}`,
);
const appDocumentCsp = (await documentResponse?.allHeaders())?.["content-security-policy"] ?? null;
const appContext = await page.evaluate(() => ({
  origin: location.origin,
  desktopBridgeInApp: typeof window.desktopBridge,
}));
await page.waitForFunction(() => window.__viewProof?.done === true, null, { timeout: 60_000 });
const rows = await page.evaluate(() => window.__viewProof.rows);

await page.waitForTimeout(500);
const frames = [];
for (const frame of page.frames()) {
  if (frame === page.mainFrame()) continue;
  const origin = await frame
    .evaluate(() => self.origin)
    .catch((error) => `evaluate failed: ${error.message}`);
  frames.push({ url: frame.url(), origin });
}

const childApiRequests = requests.filter(
  (request) =>
    request.fromChildFrame &&
    !request.url.startsWith("data:") &&
    !request.url.startsWith("blob:") &&
    !request.url.startsWith("about:"),
);
await page.screenshot({ path: `${outDir}/${browserName}.png`, fullPage: true });
const result = {
  browser: browserName,
  version: browser.version(),
  appDocumentCsp,
  appContext,
  mainUrlAfter: page.url().replace(/#.*$/, ""),
  popups,
  frames,
  childFrameNetworkRequests: childApiRequests,
  rows,
  // Requests from verified views that got any HTTP response, i.e. bytes reached a server.
  childFrameRequestsAnswered: childApiRequests.filter(
    (request) => request.result.startsWith("response") && !request.frameName.startsWith("control-"),
  ),
  leaked: rows.filter((row) => row.outcome === "LEAKED" && !row.view.startsWith("control-")),
  console: consoleLines.filter((line) => /error|violat|refused|blocked/i.test(line)).slice(0, 80),
};
writeFileSync(`${outDir}/${browserName}.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    browser: browserName,
    rows: rows.length,
    leaked: result.leaked.length,
    childFrameNetworkRequests: childApiRequests.length,
    answered: result.childFrameRequestsAnswered.length,
    popups: popups.length,
  }),
);
if (isElectron) await page.goto(`${appOrigin}/`);
await browser.close();
