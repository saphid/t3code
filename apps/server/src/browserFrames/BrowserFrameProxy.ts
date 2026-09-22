/**
 * Same-origin authenticated proxy in front of the desktop browser-frame hub
 * (`t3.browser/frames@1.0.0`).
 *
 * The hub binds loopback inside the engine host and is never reachable
 * directly, so every frame stream, snapshot, config read, and input socket
 * crosses this route. Reusing the T3 origin is what makes remote viewing work
 * unchanged — Tailscale and T3 Connect already carry `/api/*` and WebSocket
 * upgrades.
 *
 * Authentication mirrors DeviceHubProxy: cookie sessions and `wsTicket` go
 * through the upgrade authenticator at read scope; extension viewers redeem
 * a lease-bound `frameTicket`/`inputTicket` minted through `t3.browser/frames`
 * instead. Input upgrades require an input lease — authority is minted, never
 * asserted. Tickets are stripped before upstream forwarding; the proxy
 * re-asserts the verified session tuple and lease binding on the upstream
 * request so the hub never trusts client-supplied identity fields.
 *
 * Actions do not ride this surface — `/sessions` metadata, frames, and the
 * input socket only.
 */
import { AuthOrchestrationReadScope, type BrowserFrameSessionTuple } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as Socket from "effect/unstable/socket/Socket";
import * as NodeSocket from "@effect/platform-node/NodeSocket";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../auth/http.ts";
import {
  PreviewAutomationBroker,
  type BrowserFrameHubEndpoint,
} from "../mcp/PreviewAutomationBroker.ts";
import { BrowserFrameLeases } from "./BrowserFrameLeases.ts";

export const BROWSER_FRAMES_ROUTE_PREFIX = "/api/browser-frames";

const SESSION_PATH = /^\/sessions$/;
const SESSION_GET_PATH = /^\/sessions\/[^/]+\/(stream\.mjpeg|snapshot|config)$/;
const SESSION_INPUT_PATH = /^\/sessions\/([^/]+)\/input$/;

/** Hop-by-hop and credential headers that must not cross the proxy. */
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "cookie",
  "authorization",
  "dpop",
  "content-length",
  "accept-encoding",
  "x-t3-session",
  "x-t3-engine-generation",
  "x-t3-input-lease",
  "x-t3-lease",
  "x-t3-lease-expires",
]);

/** Params the proxy owns; clients may not assert them upstream. */
const STRIPPED_UPSTREAM_PARAMS = new Set([
  "wsTicket",
  "frameTicket",
  "inputTicket",
  "hostId",
  "x-t3-session",
  "x-t3-engine-generation",
  "x-t3-lease",
  "x-t3-lease-expires",
]);

const isWebSocketUpgrade = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers.upgrade?.toLowerCase() === "websocket";

/**
 * The runtime tab id the hub fences on is the JSON serialization of
 * `[environmentId, threadId, serverEpoch, tabId]` — same compact encoding the
 * engine host produces in `previewRuntimeTabId`.
 */
const encodeRuntimeTabId = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String, Schema.String, Schema.String])),
);

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
};

/** Resolve the engine host that serves this session's frame hub. */
const resolveFrameHub = (
  endpoints: ReadonlyArray<BrowserFrameHubEndpoint>,
  session: BrowserFrameSessionTuple,
  hostId: string | null,
): BrowserFrameHubEndpoint | undefined => {
  const candidates = endpoints.filter(
    (endpoint) =>
      endpoint.environmentId === session.environmentId && isLoopbackOrigin(endpoint.origin),
  );
  if (hostId !== null) return candidates.find((endpoint) => endpoint.clientId === hostId);
  return candidates.length === 1 ? candidates[0] : undefined;
};

const authenticateSessionRead = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const session = yield* serverAuth.authenticateWebSocketUpgrade(request).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (EnvironmentAuth.isServerAuthCredentialError(error)) {
          return yield* failEnvironmentAuthInvalid(
            EnvironmentAuth.serverAuthCredentialReason(error),
            EnvironmentAuth.serverAuthDpopFailureReason(error),
          );
        }
        return yield* failEnvironmentInternal("internal_error", error);
      }),
    ),
  );
  if (!session.scopes.includes(AuthOrchestrationReadScope)) {
    return yield* failEnvironmentScopeRequired(AuthOrchestrationReadScope);
  }
  return session;
});

/**
 * Session tuple from request query params. Only used for session-credential
 * requests — ticket-authenticated requests take the tuple from the verified
 * record, and the hub independently fences every route against it.
 */
const tupleFromQuery = (params: URLSearchParams, pathTabId: string | null) => {
  const environmentId = params.get("environmentId");
  const threadId = params.get("threadId");
  const serverEpoch = params.get("serverEpoch");
  const tabId = pathTabId ?? params.get("tabId");
  if (!environmentId || !threadId || !serverEpoch || !tabId) return Option.none();
  const decoded = Schema.decodeUnknownOption(
    Schema.Struct({
      environmentId: Schema.String.check(Schema.isNonEmpty()),
      threadId: Schema.String.check(Schema.isNonEmpty()),
      serverEpoch: Schema.String.check(Schema.isNonEmpty()),
      tabId: Schema.String.check(Schema.isNonEmpty()),
    }),
  )({ environmentId, threadId, serverEpoch, tabId });
  return Option.flatMap(decoded, (tuple) => Option.some(tuple as BrowserFrameSessionTuple));
};

const forwardHeaders = (
  request: HttpServerRequest.HttpServerRequest,
  origin: string,
  injected: Record<string, string>,
) => {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (DROPPED_REQUEST_HEADERS.has(name) || value === undefined) continue;
    headers[name] = value;
  }
  if (request.headers.origin !== undefined) headers.origin = origin;
  Object.assign(headers, injected);
  return headers;
};

const proxyHttp = Effect.fn("BrowserFrameProxy.proxyHttp")(function* (
  request: HttpServerRequest.HttpServerRequest,
  upstreamUrl: string,
  hubOrigin: string,
  injected: Record<string, string>,
) {
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);
  const upstreamRequest = HttpClientRequest.make("GET")(upstreamUrl).pipe(
    HttpClientRequest.setHeaders(forwardHeaders(request, hubOrigin, injected)),
  );
  const response = yield* httpClient.execute(upstreamRequest);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (name === "content-encoding" || name === "transfer-encoding" || name === "connection") {
      continue;
    }
    if (value !== undefined) headers[name] = value;
  }
  // Long-lived MJPEG responses must not be buffered by compression or cached.
  headers["cache-control"] = "no-store, no-transform";
  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers,
    ...(headers["content-type"] ? { contentType: headers["content-type"] } : {}),
  });
});

/** Pipe the client input socket to the hub's opaquely. */
const proxyWebSocket = Effect.fn("BrowserFrameProxy.proxyWebSocket")(function* (
  request: HttpServerRequest.HttpServerRequest,
  upstreamUrl: string,
) {
  const client = yield* request.upgrade;
  const upstream = yield* Socket.makeWebSocket(upstreamUrl, {
    openTimeout: "10 seconds",
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructor));
  yield* Effect.scoped(
    Effect.gen(function* () {
      const writeToClient = yield* client.writer;
      const writeToUpstream = yield* upstream.writer;
      // Whichever side closes first ends the other via scope teardown: a close
      // fails that side's run loop with a SocketError, which loses the race.
      return yield* Effect.raceFirst(
        upstream.runRaw((data) => writeToClient(data)),
        client.runRaw((data) => writeToUpstream(data)),
      );
    }),
  ).pipe(Effect.catchCause(() => Effect.void));
  return HttpServerResponse.empty();
});

const upstreamParams = (
  params: URLSearchParams,
  session: BrowserFrameSessionTuple,
  engineGeneration: string | null,
  leaseBinding?: { leaseId?: string; expiresAt?: number },
): string => {
  const upstream = new URLSearchParams();
  for (const [name, value] of params) {
    if (STRIPPED_UPSTREAM_PARAMS.has(name)) continue;
    upstream.append(name, value);
  }
  // The proxy re-asserts the verified tuple and lease binding: the hub treats
  // these as server-asserted identity on a loopback hop clients cannot reach.
  upstream.set(
    "x-t3-session",
    encodeRuntimeTabId([
      session.environmentId,
      session.threadId,
      session.serverEpoch,
      session.tabId,
    ]),
  );
  if (engineGeneration !== null) upstream.set("x-t3-engine-generation", engineGeneration);
  if (leaseBinding?.leaseId !== undefined) upstream.set("x-t3-lease", leaseBinding.leaseId);
  // The credential's expiry rides along as the stream/socket floor: the hub
  // ends the response or closes the socket when it passes, so open-time auth
  // never leaves pixels or input flowing past a dead ticket (design §3.7.7).
  if (leaseBinding?.expiresAt !== undefined) {
    upstream.set("x-t3-lease-expires", String(leaseBinding.expiresAt));
  }
  return upstream.toString();
};

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return HttpServerResponse.text("Bad Request", { status: 400 });
  }
  const hubPath = url.value.pathname.slice(BROWSER_FRAMES_ROUTE_PREFIX.length) || "/";
  const params = url.value.searchParams;
  const upgrade = isWebSocketUpgrade(request);
  const inputMatch = SESSION_INPUT_PATH.exec(hubPath);
  const getAllowed =
    request.method === "GET" && (SESSION_PATH.test(hubPath) || SESSION_GET_PATH.test(hubPath));

  if (upgrade) {
    if (inputMatch === null) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
  } else if (!getAllowed) {
    return SESSION_PATH.test(hubPath) || SESSION_GET_PATH.test(hubPath) || inputMatch !== null
      ? HttpServerResponse.text("Method Not Allowed", { status: 405 })
      : HttpServerResponse.text("Not Found", { status: 404 });
  }

  const leases = yield* BrowserFrameLeases;
  const broker = yield* PreviewAutomationBroker;

  if (upgrade && inputMatch !== null) {
    // Input is lease-gated: a minted ticket is the only credential, and it is
    // verified before the upgrade is accepted.
    const tabId = inputMatch[1];
    const ticket = params.get("inputTicket");
    const record =
      ticket === null || tabId === undefined ? Option.none() : yield* leases.verify(ticket);
    if (
      tabId === undefined ||
      Option.isNone(record) ||
      record.value.kind !== "input" ||
      record.value.session.tabId !== decodeURIComponent(tabId)
    ) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const session = record.value.session;
    const endpoints = yield* broker.frameHubs;
    const hub = resolveFrameHub(
      endpoints,
      session,
      params.get("hostId") ?? record.value.hostClientId,
    );
    if (!hub) {
      return HttpServerResponse.text("Browser frame hub is not running", { status: 503 });
    }
    const search = upstreamParams(params, session, record.value.engineGeneration, {
      ...(record.value.leaseId !== undefined ? { leaseId: record.value.leaseId } : {}),
      expiresAt: record.value.expiresAt,
    });
    const upstream = `${hub.origin.replace(/^http/, "ws")}${hubPath}?${search}`;
    return yield* proxyWebSocket(request, upstream);
  }

  // GET routes: a frameTicket authorizes extension viewers; otherwise the
  // request must carry an environment session at read scope.
  const frameTicket = params.get("frameTicket");
  let sessionTuple: Option.Option<BrowserFrameSessionTuple>;
  let engineGeneration: string | null = null;
  let ticketHostClientId: string | null = null;
  let credentialExpiresAt: number | undefined;
  if (frameTicket !== null) {
    const record = yield* leases.verify(frameTicket);
    if (Option.isNone(record) || record.value.kind !== "stream") {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    sessionTuple = Option.some(record.value.session);
    engineGeneration = record.value.engineGeneration;
    ticketHostClientId = record.value.hostClientId;
    credentialExpiresAt = record.value.expiresAt;
  } else {
    const sessionAuth = yield* authenticateSessionRead;
    const pathTabId = SESSION_GET_PATH.test(hubPath)
      ? decodeURIComponent(hubPath.split("/")[2] ?? "")
      : null;
    sessionTuple = tupleFromQuery(params, pathTabId);
    engineGeneration = params.get("engineGeneration");
    credentialExpiresAt = sessionAuth.expiresAt?.epochMilliseconds;
  }
  if (Option.isNone(sessionTuple)) {
    return HttpServerResponse.text("Missing session identity", { status: 400 });
  }
  const session = sessionTuple.value;
  const endpoints = yield* broker.frameHubs;
  const hub = resolveFrameHub(endpoints, session, params.get("hostId") ?? ticketHostClientId);
  if (!hub) {
    return HttpServerResponse.text("Browser frame hub is not running", { status: 503 });
  }
  const search = upstreamParams(params, session, engineGeneration, {
    ...(credentialExpiresAt !== undefined ? { expiresAt: credentialExpiresAt } : {}),
  });
  const injected: Record<string, string> = {
    "x-t3-session": encodeRuntimeTabId([
      session.environmentId,
      session.threadId,
      session.serverEpoch,
      session.tabId,
    ]),
  };
  if (engineGeneration !== null) injected["x-t3-engine-generation"] = engineGeneration;
  const upstreamUrl = `${hub.origin}${hubPath}${search ? `?${search}` : ""}`;
  return yield* proxyHttp(request, upstreamUrl, hub.origin, injected);
});

export const browserFrameProxyRouteLayer = HttpRouter.add(
  "*",
  `${BROWSER_FRAMES_ROUTE_PREFIX}/*`,
  handler,
);
