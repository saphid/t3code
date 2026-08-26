// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalTimers:off - Black-box process test for the standalone scheduler.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHTTP from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";

const children: Array<NodeChildProcess.ChildProcess> = [];
const servers: Array<NodeHTTP.Server> = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function waitForLine(child: NodeChildProcess.ChildProcess, pattern: RegExp): Promise<string> {
  return new Promise((resolve, reject) => {
    let pending = "";
    const onData = (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const match = pattern.exec(pending);
      if (match === null) return;
      child.stdout?.off("data", onData);
      resolve(match[0]);
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => reject(new Error(`scheduler exited ${code}: ${pending}`)));
  });
}

async function post(port: number, token: string, path: string, body: object) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function get(port: number, token: string, path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("fleet scheduler", () => {
  it("claims newest first, prevents duplicate leases, and refreshes a live registry", async () => {
    const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3perf-fleet-"));
    const tokenBytes = Buffer.from("test-token-that-is-at-least-thirty-two-characters");
    const token = tokenBytes.toString("hex");
    const tokenPath = NodePath.join(temporary, "token");
    await NodeFSP.writeFile(tokenPath, tokenBytes);
    let registry: {
      versions: Record<string, object>;
      time: Record<string, string>;
    } = {
      versions: { "0.0.1-nightly.1": {}, "0.0.1-nightly.2": {} },
      time: {
        "0.0.1-nightly.1": "2026-08-20T00:00:00.000Z",
        "0.0.1-nightly.2": "2026-08-21T00:00:00.000Z",
      },
    };
    const registryServer = NodeHTTP.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(registry));
    });
    servers.push(registryServer);
    await new Promise<void>((resolve) => registryServer.listen(0, "127.0.0.1", resolve));
    const registryAddress = registryServer.address();
    if (registryAddress === null || typeof registryAddress === "string") throw new Error("no port");

    const scheduler = NodeChildProcess.spawn(
      process.execPath,
      [
        "src/fleetScheduler.ts",
        "--db",
        NodePath.join(temporary, "fleet.sqlite"),
        "--results",
        NodePath.join(temporary, "results"),
        "--token-file",
        tokenPath,
        "--listen",
        "127.0.0.1",
        "--port",
        "0",
        "--registry-url",
        `http://127.0.0.1:${registryAddress.port}`,
        "--refresh-ms",
        "100",
        "--since-days",
        "365",
      ],
      { cwd: NodePath.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(scheduler);
    const listening = await waitForLine(scheduler, /scheduler listening on 127\.0\.0\.1:(\d+)/);
    const schedulerPort = Number(/:(\d+)$/.exec(listening)?.[1]);
    const contract = "t3perf-v1-node24-playwright1.60";
    const first = await post(schedulerPort, token, "/v1/claim", {
      workerId: "lxso1",
      contract,
    });
    expect(first.status).toBe(200);
    expect((first.body.lease as { version: string }).version).toBe("0.0.1-nightly.2");

    const second = await post(schedulerPort, token, "/v1/claim", {
      workerId: "lxso2",
      contract,
    });
    expect((second.body.lease as { version: string }).version).toBe("0.0.1-nightly.1");
    const empty = await post(schedulerPort, token, "/v1/claim", {
      workerId: "lxso3",
      contract,
    });
    expect(empty.body.lease).toBeNull();

    registry = {
      versions: {
        ...registry.versions,
        "0.0.1-nightly.3": {},
      },
      time: {
        ...registry.time,
        "0.0.1-nightly.3": "2026-08-22T00:00:00.000Z",
      },
    };
    await waitForLine(scheduler, /registry newest=0\.0\.1-nightly\.3/);
    const jumped = await post(schedulerPort, token, "/v1/claim", {
      workerId: "lxso3",
      contract,
    });
    expect((jumped.body.lease as { version: string }).version).toBe("0.0.1-nightly.3");

    const firstLease = first.body.lease as { leaseId: string; version: string };
    await post(schedulerPort, token, "/v1/fail", {
      workerId: "lxso1",
      contract,
      leaseId: firstLease.leaseId,
      version: firstLease.version,
      error: "recoverable test failure",
    });
    const recovered = await post(schedulerPort, token, "/v1/claim", {
      workerId: "lxso1",
      contract,
    });
    expect((recovered.body.lease as { version: string }).version).toBe("0.0.1-nightly.2");
  });

  it("durably drains claims while an active lease renews and settles, then explicitly reopens", async () => {
    const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3perf-drain-"));
    const tokenBytes = Buffer.from("test-token-that-is-at-least-thirty-two-characters");
    const token = tokenBytes.toString("hex");
    const tokenPath = NodePath.join(temporary, "token");
    await NodeFSP.writeFile(tokenPath, tokenBytes);
    const registryServer = NodeHTTP.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          versions: { "0.0.1-nightly.1": {}, "0.0.1-nightly.2": {} },
          time: {
            "0.0.1-nightly.1": "2026-08-20T00:00:00.000Z",
            "0.0.1-nightly.2": "2026-08-21T00:00:00.000Z",
          },
        }),
      );
    });
    servers.push(registryServer);
    await new Promise<void>((resolve) => registryServer.listen(0, "127.0.0.1", resolve));
    const address = registryServer.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const database = NodePath.join(temporary, "fleet.sqlite");
    const schedulerArguments = [
      "src/fleetScheduler.ts",
      "--db",
      database,
      "--results",
      NodePath.join(temporary, "results"),
      "--token-file",
      tokenPath,
      "--listen",
      "127.0.0.1",
      "--port",
      "0",
      "--registry-url",
      `http://127.0.0.1:${address.port}`,
      "--refresh-ms",
      "10800000",
      "--since-days",
      "365",
    ];
    let scheduler = NodeChildProcess.spawn(process.execPath, schedulerArguments, {
      cwd: NodePath.resolve(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(scheduler);
    let listening = await waitForLine(scheduler, /scheduler listening on 127\.0\.0\.1:(\d+)/);
    let port = Number(/:(\d+)$/.exec(listening)?.[1]);
    const contract = "t3perf-v1-node24-playwright1.60";
    const claimed = await post(port, token, "/v1/claim", { workerId: "lxso1", contract });
    const lease = claimed.body.lease as { leaseId: string; version: string };

    const closed = await post(port, token, "/v1/claims/close", {
      workerId: "operator",
      contract,
      reason: "Gate 2 cutover",
    });
    expect(closed.status).toBe(200);
    expect(closed.body.transition).toMatchObject({
      from: "open",
      to: "closed",
      reason: "Gate 2 cutover",
    });
    expect(closed.body.activeLeaseCount).toBe(1);

    const stopped = new Promise<void>((resolve) => scheduler.once("exit", () => resolve()));
    scheduler.kill("SIGTERM");
    await stopped;
    children.splice(children.indexOf(scheduler), 1);
    scheduler = NodeChildProcess.spawn(process.execPath, schedulerArguments, {
      cwd: NodePath.resolve(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(scheduler);
    listening = await waitForLine(scheduler, /scheduler listening on 127\.0\.0\.1:(\d+)/);
    port = Number(/:(\d+)$/.exec(listening)?.[1]);
    const persisted = await get(port, token, "/v1/state");
    expect(persisted.body).toMatchObject({
      claimGate: { state: "closed", reason: "Gate 2 cutover" },
      activeLeaseCount: 1,
    });
    const blocked = await post(port, token, "/v1/claim", { workerId: "lxso2", contract });
    expect(blocked.body).toMatchObject({ lease: null, scheduler: "draining" });

    const renewed = await post(port, token, "/v1/renew", {
      workerId: "lxso1",
      contract,
      leaseId: lease.leaseId,
      version: lease.version,
    });
    expect(renewed.body.ok).toBe(true);
    const completed = await post(port, token, "/v1/complete", {
      workerId: "lxso1",
      contract,
      leaseId: lease.leaseId,
      version: lease.version,
      result: { results: [{ scenario: "startup" }] },
    });
    expect(completed.body.ok).toBe(true);
    const drained = await get(port, token, "/v1/state");
    expect(drained.body).toMatchObject({
      claimGate: { state: "closed", reason: "Gate 2 cutover" },
      activeLeaseCount: 0,
    });

    const reopened = await post(port, token, "/v1/claims/open", {
      workerId: "operator",
      contract,
      reason: "Cutover rolled back",
    });
    expect(reopened.body.transition).toMatchObject({
      from: "closed",
      to: "open",
      reason: "Cutover rolled back",
    });
    const next = await post(port, token, "/v1/claim", { workerId: "lxso2", contract });
    expect((next.body.lease as { version: string }).version).toBe("0.0.1-nightly.1");
  });
});
