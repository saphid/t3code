// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Exercises a real localhost TCP relay.
import * as NodeNet from "node:net";
import { afterEach, describe, expect, it } from "@effect/vitest";

import { NetShaper } from "./netShaper.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = NodeNet.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as NodeNet.AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
}

function startEcho(port: number): NodeNet.Server {
  const server = NodeNet.createServer((socket) => {
    socket.on("error", () => socket.destroy());
    socket.pipe(socket);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function roundTrip(port: number, payload: string): Promise<number> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const socket = NodeNet.connect(port, "127.0.0.1", () => socket.write(payload));
    socket.once("data", () => {
      socket.destroy();
      resolve(Date.now() - startedAt);
    });
    socket.once("error", reject);
  });
}

describe("NetShaper", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("relays traffic unshaped by default", async () => {
    const upstreamPort = await freePort();
    const relayPort = await freePort();
    const echo = startEcho(upstreamPort);
    const shaper = new NetShaper();
    await shaper.listen(relayPort, upstreamPort);
    cleanups.push(() => echo.close(), () => void shaper.close());
    expect(await roundTrip(relayPort, "hello")).toBeLessThan(200);
  });

  it("adds latency in both directions", async () => {
    const upstreamPort = await freePort();
    const relayPort = await freePort();
    const echo = startEcho(upstreamPort);
    const shaper = new NetShaper();
    await shaper.listen(relayPort, upstreamPort);
    cleanups.push(() => echo.close(), () => void shaper.close());
    shaper.set({ latencyMs: 150 });
    // One-way delay applies per direction: request + echo >= ~300ms.
    expect(await roundTrip(relayPort, "hello")).toBeGreaterThanOrEqual(280);
  });

  it("drops connections with a reset", async () => {
    const upstreamPort = await freePort();
    const relayPort = await freePort();
    const echo = startEcho(upstreamPort);
    const shaper = new NetShaper();
    await shaper.listen(relayPort, upstreamPort);
    cleanups.push(() => echo.close(), () => void shaper.close());
    const errored = new Promise<string>((resolve) => {
      const socket = NodeNet.connect(relayPort, "127.0.0.1", () => socket.write("x"));
      socket.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "ERR"));
      socket.on("close", () => resolve("CLOSED"));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    shaper.dropAll({ rst: true });
    expect(await errored).toBeTruthy();
  });

  it("refuses new connections when asked", async () => {
    const upstreamPort = await freePort();
    const relayPort = await freePort();
    const echo = startEcho(upstreamPort);
    const shaper = new NetShaper();
    await shaper.listen(relayPort, upstreamPort);
    cleanups.push(() => echo.close(), () => void shaper.close());
    shaper.refuseNewConnections(true);
    const outcome = await new Promise<string>((resolve) => {
      const socket = NodeNet.connect(relayPort, "127.0.0.1");
      socket.once("error", () => resolve("closed"));
      socket.once("close", () => resolve("closed"));
      socket.once("data", () => resolve("data"));
    });
    expect(outcome).toBe("closed");
  });
});
