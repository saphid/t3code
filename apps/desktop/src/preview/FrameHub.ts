// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Loopback HTTP/WS server at the native socket boundary; expiry deadlines and the geometry poll run as Node timers outside Effect fibers.
/**
 * Loopback browser-frame hub for `t3.browser/frames@1.0.0`.
 *
 * Serves JPEG/MJPEG frames and a JSON input socket for the preview tabs this
 * Electron host owns, mirroring the device-hub shape: bound to 127.0.0.1 on
 * an ephemeral port, no auth of its own — the only caller is the app's own
 * `BrowserFrameProxy`, which injects the verified session tuple and lease
 * binding as `x-t3-*` URL params. Everything else about authority (lease
 * minting, revocation, principal binding) lives server-side.
 *
 * Actions never cross this surface: input packets map onto CDP `Input.*`
 * through the Manager's human lane only.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  BROWSER_FRAME_INPUT_MAX_EVENTS_PER_SECOND,
  BROWSER_FRAME_INPUT_PACKET_MAX_BYTES,
  BrowserFrameInputPacket,
  type BrowserFrameSessionTuple,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { WebSocket, WebSocketServer } from "ws";

import * as PreviewManager from "./Manager.ts";

const MJPEG_BOUNDARY = "t3frame";
const FRAME_FPS = 12;
const GEOMETRY_POLL_MS = 1_000;
const INPUT_CLOSE_CODE = 4000;

const SESSION_PATH = /^\/sessions$/;
const SESSION_LEAF_PATH = /^\/sessions\/([^/]+)\/(stream\.mjpeg|snapshot|config)$/;
const SESSION_INPUT_PATH = /^\/sessions\/([^/]+)\/input$/;

interface AssertedSession {
  /** The serialized session tuple — identical to the Manager's runtime tab id. */
  readonly runtimeTabId: string;
  readonly tuple: BrowserFrameSessionTuple;
}

interface HubGeometry {
  seq: number;
  /** `engineGeneration:cssWxcssH`; a change bumps `seq`. */
  key: string;
}

interface SessionActivity {
  viewers: number;
  input: HubInputSocket | null;
  geometry: HubGeometry | null;
  lastFrame: { readonly width: number; readonly height: number; readonly seq: number } | null;
  /** Latest config-derived css viewport, asserted to input dispatch. */
  viewportCss: { readonly width: number; readonly height: number } | null;
}

interface HubInputSocket {
  readonly runtimeTabId: string;
  readonly leaseId: string;
  readonly expiresAt: number;
  readonly engineGeneration: string | null;
  readonly socket: WebSocket;
  state: "bound" | "live" | "closing" | "ended";
  lastSeq: number;
  seqGaps: number;
  rejected: number;
  dispatchFailures: number;
  tokens: number;
  tokensAt: number;
  readonly expiryTimer: NodeJS.Timeout;
}

export class BrowserFrameHubError extends Schema.TaggedError<BrowserFrameHubError>()(
  "BrowserFrameHubError",
  { message: Schema.String },
) {}

export class BrowserFrameHub extends Context.Service<
  BrowserFrameHub,
  {
    /** Loopback origin like `http://127.0.0.1:49300`. */
    readonly origin: string;
  }
>()("@t3tools/desktop/preview/FrameHub/BrowserFrameHub") {}

const decodePacket = Schema.decodeUnknownSync(BrowserFrameInputPacket);

const parseAssertedSession = (url: URL): AssertedSession | null => {
  const raw = url.searchParams.get("x-t3-session");
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      typeof parsed[0] === "string" &&
      parsed[0].length > 0 &&
      typeof parsed[1] === "string" &&
      parsed[1].length > 0 &&
      typeof parsed[2] === "string" &&
      parsed[2].length > 0 &&
      typeof parsed[3] === "string" &&
      parsed[3].length > 0
    ) {
      return {
        runtimeTabId: raw,
        tuple: {
          environmentId: EnvironmentId.make(parsed[0]),
          threadId: ThreadId.make(parsed[1]),
          serverEpoch: parsed[2],
          tabId: parsed[3],
        },
      };
    }
  } catch {
    // fall through
  }
  return null;
};

const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store, no-transform",
  });
  res.end(JSON.stringify(body));
};

const startGeometryPoller = (
  activities: ReadonlyMap<string, SessionActivity>,
  refreshGeometry: (runtimeTabId: string) => Promise<number | null>,
): NodeJS.Timeout => {
  const poller = setInterval(() => {
    for (const [runtimeTabId, activity] of activities) {
      if (activity.viewers > 0 || (activity.input && activity.input.state !== "ended")) {
        void refreshGeometry(runtimeTabId);
      }
    }
  }, GEOMETRY_POLL_MS);
  poller.unref();
  return poller;
};

const make = Effect.gen(function* () {
  const manager = yield* PreviewManager.PreviewManager;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
    new Promise<A>((resolve, reject) =>
      runFork(
        Effect.matchEffect(effect, {
          onFailure: (error: E) => Effect.sync(() => reject(error)),
          onSuccess: (value: A) => Effect.sync(() => resolve(value)),
        }),
      ),
    );

  const activities = new Map<string, SessionActivity>();
  const activityFor = (runtimeTabId: string): SessionActivity => {
    const existing = activities.get(runtimeTabId);
    if (existing) return existing;
    const created: SessionActivity = {
      viewers: 0,
      input: null,
      geometry: null,
      lastFrame: null,
      viewportCss: null,
    };
    activities.set(runtimeTabId, created);
    return created;
  };

  const sendNotice = (socket: HubInputSocket, notice: unknown): void => {
    if (socket.state === "ended" || socket.state === "closing") return;
    try {
      socket.socket.send(JSON.stringify(notice));
    } catch {
      // A dead socket is handled by its close path.
    }
  };

  const rejectPacket = (socket: HubInputSocket, seq: number, reason: string): void => {
    socket.rejected += 1;
    sendNotice(socket, { type: "rejected", seq, reason });
  };

  /**
   * Recompute the session's geometry sequence from authoritative config.
   * Bumps `geometrySeq` when the guest viewport or engine generation changed
   * and pushes the notice onto the bound input socket — `<img>`-path senders
   * never see part headers, so the socket is their only geometry source.
   */
  const refreshGeometry = (runtimeTabId: string): Promise<number | null> =>
    runPromise(manager.remoteFrameConfig(runtimeTabId))
      .then((config) => {
        const activity = activities.get(runtimeTabId);
        if (!activity) return null;
        activity.viewportCss = config.viewportCss;
        const key = `${config.engineGeneration}:${config.viewportCss.width}x${config.viewportCss.height}`;
        if (activity.geometry === null || activity.geometry.key !== key) {
          const seq = (activity.geometry?.seq ?? -1) + 1;
          activity.geometry = { seq, key };
          const input = activity.input;
          if (input && (input.state === "bound" || input.state === "live")) {
            sendNotice(input, { type: "geometry", geometrySeq: seq });
          }
        }
        return activity.geometry.seq;
      })
      .catch(() => null);

  // Geometry changes are infrequent (guest resize, engine swap) but must be
  // fenced promptly: while anything watches or controls a session, poll its
  // authoritative geometry once a second.
  const geometryPoller = startGeometryPoller(activities, refreshGeometry);

  // One Manager subscription fans frames out to every connected stream. The
  // seq stamped on each part is capture-scoped, so viewers see identical
  // sequences and gaps mean capture-side drops.
  const streamListeners = new Map<string, Set<(frame: PreviewManager.RemoteLiveFrame) => void>>();
  yield* manager.subscribeRemoteFrames((frame) =>
    Effect.sync(() => {
      const activity = activities.get(frame.tabId);
      if (activity) {
        activity.lastFrame = { width: frame.width, height: frame.height, seq: frame.seq };
      }
      const listeners = streamListeners.get(frame.tabId);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(frame);
        } catch {
          // A failing stream is cleaned up by its own close path.
        }
      }
    }),
  );

  const writeFramePart = (res: ServerResponse, frame: PreviewManager.RemoteLiveFrame): boolean =>
    res.write(
      Buffer.concat([
        Buffer.from(
          `--${MJPEG_BOUNDARY}\r\n` +
            `Content-Type: image/jpeg\r\n` +
            `Content-Length: ${frame.jpeg.byteLength}\r\n` +
            `X-Frame-Seq: ${frame.seq}\r\n` +
            `X-Engine-Generation: ${frame.engineGeneration}\r\n` +
            `X-Session-Key: ${encodeURIComponent(frame.tabId)}\r\n` +
            `X-Geometry-Seq: ${activities.get(frame.tabId)?.geometry?.seq ?? 0}\r\n` +
            `X-Frame-Width: ${frame.width}\r\n` +
            `X-Frame-Height: ${frame.height}\r\n\r\n`,
          "utf8",
        ),
        frame.jpeg,
        Buffer.from("\r\n", "utf8"),
      ]),
    );

  const handleStream = (
    req: IncomingMessage,
    res: ServerResponse,
    asserted: AssertedSession,
    engineGeneration: string | null,
    expiresAt: number | null,
  ): void => {
    const { runtimeTabId } = asserted;
    void runPromise(
      Effect.gen(function* () {
        const config = yield* manager.remoteFrameConfig(runtimeTabId);
        if (engineGeneration !== null && config.engineGeneration !== engineGeneration) {
          return "engine-generation-mismatch" as const;
        }
        yield* manager.startRemoteCapture(runtimeTabId);
        return null;
      }),
    )
      .then((mismatch) => {
        if (mismatch !== null) {
          writeJson(res, 409, { error: mismatch });
          return;
        }
        return refreshGeometry(runtimeTabId).then(() => {
          if (res.destroyed || res.closed) return;
          const activity = activityFor(runtimeTabId);
          activity.viewers += 1;
          let pending: PreviewManager.RemoteLiveFrame | null = null;
          let backpressured = false;
          const listener = (frame: PreviewManager.RemoteLiveFrame): void => {
            // Latest-wins under backpressure: keep only the newest unwritten
            // frame rather than buffering a queue behind a slow client.
            if (backpressured) {
              pending = frame;
              return;
            }
            if (!writeFramePart(res, frame)) {
              backpressured = true;
            }
          };
          res.on("drain", () => {
            backpressured = false;
            if (pending === null) return;
            const frame = pending;
            pending = null;
            if (!writeFramePart(res, frame)) backpressured = true;
          });
          const listeners = streamListeners.get(runtimeTabId) ?? new Set();
          listeners.add(listener);
          streamListeners.set(runtimeTabId, listeners);
          let expiryTimer: NodeJS.Timeout | null = null;
          if (expiresAt !== null) {
            expiryTimer = setTimeout(() => res.end(), Math.max(0, expiresAt - Date.now()));
            expiryTimer.unref();
          }
          res.writeHead(200, {
            "content-type": `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
            "cache-control": "no-store, no-transform",
            "x-accel-buffering": "no",
          });
          const cleanup = (): void => {
            if (expiryTimer !== null) clearTimeout(expiryTimer);
            listeners.delete(listener);
            activity.viewers = Math.max(0, activity.viewers - 1);
            if (activity.viewers === 0) {
              runFork(manager.stopRemoteCapture(runtimeTabId).pipe(Effect.ignore));
            }
          };
          res.on("close", cleanup);
          res.on("error", cleanup);
        });
      })
      .catch((error: unknown) => {
        writeJson(res, 404, {
          error: "session-not-found",
          message: error instanceof Error ? error.message : "Session is not streamable.",
        });
      });
  };

  const tryClose = (ws: WebSocket, reason: string): void => {
    try {
      ws.close(INPUT_CLOSE_CODE, reason);
    } catch {
      // already closed
    }
  };

  const endSocket = (socket: HubInputSocket, reason: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (socket.state === "ended") return;
      if (socket.state !== "closing") {
        socket.state = "closing";
        tryClose(socket.socket, reason);
      }
      clearTimeout(socket.expiryTimer);
      // Held-input cleanup joins the lease's own lane behind queued sends.
      yield* manager.releaseRemoteInput(socket.runtimeTabId, socket.leaseId);
      socket.state = "ended";
      const activity = activities.get(socket.runtimeTabId);
      if (activity?.input === socket) {
        activity.input = null;
      }
      if (socket.seqGaps + socket.rejected + socket.dispatchFailures > 0) {
        yield* Effect.logInfo("Browser frame input socket ended with dropped input.", {
          leaseId: socket.leaseId,
          reason,
          seqGaps: socket.seqGaps,
          rejected: socket.rejected,
          dispatchFailures: socket.dispatchFailures,
        });
      }
    });

  const bindInputSocket = (
    ws: WebSocket,
    asserted: AssertedSession,
    leaseId: string,
    expiresAt: number,
    engineGeneration: string | null,
  ): void => {
    const { runtimeTabId } = asserted;
    const activity = activityFor(runtimeTabId);
    const socket: HubInputSocket = {
      runtimeTabId,
      leaseId,
      expiresAt,
      engineGeneration,
      socket: ws,
      state: "bound",
      lastSeq: 0,
      seqGaps: 0,
      rejected: 0,
      dispatchFailures: 0,
      tokens: BROWSER_FRAME_INPUT_MAX_EVENTS_PER_SECOND,
      tokensAt: Date.now(),
      expiryTimer: setTimeout(
        () => runFork(endSocket(socket, "expired")),
        Math.max(0, expiresAt - Date.now()),
      ),
    };
    socket.expiryTimer.unref();
    activity.input = socket;

    void refreshGeometry(runtimeTabId).then((geometrySeq) => {
      sendNotice(socket, {
        type: "bound",
        leaseId,
        geometrySeq: geometrySeq ?? activity.geometry?.seq ?? 0,
        expiresAt,
      });
    });

    ws.on("message", (data: Buffer) => {
      if (socket.state === "ended" || socket.state === "closing") return;
      const now = Date.now();
      if (data.byteLength > BROWSER_FRAME_INPUT_PACKET_MAX_BYTES) {
        rejectPacket(socket, 0, "oversized");
        return;
      }
      let packet: ReturnType<typeof decodePacket>;
      try {
        packet = decodePacket(JSON.parse(data.toString("utf8")));
      } catch {
        rejectPacket(socket, 0, "malformed");
        return;
      }
      if (now >= socket.expiresAt) {
        runFork(endSocket(socket, "expired"));
        return;
      }
      if (packet.seq <= socket.lastSeq) {
        rejectPacket(socket, packet.seq, "replay");
        return;
      }
      if (packet.seq > socket.lastSeq + 1 && socket.lastSeq > 0) {
        socket.seqGaps += packet.seq - socket.lastSeq - 1;
      }
      socket.lastSeq = packet.seq;
      const geometrySeq = activity.geometry?.seq ?? 0;
      if (packet.geometrySeq !== geometrySeq) {
        rejectPacket(socket, packet.seq, "stale-geometry");
        return;
      }
      socket.tokens = Math.min(
        BROWSER_FRAME_INPUT_MAX_EVENTS_PER_SECOND,
        socket.tokens +
          ((now - socket.tokensAt) / 1000) * BROWSER_FRAME_INPUT_MAX_EVENTS_PER_SECOND,
      );
      socket.tokensAt = now;
      if (socket.tokens < 1) {
        rejectPacket(socket, packet.seq, "rate-limited");
        return;
      }
      socket.tokens -= 1;
      socket.state = "live";
      runFork(
        manager.dispatchRemoteInput(runtimeTabId, leaseId, packet.event, activity.viewportCss).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Remote input dispatch failed.", {
              leaseId,
              error,
            }).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  socket.dispatchFailures += 1;
                }),
              ),
            ),
          ),
        ),
      );
    });
    ws.on("close", () => runFork(endSocket(socket, "closing")));
    ws.on("error", () => runFork(endSocket(socket, "closing")));
  };

  const handleInputUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    wss: WebSocketServer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = SESSION_INPUT_PATH.exec(url.pathname);
    const reject = (): void => {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
    };
    if (!match) {
      socket.destroy();
      return;
    }
    const pathTabId = match[1] ?? "";
    const asserted = parseAssertedSession(url);
    const leaseId = url.searchParams.get("x-t3-lease");
    const expiresAt = Number(url.searchParams.get("x-t3-lease-expires"));
    if (
      !asserted ||
      asserted.tuple.tabId !== decodeURIComponent(pathTabId) ||
      leaseId === null ||
      !Number.isFinite(expiresAt)
    ) {
      reject();
      return;
    }
    const engineGeneration = url.searchParams.get("x-t3-engine-generation");
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Fence before binding: a stale engine generation or dead tab closes the
      // socket with the named reason rather than silently accepting input.
      void runPromise(manager.remoteFrameConfig(asserted.runtimeTabId))
        .then((config) => {
          if (engineGeneration !== null && config.engineGeneration !== engineGeneration) {
            ws.close(INPUT_CLOSE_CODE, "replaced");
            return;
          }
          const activity = activityFor(asserted.runtimeTabId);
          const existing = activity.input;
          const bind = (): void =>
            bindInputSocket(ws, asserted, leaseId, expiresAt, config.engineGeneration);
          if (existing && existing.state !== "ended") {
            // Supersede ordering: the previous lease's held-input cleanup
            // completes before the new socket binds (design §3.7 item 9).
            runFork(
              endSocket(existing, existing.leaseId === leaseId ? "replaced" : "superseded").pipe(
                Effect.andThen(Effect.sync(bind)),
              ),
            );
          } else {
            bind();
          }
        })
        .catch(() => ws.close(INPUT_CLOSE_CODE, "closing"));
    });
  };

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "method-not-allowed" });
      return;
    }

    if (SESSION_PATH.test(pathname)) {
      void runPromise(manager.remoteFrameSessions())
        .then((sessions) =>
          writeJson(
            res,
            200,
            sessions.map((session) => {
              const activity = activities.get(session.runtimeTabId);
              return {
                environmentId: session.environmentId,
                threadId: session.threadId,
                serverEpoch: session.serverEpoch,
                tabId: session.tabId,
                engineGeneration: session.engineGeneration,
                viewport:
                  session.viewportCss === null
                    ? null
                    : {
                        cssWidth: session.viewportCss.width,
                        cssHeight: session.viewportCss.height,
                      },
                frame: {
                  width: activity?.lastFrame?.width ?? 0,
                  height: activity?.lastFrame?.height ?? 0,
                  fps: FRAME_FPS,
                },
                geometrySeq: activity?.geometry?.seq ?? 0,
                streaming: session.streaming,
              };
            }),
          ),
        )
        .catch(() => writeJson(res, 500, { error: "sessions-unavailable" }));
      return;
    }

    const leaf = SESSION_LEAF_PATH.exec(pathname);
    if (!leaf) {
      writeJson(res, 404, { error: "not-found" });
      return;
    }
    const asserted = parseAssertedSession(url);
    if (!asserted || asserted.tuple.tabId !== decodeURIComponent(leaf[1] ?? "")) {
      writeJson(res, 403, { error: "session-fence-mismatch" });
      return;
    }
    const engineGeneration = url.searchParams.get("x-t3-engine-generation");
    const expiresAtRaw = url.searchParams.get("x-t3-lease-expires");
    const expiresAt = expiresAtRaw === null ? null : Number(expiresAtRaw);

    if (leaf[2] === "stream.mjpeg") {
      handleStream(
        req,
        res,
        asserted,
        engineGeneration,
        Number.isFinite(expiresAt) ? expiresAt : null,
      );
      return;
    }
    if (leaf[2] === "snapshot") {
      void runPromise(manager.captureFrameJpeg(asserted.runtimeTabId))
        .then(async (frame) => {
          const geometrySeq = await refreshGeometry(asserted.runtimeTabId);
          res.writeHead(200, {
            "content-type": "image/jpeg",
            "content-length": frame.jpeg.byteLength,
            "cache-control": "no-store, no-transform",
            "x-engine-generation": frame.engineGeneration,
            "x-geometry-seq": geometrySeq ?? 0,
            "x-frame-width": frame.width,
            "x-frame-height": frame.height,
          });
          res.end(frame.jpeg);
        })
        .catch((error: unknown) =>
          writeJson(res, 404, {
            error: "session-not-found",
            message: error instanceof Error ? error.message : "Session is not capturable.",
          }),
        );
      return;
    }
    // config
    void runPromise(manager.remoteFrameConfig(asserted.runtimeTabId))
      .then(async (config) => {
        if (engineGeneration !== null && config.engineGeneration !== engineGeneration) {
          writeJson(res, 409, { error: "engine-generation-mismatch" });
          return;
        }
        const geometrySeq = await refreshGeometry(asserted.runtimeTabId);
        writeJson(res, 200, {
          ...asserted.tuple,
          engineGeneration: config.engineGeneration,
          viewport: {
            cssWidth: config.viewportCss.width,
            cssHeight: config.viewportCss.height,
          },
          zoomFactor: config.zoomFactor,
          geometrySeq: geometrySeq ?? 0,
        });
      })
      .catch((error: unknown) =>
        writeJson(res, 404, {
          error: "session-not-found",
          message: error instanceof Error ? error.message : "Session is not configurable.",
        }),
      );
  };

  const wss = new WebSocketServer({ noServer: true });
  const server: Server = createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch {
      if (!res.headersSent) writeJson(res, 500, { error: "internal" });
      else res.destroy();
    }
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      handleInputUpgrade(req, socket, head, wss);
    } catch {
      socket.destroy();
    }
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      clearInterval(geometryPoller);
      for (const activity of activities.values()) {
        if (activity.input) {
          runFork(endSocket(activity.input, "closing"));
        }
      }
      wss.close();
      server.close();
    }),
  );

  yield* Effect.callback<void, BrowserFrameHubError>((resume) => {
    server.once("error", (error) =>
      resume(Effect.fail(new BrowserFrameHubError({ message: error.message }))),
    );
    server.listen(0, "127.0.0.1", () => resume(Effect.void));
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return BrowserFrameHub.of({ origin: `http://127.0.0.1:${port}` });
}).pipe(Effect.withSpan("BrowserFrameHub.make"));

export const layer = Layer.effect(BrowserFrameHub, make);
