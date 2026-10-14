// Scratch benchmark (untracked, deleted after use).
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { createHash } from "node:crypto";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import { loadShellSnapshotParts } from "./orchestration-v2/ShellStream.ts";

const filename = process.argv[2]!;
const readerWorker = process.argv[3] === "worker";
const warmups = 5;
const measured = 10;

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA busy_timeout = 5000;`;
  yield* sql`PRAGMA journal_mode = WAL;`;
  yield* sql`PRAGMA synchronous = NORMAL;`;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const latestSequence = sql<{ sequence: number | null }>`
    SELECT MAX(sequence) AS sequence
    FROM orchestration_events INDEXED BY idx_orchestration_events_application_high_water
    WHERE aggregate_kind = 'project'
      OR (application_event_version = 2 AND aggregate_kind = 'thread')
  `.pipe(Effect.map((rows) => rows[0]?.sequence ?? 0));
  const results = [];
  for (let i = 0; i < warmups + measured; i++) {
    let last = performance.now();
    let maxGap = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 1);
    const cpu0 = process.cpuUsage();
    const start = performance.now();
    const parts = yield* loadShellSnapshotParts({
      sql,
      readThreads: projections.readShellSnapshot({ location: "active" }),
      listProjects: projects.listShells(),
      latestSequence,
    });
    const duration = performance.now() - start;
    const cpu = process.cpuUsage(cpu0);
    clearInterval(timer);
    maxGap = Math.max(maxGap, performance.now() - last);
    yield* Effect.sleep("50 millis");
    results.push({
      warmup: i < warmups,
      duration,
      maxGap,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      threads: parts.threads.threads.length,
      projects: parts.projects.length,
      sequence: parts.snapshotSequence,
      hash: createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16),
    });
  }
  const m = results.filter((r) => !r.warmup);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2;
  };
  const summary = {
    mode: readerWorker ? "worker" : "writer-only (main behaviour)",
    durationMedian: median(m.map((r) => r.duration)),
    durationRange: [Math.min(...m.map((r) => r.duration)), Math.max(...m.map((r) => r.duration))],
    gapMedian: median(m.map((r) => r.maxGap)),
    gapRange: [Math.min(...m.map((r) => r.maxGap)), Math.max(...m.map((r) => r.maxGap))],
    mainThreadCpuMsTotal: m.reduce((a, r) => a + r.cpuUserMs + r.cpuSystemMs, 0),
    rssMiB: process.memoryUsage().rss / 1048576,
    hashes: [...new Set(m.map((r) => r.hash))],
    threads: m[0]!.threads,
    projects: m[0]!.projects,
    sequence: m[0]!.sequence,
  };
  console.log(JSON.stringify({ summary, results }));
});

const sqlLayer = NodeSqliteClient.layer({ filename, readerWorker });
await Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.mergeAll(ProjectionStore.layer, ProjectStore.layer).pipe(Layer.provideMerge(sqlLayer))),
  ) as Effect.Effect<void>,
);
process.exit(0);
