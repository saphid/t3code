// Scratch profiler: node [--cpu-prof] scratch/prof.ts   env: DB, READS, TRACE=1, DUMP=path
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeFs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as inspector from "node:inspector";
import * as SqlitePersistence from "../src/persistence/Sqlite.ts";
import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";

const dbPath = process.env.DB!;
const READS = Number(process.env.READS ?? 5);
const trace: Array<{ sql: string; ms: number; rows: number }> = [];
let tracing = false;
const probe = new DatabaseSync(":memory:");
const proto = Object.getPrototypeOf(probe.prepare("select 1"));
const origAll = proto.all;
proto.all = function (this: any, ...args: any[]) {
  if (!tracing) return origAll.apply(this, args);
  const t0 = performance.now();
  const r = origAll.apply(this, args);
  if (process.env.SQLDIR && String(this.sourceSQL).includes("latest_run_id"))
    NodeFs.writeFileSync(process.env.SQLDIR + "/main.sql", String(this.sourceSQL));
  trace.push({ sql: String(this.sourceSQL ?? "").replace(/\s+/g, " ").slice(0, 90), ms: performance.now() - t0, rows: r.length });
  return r;
};
const layerDatabase = SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer));
const layer = ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase));
const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const read = sql.withTransaction(store.getShellSnapshot({ location: "active" }));
  const times: number[] = [];
  const cold0 = performance.now();
  const first = yield* read;
  const cold = performance.now() - cold0;
  if (process.env.DUMP) NodeFs.writeFileSync(process.env.DUMP, JSON.stringify(first));
  for (let i = 0; i < READS; i++) {
    tracing = i === READS - 1;
    const last = i === READS - 1 && process.env.PROF;
    let session: inspector.Session | undefined;
    if (last) {
      session = new inspector.Session();
      session.connect();
      yield* Effect.promise(() => new Promise<void>((r) => session!.post("Profiler.enable", () => r())));
      yield* Effect.promise(() => new Promise<void>((r) => session!.post("Profiler.setSamplingInterval", { interval: 200 }, () => r())));
      yield* Effect.promise(() => new Promise<void>((r) => session!.post("Profiler.start", () => r())));
    }
    const t0 = performance.now();
    yield* read;
    times.push(performance.now() - t0);
    if (session) {
      const prof: any = yield* Effect.promise(() => new Promise((r) => session!.post("Profiler.stop", (_e, v) => r(v.profile))));
      NodeFs.writeFileSync(process.env.PROF!, JSON.stringify(prof));
    }
  }
  tracing = false;
  console.log(JSON.stringify({ threads: first.threads.length, cold, times }));
  for (const t of trace) console.log(`${t.ms.toFixed(1).padStart(8)} ms ${String(t.rows).padStart(6)} rows  ${t.sql}`);
});
await Effect.runPromise(program.pipe(Effect.provide(layer), Effect.scoped));
