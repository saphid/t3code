// @effect-diagnostics nodeBuiltinImport:off - Tests server startup without launching an application or browser.
import type * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";
import { afterEach, expect, it, vi } from "@effect/vitest";

import { stopServer, waitForServerPairingUrl } from "./serverProcess.ts";

function serverChild() {
  const child = Object.assign(new NodeEvents.EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new NodeStream.PassThrough(),
    stderr: new NodeStream.PassThrough(),
    kill: vi.fn(() => true),
  });
  return { child, process: child as unknown as NodeChildProcess.ChildProcess };
}

afterEach(() => vi.useRealTimers());

it("kills an unready server and waits for it to close before rejecting startup", async () => {
  vi.useFakeTimers();
  const { child, process } = serverChild();
  let settled = false;
  const outcome = waitForServerPairingUrl(process).catch((error: Error) => {
    settled = true;
    return error;
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(settled).toBe(false);
  child.emit("close", null, "SIGKILL");
  expect(await outcome).toMatchObject({ message: expect.stringContaining("within 60s") });
});

it("keeps a ready server alive and clears the startup timeout", async () => {
  vi.useFakeTimers();
  const { child, process } = serverChild();
  const ready = waitForServerPairingUrl(process);
  child.stdout.write('pairingUrl: "http://127.0.0.1:1234/pair"\n');
  expect(await ready).toBe("http://127.0.0.1:1234/pair");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.listenerCount("error")).toBe(0);
});

it("reports an early server exit without signaling an exited process", async () => {
  const { child, process } = serverChild();
  const outcome = waitForServerPairingUrl(process).catch((error: Error) => error);
  child.exitCode = 1;
  child.emit("exit", 1);
  expect(await outcome).toMatchObject({ message: expect.stringContaining("exited with code 1") });
  expect(child.kill).not.toHaveBeenCalled();
});

it("reports a spawn error without waiting for a process that never started", async () => {
  const { child, process } = serverChild();
  delete (child as { pid?: number }).pid;
  const outcome = waitForServerPairingUrl(process).catch((error: Error) => error);
  const error = new Error("spawn failed");
  child.emit("error", error);
  expect(await outcome).toBe(error);
  expect(child.kill).not.toHaveBeenCalled();
});

it("escalates only its captured server child and waits for close", async () => {
  vi.useFakeTimers();
  const { child, process } = serverChild();
  const stopped = stopServer(process);
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  await vi.advanceTimersByTimeAsync(500);
  expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
  child.signalCode = "SIGKILL";
  child.emit("close", null, "SIGKILL");
  await stopped;
  await stopServer(process);
  expect(child.kill).toHaveBeenCalledTimes(2);
});
