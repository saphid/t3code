// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off globalDate:off globalDateInEffect:off globalTimers:off globalTimersInEffect:off preferSchemaOverJson:off -- Native socket test boundary: real HTTP/WS against the loopback hub, packet bytes are raw JSON.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { get, ServerResponse } from "node:http";
import { WebSocket } from "ws";
import { describe, expect, it, vi } from "vite-plus/test";

import { BrowserFrameHub, layer as BrowserFrameHubLayer } from "./FrameHub.ts";
import * as PreviewManager from "./Manager.ts";

const tuple = {
  environmentId: "env-a",
  threadId: "thread-a",
  serverEpoch: "epoch-1",
  tabId: "tab-1",
};
const runtimeTabId = JSON.stringify([
  tuple.environmentId,
  tuple.threadId,
  tuple.serverEpoch,
  tuple.tabId,
]);

interface ManagerStub {
  readonly dispatched: Array<{ leaseId: string; event: unknown; viewportCss: unknown }>;
  readonly released: string[];
  readonly heldReleased: string[];
  readonly started: string[];
  readonly stopped: string[];
  readonly pushFrame: (frame: PreviewManager.RemoteLiveFrame) => void;
}

const makeManagerStub = (
  edit?: (manager: Record<string, unknown>, stub: ManagerStub) => void,
): {
  readonly stub: ManagerStub;
  readonly layer: Layer.Layer<PreviewManager.PreviewManager>;
} => {
  let pushFrame: ManagerStub["pushFrame"] = () => {};
  const dispatched: ManagerStub["dispatched"] = [];
  const released: string[] = [];
  const heldReleased: string[] = [];
  const started: string[] = [];
  const stopped: string[] = [];
  const manager = {
    subscribeRemoteFrames: (
      listener: (frame: PreviewManager.RemoteLiveFrame) => Effect.Effect<void>,
    ) =>
      Effect.sync(() => {
        pushFrame = (frame) => Effect.runSync(listener(frame));
      }),
    remoteFrameSessions: () =>
      Effect.succeed([
        {
          ...tuple,
          runtimeTabId,
          engineGeneration: "gen-1",
          viewportCss: { width: 100, height: 100 },
          streaming: false,
        },
      ]),
    remoteFrameConfig: () =>
      Effect.succeed({
        engineGeneration: "gen-1",
        viewportCss: { width: 100, height: 100 },
        zoomFactor: 1,
      }),
    captureFrameJpeg: () =>
      Effect.succeed({
        jpeg: Buffer.from("ffd8ffe0-jpeg-bytes"),
        width: 100,
        height: 100,
        engineGeneration: "gen-1",
        viewportCss: { width: 100, height: 100 },
        geometryKey: PreviewManager.remoteFrameGeometryKey("gen-1", { width: 100, height: 100 }, 1),
      }),
    startRemoteCapture: (tabId: string) =>
      Effect.sync(() => {
        started.push(tabId);
      }),
    stopRemoteCapture: (tabId: string) =>
      Effect.sync(() => {
        stopped.push(tabId);
      }),
    dispatchRemoteInput: (
      _tabId: string,
      leaseId: string,
      _engineGeneration: string,
      event: unknown,
      viewportCss: unknown,
    ) =>
      Effect.sync(() => {
        dispatched.push({ leaseId, event, viewportCss });
      }),
    releaseRemoteInput: (tabId: string, _leaseId: string) =>
      Effect.sync(() => {
        released.push(tabId);
        return { attempted: 0, failed: 0 };
      }),
    releaseRemoteInputHeld: (tabId: string) =>
      Effect.sync(() => {
        heldReleased.push(tabId);
        return { attempted: 0, failed: 0 };
      }),
  };
  const stub: ManagerStub = {
    dispatched,
    released,
    heldReleased,
    started,
    stopped,
    get pushFrame() {
      return pushFrame;
    },
  };
  edit?.(manager as unknown as Record<string, unknown>, stub);
  return {
    stub,
    layer: Layer.succeed(
      PreviewManager.PreviewManager,
      manager as unknown as PreviewManager.PreviewManager["Service"],
    ),
  };
};

const authed = (origin: string, path: string, secret: string, extra = "") =>
  fetch(`${origin}${path}?x-t3-hub-auth=${secret}${extra}`);

const wsUrl = (origin: string, secret: string, params: Record<string, string>): string =>
  `${origin.replace("http", "ws")}/sessions/${encodeURIComponent(tuple.tabId)}/input?` +
  new URLSearchParams({ "x-t3-hub-auth": secret, ...params });

const baseInputParams = {
  "x-t3-session": runtimeTabId,
  "x-t3-lease": "lease-a",
  "x-t3-lease-expires": String(Date.now() + 60_000),
  "x-t3-engine-generation": "gen-1",
};

/** Wait for the next socket notice of a given type — `geometry` notices can interleave. */
const nextNotice = (ws: WebSocket, type: string): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const onMessage = (data: unknown): void => {
      const notice = JSON.parse(String(data)) as Record<string, unknown>;
      if (notice.type === type) {
        ws.off("message", onMessage);
        resolve(notice);
      }
    };
    ws.on("message", onMessage);
    ws.once("error", reject);
    ws.once("close", () => reject(new Error(`socket closed before ${type} notice`)));
  });

const waitClosed = (ws: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve, reject) => {
    ws.once("error", reject);
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });

const connectInput = (
  origin: string,
  secret: string,
  params: Record<string, string>,
): Promise<{ ws: WebSocket; bound: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(origin, secret, params));
    const onMessage = (data: unknown): void => {
      const notice = JSON.parse(String(data)) as Record<string, unknown>;
      if (notice.type === "bound") {
        ws.off("message", onMessage);
        resolve({ ws, bound: notice });
      }
    };
    ws.on("message", onMessage);
    ws.once("error", reject);
    ws.once("close", () => reject(new Error("socket closed before bound")));
  });

// Notices can arrive in the same TCP segment as the upgrade response on
// loopback — buffer every message from construction so none are missed.
const noticeBuffers = new WeakMap<WebSocket, Array<Record<string, unknown>>>();
const noticeWaiters = new WeakMap<
  WebSocket,
  Array<{ type: string; resolve: (notice: Record<string, unknown>) => void }>
>();

const openInput = (
  origin: string,
  secret: string,
  params: Record<string, string>,
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(origin, secret, params));
    noticeBuffers.set(ws, []);
    noticeWaiters.set(ws, []);
    ws.on("message", (data) => {
      const notice = JSON.parse(String(data)) as Record<string, unknown>;
      const waiters = noticeWaiters.get(ws) ?? [];
      const index = waiters.findIndex((waiter) => waiter.type === notice.type);
      if (index >= 0) {
        waiters.splice(index, 1)[0]!.resolve(notice);
      } else {
        noticeBuffers.get(ws)!.push(notice);
      }
    });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) =>
      reject(new Error(`upgrade rejected: ${res.statusCode}`)),
    );
  });

const waitNotice = (
  ws: WebSocket,
  type: string,
  timeoutMs = 4000,
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const buffered = noticeBuffers.get(ws) ?? [];
    const index = buffered.findIndex((notice) => notice.type === type);
    if (index >= 0) {
      resolve(buffered.splice(index, 1)[0]!);
      return;
    }
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    const waiters = noticeWaiters.get(ws)!;
    waiters.push({
      type,
      resolve: (notice) => {
        clearTimeout(timer);
        resolve(notice);
      },
    });
    ws.once("close", (code, reason) =>
      reject(new Error(`closed ${code} ${reason.toString()} before ${type}`)),
    );
  });

const streamUrl = (origin: string, secret: string, generation = "gen-1"): string =>
  `${origin}/sessions/${encodeURIComponent(tuple.tabId)}/stream.mjpeg?` +
  new URLSearchParams({
    "x-t3-hub-auth": secret,
    "x-t3-session": runtimeTabId,
    "x-t3-engine-generation": generation,
  });

const liveFrame = (generation = "gen-1", seq = 8, width = 100): PreviewManager.RemoteLiveFrame => ({
  tabId: runtimeTabId,
  seq,
  jpeg: Buffer.from(`jpeg-${seq}`),
  width,
  height: 100,
  engineGeneration: generation,
  geometryKey: PreviewManager.remoteFrameGeometryKey(generation, { width, height: 100 }, 1),
});

describe("BrowserFrameHub", () => {
  it("rejects unauthenticated requests and hostile upgrade origins", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const unauthed = await fetch(`${hub.origin}/sessions`);
            expect(unauthed.status).toBe(403);
            const wrong = await fetch(`${hub.origin}/sessions`, {
              headers: { "x-t3-hub-auth": "forged" },
            });
            expect(wrong.status).toBe(403);
            const health = await fetch(`${hub.origin}/health`, {
              headers: { "x-t3-hub-auth": hub.secret },
            });
            expect(health.status).toBe(200);
            expect(await health.json()).toEqual({ service: "t3.browser-frame-hub" });

            // A hostile origin cannot bypass the secret on upgrade either.
            await expect(
              new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(wsUrl(hub.origin, "forged", baseInputParams), {
                  origin: "https://untrusted.example",
                });
                ws.once("open", () => resolve());
                ws.once("error", reject);
                ws.once("unexpected-response", (_req, res) =>
                  res.statusCode === 403 ? reject(new Error("denied")) : reject(new Error("other")),
                );
              }),
            ).rejects.toThrow();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("enumerates sessions only behind the secret and fences the tuple", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const sessions = await authed(hub.origin, "/sessions", hub.secret);
            expect(sessions.status).toBe(200);
            const body = (await sessions.json()) as Array<{ tabId: string }>;
            expect(body).toHaveLength(1);
            expect(body[0]?.tabId).toBe("tab-1");

            // A forged session binding — path tab does not match the asserted
            // tuple — is denied before any session data is read.
            const mismatched = await authed(
              hub.origin,
              "/sessions/other-tab/config",
              hub.secret,
              `&x-t3-session=${encodeURIComponent(runtimeTabId)}`,
            );
            expect(mismatched.status).toBe(403);
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("binds input sockets exclusively and fences stale seq/geometry", async () => {
    const { stub, layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const first = await connectInput(hub.origin, hub.secret, baseInputParams);
            expect(first.bound.type).toBe("bound");
            expect(first.bound.leaseId).toBe("lease-a");

            first.ws.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "hi" } }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(1));
            expect(stub.dispatched[0]?.leaseId).toBe("lease-a");

            // Replay of seq 1 is rejected.
            const replayed = nextNotice(first.ws, "rejected");
            first.ws.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "no" } }),
            );
            expect(await replayed).toMatchObject({ type: "rejected", seq: 1, reason: "replay" });
            expect(stub.dispatched).toHaveLength(1);

            // Stale geometry is rejected.
            const stale = nextNotice(first.ws, "rejected");
            first.ws.send(
              JSON.stringify({ seq: 2, geometrySeq: 99, event: { type: "text", text: "no" } }),
            );
            expect(await stale).toMatchObject({
              type: "rejected",
              seq: 2,
              reason: "stale-geometry",
            });
            expect(stub.dispatched).toHaveLength(1);

            // A second lease supersedes the first: the first socket closes and
            // its held input is released BEFORE the successor binds.
            const firstClosed = waitClosed(first.ws);
            const second = await connectInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-b",
            });
            expect(await firstClosed).toMatchObject({ code: 4000 });
            expect(second.bound.leaseId).toBe("lease-b");
            expect(stub.released).toHaveLength(1);

            // The dead socket's late packets are ignored.
            first.ws.send(
              JSON.stringify({ seq: 3, geometrySeq: 0, event: { type: "text", text: "x" } }),
            );
            second.ws.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "ok" } }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(2));
            expect(stub.dispatched[1]?.leaseId).toBe("lease-b");

            first.ws.terminate();
            second.ws.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("refuses an input socket bound to a stale engine generation", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const ws = new WebSocket(
              wsUrl(hub.origin, hub.secret, {
                ...baseInputParams,
                "x-t3-engine-generation": "gen-0",
              }),
            );
            const closed = await waitClosed(ws);
            expect(closed.code).toBe(4000);
            expect(closed.reason).toBe("replaced");
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("ends input sockets at their lease expiry", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const ws = new WebSocket(
              wsUrl(hub.origin, hub.secret, {
                ...baseInputParams,
                "x-t3-lease-expires": String(Date.now() + 50),
              }),
            );
            const closed = await waitClosed(ws);
            expect(closed.code).toBe(4000);
            expect(closed.reason).toBe("expired");
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("streams seeded frames to new viewers and stops capture on the last close", async () => {
    const { stub, layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const url =
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/stream.mjpeg?` +
              new URLSearchParams({
                "x-t3-hub-auth": hub.secret,
                "x-t3-session": runtimeTabId,
              });
            const res = await fetch(url);
            expect(res.status).toBe(200);
            expect(res.headers.get("content-type")).toContain("multipart/x-mixed-replace");
            // Seeded from captureFrameJpeg — the first part arrives without a
            // pushed frame.
            const reader = res.body!.getReader();
            const first = await reader.read();
            expect(first.done).toBe(false);
            const text = Buffer.from(first.value!).toString("latin1");
            expect(text).toContain("--t3frame");
            expect(text).toContain("X-Frame-Seq");
            await vi.waitFor(() => expect(stub.started).toContain(runtimeTabId));

            // A pushed frame reaches the stream.
            stub.pushFrame({
              tabId: runtimeTabId,
              seq: 7,
              jpeg: Buffer.from("jpeg-frame-7"),
              width: 100,
              height: 100,
              engineGeneration: "gen-1",
              geometryKey: PreviewManager.remoteFrameGeometryKey(
                "gen-1",
                { width: 100, height: 100 },
                1,
              ),
            });
            const pushed = await reader.read();
            expect(Buffer.from(pushed.value!).toString("latin1")).toContain("X-Frame-Seq: 7");

            await reader.cancel();
            await vi.waitFor(() => expect(stub.stopped).toContain(runtimeTabId));
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("lets only the last pending candidate bind while incumbent cleanup is blocked", async () => {
    let finishCleanup: (() => void) | null = null;
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const { stub, layer: managerLayer } = makeManagerStub((manager) => {
      manager.releaseRemoteInput = () =>
        Effect.promise(async () => {
          await cleanupGate;
          return { attempted: 0, failed: 0 };
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            // A binds and goes live.
            const wsA = await openInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-a",
            });
            const boundA = await waitNotice(wsA, "bound");
            expect(boundA.leaseId).toBe("lease-a");
            const closedA = waitClosed(wsA);
            wsA.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "a" } }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(1));

            // B upgrades and parks; C upgrades and supersedes B while A's
            // cleanup is still blocked.
            const wsB = await openInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-b",
            });
            const closedB = waitClosed(wsB);
            const wsC = await openInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-c",
            });
            // Let both upgrade handlers reach the parked state.
            await new Promise((resolve) => setTimeout(resolve, 300));
            expect(await closedB).toMatchObject({ code: 4000, reason: "superseded" });

            finishCleanup!();
            expect(await closedA).toMatchObject({ code: 4000 });
            const boundC = await waitNotice(wsC, "bound");
            expect(boundC.leaseId).toBe("lease-c");

            wsC.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "c" } }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(2));
            const leaseIds = stub.dispatched.map((entry) => entry.leaseId);
            expect(leaseIds).not.toContain("lease-b");
            expect(leaseIds).toContain("lease-c");
            wsB.terminate();
            wsA.terminate();
            wsC.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("binds only the newest candidate when one arrives during the pending bind's config read", async () => {
    let enterRelease: (() => void) | null = null;
    let finishRelease: (() => void) | null = null;
    let bindConfigEntered: (() => void) | null = null;
    let releaseBindConfig: (() => void) | null = null;
    const enteredRelease = new Promise<void>((resolve) => {
      enterRelease = resolve;
    });
    const releaseGate = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const bindConfigStarted = new Promise<void>((resolve) => {
      bindConfigEntered = resolve;
    });
    const bindConfigGate = new Promise<void>((resolve) => {
      releaseBindConfig = resolve;
    });
    let armBindGate = false;
    let bindGateConsumed = false;
    const { stub, layer: managerLayer } = makeManagerStub((manager) => {
      manager.releaseRemoteInput = () =>
        Effect.promise(async () => {
          enterRelease!();
          await releaseGate;
          return { attempted: 0, failed: 0 };
        });
      manager.remoteFrameConfig = () =>
        Effect.promise(async () => {
          // The first config read after the incumbent's release settles is
          // the pending candidate's own bind read — hold it so a newer
          // upgrade can arrive while the reservation is still in flight.
          if (armBindGate && !bindGateConsumed) {
            bindGateConsumed = true;
            bindConfigEntered!();
            await bindConfigGate;
          }
          return {
            engineGeneration: "gen-1",
            viewportCss: { width: 100, height: 100 },
            zoomFactor: 1,
          };
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const wsA = await openInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-a",
            });
            await waitNotice(wsA, "bound");
            const closedA = waitClosed(wsA);

            // B upgrades and parks behind A's gated cleanup.
            const wsB = await openInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-b",
            });
            await enteredRelease;
            const closedB = waitClosed(wsB);

            // Let A's cleanup settle; the first config read after that is
            // B's bind read — held open by the gate.
            armBindGate = true;
            finishRelease!();
            expect(await closedA).toMatchObject({ code: 4000 });
            await bindConfigStarted;

            // C arrives while B still holds the pending reservation
            // mid-read: it must supersede B, not bind a second owner.
            const wsC = await openInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-c",
            });
            const boundC = await waitNotice(wsC, "bound");
            expect(boundC.leaseId).toBe("lease-c");
            expect(await closedB).toMatchObject({ code: 4000, reason: "superseded" });

            // B's held config read settles now; B must not bind a second
            // owner alongside C.
            releaseBindConfig!();
            wsC.send(
              JSON.stringify({
                seq: 1,
                geometrySeq: boundC.geometrySeq ?? 0,
                event: { type: "text", text: "c" },
              }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(1));
            expect(stub.dispatched.map((entry) => entry.leaseId)).toEqual(["lease-c"]);
            expect(wsB.readyState).toBe(WebSocket.CLOSED);
            wsA.terminate();
            wsB.terminate();
            wsC.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("keeps the newer pending same-lease ticket when an older in-flight ticket arrives", async () => {
    let enterRelease: (() => void) | null = null;
    let finishRelease: (() => void) | null = null;
    const enteredRelease = new Promise<void>((resolve) => {
      enterRelease = resolve;
    });
    const releaseGate = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const { stub, layer: managerLayer } = makeManagerStub((manager, stubRef) => {
      manager.releaseRemoteInput = (tabId: string) =>
        Effect.promise(async () => {
          enterRelease!();
          await releaseGate;
          stubRef.released.push(tabId);
          return { attempted: 0, failed: 0 };
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const params = (ticketSeq: string) => ({
              ...baseInputParams,
              "x-t3-lease": "lease-a",
              "x-t3-ticket-seq": ticketSeq,
            });
            const wsA = await openInput(hub.origin, hub.secret, params("1"));
            await waitNotice(wsA, "bound");
            const closedA = waitClosed(wsA);

            // Ticket 3 upgrades and parks behind A's gated cleanup.
            const ws3 = await openInput(hub.origin, hub.secret, params("3"));
            await enteredRelease;

            // Ticket 2 — issued before 3 but arriving late — is older than
            // the newest accepted ticket: it binds as a shadow and must
            // not evict the parked 3.
            const ws2 = await openInput(hub.origin, hub.secret, params("2"));
            await waitNotice(ws2, "bound");
            finishRelease!();

            const bound3 = await waitNotice(ws3, "bound");
            expect(bound3.leaseId).toBe("lease-a");
            expect(await closedA).toMatchObject({ code: 4000 });
            ws3.send(
              JSON.stringify({
                seq: 1,
                geometrySeq: bound3.geometrySeq ?? 0,
                event: { type: "text", text: "three" },
              }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(1));

            // The shadow's close runs no lease release; the owner's does.
            ws2.close();
            await waitClosed(ws2);
            expect(stub.released).toHaveLength(1);
            ws3.close();
            await waitClosed(ws3);
            await vi.waitFor(() => expect(stub.released).toHaveLength(2));
            wsA.terminate();
            ws2.terminate();
            ws3.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("binds a same-lease older ticket as a shadow that cannot seize the slot", async () => {
    const { stub, layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const modern = await connectInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-a",
              "x-t3-ticket-seq": "2",
            });
            modern.ws.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "first" } }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(1));

            // Same lease, older ticketSeq: binds as a shadow — it may still
            // dispatch under the lease, but never displaces the incumbent and
            // never runs lease cleanup.
            const stale = await connectInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-a",
              "x-t3-ticket-seq": "1",
            });
            stale.ws.send(
              JSON.stringify({ seq: 1, geometrySeq: 0, event: { type: "text", text: "second" } }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(2));
            expect(modern.ws.readyState).toBe(WebSocket.OPEN);

            stale.ws.close();
            await waitClosed(stale.ws);
            // Shadow teardown released nothing.
            expect(stub.released).toHaveLength(0);
            modern.ws.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("flags cleanupIncomplete on the successor's bound notice when incumbent release fails", async () => {
    const { layer: managerLayer } = makeManagerStub((manager) => {
      manager.releaseRemoteInput = () => Effect.succeed({ attempted: 1, failed: 1 });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const first = await connectInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-a",
            });
            const firstClosed = waitClosed(first.ws);
            const second = await connectInput(hub.origin, hub.secret, {
              ...baseInputParams,
              "x-t3-lease": "lease-b",
            });
            expect(await firstClosed).toMatchObject({ code: 4000 });
            expect(second.bound.leaseId).toBe("lease-b");
            expect(second.bound.cleanupIncomplete).toBe(true);
            first.ws.terminate();
            second.ws.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("rejects excess input packets when the dispatch lane stalls", async () => {
    let accepted = 0;
    const { layer: managerLayer } = makeManagerStub((manager) => {
      manager.dispatchRemoteInput = () =>
        Effect.sync(() => {
          accepted += 1;
        }).pipe(Effect.andThen(Effect.never));
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const { ws } = await connectInput(hub.origin, hub.secret, baseInputParams);
            let now = Date.now();
            const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
            const rejected: number[] = [];
            ws.on("message", (data) => {
              const notice = JSON.parse(String(data)) as Record<string, unknown>;
              if (notice.type === "rejected") rejected.push(notice.seq as number);
            });
            try {
              for (let batch = 0; batch < 4; batch++) {
                now += 1001;
                for (let index = 0; index < 60; index++) {
                  ws.send(
                    JSON.stringify({
                      seq: batch * 60 + index + 1,
                      geometrySeq: 0,
                      event: { type: "text", text: "blocked" },
                    }),
                  );
                }
                const pong = new Promise((resolve) => ws.once("pong", resolve));
                ws.ping();
                await pong;
              }
              await vi.waitFor(() => expect(rejected.length).toBeGreaterThan(60));
              expect(accepted).toBe(1);
            } finally {
              clock.mockRestore();
              ws.terminate();
            }
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("rejects a queued packet whose geometry was replaced before dispatch", async () => {
    let width = 100;
    let releaseDispatch: (() => void) | null = null;
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const { stub, layer: managerLayer } = makeManagerStub((manager, stubRef) => {
      manager.remoteFrameConfig = () =>
        Effect.succeed({
          engineGeneration: "gen-1",
          viewportCss: { width, height: 100 },
          zoomFactor: 1,
        });
      manager.dispatchRemoteInput = (
        _tabId: string,
        leaseId: string,
        _engineGeneration: string,
        event: unknown,
        viewportCss: unknown,
      ) =>
        Effect.promise(async () => {
          stubRef.dispatched.push({ leaseId, event, viewportCss });
          // Hold the first dispatch inside the guest lane so the second
          // packet waits in the socket's queue across the geometry bump.
          if (stubRef.dispatched.length === 1) await dispatchGate;
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const ws = await openInput(hub.origin, hub.secret, baseInputParams);
            const bound = await waitNotice(ws, "bound");
            const geometrySeq = (bound.geometrySeq as number | undefined) ?? 0;
            ws.send(
              JSON.stringify({
                seq: 1,
                geometrySeq,
                event: { type: "text", text: "first" },
              }),
            );
            await vi.waitFor(() => expect(stub.dispatched).toHaveLength(1));

            // Admitted at the old geometry and parked behind the stalled
            // dispatch — the pong proves the hub consumed it before the bump.
            ws.send(
              JSON.stringify({
                seq: 2,
                geometrySeq,
                event: { type: "text", text: "second" },
              }),
            );
            const pong = new Promise((resolve) => ws.once("pong", resolve));
            ws.ping();
            await pong;

            width = 200;
            const config = await fetch(
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/config?` +
                new URLSearchParams({
                  "x-t3-hub-auth": hub.secret,
                  "x-t3-session": runtimeTabId,
                }),
            );
            expect((await config.json()).geometrySeq).toBe(geometrySeq + 1);

            const rejected = waitNotice(ws, "rejected");
            releaseDispatch!();
            expect(await rejected).toMatchObject({
              type: "rejected",
              seq: 2,
              reason: "stale-geometry",
            });
            // The stale packet never actuates — and never against the
            // replacement viewport.
            expect(stub.dispatched).toHaveLength(1);
            expect(stub.dispatched[0]?.viewportCss).toMatchObject({ width: 100 });
            ws.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("never lets an older config read move advertised geometry backward", async () => {
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { layer: managerLayer } = makeManagerStub((manager) => {
      manager.remoteFrameConfig = () => {
        calls += 1;
        if (calls === 1) {
          return Effect.promise(async () => {
            await firstGate;
            return {
              engineGeneration: "gen-1",
              viewportCss: { width: 100, height: 100 },
              zoomFactor: 1,
            };
          });
        }
        return Effect.succeed({
          engineGeneration: "gen-1",
          viewportCss: { width: 200, height: 100 },
          zoomFactor: 1,
        });
      };
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const configUrl =
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/config?` +
              new URLSearchParams({
                "x-t3-hub-auth": hub.secret,
                "x-t3-session": runtimeTabId,
              });
            const stale = fetch(configUrl);
            await vi.waitFor(() => expect(calls).toBe(1));
            const fresh = await fetch(configUrl);
            // The newer read completes first and wins: seq 0 advertises
            // 200x100.
            expect((await fresh.json()).geometrySeq).toBe(0);

            releaseFirst!();
            const staleResponse = await stale;
            // The superseded read re-issued behind the winner and answered
            // with the settled pair — it never republished its stale
            // geometry.
            expect(staleResponse.status).toBe(200);
            const staleConfig = (await staleResponse.json()) as {
              viewport: { cssWidth: number };
              geometrySeq: number;
            };
            expect(staleConfig.viewport.cssWidth).toBe(200);
            expect(staleConfig.geometrySeq).toBe(0);

            // Advertised geometry never regressed: had the stale read
            // applied, its 100x100 key would have bumped the seq again.
            const after = await fetch(configUrl);
            expect((await after.json()).geometrySeq).toBe(0);
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("closes a fragmented oversized packet with 1009 before parsing", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const { ws } = await connectInput(hub.origin, hub.secret, baseInputParams);
            const outcome = new Promise<Record<string, unknown>>((resolve) => {
              ws.once("close", (code) => resolve({ code }));
              ws.once("message", (data) => resolve(JSON.parse(String(data))));
            });
            ws.send("x".repeat(4096), { fin: false });
            ws.send("x".repeat(4097), { fin: true });
            expect(await outcome).toMatchObject({ code: 1009 });
            ws.terminate();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("refuses a snapshot on a stale engine generation", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const stale = await fetch(
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/snapshot?` +
                new URLSearchParams({
                  "x-t3-hub-auth": hub.secret,
                  "x-t3-session": runtimeTabId,
                  "x-t3-engine-generation": "gen-0",
                }),
            );
            expect(stale.status).toBe(409);
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("ends a live stream rather than emitting replacement-generation pixels", async () => {
    const { stub, layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const res = await fetch(streamUrl(hub.origin, hub.secret));
            expect(res.status).toBe(200);
            const reader = res.body!.getReader();
            await reader.read();
            stub.pushFrame(liveFrame("gen-2", 9));
            const next = await reader.read();
            expect(next.done).toBe(true);
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("never seeds a new-generation subscriber with cached old-generation pixels", async () => {
    let generation = "gen-1";
    const { stub, layer: managerLayer } = makeManagerStub((manager) => {
      manager.remoteFrameConfig = () =>
        Effect.succeed({
          engineGeneration: generation,
          viewportCss: { width: 100, height: 100 },
          zoomFactor: 1,
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const first = await fetch(streamUrl(hub.origin, hub.secret));
            const firstReader = first.body!.getReader();
            await firstReader.read();
            stub.pushFrame(liveFrame("gen-1"));
            await firstReader.read();
            generation = "gen-2";

            const second = await fetch(streamUrl(hub.origin, hub.secret, "gen-2"));
            const secondReader = second.body!.getReader();
            const seeded = await secondReader.read();
            await firstReader.cancel();
            await secondReader.cancel();
            expect(Buffer.from(seeded.value!).toString()).not.toContain(
              "X-Engine-Generation: gen-1",
            );
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("seeds a stream with the settled geometry when its capture spans a resize", async () => {
    let width = 100;
    let captureEntered: (() => void) | null = null;
    let releaseCapture: (() => void) | null = null;
    const captureStarted = new Promise<void>((resolve) => {
      captureEntered = resolve;
    });
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const { layer: managerLayer } = makeManagerStub((manager) => {
      manager.remoteFrameConfig = () =>
        Effect.succeed({
          engineGeneration: "gen-1",
          viewportCss: { width, height: 100 },
          zoomFactor: 1,
        });
      manager.captureFrameJpeg = () =>
        Effect.promise(async () => {
          captureEntered!();
          await captureGate;
          // The real Manager retries a capture that spans a resize and only
          // returns a self-consistent stamp — this is the settled post-resize
          // read, pixels and viewport agreeing at 200x100.
          return {
            jpeg: Buffer.from("resized-jpeg"),
            width: 200,
            height: 100,
            engineGeneration: "gen-1",
            viewportCss: { width: 200, height: 100 },
            geometryKey: PreviewManager.remoteFrameGeometryKey(
              "gen-1",
              { width: 200, height: 100 },
              1,
            ),
          };
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const response = fetch(streamUrl(hub.origin, hub.secret));
            // The seed capture runs after the stream's initial config read,
            // so reaching it proves seq 0 (100x100) was already advertised.
            await captureStarted;
            width = 200;
            const config = await fetch(
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/config?` +
                new URLSearchParams({
                  "x-t3-hub-auth": hub.secret,
                  "x-t3-session": runtimeTabId,
                }),
            );
            expect((await config.json()).geometrySeq).toBe(1);
            releaseCapture!();
            const res = await response;
            const reader = res.body!.getReader();
            const first = await reader.read();
            const part = Buffer.from(first.value!).toString("latin1");
            // The seed's settled geometry is the advertised one — a stale
            // pre-resize stamp would have bumped the seq again and moved the
            // advertised geometry backward.
            expect(part).toContain("X-Geometry-Seq: 1");
            expect(part).toContain("X-Frame-Width: 200");
            await reader.cancel();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("keeps a surviving viewer's capture when a cancelled startup settles late", async () => {
    let startCalls = 0;
    let releaseFirstStart: (() => void) | null = null;
    const firstStartGate = new Promise<void>((resolve) => {
      releaseFirstStart = resolve;
    });
    const { stub, layer: managerLayer } = makeManagerStub((manager, stubRef) => {
      manager.startRemoteCapture = (tabId: string, _remoteSeq?: number) => {
        startCalls += 1;
        if (startCalls === 1) {
          return Effect.promise(async () => {
            stubRef.started.push(tabId);
            await firstStartGate;
          });
        }
        return Effect.sync(() => {
          stubRef.started.push(tabId);
        });
      };
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            // A's capture startup stalls mid-acquisition.
            const aAbort = new AbortController();
            const aFetch = fetch(streamUrl(hub.origin, hub.secret), {
              signal: aAbort.signal,
            }).catch(() => null);
            await vi.waitFor(() => expect(startCalls).toBe(1));

            // B attaches while A's start is still in flight — B's startup
            // resolves and its stream opens.
            const bRes = await fetch(streamUrl(hub.origin, hub.secret));
            const bReader = bRes.body!.getReader();
            await bReader.read();

            // A disconnects; its viewers→1, so no disconnect stop runs.
            aAbort.abort();
            await aFetch;
            // A's late-settling start completes into a session B now owns —
            // its compensation must not re-stop the capture. The pushed
            // frame's loopback round-trip gives any stale stop enough turns
            // to land before the assertion.
            releaseFirstStart!();
            stub.pushFrame(liveFrame());
            const pushed = await bReader.read();
            expect(Buffer.from(pushed.value!).toString("latin1")).toContain("X-Frame-Seq: 8");
            expect(stub.stopped).toHaveLength(0);
            await bReader.cancel();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("never writes capture output ahead of the stream's HTTP headers", async () => {
    const { layer: managerLayer } = makeManagerStub((manager, stubRef) => {
      manager.startRemoteCapture = () =>
        Effect.sync(() => {
          stubRef.pushFrame(liveFrame());
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const res = await fetch(streamUrl(hub.origin, hub.secret));
            // If the first frame's bytes beat the response headers, `fetch`
            // rejects or resolves without a content-type — either is a fail.
            expect(res.status).toBe(200);
            expect(res.headers.get("content-type")).toContain("multipart/x-mixed-replace");
            const reader = res.body!.getReader();
            const first = await reader.read();
            expect(first.done).toBe(false);
            await reader.cancel();
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("ends a silent stream at the lease deadline, not the session's", async () => {
    const { layer: managerLayer } = makeManagerStub();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const deadline = Date.now() + 400;
            const startedAt = Date.now();
            const res = await fetch(
              `${streamUrl(hub.origin, hub.secret)}&x-t3-lease-expires=${deadline}`,
            );
            expect(res.status).toBe(200);
            const reader = res.body!.getReader();
            let done = false;
            while (!done) {
              done = (await reader.read()).done === true;
            }
            expect(Date.now() - startedAt).toBeLessThan(3000);
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("cancels a stream whose client disconnected while capture was still starting", async () => {
    let enterStart: (() => void) | null = null;
    let finishStart: (() => void) | null = null;
    let reportStop: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      enterStart = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finishStart = resolve;
    });
    const didStop = new Promise<void>((resolve) => {
      reportStop = resolve;
    });
    let active = false;
    const { layer: managerLayer } = makeManagerStub((manager) => {
      manager.startRemoteCapture = () =>
        Effect.promise(async () => {
          enterStart!();
          await gate;
          active = true;
        });
      manager.stopRemoteCapture = () =>
        Effect.sync(() => {
          active = false;
          reportStop!();
        });
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* BrowserFrameHub;
          yield* Effect.promise(async () => {
            const query = new URLSearchParams({
              "x-t3-hub-auth": hub.secret,
              "x-t3-session": runtimeTabId,
            });
            const req = get(
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/stream.mjpeg?${query}`,
            );
            req.on("error", () => {});
            await entered;
            req.destroy();
            await didStop;
            finishStart!();
            // A completed request is a network/event-loop barrier past the
            // continuation that would resurrect the stopped capture.
            await fetch(
              `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/config?${query}`,
            );
            expect(active).toBe(false);
          });
        }),
      ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
    );
  });

  it("keeps a frame's capture-time geometry when the stream is backpressured", async () => {
    let width = 100;
    let stalled: ServerResponse | null = null;
    const original = ServerResponse.prototype.write;
    const spy = vi.spyOn(ServerResponse.prototype, "write").mockImplementation(function (
      this: ServerResponse,
      ...args: Array<unknown>
    ) {
      // Deliver the bytes, then report backpressure on the first frame part
      // so the next pushed frame parks instead of writing.
      const result = original.apply(this, args as never);
      const chunk = args[0];
      if (Buffer.isBuffer(chunk) && chunk.toString("latin1").startsWith("--t3frame")) {
        stalled = this;
        return false;
      }
      return result;
    });
    try {
      const { stub, layer: managerLayer } = makeManagerStub((manager) => {
        manager.remoteFrameConfig = () =>
          Effect.succeed({
            engineGeneration: "gen-1",
            viewportCss: { width, height: 100 },
            zoomFactor: 1,
          });
      });
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const hub = yield* BrowserFrameHub;
            yield* Effect.promise(async () => {
              const query = new URLSearchParams({
                "x-t3-hub-auth": hub.secret,
                "x-t3-session": runtimeTabId,
                "x-t3-engine-generation": "gen-1",
              });
              const res = await fetch(
                `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/stream.mjpeg?${query}`,
              );
              const reader = res.body!.getReader();
              await reader.read();
              stub.pushFrame(liveFrame("gen-1", 2));
              await vi.waitFor(() => expect(stalled).not.toBeNull());
              width = 200;
              const config = await fetch(
                `${hub.origin}/sessions/${encodeURIComponent(tuple.tabId)}/config?${query}`,
              );
              expect((await config.json()).geometrySeq).toBe(1);
              stalled!.emit("drain");
              const old = await reader.read();
              await reader.cancel();
              expect(Buffer.from(old.value!).toString("latin1")).toContain("X-Geometry-Seq: 0");
            });
          }),
        ).pipe(Effect.provide(BrowserFrameHubLayer.pipe(Layer.provide(managerLayer)))),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
