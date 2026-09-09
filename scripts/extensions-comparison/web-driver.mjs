import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { endpoint, selector, metricSnapshot, measuredDelta, webSocketPayloadBytes, validateRequest } from "./web-driver-observations.mjs";

const defaults = {
  files: { ready: { role: "button", name: "Refresh workspace files" } },
  diff: { ready: { role: "group", name: "Diff layout" } },
  terminal: { ready: { css: '[data-terminal-owner="drawer"] canvas' } },
  sidebar: { ready: { role: "button", name: "New project" } },
};
function locate(page, description) {
  const parsed = selector(description);
  return parsed.css ? page.locator(parsed.css) : page.getByRole(parsed.role, { name: parsed.name, exact: true });
}
async function uniqueVisible(locator, description) {
  await locator.waitFor({ state: "visible" });
  if (await locator.count() !== 1) throw new Error(`Ambiguous selector: ${description}`);
}
async function waitPresentedVisibility(page, handle, visible) {
  // Playwright's visible predicate ignores clipping. Retained native panels can
  // have a nonzero child box inside a zero-width/height overflow-hidden shell.
  await page.waitForFunction(({ element, expected }) => {
    if (!element.isConnected) return !expected;
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    let top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return !expected;
      const parent = node.getBoundingClientRect();
      if (style.overflowX !== "visible") { left = Math.max(left, parent.left); right = Math.min(right, parent.right); }
      if (style.overflowY !== "visible") { top = Math.max(top, parent.top); bottom = Math.min(bottom, parent.bottom); }
    }
    return ((right - left > 0.5) && (bottom - top > 0.5)) === expected;
  }, { element: handle, expected: visible }, { polling: "raf" });
}
async function presented(page) {
  // Two animation frames acknowledge rendering; this is not backend/service readiness.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function readCounters(cdp) {
  const [metrics, dom] = await Promise.all([cdp.send("Performance.getMetrics"), cdp.send("Memory.getDOMCounters")]);
  return metricSnapshot(metrics, dom);
}

export async function observe(request, { probe = false } = {}) {
  const journey = validateRequest(request);
  const result = { status: "inconclusive", journey, observedChecks: [], measurements: {},
    limitations: ["No full schema-2 conformance verdict: backend resources/handles, fault injection, unrelated-session survival, throughput and process RSS/CPU are not observed.",
      "CDP TaskDuration is renderer task occupancy, not OS process CPU time. DOM listeners exclude backend/native listeners.",
      "Network counters cover this page CDP session only; exclude other tabs, workers and native service traffic.",
      "Two presented frames plus visible controls establish mounted UI only, not terminal PTY readiness, diff/content correctness or transport drain."] };
  if (!["files", "diff", "terminal", "sidebar"].includes(journey)) {
    result.reason = journey === "browser" ? "Electron Browser navigation/compositor adapter requires separately prepared native application; web canvas is not a substitute" : "Real journey not implemented";
    return result;
  }
  const { target } = request;
  const moduleName = process.env.T3_COMPARISON_PLAYWRIGHT_MODULE;
  if (moduleName && !Path.isAbsolute(moduleName)) throw new Error("Playwright module override must be an absolute installed module path");
  const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : "playwright");
  await Fs.mkdir(target.artifactDir, { recursive: true });
  const evidenceDir = await Fs.mkdtemp(Path.join(target.artifactDir, `web-${journey}-`));
  result.evidenceDir = evidenceDir;
  let browser, page, cdp;
  let stage = "connect owned browser";
  let httpReceived = 0, wsReceived = 0, wsSent = 0, wsFrames = 0;
  const pageErrors = [];
  try {
    browser = await chromium.connectOverCDP(target.webCdpUrl, { timeout: target.timeoutMs ?? 15000 });
    result.clientVersion = browser.version();
    result.realClient = "web";
    const contexts = browser.contexts();
    if (contexts.length !== 1) throw new Error("Expected one explicitly owned paired browser context");
    page = await contexts[0].newPage();
    // Fresh Vite page readiness is outside the measured surface interaction.
    page.setDefaultTimeout(60_000);
    const startupStarted = performance.now();
    result.startupStages = [];
    page.on("pageerror", (error) => pageErrors.push(error.name));
    cdp = await contexts[0].newCDPSession(page);
    await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
    await cdp.send("Network.enable");
    cdp.on("Network.dataReceived", (event) => { httpReceived += event.encodedDataLength; });
    cdp.on("Network.webSocketFrameReceived", ({ response }) => { wsReceived += webSocketPayloadBytes(response); wsFrames++; });
    cdp.on("Network.webSocketFrameSent", ({ response }) => { wsSent += webSocketPayloadBytes(response); });
    stage = "navigate paired seeded thread";
    await page.goto(target.webUrl, { waitUntil: "domcontentloaded" });
    result.startupStages.push({ stage, elapsedMs: performance.now() - startupStarted });
    const expected = endpoint(target.webUrl, "webUrl");
    const actual = new URL(page.url());
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname)
      throw new Error("Client redirected away from the seeded thread (pairing/readiness not established)");
    stage = "await app shell readiness";
    await uniqueVisible(page.getByRole("button", { name: "Toggle main sidebar", exact: true }), "app sidebar toggle");
    result.startupStages.push({ stage, elapsedMs: performance.now() - startupStarted });
    if (target.threadTitle) {
      stage = "await seeded thread readiness";
      await uniqueVisible(page.getByRole("button", { name: `Thread actions for ${target.threadTitle}`, exact: true }), "fixture thread title");
      result.startupStages.push({ stage, elapsedMs: performance.now() - startupStarted });
    }
    page.setDefaultTimeout(target.timeoutMs ?? 15000);
    stage = "select native surface and await mounted UI";
    const selectors = { ...defaults[journey], ...target.selectors?.[journey] };
    const ready = locate(page, selectors.ready);
    const toggleName = journey === "terminal" ? "Toggle terminal drawer" : journey === "sidebar" ? "Toggle main sidebar" : "Toggle right panel";
    const toggle = page.getByRole("button", { name: journey === "files" || journey === "diff" ? /^Toggle right panel(?:,|$)/ : toggleName, exact: true });
    await uniqueVisible(toggle, toggleName);
    // Select existing domain surface before timing. This may create a native PTY;
    // the operator retains ownership and must clean it through native controls.
    if (journey === "files" || journey === "diff") {
      if (!await ready.isVisible()) {
        const emptyPanel = page.locator('[aria-label="Open a surface"]');
        const addSurface = page.getByRole("button", { name: "Add panel surface", exact: true });
        if (!await emptyPanel.isVisible() && !await addSurface.isVisible()) await toggle.click();
        if (!await ready.isVisible()) {
          if (await addSurface.isVisible()) {
            await uniqueVisible(addSurface, "surface menu opener");
            await addSurface.click();
            const menuItem = page.getByRole("menuitem", { name: journey === "files" ? /^Files(?:\s|$)/ : /^Diff(?:\s|$)/ });
            await uniqueVisible(menuItem, "surface menu item");
            await menuItem.click();
          } else {
            await uniqueVisible(emptyPanel, "empty surface panel");
            const card = emptyPanel.getByRole("button", { name: journey === "files" ? /Files.*Browse and read workspace files/ : /Diff.*Review changes in this thread/ });
            await uniqueVisible(card, "empty panel surface card");
            await card.click();
          }
        }
      }
    } else if (!await ready.isVisible()) await toggle.click();
    await uniqueVisible(ready, "ready control");
    await presented(page);
    await page.screenshot({ path: Path.join(evidenceDir, "initial.png") });
    const before = await readCounters(cdp);
    const networkBefore = { httpReceived, wsReceived, wsSent, wsFrames };
    const cycles = request.phase === "conformance" ? 100 : 1;
    const samples = [];
    const started = performance.now();
    for (let cycle = 0; cycle < cycles; cycle++) {
      stage = `cycle ${cycle}: hide surface`;
      const hiddenStart = performance.now();
      const previous = await ready.elementHandle();
      if (!previous) throw new Error("Ready control disappeared before hide");
      await toggle.click();
      await waitPresentedVisibility(page, previous, false);
      await previous.dispose();
      await presented(page);
      const hideMs = performance.now() - hiddenStart;
      const hiddenCounters = await readCounters(cdp);
      stage = `cycle ${cycle}: reopen surface`;
      const openStart = performance.now();
      await toggle.click();
      await uniqueVisible(ready, "ready control after reopen");
      const reopened = await ready.elementHandle();
      if (!reopened) throw new Error("Ready control disappeared after reopen");
      await waitPresentedVisibility(page, reopened, true);
      await reopened.dispose();
      await presented(page);
      samples.push({ cycle, hideMs, openMs: performance.now() - openStart, hiddenCounters });
      // Persist completed observations even if a later cycle fails or the runner times out.
      await Fs.appendFile(Path.join(evidenceDir, "cycles.jsonl"), JSON.stringify(samples.at(-1)) + "\n");
    }
    const after = await readCounters(cdp);
    result.measurements = { ...measuredDelta(before, after),
      httpReceivedBodyEncodedBytes: httpReceived - networkBefore.httpReceived,
      webSocketReceivedPayloadBytes: wsReceived - networkBefore.wsReceived,
      webSocketSentPayloadBytes: wsSent - networkBefore.wsSent,
      webSocketReceivedFrames: wsFrames - networkBefore.wsFrames };
    if (request.phase === "timing") Object.assign(result.measurements, { openMs: samples[0].openMs, actionMs: samples[0].hideMs });
    result.cycles = { completed: samples.length, durationMs: performance.now() - started,
      before, after, samplesPath: Path.join(evidenceDir, "cycles.jsonl") };
    result.observedChecks.push({ id: "visible-hide-reopen", passed: true,
      evidence: `${samples.length} UI cycles awaited ready control hidden and visible, then two animation frames; ${result.cycles.samplesPath}` });
    result.pageErrors = pageErrors;
    if (pageErrors.length) throw new Error("Page emitted errors during observation");
    await page.screenshot({ path: Path.join(evidenceDir, "final.png") });
    result.status = probe ? "observed" : "inconclusive";
    result.reason = "Observed UI microjourney only; required full behavior/identity/metrics remain unverified";
  } catch (error) {
    result.status = "failed";
    // Do not persist Playwright diagnostics which can include URLs or authenticated markup.
    result.reason = error.name === "TimeoutError" ? "Timed out awaiting an actual UI observation" : "Driver failed; see sanitized error type";
    result.errorType = error.name;
    result.failedStage = stage;
    result.pageErrors = pageErrors;
  } finally {
    const cleanup = { cdp: "not-created", page: "not-created", connection: "not-created", domainResources: "operator-owned; not measured or terminated" };
    for (const [key, resource, close] of [
      ["cdp", cdp, () => cdp.detach()],
      ["page", page, () => page.close()],
      // Closing a connectOverCDP client disconnects it; no browser process was launched.
      ["connection", browser, () => browser.close()],
    ]) {
      if (!resource) continue;
      try { await close(); cleanup[key] = "closed"; }
      catch (error) { cleanup[key] = `failed:${error.name}`; result.status = "failed"; }
    }
    result.cleanup = cleanup;
    await Fs.writeFile(Path.join(evidenceDir, "observation.json"), JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const result = await observe(JSON.parse(input), { probe: process.argv.includes("--probe") });
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.status === "observed" ? 0 : result.status === "inconclusive" ? 2 : 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "inconclusive", reason: "Invalid request or unavailable driver dependency", errorType: error.name }) + "\n");
    process.exitCode = 2;
  }
}
