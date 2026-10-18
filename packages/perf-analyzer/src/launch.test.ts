// @effect-diagnostics nodeBuiltinImport:off - Exercises launch ownership with fake server and browser handles.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeStream from "node:stream";
import { afterEach, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { chromium } from "playwright-core";

import { launchEnv } from "./launch.ts";
import { seedFixture } from "./seed.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("playwright-core", () => ({
  chromium: { launch: vi.fn() },
  _electron: { launch: vi.fn() },
}));
vi.mock("./seed.ts", () => ({ createWorkspaceRepo: vi.fn(), seedFixture: vi.fn() }));

afterEach(() => vi.resetAllMocks());

it.each([false, true])(
  "reaps the captured server and removes its isolated home after browser failure=%s",
  async (failBrowser) => {
    const server = Object.assign(new NodeEvents.EventEmitter(), {
      pid: 123,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdout: new NodeStream.PassThrough(),
      stderr: new NodeStream.PassThrough(),
      kill: vi.fn(() => {
        server.signalCode = "SIGTERM";
        server.emit("exit", null, "SIGTERM");
        server.emit("close", null, "SIGTERM");
        return true;
      }),
    });
    vi.mocked(NodeChildProcess.spawn).mockImplementation(() => {
      queueMicrotask(() => server.stdout.write('pairingUrl: "http://127.0.0.1:1234/pair"\n'));
      return server as unknown as NodeChildProcess.ChildProcess;
    });
    vi.mocked(seedFixture).mockResolvedValue({} as Awaited<ReturnType<typeof seedFixture>>);
    const browser = {
      close: vi.fn(async () => {}),
      newContext: vi.fn(async () => ({ newPage: async () => ({ goto: async () => {} }) })),
      newBrowserCDPSession: vi.fn(async () => ({
        send: async () => ({ processInfo: [{ type: "GPU", id: 456 }] }),
        detach: async () => {},
      })),
    };
    if (failBrowser)
      vi.mocked(chromium.launch).mockRejectedValue(new Error("browser launch failed"));
    else
      vi.mocked(chromium.launch).mockResolvedValue(
        browser as unknown as Awaited<ReturnType<typeof chromium.launch>>,
      );
    let env: Awaited<ReturnType<typeof launchEnv>> | undefined;
    try {
      if (failBrowser) {
        await expect(launchEnv({ surface: "web", size: "small", headless: true })).rejects.toThrow(
          "browser launch failed",
        );
      } else {
        env = await launchEnv({ surface: "web", size: "small", headless: true });
        await Promise.all([env.close(), env.close()]);
        expect(browser.close).toHaveBeenCalledTimes(1);
      }
      expect(server.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
      const args = vi.mocked(NodeChildProcess.spawn).mock.calls[0]?.[1];
      const homeDir = args?.[args.indexOf("--base-dir") + 1];
      expect(homeDir).toContain("t3-perf-");
      await expect(NodeFSP.stat(homeDir!)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await env?.close();
    }
  },
);
