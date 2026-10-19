// Throwaway benchmark harness. Never commit. Run once per (database, build) with
// MATRIX_DB, MATRIX_OUT and optionally MATRIX_MODE=init|bench.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { identity } from "effect/Function";
import * as NodeFs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { test } from "vite-plus/test";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const dbPath = process.env.MATRIX_DB ?? "";
const outPath = process.env.MATRIX_OUT ?? "";
const mode = process.env.MATRIX_MODE ?? "bench";
const SEQ_READS = Number(process.env.MATRIX_SEQ_READS ?? 7);
const CONTENDED_MS = Number(process.env.MATRIX_CONTENDED_MS ?? 4000);
const STORM = Number(process.env.MATRIX_STORM ?? 10);

// Absent on the base build, which is exactly the point.
const markReadOnly: <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> =
  (NodeSqliteClient as unknown as { readOnly?: typeof identity }).readOnly ?? identity;
const hasReader = (NodeSqliteClient as unknown as { readOnly?: unknown }).readOnly !== undefined;

const quantile = (xs: ReadonlyArray<number>, q: number) => {
  const s = [...xs].toSorted((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const now = () => performance.now();

// Records the longest gap between 2 ms timer ticks while a window is open.
const gapRecorder = () => {
  let last = now();
  let max = 0;
  const timer = setInterval(() => {
    const t = now();
    max = Math.max(max, t - last);
    last = t;
  }, 2);
  return {
    reset: () => {
      last = now();
      max = 0;
    },
    max: () => Math.max(max, now() - last),
    stop: () => clearInterval(timer),
  };
};

const layerDatabase = SqlitePersistence.layerFromPath(dbPath).pipe(
  Layer.provide(NodeServices.layer),
);
const layer = ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase));

test(
  "reader matrix",
  async () => {
    if (dbPath === "" || outPath === "") throw new Error("MATRIX_DB and MATRIX_OUT are required");
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (mode === "init") return { mode };
      const store = yield* ProjectionStore.ProjectionStoreV2;
      yield* sql`CREATE TABLE IF NOT EXISTS bench_writes (id INTEGER PRIMARY KEY, t REAL)`;

      const snapshot = sql
        .withTransaction(store.getShellSnapshot({ location: "active" }))
        .pipe(markReadOnly);

      const rss = { max: 0 };
      const rssTimer = setInterval(() => {
        rss.max = Math.max(rss.max, process.memoryUsage().rss);
      }, 50);
      const gap = gapRecorder();

      const timed = Effect.gen(function* () {
        gap.reset();
        const t0 = now();
        const rows = yield* snapshot;
        return { ms: now() - t0, gapMs: gap.max(), threads: rows.length as number };
      });

      // Phase A: one cold read (includes worker startup on the candidate), then warm reads.
      const cold = yield* timed;
      const cpu0 = process.cpuUsage();
      const wall0 = now();
      const seq: Array<{ ms: number; gapMs: number }> = [];
      for (let i = 0; i < SEQ_READS; i += 1) seq.push(yield* timed);
      const cpu1 = process.cpuUsage(cpu0);
      const seqWall = now() - wall0;

      // Phase B: writes alone, then writes while reads run back to back.
      const writeLoop = (durationMs: number) =>
        Effect.gen(function* () {
          const lat: Array<number> = [];
          const end = now() + durationMs;
          while (now() < end) {
            const t0 = now();
            yield* sql`INSERT INTO bench_writes (t) VALUES (${t0})`;
            lat.push(now() - t0);
            yield* Effect.sleep("1 millis");
          }
          return lat;
        });
      gap.reset();
      const aloneLat = yield* writeLoop(Math.min(2000, CONTENDED_MS));
      const aloneGap = gap.max();

      gap.reset();
      let reading = true;
      const readerFiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          let n = 0;
          while (reading) {
            yield* snapshot;
            n += 1;
            yield* Effect.sleep("100 millis");
          }
          return n;
        }),
      );
      const contendedLat = yield* writeLoop(CONTENDED_MS);
      reading = false;
      const contendedGap = gap.max();
      const readsDuring = yield* Fiber.await(readerFiber).pipe(
        Effect.map((exit) => (exit._tag === "Success" ? exit.value : -1)),
      );

      // Phase C: reconnect storm, STORM snapshots at once.
      gap.reset();
      const s0 = now();
      const stormDurations = yield* Effect.forEach(
        Array.from({ length: STORM }),
        () =>
          Effect.gen(function* () {
            const t0 = now();
            yield* snapshot;
            return now() - t0;
          }),
        { concurrency: STORM },
      );
      const stormWall = now() - s0;
      const stormGap = gap.max();

      gap.stop();
      clearInterval(rssTimer);
      const walBytes = NodeFs.existsSync(`${dbPath}-wal`) ? NodeFs.statSync(`${dbPath}-wal`).size : 0;

      return {
        build: hasReader ? "candidate" : "base",
        threads: cold.threads,
        coldMs: cold.ms,
        coldGapMs: cold.gapMs,
        seqMsP50: quantile(seq.map((s) => s.ms), 0.5),
        seqMsMax: Math.max(...seq.map((s) => s.ms)),
        seqGapMaxMs: Math.max(...seq.map((s) => s.gapMs)),
        seqGapP50Ms: quantile(seq.map((s) => s.gapMs), 0.5),
        seqCpuMsPerRead: (cpu1.user + cpu1.system) / 1000 / SEQ_READS,
        seqWallPerReadMs: seqWall / SEQ_READS,
        writeAlone: {
          n: aloneLat.length,
          perSec: aloneLat.length / (Math.min(2000, CONTENDED_MS) / 1000),
          p50: quantile(aloneLat, 0.5),
          p99: quantile(aloneLat, 0.99),
          max: Math.max(...aloneLat),
          gapMs: aloneGap,
        },
        writeWhileReading: {
          n: contendedLat.length,
          perSec: contendedLat.length / (CONTENDED_MS / 1000),
          p50: quantile(contendedLat, 0.5),
          p99: quantile(contendedLat, 0.99),
          max: Math.max(...contendedLat),
          gapMs: contendedGap,
          readsCompleted: readsDuring,
        },
        storm: {
          size: STORM,
          wallMs: stormWall,
          p50: quantile(stormDurations, 0.5),
          max: Math.max(...stormDurations),
          gapMs: stormGap,
        },
        rssMaxMb: rss.max / 1024 / 1024,
        walMb: walBytes / 1024 / 1024,
        dbMb: NodeFs.statSync(dbPath).size / 1024 / 1024,
      };
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer), Effect.scoped));
    NodeFs.writeFileSync(outPath, JSON.stringify(result, null, 1));
    void monitorEventLoopDelay;
  },
  30 * 60 * 1000,
);
