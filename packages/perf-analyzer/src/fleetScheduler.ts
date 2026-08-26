// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalFetch:off globalTimers:off - Standalone fleet control plane.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHTTP from "node:http";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { DatabaseSync } from "node:sqlite";

const HELP = `t3 perf fleet scheduler

Usage: node src/fleetScheduler.ts --db <path> --results <dir> --token-file <path>
  [--listen 0.0.0.0] [--port 9433] [--contract <id>] [--refresh-ms 10800000]
  [--lease-ms 21600000] [--since-days 14] [--legacy-ledger <json>]
  [--hold-versions <tsv>]

The scheduler is the only writer of assignment state. It refreshes the npm
registry at startup and every three hours, then atomically leases the newest
published uncompleted nightly. Expired leases are recoverable.
`;

interface JobRow {
  readonly version: string;
  readonly published_at: string;
  readonly state: "queued" | "leased" | "completed" | "failed" | "external";
  readonly attempts: number;
  readonly worker_id: string | null;
  readonly lease_id: string | null;
  readonly lease_expires_at: string | null;
  readonly run_id: string | null;
  readonly result_path: string | null;
  readonly updated_at: string;
}

interface WorkerRow {
  readonly worker_id: string;
  readonly contract: string;
  readonly status: string;
  readonly current_version: string | null;
  readonly last_seen_at: string;
}

interface JsonBody {
  readonly workerId?: unknown;
  readonly contract?: unknown;
  readonly leaseId?: unknown;
  readonly version?: unknown;
  readonly runId?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly reason?: unknown;
}

function stringField(body: JsonBody, key: keyof JsonBody): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") throw new Error(`${key} must be a string`);
  return value;
}

async function readBody(request: NodeHTTP.IncomingMessage): Promise<JsonBody> {
  const chunks: Array<Buffer> = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 32 * 1024 * 1024) throw new Error("request body exceeds 32 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody;
}

function send(response: NodeHTTP.ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
  });
  response.end(encoded);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && NodeCrypto.timingSafeEqual(a, b);
}

function initialize(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS jobs (
      version TEXT PRIMARY KEY,
      published_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued','leased','completed','failed','external')),
      attempts INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      lease_id TEXT UNIQUE,
      lease_expires_at TEXT,
      run_id TEXT,
      result_path TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS jobs_claim_order ON jobs(state, published_at DESC);
    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      contract TEXT NOT NULL,
      status TEXT NOT NULL,
      current_version TEXT,
      last_seen_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS registry_refreshes (
      refreshed_at TEXT PRIMARY KEY,
      newest_version TEXT,
      discovered_count INTEGER NOT NULL,
      error TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS claim_gate (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      state TEXT NOT NULL CHECK(state IN ('open','closed')),
      reason TEXT NOT NULL,
      changed_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS claim_gate_transitions (
      transition_id TEXT PRIMARY KEY,
      from_state TEXT NOT NULL CHECK(from_state IN ('open','closed')),
      to_state TEXT NOT NULL CHECK(to_state IN ('open','closed')),
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      changed_at TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(`
    INSERT INTO claim_gate(singleton,state,reason,changed_at)
    VALUES (1,'open','scheduler initialized',?) ON CONFLICT(singleton) DO NOTHING
  `).run(new Date().toISOString());
}

interface ClaimGateRow {
  readonly state: "open" | "closed";
  readonly reason: string;
  readonly changedAt: string;
}

function claimGate(db: DatabaseSync): ClaimGateRow {
  const row = db
    .prepare("SELECT state,reason,changed_at AS changedAt FROM claim_gate WHERE singleton=1")
    .get();
  if (row === undefined) throw new Error("claim gate is not initialized");
  return row as unknown as ClaimGateRow;
}

function activeLeaseCount(db: DatabaseSync): number {
  const row = db.prepare("SELECT count(*) AS count FROM jobs WHERE state='leased'").get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

function requeueExpiredLeases(db: DatabaseSync, now: string): void {
  db.prepare(`
    UPDATE jobs SET state='queued',worker_id=NULL,lease_id=NULL,lease_expires_at=NULL,
      run_id=NULL,updated_at=?
    WHERE state='leased' AND lease_expires_at <= ?
  `).run(now, now);
  db.prepare(`
    UPDATE workers SET status='idle',current_version=NULL,last_seen_at=?
    WHERE status='busy' AND NOT EXISTS (
      SELECT 1 FROM jobs WHERE jobs.worker_id=workers.worker_id AND jobs.state='leased'
    )
  `).run(now);
}

function transitionClaimGate(
  db: DatabaseSync,
  to: "open" | "closed",
  actor: string,
  reason: string,
  now: string,
): {
  transitionId: string;
  from: "open" | "closed";
  to: "open" | "closed";
  actor: string;
  reason: string;
  changedAt: string;
} {
  const transitionId = NodeCrypto.randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = claimGate(db);
    if (current.state === to) throw new Error(`claim gate is already ${to}`);
    db.prepare("UPDATE claim_gate SET state=?,reason=?,changed_at=? WHERE singleton=1").run(
      to,
      reason,
      now,
    );
    db.prepare(`
      INSERT INTO claim_gate_transitions(transition_id,from_state,to_state,actor,reason,changed_at)
      VALUES (?,?,?,?,?,?)
    `).run(transitionId, current.state, to, actor, reason, now);
    db.exec("COMMIT");
    return { transitionId, from: current.state, to, actor, reason, changedAt: now };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function importLegacyLedger(db: DatabaseSync, path: string): void {
  if (!NodeFS.existsSync(path)) return;
  const ledger = JSON.parse(NodeFS.readFileSync(path, "utf8")) as Record<
    string,
    { exitCode?: number; combosOk?: number; finishedAt?: string }
  >;
  const insert = db.prepare(`
    INSERT INTO jobs(version, published_at, state, updated_at)
    VALUES (?, ?, 'completed', ?)
    ON CONFLICT(version) DO UPDATE SET
      state='completed', worker_id=NULL, lease_id=NULL, lease_expires_at=NULL,
      updated_at=excluded.updated_at
  `);
  for (const [version, entry] of Object.entries(ledger)) {
    if (!(entry.exitCode === 0 || (entry.combosOk ?? 0) > 0)) continue;
    const finishedAt = entry.finishedAt ?? new Date(0).toISOString();
    insert.run(version, finishedAt, finishedAt);
  }
}

function importHolds(db: DatabaseSync, path: string): void {
  if (!NodeFS.existsSync(path)) return;
  const insert = db.prepare(`
    INSERT INTO jobs(version, published_at, state, updated_at)
    VALUES (?, ?, 'external', ?)
    ON CONFLICT(version) DO UPDATE SET
      state=CASE WHEN jobs.state='completed' THEN 'completed' ELSE 'external' END,
      worker_id=NULL, lease_id=NULL, lease_expires_at=NULL, updated_at=excluded.updated_at
  `);
  const now = new Date().toISOString();
  for (const raw of NodeFS.readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const [version, publishedAt] = line.split("\t");
    if (version === undefined) continue;
    insert.run(version, publishedAt ?? now, now);
  }
}

async function refreshRegistry(
  db: DatabaseSync,
  registryUrl: string,
  sinceDays: number,
): Promise<{ newest: string | null; discovered: number }> {
  const refreshedAt = new Date().toISOString();
  try {
    const response = await fetch(registryUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
    const packument = (await response.json()) as {
      readonly time?: Record<string, string>;
      readonly versions?: Record<string, unknown>;
    };
    const cutoff = Date.now() - sinceDays * 86_400_000;
    const entries = Object.keys(packument.versions ?? {})
      .filter((version) => version.includes("-nightly."))
      .map((version) => ({ version, publishedAt: packument.time?.[version] }))
      .filter(
        (entry): entry is { version: string; publishedAt: string } =>
          entry.publishedAt !== undefined && Date.parse(entry.publishedAt) >= cutoff,
      )
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const insert = db.prepare(`
      INSERT INTO jobs(version, published_at, state, updated_at)
      VALUES (?, ?, 'queued', ?)
      ON CONFLICT(version) DO UPDATE SET published_at=excluded.published_at
    `);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) insert.run(entry.version, entry.publishedAt, refreshedAt);
      db.prepare(
        "INSERT INTO registry_refreshes(refreshed_at,newest_version,discovered_count,error) VALUES (?,?,?,NULL)",
      ).run(refreshedAt, entries[0]?.version ?? null, entries.length);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { newest: entries[0]?.version ?? null, discovered: entries.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      "INSERT INTO registry_refreshes(refreshed_at,newest_version,discovered_count,error) VALUES (?,NULL,0,?)",
    ).run(refreshedAt, message);
    throw error;
  }
}

function validateLease(db: DatabaseSync, body: JsonBody): JobRow {
  const leaseId = stringField(body, "leaseId");
  const workerId = stringField(body, "workerId");
  const version = stringField(body, "version");
  const row = db
    .prepare("SELECT * FROM jobs WHERE version=? AND lease_id=? AND worker_id=? AND state='leased'")
    .get(version, leaseId, workerId) as JobRow | undefined;
  if (row === undefined) throw new Error("lease is not current");
  return row;
}

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: {
      db: { type: "string" },
      results: { type: "string" },
      "token-file": { type: "string" },
      listen: { type: "string", default: "0.0.0.0" },
      port: { type: "string", default: "9433" },
      contract: { type: "string", default: "t3perf-v1-node24-playwright1.60" },
      "refresh-ms": { type: "string", default: "10800000" },
      "lease-ms": { type: "string", default: "21600000" },
      "since-days": { type: "string", default: "14" },
      "registry-url": { type: "string", default: "https://registry.npmjs.org/t3" },
      "legacy-ledger": { type: "string", multiple: true },
      "hold-versions": { type: "string", multiple: true },
      help: { type: "boolean", default: false },
    },
  });
  if (
    values.help ||
    values.db === undefined ||
    values.results === undefined ||
    values["token-file"] === undefined
  ) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  const port = Number(values.port);
  const refreshMs = Number(values["refresh-ms"]);
  const leaseMs = Number(values["lease-ms"]);
  const sinceDays = Number(values["since-days"]);
  const tokenBytes = await NodeFSP.readFile(values["token-file"]);
  const token = tokenBytes.toString("hex");
  const resultsDir = values.results;
  if (tokenBytes.length < 32) throw new Error("token must contain at least 32 random bytes");
  await NodeFSP.mkdir(NodePath.dirname(values.db), { recursive: true });
  await NodeFSP.mkdir(resultsDir, { recursive: true });
  const db = new DatabaseSync(values.db);
  initialize(db);
  for (const path of values["legacy-ledger"] ?? []) importLegacyLedger(db, path);
  for (const path of values["hold-versions"] ?? []) importHolds(db, path);

  const refresh = async () => {
    try {
      const state = await refreshRegistry(db, values["registry-url"], sinceDays);
      console.log(
        `${new Date().toISOString()} registry newest=${state.newest ?? "none"} discovered=${state.discovered}`,
      );
    } catch (error) {
      console.error(`${new Date().toISOString()} registry refresh failed`, error);
    }
  };
  await refresh();
  const refreshTimer = setInterval(() => void refresh(), refreshMs);

  const server = NodeHTTP.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        const newest = db
          .prepare("SELECT version,published_at FROM jobs ORDER BY published_at DESC LIMIT 1")
          .get();
        send(response, 200, { ok: true, contract: values.contract, newest });
        return;
      }
      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), token)) {
        send(response, 401, { error: "unauthorized" });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/state") {
        const now = new Date().toISOString();
        db.exec("BEGIN IMMEDIATE");
        try {
          requeueExpiredLeases(db, now);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        const jobs = db
          .prepare("SELECT * FROM jobs ORDER BY published_at DESC")
          .all() as unknown as Array<JobRow>;
        const workers = db
          .prepare("SELECT * FROM workers ORDER BY worker_id")
          .all() as unknown as Array<WorkerRow>;
        send(response, 200, {
          jobs,
          workers,
          claimGate: claimGate(db),
          activeLeaseCount: activeLeaseCount(db),
        });
        return;
      }
      if (request.method !== "POST") {
        send(response, 404, { error: "not found" });
        return;
      }
      const body = await readBody(request);
      const workerId = stringField(body, "workerId");
      const contract = stringField(body, "contract");
      if (contract !== values.contract) {
        send(response, 409, { error: "worker contract mismatch", expected: values.contract });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO workers(worker_id,contract,status,current_version,last_seen_at)
        VALUES (?,?,'idle',NULL,?)
        ON CONFLICT(worker_id) DO UPDATE SET contract=excluded.contract,last_seen_at=excluded.last_seen_at
      `).run(workerId, contract, now);

      if (request.url === "/v1/claims/close" || request.url === "/v1/claims/open") {
        const reason = stringField(body, "reason").trim();
        if (reason === "" || reason.length > 4000)
          throw new Error("reason must be 1 to 4000 characters");
        const to = request.url.endsWith("/open") ? "open" : "closed";
        const transition = transitionClaimGate(db, to, workerId, reason, now);
        send(response, 200, {
          transition,
          claimGate: claimGate(db),
          activeLeaseCount: activeLeaseCount(db),
        });
        return;
      }

      if (request.url === "/v1/claim") {
        db.exec("BEGIN IMMEDIATE");
        try {
          requeueExpiredLeases(db, now);
          const gate = claimGate(db);
          if (gate.state === "closed") {
            db.prepare(
              "UPDATE workers SET status='idle',current_version=NULL,last_seen_at=? WHERE worker_id=?",
            ).run(now, workerId);
            db.exec("COMMIT");
            send(response, 200, { lease: null, scheduler: "draining", claimGate: gate });
            return;
          }
          const job = db
            .prepare(
              "SELECT version,published_at FROM jobs WHERE state='queued' AND attempts < 4 ORDER BY published_at DESC LIMIT 1",
            )
            .get() as { version: string; published_at: string } | undefined;
          if (job === undefined) {
            db.prepare(
              "UPDATE workers SET status='idle',current_version=NULL,last_seen_at=? WHERE worker_id=?",
            ).run(now, workerId);
            db.exec("COMMIT");
            send(response, 200, { lease: null });
            return;
          }
          const leaseId = NodeCrypto.randomUUID();
          const runId = NodeCrypto.randomUUID();
          const expiresAt = new Date(Date.now() + leaseMs).toISOString();
          db.prepare(`
            UPDATE jobs SET state='leased',attempts=attempts+1,worker_id=?,lease_id=?,
              lease_expires_at=?,run_id=?,updated_at=? WHERE version=? AND state='queued'
          `).run(workerId, leaseId, expiresAt, runId, now, job.version);
          db.prepare(
            "UPDATE workers SET status='busy',current_version=?,last_seen_at=? WHERE worker_id=?",
          ).run(job.version, now, workerId);
          db.exec("COMMIT");
          send(response, 200, {
            lease: {
              leaseId,
              runId,
              version: job.version,
              publishedAt: job.published_at,
              expiresAt,
            },
          });
          return;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      const job = validateLease(db, body);
      if (request.url === "/v1/renew") {
        const expiresAt = new Date(Date.now() + leaseMs).toISOString();
        db.prepare("UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE version=?").run(
          expiresAt,
          now,
          job.version,
        );
        db.prepare("UPDATE workers SET last_seen_at=? WHERE worker_id=?").run(now, workerId);
        send(response, 200, { ok: true, expiresAt });
        return;
      }
      if (request.url === "/v1/complete") {
        if (typeof body.result !== "object" || body.result === null) {
          throw new Error("result must be an object");
        }
        const results = (body.result as { results?: unknown }).results;
        if (!Array.isArray(results) || results.length === 0)
          throw new Error("result has no scenario results");
        const versionDir = NodePath.join(resultsDir, job.version);
        await NodeFSP.mkdir(versionDir, { recursive: true });
        const finalPath = NodePath.join(versionDir, `${job.run_id}.json`);
        const temporaryPath = `${finalPath}.tmp-${process.pid}`;
        await NodeFSP.writeFile(temporaryPath, JSON.stringify(body.result, null, 2), {
          flag: "wx",
        });
        await NodeFSP.rename(temporaryPath, finalPath);
        db.prepare(`
          UPDATE jobs SET state='completed',lease_expires_at=NULL,result_path=?,updated_at=?
          WHERE version=?
        `).run(finalPath, now, job.version);
        db.prepare(
          "UPDATE workers SET status='idle',current_version=NULL,last_seen_at=? WHERE worker_id=?",
        ).run(now, workerId);
        send(response, 200, { ok: true, resultPath: finalPath });
        return;
      }
      if (request.url === "/v1/fail") {
        const error = typeof body.error === "string" ? body.error.slice(0, 4000) : "worker failed";
        db.prepare(`
          UPDATE jobs SET state=CASE WHEN attempts >= 4 THEN 'failed' ELSE 'queued' END,
            worker_id=NULL,lease_id=NULL,lease_expires_at=NULL,run_id=NULL,last_error=?,updated_at=?
          WHERE version=?
        `).run(error, now, job.version);
        db.prepare(
          "UPDATE workers SET status='idle',current_version=NULL,last_seen_at=? WHERE worker_id=?",
        ).run(now, workerId);
        send(response, 200, { ok: true });
        return;
      }
      send(response, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(response, message === "lease is not current" ? 409 : 400, { error: message });
    }
  });

  server.listen(port, values.listen, () => {
    const address = server.address();
    const actualPort = address !== null && typeof address !== "string" ? address.port : port;
    console.log(
      `${new Date().toISOString()} scheduler listening on ${values.listen}:${actualPort} contract=${values.contract}`,
    );
  });
  const close = () => {
    clearInterval(refreshTimer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
  return await new Promise<number>(() => undefined);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
