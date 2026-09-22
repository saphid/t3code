// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off -- Native socket test boundary: real HTTP/WS against the loopback hub, packet bytes are raw JSON.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  readonly dispatched: Array<{ leaseId: string; event: unknown }>;
  readonly released: string[];
  readonly heldReleased: string[];
  readonly started: string[];
  readonly stopped: string[];
  readonly pushFrame: (frame: PreviewManager.RemoteLiveFrame) => void;
}

const makeManagerStub = (): {
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
      _viewportCss: unknown,
    ) =>
      Effect.sync(() => {
        dispatched.push({ leaseId, event });
      }),
    releaseRemoteInput: (tabId: string, _leaseId: string) =>
      Effect.sync(() => {
        released.push(tabId);
      }),
    releaseRemoteInputHeld: (tabId: string) =>
      Effect.sync(() => {
        heldReleased.push(tabId);
      }),
  };
  return {
    stub: {
      dispatched,
      released,
      heldReleased,
      started,
      stopped,
      get pushFrame() {
        return pushFrame;
      },
    },
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
});
