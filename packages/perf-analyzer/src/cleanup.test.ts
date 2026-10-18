// @effect-diagnostics nodeBuiltinImport:off - Verifies signal shutdown using owned fake children, with no app or browser.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";

import { createCleanupScope } from "./cleanup.ts";

it("closes resources once in reverse order", async () => {
  const scope = createCleanupScope();
  const closed: Array<string> = [];
  await scope.acquire(
    async () => "home",
    async (value) => {
      closed.push(value);
    },
  );
  await scope.acquire(
    async () => "server",
    async (value) => {
      closed.push(value);
    },
  );
  await Promise.all([scope.close(), scope.close()]);
  expect(closed).toEqual(["server", "home"]);
});

it.each([
  ["SIGTERM", 143],
  ["SIGINT", 130],
] as const)(
  "reaps its owned child and pending browser handle after %s",
  async (signal, exitCode) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-perf-cleanup-"));
    let ownedPid: number | undefined;
    try {
      for (const name of ["cleanup.ts", "serverProcess.ts"]) {
        await NodeFSP.copyFile(
          NodeURL.fileURLToPath(new URL(name, import.meta.url)),
          NodePath.join(root, name),
        );
      }
      const records = NodePath.join(root, "shutdown.jsonl");
      const script = `import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createCleanupScope } from "./cleanup.ts";
import { stopServer } from "./serverProcess.ts";
const record = (value) => fs.appendFileSync(${JSON.stringify(records)}, JSON.stringify(value) + "\\n");
const scope = createCleanupScope();
scope.cleanups.push(async () => record("home-removed"));
const child = spawn(process.execPath, ["-e", 'setInterval(() => {}, 1000); process.send("ready");'], {
  stdio: ["ignore", "ignore", "ignore", "ipc"],
});
record({ pid: child.pid });
scope.cleanups.push(async () => { await stopServer(child); record("server-closed"); });
await once(child, "message");
await scope.acquire(() => new Promise((resolve) => {
  process.once(${JSON.stringify(signal)}, () => setImmediate(() => resolve({
    close: async () => {
      record("browser-closed");
      // A repeated signal must reuse the cleanup already in progress.
      process.kill(process.pid, ${JSON.stringify(signal === "SIGTERM" ? "SIGINT" : "SIGTERM")});
      await new Promise((done) => setImmediate(() => setImmediate(done)));
    },
  })));
  process.kill(process.pid, ${JSON.stringify(signal)});
}), (browser) => browser.close());
record("NEXT-QUEUED-RUN");
`;
      await NodeFSP.writeFile(NodePath.join(root, "run.mjs"), script);
      const child = NodeChildProcess.spawn(process.execPath, [NodePath.join(root, "run.mjs")], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
        killSignal: "SIGKILL",
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      const entries = (await NodeFSP.readFile(records, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      ownedPid = entries[0]?.pid;
      expect(code, output).toBe(exitCode);
      expect(entries.slice(1)).toEqual(["browser-closed", "server-closed", "home-removed"]);
      expect(() => process.kill(ownedPid!, 0)).toThrow();
      ownedPid = undefined;
    } finally {
      if (ownedPid !== undefined) {
        try {
          process.kill(ownedPid, "SIGKILL");
        } catch {
          /* Already reaped. */
        }
      }
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
