import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";
import { installTerminalInputGuard } from "./web-driver-terminal-guard.mjs";
import { observedText } from "./web-driver-content.mjs";
import { terminalChunks } from "./web-driver-observations.mjs";

export function encodedMarkerCommand(marker) {
  const octal = [...NodeBuffer.Buffer.from(marker + "\n", "utf8")]
    .map((byte) => "\\" + byte.toString(8).padStart(3, "0"))
    .join("");
  return "printf '\\033[2J\\033[H'; printf '%b' '" + octal + "'\n";
}
async function unique(locator) {
  await locator.waitFor({ state: "visible" });
  if ((await locator.count()) !== 1) throw new Error("Ambiguous content control");
  return locator;
}
async function terminalCopy(page, marker, timeoutMs) {
  const root = page.locator('[data-terminal-owner="drawer"]:visible');
  const canvas = await unique(root.locator("canvas:visible"));
  const sentinel = "T3-clipboard-sentinel-" + NodeCrypto.randomUUID();
  await page.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
  await canvas.click({ position: { x: 20, y: 10 }, clickCount: 3 });
  await page.keyboard.press("Control+C");
  let receipt;
  try {
    receipt = await page.waitForFunction(
      async ({ marker, sentinel }) => {
        const text = await navigator.clipboard.readText();
        return text !== sentinel && text.includes(marker);
      },
      { marker, sentinel },
      { polling: "raf", timeout: timeoutMs },
    );
    if ((await receipt.jsonValue()) !== true)
      throw new Error("System clipboard did not receive actual terminal output");
    return {
      matched: true,
      marker,
      evidence: "Ghostty pointer selection, real Control+C and system clipboard read",
    };
  } finally {
    await receipt?.dispose();
  }
}
export async function prepareContent(page, cdp, journey, fixture, timeoutMs) {
  const options = { timeoutMs };
  if (journey === "files") {
    await observedText(page, cdp, { itemPath: fixture.filename }, { ...options, click: true });
    return async () => {
      await observedText(page, cdp, { itemPath: fixture.filename }, options);
      const crumb = await unique(
        page.locator('[data-right-panel-surface-content] [data-current-file-crumb="true"]'),
      );
      if ((await crumb.innerText()).trim() !== fixture.filename.split("/").at(-1))
        throw new Error("Selected file breadcrumb differs from fixture");
      return {
        ...(await observedText(page, cdp, { text: fixture.text }, options)),
        filename: fixture.filename,
        currentFileBreadcrumb: await crumb.innerText(),
      };
    };
  }
  if (journey === "diff") {
    await (await unique(page.getByRole("button", { name: /^Diff scope:/ }))).click();
    await (await unique(page.getByRole("menuitem", { name: "Working tree", exact: true }))).click();
    const expand = page.getByRole("button", { name: "Expand " + fixture.file, exact: true });
    if (await expand.isVisible()) await expand.click();
    const refresh = page.getByRole("button", { name: "Refresh diff", exact: true });
    await (await unique(refresh)).click();
    await unique(refresh);
    return async () => {
      await observedText(page, cdp, { text: fixture.file }, options);
      await observedText(page, cdp, { text: fixture.before }, options);
      await observedText(page, cdp, { text: fixture.after }, options);
      return {
        matched: true,
        file: fixture.file,
        before: fixture.before,
        after: fixture.after,
        evidence: "actual scoped visible diff content",
      };
    };
  }
  if (journey !== "terminal")
    return async () => ({ matched: true, evidence: "mounted sidebar only; not Agents content" });
  const marker = "T3PTY-" + NodeCrypto.randomUUID().slice(0, 8) + "-選択-🌈";
  const command = encodedMarkerCommand(marker);
  if (command.includes(marker)) throw new Error("Command echo could satisfy output oracle");
  let text = "",
    observed = false,
    wake,
    timer;
  const listener = ({ response }) => {
    if (response.opcode !== 1) return;
    let value;
    try {
      value = JSON.parse(response.payloadData);
    } catch {
      return;
    }
    for (const chunk of terminalChunks(value, fixture)) text = (text + chunk).slice(-65536);
    if (text.includes(marker)) {
      observed = true;
      wake?.();
    }
  };
  const guardKey = "__t3TerminalInputGuard_" + NodeCrypto.randomUUID().replaceAll("-", "");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.evaluate(installTerminalInputGuard, {
    fixture,
    origin: new URL(page.url()).origin,
    key: guardKey,
  });
  cdp.on("Network.webSocketFrameReceived", listener);
  const dispose = async () =>
    page.evaluate((key) => {
      const guard = globalThis[key];
      guard.restore();
      delete globalThis[key];
      return guard.state;
    }, guardKey);
  const guardState = async () => page.evaluate((key) => globalThis[key].state, guardKey);
  try {
    const input = await unique(
      page
        .locator('[data-terminal-owner="drawer"]:visible')
        .getByRole("textbox", { name: "Terminal input", exact: true }),
    );
    await input.focus();
    await page.keyboard.type(command);
    await new Promise((resolve, reject) => {
      if (observed) {
        resolve();
        return;
      }
      wake = resolve;
      timer = setTimeout(
        () => reject(new Error("No fresh output from the configured fixture PTY")),
        timeoutMs,
      );
    });
    await terminalCopy(page, marker, timeoutMs);
  } catch (error) {
    error.inputGuard = await dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    cdp.off("Network.webSocketFrameReceived", listener);
  }
  const awaitContent = async () => {
    const copied = await terminalCopy(page, marker, timeoutMs);
    const inputGuard = await guardState();
    if (inputGuard.violations.length || inputGuard.forwardedWrites < 1) {
      const error = new Error("Terminal input guard rejected or did not observe fixture writes");
      error.inputGuard = inputGuard;
      throw error;
    }
    return {
      ...copied,
      inputGuard,
      threadId: fixture.threadId,
      terminalId: fixture.terminalId,
      outputReceiptObserved: observed,
      commandMarkerLiteralAbsent: true,
    };
  };
  awaitContent.dispose = dispose;
  return awaitContent;
}
