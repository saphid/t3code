// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side process launcher for the perf harness; runs outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { Browser, ElectronApplication, Page } from "playwright-core";
import { chromium, _electron } from "playwright-core";

import { NetShaper, type ShapeConfig } from "./netShaper.ts";
import { createWorkspaceRepo, seedFixture, type FixtureSize, type SeedResult } from "./seed.ts";

const packageDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const repoRoot = NodePath.resolve(packageDir, "..", "..");
// T3_PERF_SERVER_BIN points the web surface at any t3 server entry (e.g. an
// npm-installed release's dist/bin.mjs) instead of this repo's build.
const serverBin = process.env["T3_PERF_SERVER_BIN"] ?? NodePath.join(repoRoot, "apps/server/dist/bin.mjs");
const desktopDir = NodePath.join(repoRoot, "apps/desktop");
// T3_PERF_CHROME points at a Chromium binary on machines without installed
// Chrome (Linux servers); default is the local Chrome channel.
const chromeExecutable = process.env["T3_PERF_CHROME"];
// T3_PERF_CHROME_ARGS: extra whitespace-separated Chromium switches, e.g.
// "--enable-gpu --use-angle=gl-egl" to use a real GPU in Linux headless runs.
const chromeExtraArgs = (process.env["T3_PERF_CHROME_ARGS"] ?? "").split(/\s+/).filter(Boolean);

export type Surface = "web" | "desktop";

/**
 * Ambient network conditions for a run (web only). "good" is a direct
 * connection; the others route through the relay. "flaky" additionally
 * hard-drops every open connection (TCP RST) on an interval, starting after
 * the initial page load so launches complete and the measured scenario phase
 * absorbs the chaos.
 */
export const NETWORK_PROFILES = {
  good: null,
  okay: { shape: { latencyMs: 80, jitterMs: 20, bytesPerSecond: 2_000_000 } },
  flaky: {
    shape: { latencyMs: 150, jitterMs: 150, bytesPerSecond: 1_000_000 },
    dropEveryMs: 10_000,
  },
} as const;

export type NetworkProfileName = keyof typeof NETWORK_PROFILES;

export interface LaunchOptions {
  readonly surface: Surface;
  readonly size: FixtureSize;
  readonly headless: boolean;
  /** When set, web traffic is routed through a NetShaper relay. Web only. */
  readonly shape?: ShapeConfig | undefined;
  /** Ambient network profile; a scenario's own non-empty shape wins. */
  readonly network?: NetworkProfileName | undefined;
  /**
   * Register the mock streaming ACP agent as an enabled Grok provider
   * instance in the throwaway environment (streaming-turn-append only; the
   * enabled instance's boot-time health probe would add cold-start noise to
   * every other scenario).
   */
  readonly streamingProvider?: boolean | undefined;
  /**
   * Spawn, seed (always small), and retitle a second server alongside the
   * primary (web only, environment-switch). The scenario pairs it as a saved
   * environment through the real Settings -> Connections dialog; the retitle
   * keeps its rows locatable next to the identically seeded primary.
   */
  readonly secondServer?: boolean | undefined;
}

/** The second spawned server, as environment-switch needs to reach it. */
export interface SecondServer {
  /** Full pairing URL; pasted into the Add environment dialog's Host field. */
  readonly pairingUrl: string;
  /** The second environment's project title (its sidebar scope menu entry). */
  readonly projectTitle: string;
  /** A thread title that exists only in the second environment. */
  readonly threadTitle: string;
}

export interface LaunchedEnv {
  readonly surface: Surface;
  readonly page: Page;
  readonly seed: SeedResult & { readonly homeDir: string };
  /** pid of the app's `--type=gpu-process` helper, for GPU attribution. */
  readonly gpuHelperPid: number;
  /** pid of the browser/Electron root process. */
  readonly rootPid: number;
  /** pid of the T3 server process (web surface only; desktop owns its own). */
  readonly serverPid: number | null;
  /** Second seeded server (web only; LaunchOptions.secondServer). */
  readonly secondServer: SecondServer | null;
  readonly shaper: NetShaper | null;
  readonly electronApp: ElectronApplication | null;
  readonly browser: Browser | null;
  readonly close: () => Promise<void>;
}

async function findFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("No port assigned.")),
      );
    });
  });
}

interface SpawnedServer {
  readonly child: NodeChildProcess.ChildProcess;
  readonly pairingUrl: string;
  readonly port: number;
}

/** Spawns the built server against an isolated home and waits for its pairing URL. */
async function spawnServer(input: {
  readonly homeDir: string;
  readonly port: number;
  /** Extra origins (the relay's) the server should accept. */
  readonly allowedOrigins?: ReadonlyArray<string>;
}): Promise<SpawnedServer> {
  const args = [serverBin, "--base-dir", input.homeDir, "--port", String(input.port), "--no-browser"];
  const child = NodeChildProcess.spawn(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      T3CODE_HOME: input.homeDir,
      ...(input.allowedOrigins !== undefined && input.allowedOrigins.length > 0
        ? { T3CODE_DEV_ALLOWED_ORIGINS: input.allowedOrigins.join(",") }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const pairingUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not print a pairing URL within 60s. Output so far:\n${output.slice(-4000)}`));
    }, 60_000);
    timer.unref();
    const scan = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /pairingUrl[=:"\s]+"?(https?:\/\/\S+?)["\s]/.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with code ${code} before printing a pairing URL:\n${output.slice(-4000)}`));
    });
  });
  return { child, pairingUrl, port: input.port };
}

/**
 * Writes the throwaway home's settings.json so the server hydrates a Grok
 * provider instance (instanceId "grok", the legacy single-instance slug)
 * whose binary is a wrapper around src/acpStreamingAgent.ts. The wrapper
 * answers the health check's `--version` itself and hands everything else
 * to the mock agent, so provider probing, session start, and prompting all
 * run the server's real Grok ACP code path. Must run before the server
 * boots: settings are read at startup.
 */
async function provisionStreamingProvider(homeDir: string): Promise<void> {
  const agentPath = NodePath.join(packageDir, "src", "acpStreamingAgent.ts");
  const wrapperPath = NodePath.join(homeDir, "grok-streaming-mock");
  await NodeFSP.writeFile(
    wrapperPath,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "grok 9.9.9 (t3-perf streaming mock)"; exit 0; fi\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(agentPath)} "$@"\n`,
  );
  await NodeFSP.chmod(wrapperPath, 0o755);
  const stateDir = NodePath.join(homeDir, "userdata");
  await NodeFSP.mkdir(stateDir, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(stateDir, "settings.json"),
    JSON.stringify({ providers: { grok: { enabled: true, binaryPath: wrapperPath } } }, null, 2),
  );
}

const SECOND_ENV_PROJECT_TITLE = "Perf Fixture Two";
const SECOND_ENV_THREAD_PREFIX = "Env two ";

/**
 * Retitles every row in the second server's freshly seeded database. Seeding
 * is deterministic, so without this the two environments render byte-identical
 * project and thread titles and no scenario could tell their rows apart. Runs
 * right after seedFixture, before any client pairs, so nothing has cached the
 * original titles.
 */
function retitleSecondEnvironment(dbPath: string): void {
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    database.prepare("UPDATE projection_projects SET title = ?").run(SECOND_ENV_PROJECT_TITLE);
    database
      .prepare("UPDATE projection_threads SET title = ? || thread_id")
      .run(SECOND_ENV_THREAD_PREFIX);
    database.exec("COMMIT");
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
}

/** Chrome exposes its own process table over CDP; the GPU process is typed. */
async function chromiumGpuPid(browser: Browser): Promise<number> {
  const session = await browser.newBrowserCDPSession();
  try {
    const info = (await session.send("SystemInfo.getProcessInfo" as never)) as unknown as {
      processInfo: Array<{ type: string; id: number }>;
    };
    const gpu = info.processInfo.find((entry) => entry.type === "GPU");
    if (gpu === undefined) throw new Error("Chromium reported no GPU process.");
    return gpu.id;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export async function launchEnv(options: LaunchOptions): Promise<LaunchedEnv> {
  const homeDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-perf-"));
  const workspaceRoot = NodePath.join(homeDir, "workspace");
  await createWorkspaceRepo(workspaceRoot);
  if (options.streamingProvider === true) await provisionStreamingProvider(homeDir);
  const cleanups: Array<() => Promise<void>> = [
    async () => {
      await NodeFSP.rm(homeDir, { recursive: true, force: true });
    },
  ];
  const close = async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup().catch(() => undefined);
    }
  };
  try {
    if (options.surface === "web") {
      const serverPort = await findFreePort();
      const profile =
        options.network !== undefined && options.network !== "good"
          ? NETWORK_PROFILES[options.network]
          : null;
      const scenarioShape =
        options.shape !== undefined && Object.keys(options.shape).length > 0
          ? options.shape
          : undefined;
      const wantRelay = options.shape !== undefined || profile !== null;
      let shaper: NetShaper | null = null;
      let clientPort = serverPort;
      if (wantRelay) {
        clientPort = await findFreePort();
        shaper = new NetShaper();
        await shaper.listen(clientPort, serverPort);
        shaper.set(scenarioShape ?? profile?.shape ?? {});
        const shaperHandle = shaper;
        cleanups.push(async () => shaperHandle.close());
      }
      const server = await spawnServer({
        homeDir,
        port: serverPort,
        ...(shaper !== null
          ? {
              allowedOrigins: [
                `http://127.0.0.1:${clientPort}`,
                `http://localhost:${clientPort}`,
              ],
            }
          : {}),
      });
      // Behind the relay the browser must enter through the relay's port; the
      // pairing URL is origin-relative beyond that.
      const entryUrl =
        shaper === null
          ? server.pairingUrl
          : (() => {
              const url = new URL(server.pairingUrl);
              url.port = String(clientPort);
              return url.toString();
            })();
      cleanups.push(async () => {
        server.child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (server.child.exitCode === null) server.child.kill("SIGKILL");
      });
      const seed = await seedFixture({ homeDir, size: options.size, workspaceRoot });
      // Second server (environment-switch): its own home under the throwaway
      // dir (the rm -rf cleanup covers it), always the small fixture, retitled
      // so its rows are distinguishable. The page's origin goes into its
      // allowed origins for the paired browser's credentialed cross-origin
      // calls; the scenario does the pairing itself through the real UI.
      let secondServer: SecondServer | null = null;
      if (options.secondServer === true) {
        const secondHomeDir = NodePath.join(homeDir, "second-env");
        const secondWorkspaceRoot = NodePath.join(secondHomeDir, "workspace");
        await createWorkspaceRepo(secondWorkspaceRoot);
        const second = await spawnServer({
          homeDir: secondHomeDir,
          port: await findFreePort(),
          allowedOrigins: [
            `http://127.0.0.1:${clientPort}`,
            `http://localhost:${clientPort}`,
          ],
        });
        cleanups.push(async () => {
          second.child.kill("SIGTERM");
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (second.child.exitCode === null) second.child.kill("SIGKILL");
        });
        const secondSeed = await seedFixture({
          homeDir: secondHomeDir,
          size: "small",
          workspaceRoot: secondWorkspaceRoot,
        });
        retitleSecondEnvironment(secondSeed.dbPath);
        secondServer = {
          pairingUrl: second.pairingUrl,
          projectTitle: SECOND_ENV_PROJECT_TITLE,
          threadTitle: `${SECOND_ENV_THREAD_PREFIX}perf-thread-giant`,
        };
      }
      const browser = await chromium.launch({
        ...(chromeExecutable !== undefined
          ? { executablePath: chromeExecutable }
          : { channel: "chrome" as const }),
        ...(chromeExtraArgs.length > 0 ? { args: chromeExtraArgs } : {}),
        headless: options.headless,
      });
      cleanups.push(async () => browser.close());
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      // Shaped connections legitimately take minutes to move the bundle.
      await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 300_000 });
      if (shaper !== null && profile !== null && "dropEveryMs" in profile) {
        const shaperHandle = shaper;
        const chaos = setInterval(() => shaperHandle.dropAll({ rst: true }), profile.dropEveryMs);
        chaos.unref();
        cleanups.push(async () => clearInterval(chaos));
      }
      const gpuHelperPid = await chromiumGpuPid(browser);
      return {
        surface: "web",
        page,
        seed: { ...seed, homeDir },
        gpuHelperPid,
        rootPid: gpuHelperPid, // Chromium root pid is not exposed; the GPU pid is what we attribute to.
        serverPid: server.child.pid ?? -1,
        secondServer,
        shaper,
        electronApp: null,
        browser,
        close,
      };
    }

    // Desktop: Electron owns its own bundled server; T3CODE_HOME isolates all
    // state. The backend snapshots projections when it first opens the
    // database, so the fixture must be fully seeded before Electron starts:
    // boot the plain server once to run migrations, stop it, seed, launch.
    {
      const migratePort = await findFreePort();
      const migrateServer = await spawnServer({ homeDir, port: migratePort });
      const seedDone = await seedFixture({ homeDir, size: options.size, workspaceRoot }).finally(
        () => {
          migrateServer.child.kill("SIGTERM");
        },
      );
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          migrateServer.child.kill("SIGKILL");
          resolve();
        }, 3000);
        force.unref();
        migrateServer.child.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
      });
      return await launchDesktop(homeDir, seedDone, cleanups, close);
    }
  } catch (error) {
    await close();
    throw error;
  }
}

async function launchDesktop(
  homeDir: string,
  seed: SeedResult,
  cleanups: Array<() => Promise<void>>,
  close: () => Promise<void>,
): Promise<LaunchedEnv> {
    // The terminal scenario opens a real PTY, and desktop points HOME at the
    // throwaway dir; an empty .zshrc keeps a zsh with no startup files from
    // running zsh-newuser-install into the measured terminal.
    await NodeFSP.writeFile(NodePath.join(homeDir, ".zshrc"), "");
    // The repo's launcher prepares the app bundle the way the desktop's own
    // scripts do - a raw Electron binary launch fails scheme registration.
    const { resolveElectronLaunchCommand } = (await import(
      NodePath.join(desktopDir, "scripts/electron-launcher.mjs")
    )) as { resolveElectronLaunchCommand: (args: Array<string>) => { electronPath: string; args: Array<string> } };
    // --use-mock-keychain: with HOME pointed at the throwaway dir the login
    // keychain is invisible, and without this switch macOS shows a blocking
    // "Keychain Not Found" dialog (whose default button would edit the
    // developer's real keychain search list). Test secrets need no encryption.
    const command = resolveElectronLaunchCommand([
      "--use-mock-keychain",
      NodePath.join(desktopDir, "dist-electron/main.cjs"),
    ]);
    // Agents driving this harness often run inside a T3 desktop-spawned
    // server, which exports ELECTRON_RUN_AS_NODE=1; inheriting it turns the
    // Electron launch into a plain Node process with no Electron APIs.
    const electronEnv = { ...(process.env as Record<string, string>) };
    delete electronEnv["ELECTRON_RUN_AS_NODE"];
    const electronApp = await _electron.launch({
      executablePath: command.electronPath,
      args: command.args,
      cwd: desktopDir,
      env: {
        ...electronEnv,
        VITE_DEV_SERVER_URL: "",
        // T3CODE_HOME moves the database but NOT Electron's userData
        // (cookies, IndexedDB), which otherwise lands on the developer's live
        // T3 Code profile and collides with it. An isolated HOME moves both.
        HOME: homeDir,
        XDG_CONFIG_HOME: NodePath.join(homeDir, ".config"),
        XDG_DATA_HOME: NodePath.join(homeDir, ".local/share"),
        T3CODE_HOME: homeDir,
        T3CODE_NO_BROWSER: "1",
      },
    });
    cleanups.push(async () => {
      // close() can wedge (observed hanging a whole suite); give it 15s, then
      // kill the Electron root pid we captured at spawn.
      const rootPid = electronApp.process().pid;
      await Promise.race([
        electronApp.close().catch(() => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (typeof rootPid === "number") {
              try {
                process.kill(rootPid, "SIGKILL");
              } catch {
                // Already gone.
              }
            }
            resolve();
          }, 15_000);
          timer.unref();
        }),
      ]);
      // The desktop's bundled server can outlive the Electron shell; reap it
      // via the pid it recorded inside our throwaway home.
      try {
        const runtime = JSON.parse(
          await NodeFSP.readFile(NodePath.join(homeDir, "userdata", "server-runtime.json"), "utf8"),
        ) as { pid?: number };
        if (typeof runtime.pid === "number" && runtime.pid > 1) {
          const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)("/bin/ps", [
            "-p",
            String(runtime.pid),
            "-o",
            "command=",
          ]);
          if (stdout.includes("bin.mjs --bootstrap-fd")) process.kill(runtime.pid, "SIGTERM");
        }
      } catch {
        // Already gone, or never started.
      }
    });
    const page = await electronApp.firstWindow();
    const metrics = await electronApp.evaluate(({ app }) => app.getAppMetrics());
    const gpu = metrics.find((entry) => entry.type === "GPU");
    if (gpu === undefined) throw new Error("Electron reported no GPU process in getAppMetrics().");
    return {
      surface: "desktop",
      page,
      seed: { ...seed, homeDir },
      gpuHelperPid: gpu.pid,
    rootPid: electronApp.process().pid ?? -1,
    serverPid: null,
    secondServer: null,
    shaper: null,
    electronApp,
    browser: null,
    close,
  };
}
