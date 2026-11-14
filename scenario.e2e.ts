import { expect } from "e2e";
import { test, WEB, makeState, runPromise } from "./t3.ts";
import { T3_HOME } from "../e2e.config.ts";

test("Cancelling a queued edit while its save is held releases its preview after settlement", WEB,
  async ({ t3, app, screen, browser }) => {
    await t3.open();
    const project = await t3.project("Queued edit resource proof");
    const state = makeState(T3_HOME);
    const launched = await runPromise(state.cli(["thread", "start", project, "Show your work", "--title", "Cancel during queued save", "--provider", "devReplay", "--model", "showcase", "--json"]));
    const thread = JSON.parse(launched.stdout.split("\n").find((line) => line.startsWith("{\"threadId\""))!);
    await runPromise(state.cli(["thread", "send", thread.threadId, "Queued attachment edit", "--json"]));
    await t3.open(thread);
    await screen.getByRole("button", "Stop generation").tap();
    await expect(screen.getByRole("button", "Edit queued message")).toBeEnabled();
    await screen.getByRole("button", "Edit queued message").tap();
    await browser.evaluate(() => {
      const w = window as any;
      w.__proof29570 = { created: [], revoked: [], held: null, sent: false };
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { const url = create(blob); w.__proof29570.created.push(url); return url; };
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => { w.__proof29570.revoked.push(url); revoke(url); };
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        if (typeof data === "string" && data.includes("queued-run.edit") && !w.__proof29570.sent) {
          w.__proof29570.sent = true;
          w.__proof29570.held = () => send.call(this, data);
          return;
        }
        return send.call(this, data);
      };
    });
    await browser.locator('[data-testid="composer-editor"]').fill("Queued attachment edit with image");
    await browser.locator('input[type="file"]').setInputFiles("/tmp/pr-recovery-20261112/finish-all-20261114/t3-lane/29570-proof.png");
    await expect.poll(() => browser.evaluate(() => (window as any).__proof29570.created.length)).toBeGreaterThan(0);
    await expect(screen.getByRole("button", "Preview 29570-proof.png")).toBeEnabled();
    await expect(screen.getByRole("image", "29570-proof.png")).toBeVisible();
    // Let the real Stop button's landed-click guard expire before submitting.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await screen.getByRole("button", "Update queued message").tap();
    await expect.poll(() => browser.evaluate(() => (window as any).__proof29570.held !== null)).toBe(true);
    await browser.evaluate(async () => {
      const p = (window as any).__proof29570;
      const { useComposerDraftStore } = await import("/src/composerDraftStore.ts");
      p.previews = Object.values(useComposerDraftStore.getState().draftsByThreadKey)
        .flatMap((draft: any) => draft.images.map((image: any) => image.previewUrl))
        .filter((url: string) => url.startsWith("blob:"));
    });
    expect(await browser.evaluate(() => (window as any).__proof29570.previews.length)).toBeGreaterThan(0);
    await app.screenshot("save-held");
    await screen.getByRole("button", "Cancel editing queued message").tap();
    await expect(screen.getByRole("button", "Edit queued message")).toBeVisible();
    expect(await browser.evaluate(() => {
      const p = (window as any).__proof29570;
      return p.previews.every((url: string) => !p.revoked.includes(url));
    })).toBe(true);
    await app.screenshot("cancelled-before-settlement");
    await browser.evaluate(() => (window as any).__proof29570.held());
    await expect.poll(() => browser.evaluate(() => {
      const p = (window as any).__proof29570;
      return p.previews.every((url: string) => p.revoked.includes(url));
    })).toBe(true);
    await app.screenshot("preview-released-after-settlement");
    await screen.getByRole("button", "Edit queued message").tap();
    await expect(screen.getByRole("button", "Remove 29570-proof.png")).toBeVisible();
    await app.screenshot("saved-attachment-reopened");
  });
