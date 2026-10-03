// Headless proof run against an owned dev server. Never prints credentials.
// node run-playwright.mjs <chromium|webkit> <webOrigin> <devLog> <payloadRoot> <outDir> <authStatePath>
// Env: VIEW_PROOF_NAV=none|wrapper (host navigation policy), VIEW_PROOF_LABEL (output
// file name), VIEW_PROOF_FIXTURE (fixture-server.mjs origin), VIEW_PROOF_HOST_CSP (a
// CSP added to the app document, to show what an app-wide frame-src policy changes).
import { chromium, webkit } from "../../apps/desktop/node_modules/playwright-core/index.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [browserName, webOrigin, devLog, root, outDir, authState] = process.argv.slice(2);
const browserType = browserName === "webkit" ? webkit : chromium;
mkdirSync(outDir, { recursive: true });

// "electron" attaches to an owned dev Electron started with a remote debugging
// port (webOrigin is then the CDP endpoint). Browsers use cached builds when the
// matching revision is not installed.
const isElectron = browserName === "electron";
const navigationPolicy = process.env.VIEW_PROOF_NAV === "wrapper" ? "wrapper" : "none";
const label = process.env.VIEW_PROOF_LABEL || browserName;
const fixtureOrigin = process.env.VIEW_PROOF_FIXTURE || "http://127.0.0.1:7391";
const hostCsp = process.env.VIEW_PROOF_HOST_CSP || null;
const readFixtureLog = async () => (await fetch(`${fixtureOrigin}/__log`)).json();
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
  try {
    await page.goto(pairingUrl);
    await page.waitForURL((url) => !url.pathname.startsWith("/pair"), { timeout: 60_000 });
  } catch (error) {
    // Playwright's call log repeats the pairing URL; never let it reach output.
    throw new Error(String(error.message).replace(/#token=[^\s"]+/g, "#token=<redacted>"));
  }
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

if (hostCsp && !isElectron) {
  // A <meta> policy on the app document: for frame-src it means the same as the
  // header. Fulfilling the document from Playwright instead trips Chromium's
  // local-network-access checks on the app's own WebSockets.
  await page.addInitScript((policy) => {
    if (window !== window.top) return;
    const add = () => {
      const meta = document.createElement("meta");
      meta.httpEquiv = "Content-Security-Policy";
      meta.content = policy;
      document.head.prepend(meta);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
  }, hostCsp);
}
const fixtureLogStart = (await readFixtureLog()).length;

// Desktop uses hash history; web uses path history.
const proofPath = `/view-proof?root=${encodeURIComponent(root)}&nav=${navigationPolicy}`;
// The dev desktop renderer loads thousands of unbundled modules through its
// protocol proxy, so its load event can stall; the proof only needs the commit.
const documentResponse = await page.goto(
  isElectron ? `${appOrigin}/#${proofPath}` : `${appOrigin}${proofPath}`,
  isElectron ? { waitUntil: "commit" } : {},
);
const appDocumentCsp = (await documentResponse?.allHeaders())?.["content-security-policy"] ?? null;
const appContext = await page.evaluate(() => ({
  origin: location.origin,
  desktopBridgeInApp: typeof window.desktopBridge,
}));
await page.waitForFunction(() => window.__viewProof?.done === true, null, { timeout: 60_000 });
const rows = await page.evaluate(() => window.__viewProof.rows);

await page.waitForTimeout(500);
// The view a frame belongs to, from the host's data-view-id on its top-level iframe.
const viewIdOf = async (frame) => {
  let outer = frame;
  while (outer.parentFrame() && outer.parentFrame() !== page.mainFrame())
    outer = outer.parentFrame();
  const element = await outer.frameElement().catch(() => null);
  return element ? await element.getAttribute("data-view-id") : null;
};
const frames = [];
for (const frame of page.frames()) {
  if (frame === page.mainFrame()) continue;
  const { origin, href } = await frame
    .evaluate(() => ({ origin: self.origin, href: location.href }))
    .catch((error) => ({ origin: `evaluate failed: ${error.message.slice(0, 80)}`, href: null }));
  const depth = frame.parentFrame() === page.mainFrame() ? 0 : 1;
  // Chromium hides error pages and process-isolated children from page.frames();
  // ask the frame's own CDP session for its children.
  let cdpChildren = null;
  if (browserName !== "webkit") {
    const session = await context.newCDPSession(frame).catch(() => null);
    if (session) {
      const tree = await session.send("Page.getFrameTree");
      cdpChildren = (tree.frameTree.childFrames ?? []).map((child) =>
        child.frame.unreachableUrl
          ? `error page (${child.frame.url}) for ${child.frame.unreachableUrl}`
          : child.frame.url,
      );
      await session.detach().catch(() => {});
    }
  }
  frames.push({
    viewId: await viewIdOf(frame),
    depth,
    url: href ?? frame.url(),
    origin,
    cdpChildren,
  });
}
const fixtureLog = (await readFixtureLog()).slice(fixtureLogStart);
// Per navigation probe: did a request reach the fixture server, did fixture script
// run, and what document is in the view's frame now.
const navigationCases = rows
  .filter((row) => row.view.startsWith("nav-") && row.name.startsWith("verified document"))
  .map((row) => {
    const entries = fixtureLog.filter((entry) => entry.query.case === row.view);
    const markers = entries.filter((entry) => entry.path === "/marker");
    const documentRequests = entries.filter((entry) => entry.path !== "/marker");
    const viewFrames = frames.filter((frame) => frame.viewId === row.view);
    const viewDepth = navigationPolicy === "wrapper" ? 1 : 0;
    const viewFrame = viewFrames.find((frame) => frame.depth === viewDepth);
    const viewDocument =
      viewFrame?.url ??
      viewFrames.find((frame) => frame.depth === 0)?.cdpChildren?.[0] ??
      "not visible";
    const stillAlive = row.outcome === "blocked";
    const hostStats = JSON.parse(
      rows.find((other) => other.view === `${row.view}#1` && other.name === "host stats")?.detail ??
        "{}",
    );
    const verdict =
      markers.length > 0
        ? "ESCAPED: fixture script ran"
        : documentRequests.length > 0
          ? "egress: request reached the fixture server, no fixture script ran"
          : stillAlive
            ? "held: navigation refused, verified document intact"
            : /chrome-error|error page/.test(viewDocument)
              ? "held: navigation refused, browser error page replaced the view (no request)"
              : hostStats.loads > 1
                ? "no fixture request or script; a second load event fired and the host load guard blanked the frame (a refused load and a committed local document look the same here)"
                : viewDocument === "about:blank"
                  ? "inert commit: empty about:blank replaced the view (no request, no script)"
                  : `unclear: ${viewDocument}`;
    return {
      case: row.view,
      verdict,
      stillAlive,
      viewDocument,
      hostStats,
      documentRequests: documentRequests.map((entry) => `${entry.path} ${entry.secFetchDest}`),
      markers: markers.map((entry) => entry.query),
    };
  });

const childApiRequests = requests.filter(
  (request) =>
    request.fromChildFrame &&
    !request.url.startsWith("data:") &&
    !request.url.startsWith("blob:") &&
    !request.url.startsWith("about:"),
);
await page.screenshot({ path: `${outDir}/${label}.png`, fullPage: true });
const result = {
  browser: browserName,
  label,
  navigationPolicy,
  hostCspInjected: hostCsp,
  version: browser.version(),
  appDocumentCsp,
  appContext,
  mainUrlAfter: page.url().replace(/#.*$/, ""),
  popups,
  frames,
  childFrameNetworkRequests: childApiRequests,
  navigationCases,
  fixtureLog,
  rows,
  // Requests from verified views that got an HTTP response. Not a complete list of
  // requests that reached a server: a CORS failure can follow a delivered request.
  childFrameRequestsAnswered: childApiRequests.filter(
    (request) => request.result.startsWith("response") && !request.frameName.startsWith("control-"),
  ),
  leaked: rows.filter((row) => row.outcome === "LEAKED" && !row.view.startsWith("control-")),
  console: consoleLines.filter((line) => /error|violat|refused|blocked/i.test(line)).slice(0, 80),
};
writeFileSync(`${outDir}/${label}.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    label,
    navigationCases: navigationCases.map((entry) => `${entry.case}: ${entry.verdict}`),
    rows: rows.length,
    leaked: result.leaked.length,
    childFrameNetworkRequests: childApiRequests.length,
    answered: result.childFrameRequestsAnswered.length,
    popups: popups.length,
  }),
);
if (isElectron) await page.goto(`${appOrigin}/`);
await browser.close();
