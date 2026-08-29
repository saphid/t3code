// @effect-diagnostics nodeBuiltinImport:off - These fixtures model the Node handles required by the SDK spawn hook.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";
import { assert, describe, it } from "@effect/vitest";
import type { SpawnOptions as ClaudeSpawnOptions } from "@anthropic-ai/claude-agent-sdk";

import {
  makeClaudeCapabilitiesProcessController,
  type ClaudeCapabilitiesProcessDependencies,
} from "./ClaudeCapabilitiesProcess.ts";

interface FakeProcess {
  readonly handle: NodeChildProcess.ChildProcess;
  readonly killSignals: Array<NodeJS.Signals>;
  finish(code: number | null): void;
  fail(error: Error): void;
}

function makeFakeProcess(pid: number): FakeProcess {
  const emitter = new NodeEvents.EventEmitter();
  const stdin = new NodeStream.PassThrough();
  const stdout = new NodeStream.PassThrough();
  const killSignals: Array<NodeJS.Signals> = [];
  let killed = false;
  let exitCode: number | null = null;

  const handle = Object.assign(emitter, {
    pid,
    stdin,
    stdout,
    stderr: null,
    stdio: [stdin, stdout, null],
    connected: false,
    signalCode: null,
    spawnargs: [],
    spawnfile: "fixture.exe",
    channel: undefined,
    killed: false,
    exitCode: null,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      killSignals.push(signal);
      killed = true;
      Object.defineProperty(handle, "killed", { configurable: true, get: () => killed });
      return true;
    },
    ref() {
      return handle;
    },
    unref() {
      return handle;
    },
    send() {
      return false;
    },
    disconnect() {},
    [Symbol.dispose]() {},
  }) as unknown as NodeChildProcess.ChildProcess;

  Object.defineProperty(handle, "killed", { configurable: true, get: () => killed });
  Object.defineProperty(handle, "exitCode", { configurable: true, get: () => exitCode });

  return {
    handle,
    killSignals,
    finish: (code) => {
      exitCode = code;
      emitter.emit("exit", code, null);
      emitter.emit("close", code, null);
    },
    fail: (error) => emitter.emit("error", error),
  };
}

function claudeSpawnOptions(environment: NodeJS.ProcessEnv = {}): ClaudeSpawnOptions {
  return {
    command: "C:\\Program Files\\Claude\\claude.exe",
    args: ["--output-format", "stream-json"],
    cwd: "C:\\工作区\\project",
    env: environment,
    signal: new AbortController().signal,
  };
}

describe("Windows Claude capability process ownership", () => {
  it("reaps the exact spawned PID tree and leaves unrelated processes alone", async () => {
    const abortController = new AbortController();
    const root = makeFakeProcess(4201);
    const taskkill = makeFakeProcess(4301);
    const taskkillInvocations: Array<{
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly environment: NodeJS.ProcessEnv;
    }> = [];
    let probeDescendantsAlive = true;
    let unrelatedProcessAlive = true;

    const dependencies: ClaudeCapabilitiesProcessDependencies = {
      spawnClaude: () => root.handle,
      spawnTaskkill: (input) => {
        taskkillInvocations.push(input);
        queueMicrotask(() => {
          probeDescendantsAlive = false;
          root.finish(1);
          taskkill.finish(0);
        });
        return taskkill.handle;
      },
    };
    const controller = makeClaudeCapabilitiesProcessController({
      abortController,
      dependencies,
    });

    controller.spawn(claudeSpawnOptions({ SystemRoot: "C:\\Windows" }));
    abortController.abort();
    await Promise.all([controller.reap(), controller.reap()]);

    assert.deepStrictEqual(taskkillInvocations, [
      {
        command: "C:\\Windows\\System32\\taskkill.exe",
        args: ["/PID", "4201", "/T", "/F"],
        environment: { SystemRoot: "C:\\Windows" },
      },
    ]);
    assert.equal(probeDescendantsAlive, false);
    assert.equal(unrelatedProcessAlive, true);
    assert.deepStrictEqual(root.killSignals, []);
  });

  it("falls back to the exact root handle when taskkill is missing", async () => {
    const abortController = new AbortController();
    const root = makeFakeProcess(5201);
    const controller = makeClaudeCapabilitiesProcessController({
      abortController,
      dependencies: {
        spawnClaude: () => root.handle,
        spawnTaskkill: () => {
          throw new Error("ENOENT");
        },
      },
    });

    controller.spawn(claudeSpawnOptions());
    abortController.abort();
    await controller.reap();

    assert.deepStrictEqual(root.killSignals, ["SIGKILL"]);
  });

  it("falls back after access denial and preserves Unicode taskkill paths", async () => {
    const abortController = new AbortController();
    const root = makeFakeProcess(6201);
    const taskkill = makeFakeProcess(6301);
    const commands: Array<string> = [];
    const controller = makeClaudeCapabilitiesProcessController({
      abortController,
      dependencies: {
        spawnClaude: () => root.handle,
        spawnTaskkill: (input) => {
          commands.push(input.command);
          queueMicrotask(() => taskkill.finish(5));
          return taskkill.handle;
        },
      },
    });

    controller.spawn(claudeSpawnOptions({ SystemRoot: "C:\\系统\\Windows" }));
    await controller.reap();

    assert.deepStrictEqual(commands, ["C:\\系统\\Windows\\System32\\taskkill.exe"]);
    assert.deepStrictEqual(root.killSignals, ["SIGKILL"]);
  });

  it("uses bounded cleanup when the SDK invokes its process kill hook", async () => {
    const abortController = new AbortController();
    const root = makeFakeProcess(6701);
    const taskkill = makeFakeProcess(6801);
    const receipts: Array<string> = [];
    const controller = makeClaudeCapabilitiesProcessController({
      abortController,
      dependencies: {
        spawnClaude: () => root.handle,
        spawnTaskkill: ({ args }) => {
          receipts.push(args.join(" "));
          queueMicrotask(() => taskkill.finish(0));
          return taskkill.handle;
        },
      },
    });

    const process = controller.spawn(claudeSpawnOptions());
    process.kill("SIGKILL");
    await controller.reap();

    assert.deepStrictEqual(receipts, ["/PID 6701 /T /F"]);
  });

  it("does not target a PID after the owned handle has exited", async () => {
    const abortController = new AbortController();
    const root = makeFakeProcess(6901);
    let taskkillCalls = 0;
    const controller = makeClaudeCapabilitiesProcessController({
      abortController,
      dependencies: {
        spawnClaude: () => root.handle,
        spawnTaskkill: () => {
          taskkillCalls += 1;
          return makeFakeProcess(6902).handle;
        },
      },
    });

    controller.spawn(claudeSpawnOptions());
    root.finish(1);
    await controller.reap();

    assert.equal(taskkillCalls, 0);
  });

  it("owns repeated concurrent probes independently", async () => {
    const receipts: Array<number> = [];

    await Promise.all(
      [7201, 7202, 7203].map(async (pid) => {
        const abortController = new AbortController();
        const root = makeFakeProcess(pid);
        const taskkill = makeFakeProcess(pid + 100);
        const controller = makeClaudeCapabilitiesProcessController({
          abortController,
          dependencies: {
            spawnClaude: () => root.handle,
            spawnTaskkill: ({ args }) => {
              assert.deepStrictEqual(args, ["/PID", String(pid), "/T", "/F"]);
              queueMicrotask(() => {
                receipts.push(pid);
                root.finish(1);
                taskkill.finish(0);
              });
              return taskkill.handle;
            },
          },
        });
        controller.spawn(claudeSpawnOptions());
        abortController.abort();
        await controller.reap();
      }),
    );

    assert.deepStrictEqual(receipts.sort(), [7201, 7202, 7203]);
  });
});
