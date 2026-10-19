import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import { Effect, Layer, Schema, Schedule } from "effect";

const token = process.argv[2];
const base = "http://127.0.0.1:3773";

const ticketRes = await fetch(`${base}/api/auth/websocket-ticket`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
if (!ticketRes.ok) {
  console.error("ticket failed:", ticketRes.status, (await ticketRes.text()).slice(0, 300));
  process.exit(1);
}
const ticketJson = await ticketRes.json();
const ticket = ticketJson.ticket ?? ticketJson.value ?? ticketJson.token;
if (!ticket) {
  console.error("no ticket in response:", JSON.stringify(ticketJson).slice(0, 200));
  process.exit(1);
}
console.error("ticket acquired");

const AnyJson = Schema.Any;
const group = RpcGroup.make(
  Rpc.make("server.getSettings", { payload: Schema.Struct({}), success: AnyJson }),
  Rpc.make("server.updateSettings", {
    payload: Schema.Struct({ patch: AnyJson }),
    success: AnyJson,
  }),
  Rpc.make("server.refreshProviders", {
    payload: Schema.Struct({ instanceId: Schema.optional(Schema.String) }),
    success: AnyJson,
  }),
);

const program = Effect.gen(function* () {
  const socketLayer = Socket.layerWebSocket(
    `ws://127.0.0.1:3773/ws?wsTicket=${encodeURIComponent(ticket)}`,
    {
      openTimeout: 10000,
    },
  ).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, globalThis.WebSocket)));
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({ retryTransientErrors: false, retryPolicy: Schedule.recurs(0) }),
  ).pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
  const context = yield* Layer.build(protocolLayer).pipe(Effect.scoped);
  const client = yield* RpcClient.make(group).pipe(
    Effect.provide(Layer.succeed(RpcClient.Protocol, context)),
    Effect.scoped,
  );

  const settings = yield* client.serverGetSettings({});
  const instances = settings.providerInstances ?? {};
  if (!instances.cliproxyapi) {
    console.error("no cliproxyapi instance in settings; keys:", Object.keys(instances).join(","));
    process.exit(2);
  }
  const current = instances.cliproxyapi;
  const currentModels = current.config?.customModels ?? [];
  console.error("current customModels:", JSON.stringify(currentModels));

  const add = (process.env.ADD_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const remove = (process.env.REMOVE_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const nextModels = currentModels.filter((m) => !remove.includes(m));
  for (const m of add) if (!nextModels.includes(m)) nextModels.push(m);

  if (process.env.APPLY !== "1") {
    console.log("DRY-RUN next customModels:", JSON.stringify(nextModels));
    return "dry-run";
  }

  const nextInstances = {
    ...instances,
    cliproxyapi: { ...current, config: { ...current.config, customModels: nextModels } },
  };
  const updated = yield* client.serverUpdateSettings({
    patch: { providerInstances: nextInstances },
  });
  console.log(
    "updated customModels:",
    JSON.stringify(updated.providerInstances?.cliproxyapi?.config?.customModels ?? updated),
  );
  const refreshed = yield* client.serverRefreshProviders({ instanceId: "cliproxyapi" });
  const models = refreshed.providers?.cliproxyapi?.models ?? [];
  console.log("refreshed provider models:", models.map((m) => m.slug).join(","));
  return "ok";
}).pipe(Effect.scoped);

Effect.runPromise(program)
  .then((r) => {
    console.error("done:", r);
  })
  .catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  });
