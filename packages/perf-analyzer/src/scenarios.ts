// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off - Scenario bodies drive a live page from the host side; fetch calls run inside page.evaluate, in the browser, and fixture proofs read the throwaway workspace with host fs.
import * as NodeFSP from "node:fs/promises";
import * as NodeHTTP from "node:http";
import * as NodePath from "node:path";

import type { Page } from "playwright-core";

import type { LaunchedEnv, Surface } from "./launch.ts";
import type { ShapeConfig } from "./netShaper.ts";
import type { FixtureSize } from "./seed.ts";

export interface ScenarioContext {
  readonly env: LaunchedEnv;
  readonly page: Page;
  readonly size: FixtureSize;
}

/**
 * A scenario is one measured user-visible behavior. Keep bodies dumb: locate
 * by seeded text, act, wait for the result to be visible. The harness wraps
 * every run in a metrics window (wall time, renderer counts, GPU, memory), so
 * a body only needs extra instrumentation for sub-steps, via
 * performance.mark/measure inside the page.
 */
export interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly surfaces: ReadonlyArray<Surface>;
  readonly sizes: ReadonlyArray<FixtureSize>;
  /** Saturates CPU/GPU or runs long; excluded unless --heavy. */
  readonly heavy?: boolean;
  /** Web only: routes traffic through the chaos relay with this profile. */
  readonly shape?: ShapeConfig;
  /** Relaunch the whole environment for every run (startup-style measures). */
  readonly freshEnv?: boolean;
  /** Provision the mock streaming ACP provider in the environment at launch. */
  readonly streamingProvider?: boolean;
  /** Spawn and seed a second small server at launch (environment-switch, web only). */
  readonly secondServer?: boolean;
  /** Fold process-launch time into wall time (cold-start scenarios only). */
  readonly measureFromLaunch?: boolean;
  /** Setup executed before the metrics window opens (not measured). */
  readonly prepare?: (ctx: ScenarioContext) => Promise<void>;
  readonly run: (ctx: ScenarioContext) => Promise<void>;
}

const READY_TIMEOUT = 90_000;

const COMPOSER_SELECTOR = '[data-testid="composer-editor"]';

/** 5 x 41 chars of mention-free text (no @ / #, which open popovers). */
const TYPED_TEXT = "profiling composer keystroke latency now ".repeat(5);

/**
 * Marks every keydown and measures to paint completion (double rAF) as
 * "t3perf.keystroke". Idempotent: the env is reused across runs, so a flag
 * keeps re-preparation from stacking duplicate listeners.
 */
async function installKeystrokeProbe(ctx: ScenarioContext): Promise<void> {
  await ctx.page.evaluate(() => {
    const flagged = window as unknown as { __t3perfKeystrokeProbe?: boolean };
    if (flagged.__t3perfKeystrokeProbe === true) return;
    flagged.__t3perfKeystrokeProbe = true;
    let sequence = 0;
    document.addEventListener(
      "keydown",
      () => {
        const mark = `t3perf.keystroke.start.${sequence++}`;
        performance.mark(mark);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            performance.measure("t3perf.keystroke", { start: mark });
          });
        });
      },
      { capture: true, passive: true },
    );
  });
}

/** Focuses the composer and clears any text left over from a previous run. */
async function focusAndClearComposer(ctx: ScenarioContext): Promise<void> {
  const composer = ctx.page.locator(COMPOSER_SELECTOR).first();
  await composer.waitFor({ state: "visible", timeout: READY_TIMEOUT });
  await composer.click();
  await ctx.page.keyboard.press("ControlOrMeta+a");
  await ctx.page.keyboard.press("Backspace");
}

async function waitForThreadList(ctx: ScenarioContext): Promise<void> {
  await ctx.page
    .getByText(ctx.env.seed.giantThreadTitle, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: READY_TIMEOUT });
}

async function openGiantThread(ctx: ScenarioContext): Promise<void> {
  await ctx.page.getByText(ctx.env.seed.giantThreadTitle, { exact: false }).first().click();
  await ctx.page
    .getByText(ctx.env.seed.giantLastMessageSnippet, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: READY_TIMEOUT });
}

/** Setup for compose-typing-latency; also runs inline on the warm-up pass. */
async function prepareComposerTyping(ctx: ScenarioContext): Promise<void> {
  await openGiantThread(ctx);
  await installKeystrokeProbe(ctx);
  await focusAndClearComposer(ctx);
}

const PALETTE_SELECTOR = '[data-testid="command-palette"]';

/** Waits two frames so the just-asserted DOM state has actually painted. */
async function afterNextPaint(ctx: ScenarioContext): Promise<void> {
  await ctx.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * Escapes out of the palette until the dialog is gone. The env is reused
 * across runs and each run leaves the palette open with a typed query, so the
 * first Escape may only clear state inside the dialog; loop until hidden.
 */
async function closeCommandPalette(ctx: ScenarioContext): Promise<void> {
  const palette = ctx.page.locator(PALETTE_SELECTOR);
  for (let attempt = 0; attempt < 5 && (await palette.isVisible()); attempt++) {
    await ctx.page.keyboard.press("Escape");
    await ctx.page.waitForTimeout(100);
  }
  await palette.waitFor({ state: "hidden", timeout: 5_000 });
}

const PINNED_DIVIDER_SELECTOR = '[data-testid="sidebar-pinned-divider"]';

const PROJECT_SCOPE_TRIGGER_SELECTOR = '[aria-label="Filter threads by project"]';

/**
 * Opens the sidebar's project filter menu, picks the entry with the given
 * label, and waits for the caller's proof that the rescoped list painted.
 * Each switch lands as one pageMeasure under measureName (menu open,
 * selection, and full thread-list re-render).
 */
async function scopeSidebarThreads(
  ctx: ScenarioContext,
  entryLabel: string,
  settled: () => Promise<void>,
  measureName = "t3perf.project-scope",
): Promise<void> {
  await ctx.page.evaluate((name) => performance.mark(`${name}.start`), measureName);
  await ctx.page.locator(PROJECT_SCOPE_TRIGGER_SELECTOR).first().click();
  // Search inside the open menu popup only: sidebar thread rows carry project
  // captions with the same text, and before the popup renders a bare
  // getByText().last() can land on one of those instead of the menu item.
  const menu = ctx.page.getByRole("menu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await menu.getByText(entryLabel, { exact: true }).last().click();
  await settled();
  await afterNextPaint(ctx);
  await ctx.page.evaluate(
    (name) => performance.measure(name, { start: `${name}.start` }),
    measureName,
  );
}

/** The changed-files card's header button in the giant thread's timeline. */
const OPEN_DIFF_BUTTON_SELECTOR = '[aria-label="Open diff"]';

/** A line of the seeded checkpoint diff's first hunk (first changed line). */
function firstHunkLine(ctx: ScenarioContext) {
  return ctx.page.getByText(ctx.env.seed.checkpointFirstHunkSnippet, { exact: false }).first();
}

/**
 * Setup for open-large-diff; also runs inline on the warm-up pass. Ends with
 * the giant thread open, the diff panel closed (a previous run leaves it open
 * showing the hunks; mod+d is the default diff.toggle binding), and the
 * changed-files card's Open diff button rendered.
 */
async function prepareOpenLargeDiff(ctx: ScenarioContext): Promise<void> {
  await openGiantThread(ctx);
  if (await firstHunkLine(ctx).isVisible()) {
    await ctx.page.keyboard.press("ControlOrMeta+d");
    await firstHunkLine(ctx).waitFor({ state: "hidden", timeout: 10_000 });
  }
  await ctx.page
    .locator(OPEN_DIFF_BUTTON_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: READY_TIMEOUT });
}

/** streaming-turn-append fixtures, created through the real dispatch API. */
const STREAMING_PROJECT_ID = "perf-streaming-project";

/** Routes to the provisioned mock agent (see provisionStreamingProvider). */
const STREAMING_MODEL_SELECTION = { instanceId: "grok", model: "grok-build" } as const;

/** The mock agent's first delta text (see acpStreamingAgent.ts). */
const STREAM_MARKER = "perfstream begins";

/**
 * POSTs one orchestration command through the paired page's own session
 * cookie (a same-origin fetch), i.e. the server's real HTTP dispatch path
 * into the real decider. Retries transient transport failures because the
 * network suite runs this scenario under lossy profiles.
 */
async function dispatchOrchestrationCommand(
  ctx: ScenarioContext,
  command: Record<string, unknown>,
  attempts = 3,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const result = await ctx.page.evaluate(async (payload) => {
      try {
        const response = await fetch("/api/orchestration/dispatch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        return {
          ok: response.ok,
          status: response.status,
          body: (await response.text()).slice(0, 300),
        };
      } catch (error) {
        return { ok: false, status: 0, body: String(error) };
      }
    }, command);
    if (result.ok) return;
    if (attempt >= attempts) {
      throw new Error(
        `Dispatch of ${String(command["type"])} failed with status ${result.status}: ${result.body}`,
      );
    }
    await ctx.page.waitForTimeout(500);
  }
}

/**
 * Whether the event-backed streaming project already exists in this
 * environment. Read from the command read model: seeded fixture rows are
 * projection-only and invisible to it, so this only ever sees entities the
 * scenario itself created.
 */
async function streamingProjectExists(ctx: ScenarioContext): Promise<boolean> {
  return await ctx.page.evaluate(async (projectId) => {
    const response = await fetch("/api/orchestration/snapshot", { credentials: "include" });
    if (!response.ok) return false;
    const model = (await response.json()) as { projects?: Array<{ id?: string }> };
    return (model.projects ?? []).some((project) => project.id === projectId);
  }, STREAMING_PROJECT_ID);
}

/** Total page text length; grows monotonically while the stream appends. */
async function visibleTextLength(ctx: ScenarioContext): Promise<number> {
  return await ctx.page.evaluate(() => document.body.innerText.length);
}

/**
 * Setup for streaming-turn-append; also runs inline on the warm-up pass.
 * Seeded fixture threads are projection-only and the decider validates
 * against event-backed state, so this creates its own project (once per
 * environment) and a fresh thread per run through the real dispatch API,
 * opens the thread, starts a real turn against the provisioned mock
 * streaming provider, and waits for the first delta to paint. The mock
 * streams for ~20s, so the 10s metrics window that follows is fully covered;
 * the previous run's turn is interrupted first so its tail cannot bleed in.
 */
async function prepareStreamingTurn(ctx: ScenarioContext): Promise<void> {
  const previousThreadId = await ctx.page.evaluate(() => {
    const state = window as unknown as { __t3perfStreamingThreadId?: string };
    const value = state.__t3perfStreamingThreadId;
    delete state.__t3perfStreamingThreadId;
    return value ?? null;
  });
  if (previousThreadId !== null) {
    await dispatchOrchestrationCommand(
      ctx,
      {
        type: "thread.turn.interrupt",
        commandId: `perf-stream-cmd-${Date.now().toString(36)}-i`,
        threadId: previousThreadId,
        createdAt: new Date().toISOString(),
      },
      1,
    ).catch(() => undefined);
  }
  if (!(await streamingProjectExists(ctx))) {
    await dispatchOrchestrationCommand(ctx, {
      type: "project.create",
      commandId: `perf-stream-cmd-${Date.now().toString(36)}-p`,
      projectId: STREAMING_PROJECT_ID,
      title: "Perf Streaming",
      workspaceRoot: `${ctx.env.seed.homeDir}/streaming-workspace`,
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: STREAMING_MODEL_SELECTION,
      createdAt: new Date().toISOString(),
    });
  }
  const suffix = Date.now().toString(36);
  const threadId = `perf-streaming-thread-${suffix}`;
  const title = `Perf streaming ${suffix}`;
  await dispatchOrchestrationCommand(ctx, {
    type: "thread.create",
    commandId: `perf-stream-cmd-${suffix}-t`,
    threadId,
    projectId: STREAMING_PROJECT_ID,
    title,
    modelSelection: STREAMING_MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: new Date().toISOString(),
  });
  // The new row lands in the sidebar over the live WS push; open it so the
  // auto-scrolling timeline is the visible measured surface (the thread
  // route's path contains the thread id, which proves the right thread).
  await ctx.page.getByText(title, { exact: false }).first().click();
  await ctx.page.waitForURL((url) => url.pathname.includes(threadId), {
    timeout: READY_TIMEOUT,
  });
  await ctx.page
    .locator(COMPOSER_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: READY_TIMEOUT });
  await dispatchOrchestrationCommand(ctx, {
    type: "thread.turn.start",
    commandId: `perf-stream-cmd-${suffix}-s`,
    threadId,
    message: {
      messageId: `${threadId}-m0`,
      role: "user",
      text: "Stream the perf fixture response.",
      attachments: [],
    },
    modelSelection: STREAMING_MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: new Date().toISOString(),
  });
  await ctx.page
    .getByText(STREAM_MARKER, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: READY_TIMEOUT });
  await ctx.page.evaluate((id) => {
    (window as unknown as { __t3perfStreamingThreadId?: string }).__t3perfStreamingThreadId = id;
  }, threadId);
}

/** The Ghostty terminal canvas inside the thread's terminal drawer. */
const TERMINAL_CANVAS_SELECTOR = ".thread-terminal-drawer canvas";

/** Marker file the burst command touches in the workspace when it finishes. */
const BURST_DONE_FILE = ".t3perf-burst-done";

/**
 * ~10k lines paced to ~11 s: awk sleeps 40 ms every 40 lines (~1k lines/s),
 * so output covers the whole fixed 10 s metrics window that follows Enter.
 * Runs in the seeded workspace repo (the terminal's cwd) and touches the done
 * marker last, so the host can prove the burst ran to completion.
 */
const BURST_COMMAND = `clear; seq 10000 | awk '{print "perfburst line " $0; if ($0 % 40 == 0) system("sleep .04")}'; touch ${BURST_DONE_FILE}`;

/** launch.ts roots every fixture workspace at <homeDir>/workspace. */
function burstDonePath(ctx: ScenarioContext): string {
  return NodePath.join(ctx.env.seed.homeDir, "workspace", BURST_DONE_FILE);
}

/**
 * Hash of the terminal canvas's top-left corner pixels. Ghostty renders to a
 * 2d canvas, so its text never reaches the DOM; comparing this sample before
 * and after the burst proves the attach stream actually painted. The region
 * shows the shell prompt before Enter and scrolled burst lines after, while
 * the blinking cursor sits at the end of the typed command, far outside it.
 */
async function terminalCanvasSample(ctx: ScenarioContext): Promise<number> {
  return await ctx.page.evaluate((selector) => {
    const canvas = document.querySelector(selector);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("The terminal canvas is not mounted.");
    }
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The terminal canvas has no 2d context.");
    const width = Math.max(1, Math.min(240, canvas.width));
    const height = Math.max(1, Math.min(48, canvas.height));
    const data = context.getImageData(0, 0, width, height).data;
    let hash = 0;
    for (let index = 0; index < data.length; index += 16) {
      hash = (hash * 31 + (data[index] ?? 0)) | 0;
    }
    return hash;
  }, TERMINAL_CANVAS_SELECTOR);
}

/**
 * Setup for terminal-output-burst; also runs inline on the warm-up pass.
 * Terminals are runtime state, not projections, so the seeded
 * projection-only thread works: mod+j (terminal.toggle) opens the drawer
 * and, on a thread with no sessions yet, also opens a real PTY over the
 * terminal.open RPC at the project's workspace root, with no decider
 * involvement. Ends with the terminal focused and the burst command typed
 * but not run, so the metrics window opens exactly on Enter.
 */
async function prepareTerminalBurst(ctx: ScenarioContext): Promise<void> {
  await openGiantThread(ctx);
  const canvas = ctx.page.locator(TERMINAL_CANVAS_SELECTOR).first();
  if (!(await canvas.isVisible())) {
    await ctx.page.keyboard.press("ControlOrMeta+j");
    await canvas.waitFor({ state: "visible", timeout: READY_TIMEOUT });
  }
  await canvas.click();
  // Ctrl+C clears a partially typed line and any straggler from an aborted
  // run; the PTY absorbs typeahead, so typing right after open is safe even
  // while the shell is still starting.
  await ctx.page.keyboard.press("Control+c");
  await ctx.page.waitForTimeout(300);
  await NodeFSP.rm(burstDonePath(ctx), { force: true });
  await ctx.page.keyboard.type(BURST_COMMAND, { delay: 10 });
  await ctx.page.evaluate(() => {
    (
      window as unknown as { __t3perfTerminalBurstPrepared?: boolean }
    ).__t3perfTerminalBurstPrepared = true;
  });
}

/**
 * preview-pip-frames target page. The preview accepts only http(s) loopback
 * URLs (normalizePreviewUrl in packages/shared rejects file: and data:), and
 * the fixture workspace serves nothing, so the harness hosts the previewable
 * target itself. The page animates a canvas on every frame so each 12 fps
 * capturePage JPEG differs, the realistic cost case for streaming a live dev
 * server; the no-continuous-animation rule is product taste, and this is
 * measurement fixture content, not product UI.
 */
const PREVIEW_TARGET_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>T3 Perf PiP Target</title>
    <style>html, body { margin: 0; height: 100%; background: #101418; overflow: hidden; } canvas { width: 100vw; height: 100vh; display: block; }</style>
  </head>
  <body>
    <canvas id="stage" width="640" height="480"></canvas>
    <script>
      const stage = document.getElementById("stage");
      const paint = stage.getContext("2d");
      let tick = 0;
      const draw = () => {
        tick += 1;
        paint.fillStyle = "hsl(" + (tick % 360) + " 60% 12%)";
        paint.fillRect(0, 0, 640, 480);
        for (let bar = 0; bar < 8; bar += 1) {
          paint.fillStyle = "hsl(" + ((tick * 3 + bar * 45) % 360) + " 80% 55%)";
          paint.fillRect(((tick * (2 + bar) + bar * 80) % 720) - 80, bar * 60, 64, 52);
        }
        paint.fillStyle = "#fff";
        paint.font = "24px monospace";
        paint.fillText("t3 perf pip frame " + tick, 16, 468);
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    </script>
  </body>
</html>`;

/** Module-level singleton: one target server for the whole CLI process. */
let previewTargetPort: Promise<number> | null = null;

/** Serves the animated target on a loopback port; unref'd so it never holds the process open. */
function startPreviewTarget(): Promise<number> {
  previewTargetPort ??= new Promise((resolve, reject) => {
    const server = NodeHTTP.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PREVIEW_TARGET_HTML);
    });
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) resolve(address.port);
      else reject(new Error("The preview target server reported no port."));
    });
  });
  return previewTargetPort;
}

const PREVIEW_URL_INPUT_SELECTOR = "[data-preview-url-input]";

/** PanelLayoutControls' toggle; the label gains an agent-count suffix, hence the prefix match. */
const RIGHT_PANEL_TOGGLE_SELECTOR = '[aria-label^="Toggle right panel"]';

/** The chrome row's three-dot menu (PreviewMoreMenu), which holds the PiP item. */
const PREVIEW_MENU_TRIGGER_SELECTOR = '[aria-label="Preview menu"]';

/**
 * Installs (idempotently) and reads a received-frame counter inside the PiP
 * window's page. Its preload exposes previewPictureInPicture.onFrame, the
 * same hook the page's own <img> updater uses, so counted frames are frames
 * that crossed capturePage -> JPEG -> IPC for real. Returns null while the
 * page has not loaded its preload yet.
 */
const PIP_COUNTER_EXPRESSION = `(() => {
  const state = window;
  if (state.previewPictureInPicture === undefined) return null;
  if (state.__t3perfPipCounter === undefined) {
    state.__t3perfPipCounter = { frames: 0 };
    state.previewPictureInPicture.onFrame(() => { state.__t3perfPipCounter.frames += 1; });
  }
  return state.__t3perfPipCounter.frames;
})()`;

function requireElectronApp(ctx: ScenarioContext) {
  const app = ctx.env.electronApp;
  if (app === null) throw new Error("preview-pip-frames requires the desktop surface.");
  return app;
}

/** True when the native PiP BrowserWindow exists (titled by Manager.ts). */
async function pipWindowExists(ctx: ScenarioContext): Promise<boolean> {
  return await requireElectronApp(ctx).evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((candidate) => {
      const title = candidate.getTitle();
      return title === "Browser preview" || title.startsWith("Preview ·");
    }),
  );
}

/** Frames the PiP window has received since the counter installed; null when it is not streaming yet. */
async function pipFrameCount(ctx: ScenarioContext): Promise<number | null> {
  const result = await requireElectronApp(ctx).evaluate(
    async ({ BrowserWindow }, expression) => {
      const pip = BrowserWindow.getAllWindows().find((candidate) => {
        const title = candidate.getTitle();
        return title === "Browser preview" || title.startsWith("Preview ·");
      });
      if (pip === undefined || pip.isDestroyed()) return null;
      try {
        return (await pip.webContents.executeJavaScript(expression)) as number | null;
      } catch {
        // The data-URL page is still loading; the caller polls.
        return null;
      }
    },
    PIP_COUNTER_EXPRESSION,
  );
  return typeof result === "number" ? result : null;
}

/** Waits until some webContents (the preview guest) finished loading the target origin. */
async function waitForPreviewGuest(ctx: ScenarioContext, targetOrigin: string): Promise<void> {
  const app = requireElectronApp(ctx);
  const deadline = Date.now() + READY_TIMEOUT;
  for (;;) {
    const loaded = await app.evaluate(
      ({ webContents }, prefix) =>
        webContents
          .getAllWebContents()
          .some(
            (contents) =>
              !contents.isDestroyed() &&
              contents.getURL().startsWith(prefix) &&
              !contents.isLoading(),
          ),
      targetOrigin,
    );
    if (loaded) return;
    if (Date.now() > deadline) {
      throw new Error("The desktop preview never finished loading the harness target page.");
    }
    await ctx.page.waitForTimeout(200);
  }
}

/**
 * Setup for preview-pip-frames; also runs inline on the warm-up pass. Ends
 * with the giant thread open in the main window, the harness's animated
 * target loaded in the right panel's browser surface, the native PiP window
 * open (the three-dot menu's "Open separate preview window"), and at least
 * one frame delivered, so the metrics window opens on a steady stream. The
 * environment is reused across runs and the PiP window survives between
 * them, so re-preparation is a cheap no-op after the first run.
 */
async function preparePreviewPip(ctx: ScenarioContext): Promise<void> {
  await openGiantThread(ctx);
  if ((await pipFrameCount(ctx)) !== null) return;
  const port = await startPreviewTarget();
  const targetUrl = `http://127.0.0.1:${port}/`;
  const urlInput = ctx.page.locator(PREVIEW_URL_INPUT_SELECTOR).first();
  if (!(await urlInput.isVisible())) {
    // The browser surface's card in the right panel's "Open a surface" empty
    // state; its description is the only stable unique text on the card.
    const browserCard = ctx.page.getByText("Open a local app or URL.", { exact: true }).first();
    if (!(await browserCard.isVisible())) {
      await ctx.page.locator(RIGHT_PANEL_TOGGLE_SELECTOR).first().click();
      await browserCard.waitFor({ state: "visible", timeout: READY_TIMEOUT });
    }
    await browserCard.click();
    await urlInput.waitFor({ state: "visible", timeout: READY_TIMEOUT });
  }
  await urlInput.click();
  await urlInput.fill(targetUrl);
  await ctx.page.keyboard.press("Enter");
  await waitForPreviewGuest(ctx, targetUrl);
  // The menu item stays disabled until the desktop bridge registers the
  // guest's webContentsId in the renderer, which can lag the load; retry.
  let opened = await pipWindowExists(ctx);
  for (let attempt = 0; !opened && attempt < 5; attempt += 1) {
    await ctx.page.locator(PREVIEW_MENU_TRIGGER_SELECTOR).first().click();
    const item = ctx.page.getByRole("menuitem", { name: "Open separate preview window" });
    await item.waitFor({ state: "visible", timeout: 5_000 });
    await item.click();
    const deadline = Date.now() + 10_000;
    while (!opened && Date.now() < deadline) {
      opened = await pipWindowExists(ctx);
      if (!opened) await ctx.page.waitForTimeout(250);
    }
    if (!opened) await ctx.page.keyboard.press("Escape");
  }
  if (!opened) throw new Error("The separate preview window never opened.");
  // The first counted frame proves capture -> encode -> IPC -> render live.
  const deadline = Date.now() + READY_TIMEOUT;
  for (;;) {
    const frames = await pipFrameCount(ctx);
    if (frames !== null && frames > 0) return;
    if (Date.now() > deadline) {
      throw new Error("The picture-in-picture window never received a frame.");
    }
    await ctx.page.waitForTimeout(200);
  }
}

/**
 * Settings sections in sidebar order, mirroring SETTINGS_SECTION_LABELS in
 * apps/web/src/components/settings/settingsSearch.ts (the record the settings
 * nav renders from). `nav` is the sidebar entry's label; `marker` matches an
 * h2 unique to that section's page content (SettingsSection titles), so a
 * transition only counts as done once the destination panel actually rendered.
 * Source Control resolves to a skeleton, a discovery list, or an empty state
 * depending on what the server environment reports; the first two title their
 * lead section "Version Control", the last "Server environment".
 */
const SETTINGS_WALK: ReadonlyArray<{ readonly nav: string; readonly marker: RegExp }> = [
  { nav: "General", marker: /^General$/ },
  { nav: "Appearance", marker: /^Appearance$/ },
  { nav: "Keybindings", marker: /^Keybindings$/ },
  { nav: "Providers", marker: /^Providers$/ },
  { nav: "Integrations", marker: /^Browser$/ },
  { nav: "Source Control", marker: /^(Version Control|Server environment)$/ },
  { nav: "Connections", marker: /^This environment$/ },
  { nav: "Archive", marker: /^Archived threads$/ },
];

/** The primary environment's seeded project title (seed.ts, project 1). */
const PRIMARY_PROJECT_TITLE = "Perf Fixture";

const ENV_SWITCH_MEASURE = "t3perf.env-switch";

function requireSecondServer(ctx: ScenarioContext) {
  const second = ctx.env.secondServer;
  if (second === null) {
    throw new Error("environment-switch requires the second spawned server.");
  }
  return second;
}

/** The sidebar row of the second environment's retitled marker thread. */
function secondEnvRow(ctx: ScenarioContext) {
  return ctx.page.getByText(requireSecondServer(ctx).threadTitle, { exact: false }).first();
}

/**
 * Setup for environment-switch; also runs inline on the warm-up pass. Pairs
 * the second spawned server as a saved environment through the real Settings
 * -> Connections "Add environment" dialog, once per environment: the pairing
 * token is single-use, so a window flag guards re-preparation. Registration
 * is when the client establishes the second environment's connection and
 * syncs its snapshot, so that cost stays out of the metrics window by design
 * (see the environmentSwitch band note in report.ts). Ends with the sidebar
 * scoped to the primary environment's project, the uniform starting state.
 */
async function prepareEnvironmentSwitch(ctx: ScenarioContext): Promise<void> {
  const second = requireSecondServer(ctx);
  const paired = await ctx.page.evaluate(
    () =>
      (window as unknown as { __t3perfEnvSwitchPaired?: boolean }).__t3perfEnvSwitchPaired === true,
  );
  if (!paired) {
    await waitForThreadList(ctx);
    const sidebar = ctx.page.locator("[data-app-sidebar]");
    await sidebar.locator('[aria-label="Settings"]').first().click();
    await sidebar.getByText("Connections", { exact: true }).first().click();
    const openDialogButton = ctx.page.getByRole("button", { name: "Add environment" }).first();
    await openDialogButton.waitFor({ state: "visible", timeout: READY_TIMEOUT });
    await openDialogButton.click();
    // Named lookup: toasts also carry role dialog (e.g. provider updates).
    const dialog = ctx.page.getByRole("dialog", { name: "Add Environment" });
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    // Pasting the full pairing URL into Host fills the pairing code too
    // (parsePairingUrlFields in ConnectionsSettings.tsx).
    await dialog.getByLabel("Host").fill(second.pairingUrl);
    await dialog.getByRole("button", { name: "Add environment" }).click();
    // Success closes the dialog; a failure leaves it open showing the error.
    await dialog.waitFor({ state: "hidden", timeout: READY_TIMEOUT });
    await ctx.page.evaluate(() => {
      (window as unknown as { __t3perfEnvSwitchPaired?: boolean }).__t3perfEnvSwitchPaired = true;
    });
    // Back to the thread list; under All projects the second environment's
    // rows land in the sidebar once its connection and snapshot sync settle.
    await sidebar.getByText("Back", { exact: true }).first().click();
    await waitForThreadList(ctx);
    await secondEnvRow(ctx).waitFor({ state: "visible", timeout: READY_TIMEOUT });
  }
  // Park on the primary project's scope; a no-op when the previous run
  // already left the sidebar there.
  if (await secondEnvRow(ctx).isVisible()) {
    await scopeSidebarThreads(ctx, PRIMARY_PROJECT_TITLE, async () => {
      await secondEnvRow(ctx).waitFor({ state: "hidden", timeout: READY_TIMEOUT });
    });
  }
}

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: "startup",
    description: "Cold start to a rendered thread list.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    freshEnv: true,
    measureFromLaunch: true,
    run: waitForThreadList,
  },
  {
    name: "open-giant-thread",
    description: "Switch from a small thread to the giant one until its last message renders.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    // Reset to a cheap thread before measurement so each run measures only
    // the switch to the giant thread (the settle must stay out of the window;
    // it inflated interaction readings by a flat 300ms before this hook).
    prepare: async (ctx) => {
      await ctx.page.getByText(ctx.env.seed.sampleThreadTitle, { exact: false }).first().click();
      await ctx.page.waitForTimeout(300);
    },
    run: openGiantThread,
  },
  {
    name: "scroll-giant-thread",
    description: "Wheel-scroll through the giant thread for five seconds; the GPU/frame scenario.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    run: async (ctx) => {
      await openGiantThread(ctx);
      // Wheel events land at the cursor; park it over the message pane.
      const viewport = ctx.page.viewportSize() ?? { width: 1440, height: 900 };
      await ctx.page.mouse.move(viewport.width * 0.6, viewport.height * 0.5);
      const until = Date.now() + 5_000;
      while (Date.now() < until) {
        await ctx.page.mouse.wheel(0, -600);
        await ctx.page.waitForTimeout(50);
        await ctx.page.mouse.wheel(0, 600);
        await ctx.page.waitForTimeout(50);
      }
    },
  },
  {
    name: "compose-typing-latency",
    description:
      "Type ~200 characters into the composer with the giant thread open. Headline: p95 of the per-keystroke t3perf.keystroke pageMeasures (keydown to paint), not wall time, which the scripted 30ms key delay fixes by design.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    prepare: prepareComposerTyping,
    run: async (ctx) => {
      // The warm-up run arrives without prepare(); do the setup inline then.
      const composer = ctx.page.locator(COMPOSER_SELECTOR).first();
      if (!(await composer.isVisible())) await prepareComposerTyping(ctx);
      await composer.click();
      await ctx.page.keyboard.type(TYPED_TEXT, { delay: 30 });
      // The last keystroke's measure lands two frames after its keydown; wait
      // for that exact paint (not a timeout) so pageMeasures always catch it.
      await ctx.page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  },
  {
    name: "command-palette-open",
    description:
      "Open the command palette from the thread list (mod+k) to first painted results, then type a 3-character query until the filtered Threads group renders. Sub-steps land as t3perf.palette-open and t3perf.palette-filter pageMeasures.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    // Each run leaves the palette open with a query typed; start closed.
    prepare: async (ctx) => {
      await closeCommandPalette(ctx);
      await waitForThreadList(ctx);
    },
    run: async (ctx) => {
      const palette = ctx.page.locator(PALETTE_SELECTOR);
      // The warm-up run arrives without prepare() right after launch; do the
      // setup inline always (both are instant no-ops on prepared runs).
      if (await palette.isVisible()) await closeCommandPalette(ctx);
      await waitForThreadList(ctx);

      await ctx.page.evaluate(() => performance.mark("t3perf.palette-open.start"));
      // Default binding is mod+k (packages/shared/src/keybindings.ts): meta
      // on Mac platforms, ctrl elsewhere, which is exactly ControlOrMeta.
      await ctx.page.keyboard.press("ControlOrMeta+k");
      // The empty-query palette leads with the Recent Threads group.
      await palette
        .getByText("Recent Threads", { exact: true })
        .waitFor({ state: "visible", timeout: READY_TIMEOUT });
      await afterNextPaint(ctx);
      await ctx.page.evaluate(() =>
        performance.measure("t3perf.palette-open", { start: "t3perf.palette-open.start" }),
      );

      // Typed characters must land in the palette input, not whatever held
      // focus before the dialog's autofocus settles (a mid-boot composer can
      // win that race on the warm-up pass).
      await ctx.page.waitForFunction(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLInputElement &&
          active.closest('[data-testid="command-palette"]') !== null
        );
      });

      // Three characters of a seeded title always match at least one thread.
      const query = ctx.env.seed.giantThreadTitle.slice(0, 3).toLowerCase();
      await ctx.page.evaluate(() => performance.mark("t3perf.palette-filter.start"));
      await ctx.page.keyboard.type(query, { delay: 30 });
      // Filtering swaps Recent Threads out for the matched Threads group, so
      // this exact label only exists once the filtered results rendered.
      await palette
        .getByText("Threads", { exact: true })
        .waitFor({ state: "visible", timeout: READY_TIMEOUT });
      await afterNextPaint(ctx);
      await ctx.page.evaluate(() =>
        performance.measure("t3perf.palette-filter", { start: "t3perf.palette-filter.start" }),
      );
    },
  },
  {
    name: "settings-navigation",
    description:
      "Open Settings from the thread list, click every settings section in sidebar order waiting for each panel to render, then return to the thread list. Wall time covers 9 route transitions including route-level code-split loads (settings open, 7 real section switches since General is already active when its nav entry is clicked, and the return). Per-section timing is a future refinement.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    // Each run ends back at the thread list; waiting for it here keeps any
    // late settle of the previous run's return out of the metrics window.
    prepare: waitForThreadList,
    run: async (ctx) => {
      const sidebar = ctx.page.locator("[data-app-sidebar]");
      // The gear in the sidebar footer; /settings redirects to General.
      await sidebar.locator('[aria-label="Settings"]').first().click();
      for (const step of SETTINGS_WALK) {
        await sidebar.getByText(step.nav, { exact: true }).first().click();
        await ctx.page
          .getByRole("heading", { level: 2, name: step.marker })
          .first()
          .waitFor({ state: "visible", timeout: READY_TIMEOUT });
      }
      // The settings sidebar's footer Back button leads out (section clicks
      // navigate with replace, so history holds only the thread list).
      await sidebar.getByText("Back", { exact: true }).first().click();
      await waitForThreadList(ctx);
      await afterNextPaint(ctx);
    },
  },
  {
    name: "open-large-diff",
    description:
      "Open the giant thread's seeded 40-file / ~4.8k-changed-line checkpoint diff from the timeline's changed-files card (its Open diff button) and wait for the first hunk's text to paint. The click-to-first-hunk span also lands as the t3perf.diff-open pageMeasure. Covers the diff panel's code-split load, the server-side git diff between the seeded turn/0 and turn/1 refs, the patch crossing the wire, and the parse and first render (stacked, the default mode). Fresh environment per run: the client's query cache (30s SWR) would otherwise serve every reopen instantly and only the discarded warm-up would pay the real cost.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    freshEnv: true,
    prepare: prepareOpenLargeDiff,
    run: async (ctx) => {
      const openDiff = ctx.page.locator(OPEN_DIFF_BUTTON_SELECTOR).first();
      // The warm-up run arrives without prepare(); do the setup inline then.
      if (!(await openDiff.isVisible())) await prepareOpenLargeDiff(ctx);
      await ctx.page.evaluate(() => performance.mark("t3perf.diff-open.start"));
      await openDiff.click();
      await firstHunkLine(ctx).waitFor({ state: "visible", timeout: READY_TIMEOUT });
      await afterNextPaint(ctx);
      await ctx.page.evaluate(() =>
        performance.measure("t3perf.diff-open", { start: "t3perf.diff-open.start" }),
      );
    },
  },
  {
    name: "sidebar-scroll-and-reorder",
    description:
      "Wheel-scroll the sidebar thread list (with its seeded pinned block) for three seconds. Wall time is fixed by design; frames and GPU are the headline. The planned reorder half (drag a pinned row, measure the t3perf.pin-drop-settle drop settle) is blocked: seed.ts pins render and drag correctly, but the fixture threads exist only as projection rows, so the server's event-sourced decider rejects thread.pin.reorder (\"thread does not exist\") and the drop snaps back. It needs event-backed fixture threads.",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    prepare: waitForThreadList,
    run: async (ctx) => {
      // The warm-up run arrives without prepare(); an instant no-op otherwise.
      await waitForThreadList(ctx);
      // The seeded pinned block must be part of the scrolled content.
      await ctx.page
        .locator(PINNED_DIVIDER_SELECTOR)
        .waitFor({ state: "attached", timeout: READY_TIMEOUT });
      const box = await ctx.page.locator("[data-app-sidebar]").boundingBox();
      if (box === null) throw new Error("The sidebar is not visible.");
      // Wheel events land at the cursor; park it over the thread list.
      await ctx.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const until = Date.now() + 3_000;
      while (Date.now() < until) {
        await ctx.page.mouse.wheel(0, 600);
        await ctx.page.waitForTimeout(50);
        await ctx.page.mouse.wheel(0, -600);
        await ctx.page.waitForTimeout(50);
      }
    },
  },
  {
    name: "many-projects-sidebar",
    description:
      "Cold start to a rendered thread list with 50 seeded projects (the wide fixture), then scope the sidebar to two seeded projects and back to all via the project filter menu. The sidebar thread list and the 51-entry scope menu are plain non-virtualized .maps in Sidebar.tsx, so mount cost scales with project and thread counts; wall time is the mount (startup bands). The default sidebar has no per-project group expand/collapse (that affordance is legacy-sidebar only), so the scope menu is the grouping interaction; each switch lands as a t3perf.project-scope pageMeasure (interaction bands).",
    surfaces: ["web", "desktop"],
    sizes: ["wide"],
    freshEnv: true,
    measureFromLaunch: true,
    run: async (ctx) => {
      await waitForThreadList(ctx);
      const projects = ctx.env.seed.projects;
      const projectA = projects[10];
      const projectB = projects[30];
      if (projectA === undefined || projectB === undefined) {
        throw new Error("The wide fixture seeded too few projects for the scope switches.");
      }
      const giantRow = ctx.page.getByText(ctx.env.seed.giantThreadTitle, { exact: false }).first();
      const sampleRow = (title: string) =>
        ctx.page.getByText(title, { exact: false }).first();
      // Scoping away from project 1 must unmount the giant thread's row and
      // paint the target project's seeded thread; both prove the re-render.
      await scopeSidebarThreads(ctx, projectA.title, async () => {
        await giantRow.waitFor({ state: "hidden", timeout: READY_TIMEOUT });
        await sampleRow(projectA.sampleThreadTitle).waitFor({
          state: "visible",
          timeout: READY_TIMEOUT,
        });
      });
      await scopeSidebarThreads(ctx, projectB.title, async () => {
        await sampleRow(projectB.sampleThreadTitle).waitFor({
          state: "visible",
          timeout: READY_TIMEOUT,
        });
      });
      await scopeSidebarThreads(ctx, "All projects", async () => {
        await giantRow.waitFor({ state: "visible", timeout: READY_TIMEOUT });
      });
    },
  },
  {
    name: "streaming-turn-append",
    description:
      "Frame pacing and script time while a real assistant turn appends to the auto-scrolling timeline for 10 seconds. Wall time is fixed by design; dropped frames, script time, and GPU are the headline. The environment registers a mock streaming ACP agent as a Grok provider instance, and prepare() creates a project and a fresh thread per run through the real HTTP dispatch path (seeded fixture threads are projection-only, which the decider rejects), then starts a real turn: deltas flow provider -> ACP adapter -> ingestion -> orchestration events -> WS -> timeline, the exact shipped code path. Default assistant delivery is buffered (token streaming is a legacy opt-in), so the agent emits what a busy real turn emits: text chunks every 40ms punctuated by a completed tool call every ~1.3s, each of which flushes the buffered segment into a visible append plus a tool card. Web only for now: the dispatch calls ride the paired browser session's same-origin cookie, which the desktop shell does not have.",
    surfaces: ["web"],
    sizes: ["small", "medium", "large"],
    streamingProvider: true,
    prepare: prepareStreamingTurn,
    run: async (ctx) => {
      // The warm-up run arrives without prepare(); do the setup inline then.
      const prepared = await ctx.page.evaluate(
        () =>
          (window as unknown as { __t3perfStreamingThreadId?: string })
            .__t3perfStreamingThreadId !== undefined,
      );
      if (!prepared) await prepareStreamingTurn(ctx);
      const before = await visibleTextLength(ctx);
      await ctx.page.waitForTimeout(10_000);
      const after = await visibleTextLength(ctx);
      // A dead stream would measure an idle page; fail loudly instead.
      if (after <= before) {
        throw new Error("The assistant stream did not append during the measured window.");
      }
    },
  },
  {
    name: "terminal-output-burst",
    description:
      "Press Enter on a pre-typed paced burst command in the thread terminal and measure a fixed 10 s window while ~10k lines stream into the Ghostty canvas. Wall time is fixed by design; dropped frames, GPU ms/s, and GPU-process CPU are the headline. Terminals are runtime state rather than projections, so the seeded thread needs no event backing: prepare() opens the drawer's real affordance (mod+j, which also opens a PTY at the seeded workspace repo via terminal.open) and types the command, keeping setup out of the window. Output is proven live twice: the canvas's corner pixels must change across the window (Ghostty text never reaches the DOM), and the burst's workspace done marker must appear, which run() waits for so the ~1 s tail cannot bleed into the next run. Small size only: terminal cost does not scale with the fixture.",
    surfaces: ["web", "desktop"],
    sizes: ["small"],
    prepare: prepareTerminalBurst,
    run: async (ctx) => {
      // The warm-up run arrives without prepare(); do the setup inline then.
      const prepared = await ctx.page.evaluate(() => {
        const state = window as unknown as { __t3perfTerminalBurstPrepared?: boolean };
        const value = state.__t3perfTerminalBurstPrepared === true;
        delete state.__t3perfTerminalBurstPrepared;
        return value;
      });
      if (!prepared) await prepareTerminalBurst(ctx);
      const before = await terminalCanvasSample(ctx);
      await ctx.page.keyboard.press("Enter");
      await ctx.page.waitForTimeout(10_000);
      // A dead attach stream would measure an idle canvas; fail loudly.
      const after = await terminalCanvasSample(ctx);
      if (after === before) {
        throw new Error("The terminal canvas did not repaint during the measured window.");
      }
      const deadline = Date.now() + 15_000;
      for (;;) {
        try {
          await NodeFSP.access(burstDonePath(ctx));
          break;
        } catch {
          if (Date.now() > deadline) {
            throw new Error(
              "The terminal burst never finished: its workspace done marker did not appear.",
            );
          }
          await ctx.page.waitForTimeout(100);
        }
      }
    },
  },
  {
    name: "preview-pip-frames",
    description:
      "Measure a fixed 10 s window while the desktop picture-in-picture preview window streams frames alongside the main window (giant thread open). Wall time is fixed by design; GPU ms/s, GPU-process CPU, and dropped frames are the headline. The PiP path is the expensive one by construction: the preview manager capturePage-samples the guest at 12 fps, JPEG-encodes each frame, and IPCs it into an always-on-top BrowserWindow that repaints an <img>, so one Electron GPU helper carries the main window, the preview guest, and the PiP window together (per-process GPU attribution sees them as one app, which is exactly the number that matters). The preview accepts only loopback http(s) URLs, so the harness serves its own animated canvas page as the target, keeping every captured frame distinct like a live dev server. Liveness is proven by a frame counter installed inside the PiP window through its own onFrame preload hook; a run fails loudly if fewer than 10 frames arrive. Desktop only (the PiP window is an Electron affordance); small size only: streaming cost does not scale with the fixture.",
    surfaces: ["desktop"],
    sizes: ["small"],
    prepare: preparePreviewPip,
    run: async (ctx) => {
      // The warm-up run arrives without prepare(); do the setup inline then.
      if ((await pipFrameCount(ctx)) === null) await preparePreviewPip(ctx);
      const before = await pipFrameCount(ctx);
      if (before === null) throw new Error("The picture-in-picture stream is not live.");
      await ctx.page.waitForTimeout(10_000);
      const after = await pipFrameCount(ctx);
      if (after === null) {
        throw new Error("The picture-in-picture window closed during the measured window.");
      }
      // 12 fps nominal is ~120 frames; 10 tolerates slow capture, not death.
      if (after - before < 10) {
        throw new Error(
          `The picture-in-picture stream stalled: only ${after - before} frames arrived in the 10 s window.`,
        );
      }
    },
  },
  {
    name: "slow-network-startup",
    description: "Cold start over a 200ms±100ms, 500 KB/s connection (relay-shaped, affects WS).",
    surfaces: ["web"],
    sizes: ["small", "medium", "large"],
    freshEnv: true,
    measureFromLaunch: true,
    shape: { latencyMs: 200, jitterMs: 100, bytesPerSecond: 500_000 },
    run: waitForThreadList,
  },
  {
    name: "flaky-reconnect",
    description: "Hard-drop every connection (TCP RST) mid-session; measure until the app is usable again.",
    surfaces: ["web"],
    sizes: ["small", "medium", "large"],
    shape: {},
    // Fresh environment per run: every run measures first-drop recovery with
    // the same never-visited target thread (an unvisited thread's messages
    // cannot come from client cache, so rendering them proves a fresh socket
    // round-tripped). Reusing one session instead would stack the client's
    // reconnect backoff, which grows with each successive drop.
    freshEnv: true,
    run: async (ctx) => {
      const shaper = ctx.env.shaper;
      if (shaper === null) throw new Error("flaky-reconnect requires the relay.");
      await waitForThreadList(ctx);
      shaper.dropAll({ rst: true });
      const target = ctx.env.seed.threads[2];
      if (target === undefined) throw new Error("Fixture has too few threads.");
      await ctx.page.getByText(target.title, { exact: false }).first().click();
      await ctx.page
        .getByText(target.lastMessageSnippet, { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: READY_TIMEOUT });
    },
  },
  {
    name: "environment-switch",
    description:
      "Switch the sidebar between two connected environments and back via the project scope menu (the sidebar merges environments, so the scope menu is the product's environment switcher). launch.ts spawns, seeds, and retitles a second small server; prepare() pairs it once through the real Settings -> Connections Add environment dialog (host and pairing code, the flow that works from any web client), which is also where the client establishes the second environment's connection, keeping that cost out of the metrics window. Each measured run scopes to the second environment's project until only its retitled rows are painted, then back to the primary's until only the primary's giant row is; each direction lands as a t3perf.env-switch pageMeasure and wall time covers both. Web only: pairing rides the page's Add environment dialog, and the desktop's saved-environment flows are bridge-driven.",
    surfaces: ["web"],
    sizes: ["small", "medium", "large"],
    secondServer: true,
    prepare: prepareEnvironmentSwitch,
    run: async (ctx) => {
      const second = requireSecondServer(ctx);
      // The warm-up run arrives without prepare(); do the setup inline then.
      const paired = await ctx.page.evaluate(
        () =>
          (window as unknown as { __t3perfEnvSwitchPaired?: boolean })
            .__t3perfEnvSwitchPaired === true,
      );
      if (!paired) await prepareEnvironmentSwitch(ctx);
      const giantRow = ctx.page.getByText(ctx.env.seed.giantThreadTitle, { exact: false }).first();
      const secondRow = secondEnvRow(ctx);
      // To the second environment: the primary's giant row must unmount and
      // the second's retitled marker row must paint; both prove the rescope.
      await scopeSidebarThreads(
        ctx,
        second.projectTitle,
        async () => {
          await giantRow.waitFor({ state: "hidden", timeout: READY_TIMEOUT });
          await secondRow.waitFor({ state: "visible", timeout: READY_TIMEOUT });
        },
        ENV_SWITCH_MEASURE,
      );
      // And back, with the mirrored proof.
      await scopeSidebarThreads(
        ctx,
        PRIMARY_PROJECT_TITLE,
        async () => {
          await secondRow.waitFor({ state: "hidden", timeout: READY_TIMEOUT });
          await giantRow.waitFor({ state: "visible", timeout: READY_TIMEOUT });
        },
        ENV_SWITCH_MEASURE,
      );
    },
  },
];
