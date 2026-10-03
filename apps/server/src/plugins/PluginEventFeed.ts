/**
 * Delivers the curated event projection (contracts `PluginEvent`) to every
 * enabled plugin that declares the `events` capability.
 *
 * Each such installation has a durable cursor: the event log sequence it has
 * acknowledged through. Its worker reads the log after the cursor in bounded
 * windows and pages, calls the plugin's `t3.events` handler through the
 * catalogue, and moves the cursor past a page only after the plugin answered
 * it. A failed page is retried with backoff and, after `maxFailures`
 * consecutive failures, the worker is quarantined with the cursor unchanged
 * until `resume`, a re-enable, or a server restart. Delivery is at-least-once.
 *
 * The cursor starts at the end of the log the first time an installation is
 * enabled, so a new plugin sees only later events. It belongs to the
 * installation: disable and re-enable, consent to changed bytes, and restarts
 * continue from it; remove forgets it. Workers never subscribe to raw events:
 * a commit of a projected event type only wakes them, and they read the store.
 */
import {
  OrchestrationV2RunFinalizationFailed,
  OrchestrationV2RunFinalized,
  PLUGIN_EVENT_THREAD_TITLE_MAX_LENGTH,
  PLUGIN_EVENT_TYPES,
  PLUGIN_EVENTS_CAPABILITY,
  PluginEventPage,
  type EnvironmentId,
  type PluginEvent,
  type PluginInstallation,
  type PluginInstallationId,
  EventId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { PluginCatalog } from "./PluginCatalog.ts";
import { PLUGIN_EVENTS_HANDLER } from "./pluginIpcFraming.ts";

export interface PluginEventFeedOptions {
  /** Most events in one page; at most `PLUGIN_EVENT_PAGE_MAX_EVENTS`. */
  readonly pageSize: number;
  /** Most log sequences one read scans, so a far-behind cursor never scans the whole log at once. */
  readonly scanWindow: number;
  /** How long the plugin may take to answer one page. */
  readonly deliveryTimeout: Duration.Input;
  readonly retryBackoff: Duration.Input;
  readonly maxRetryBackoff: Duration.Input;
  /** Consecutive failed attempts at one page before the worker is quarantined. */
  readonly maxFailures: number;
}

const defaultOptions: PluginEventFeedOptions = {
  pageSize: 32,
  scanWindow: 4096,
  deliveryTimeout: Duration.seconds(30),
  retryBackoff: Duration.seconds(2),
  maxRetryBackoff: Duration.minutes(1),
  maxFailures: 5,
};

/** What one installation's worker is doing. Kept in memory; only the cursor is durable. */
export type PluginEventFeedState =
  | { readonly _tag: "waiting" }
  | { readonly _tag: "delivering" }
  | {
      readonly _tag: "retrying";
      readonly failures: number;
      readonly reason: string;
      readonly retryAt: string;
    }
  | { readonly _tag: "quarantined"; readonly failures: number; readonly reason: string }
  /** The registration it delivered to was revoked; the next catalogue change replaces it. */
  | { readonly _tag: "stopped" };

export interface PluginEventFeedStatus {
  readonly generation: number;
  /** The log sequence acknowledged through, or undefined before it was loaded. */
  readonly cursor: number | undefined;
  readonly state: PluginEventFeedState;
}

/** Milestones a worker reaches, for logs and tests. */
export type PluginEventFeedReceipt =
  | {
      /** A worker loaded its cursor and delivers everything after it. */
      readonly _tag: "Started";
      readonly installationId: PluginInstallationId;
      readonly generation: number;
      readonly cursor: number;
    }
  | {
      readonly _tag: "Acknowledged";
      readonly installationId: PluginInstallationId;
      readonly generation: number;
      /** The new cursor. */
      readonly throughSequence: number;
      /** Events the plugin answered for; 0 when the window held none. */
      readonly delivered: number;
    }
  | {
      readonly _tag: "Failed";
      readonly installationId: PluginInstallationId;
      readonly generation: number;
      readonly cursor: number;
      readonly failures: number;
      readonly reason: string;
    }
  | {
      readonly _tag: "Quarantined";
      readonly installationId: PluginInstallationId;
      readonly generation: number;
      readonly cursor: number;
      readonly failures: number;
      readonly reason: string;
    }
  /** A removed installation's cursor was deleted. */
  | { readonly _tag: "Forgotten"; readonly installationId: PluginInstallationId };

export class PluginEventFeed extends Context.Service<
  PluginEventFeed,
  {
    readonly status: (
      installationId: PluginInstallationId,
    ) => Effect.Effect<Option.Option<PluginEventFeedStatus>>;
    /** Restarts a quarantined worker from its cursor. Does nothing otherwise. */
    readonly resume: (installationId: PluginInstallationId) => Effect.Effect<void>;
    /** Subscribes before returning, so no receipt after this point is missed (sliding, 1024). */
    readonly subscribe: Effect.Effect<
      PubSub.Subscription<PluginEventFeedReceipt>,
      never,
      Scope.Scope
    >;
  }
>()("t3/plugins/PluginEventFeed") {}

interface EventRow {
  readonly sequence: number;
  readonly event_id: string;
  readonly event_type: string;
  readonly stream_id: string;
  readonly occurred_at: string;
  readonly payload_json: string;
}

interface Worker {
  readonly generation: number;
  cursor: number | undefined;
  state: PluginEventFeedState;
  fiber: Fiber.Fiber<unknown, unknown> | undefined;
}

const decodeFinalized = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2RunFinalized),
);
const decodeFinalizationFailed = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2RunFinalizationFailed),
);
const encodePage = Schema.encodeEffect(PluginEventPage);

/** Cuts `text` to `max` UTF-16 units without splitting a surrogate pair. */
const truncate = (text: string, max: number) => {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
};

/** True for an installation the feed delivers to: enabled, registered, and asking for events. */
const receivesEvents = (installation: PluginInstallation) =>
  installation.enabled &&
  installation.hostState !== undefined &&
  installation.manifest?.capabilities.includes(PLUGIN_EVENTS_CAPABILITY) === true;

export const make = Effect.fn("PluginEventFeed.make")(function* (
  overrides: Partial<PluginEventFeedOptions> = {},
) {
  const options = { ...defaultOptions, ...overrides };
  const retryBackoff = Duration.fromInputUnsafe(options.retryBackoff);
  const maxRetryBackoff = Duration.fromInputUnsafe(options.maxRetryBackoff);
  const sql = yield* SqlClient.SqlClient;
  const catalog = yield* PluginCatalog;
  const eventSink = yield* EventSinkV2;
  const projections = yield* ProjectionStoreV2;
  const environmentId: EnvironmentId = yield* (yield* ServerEnvironment).getEnvironmentId;
  const scope = yield* Effect.scope;

  const workers = new Map<PluginInstallationId, Worker>();
  // Reconciling and resuming both replace workers; one at a time.
  const lock = yield* Semaphore.make(1);
  // A pending wake per worker is enough: the worker reads everything after its cursor.
  const wakes = yield* PubSub.sliding<void>(1);
  const receipts = yield* PubSub.sliding<PluginEventFeedReceipt>(1024);
  const publish = (receipt: PluginEventFeedReceipt) =>
    PubSub.publish(receipts, receipt).pipe(Effect.asVoid);

  const loadCursor = Effect.fnUntraced(function* (installationId: PluginInstallationId) {
    // The first start begins at the end of the log; later starts keep the stored cursor.
    const head = yield* eventSink.latestSequence();
    yield* sql`
      INSERT INTO plugin_event_cursors (installation_id, acknowledged_sequence, updated_at)
      VALUES (${installationId}, ${head}, ${DateTime.formatIso(yield* DateTime.now)})
      ON CONFLICT (installation_id) DO NOTHING
    `;
    const rows = yield* sql<{ readonly acknowledged_sequence: number }>`
      SELECT acknowledged_sequence FROM plugin_event_cursors
      WHERE installation_id = ${installationId}
    `;
    return rows[0]?.acknowledged_sequence ?? head;
  });

  const saveCursor = Effect.fnUntraced(function* (
    installationId: PluginInstallationId,
    sequence: number,
  ) {
    yield* sql`
      UPDATE plugin_event_cursors
      SET acknowledged_sequence = ${sequence},
          updated_at = ${DateTime.formatIso(yield* DateTime.now)}
      WHERE installation_id = ${installationId}
    `;
  });

  const readRows = (afterSequence: number, throughSequence: number) =>
    sql<EventRow>`
      SELECT sequence, event_id, event_type, stream_id, occurred_at, payload_json
      FROM orchestration_events
      WHERE sequence > ${afterSequence}
        AND sequence <= ${throughSequence}
        AND application_event_version = 2
        AND aggregate_kind = 'thread'
        AND event_type IN ${sql.in(PLUGIN_EVENT_TYPES)}
      ORDER BY sequence ASC
      LIMIT ${options.pageSize}
    `;

  /** Projects one stored row; undefined for a row that cannot be read, which is skipped. */
  const project = Effect.fnUntraced(function* (row: EventRow) {
    const threadId = ThreadId.make(row.stream_id);
    const shell = yield* projections.getThreadShell(threadId);
    const base = {
      deliveryId: EventId.make(row.event_id),
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      environmentId,
      threadId,
      thread:
        shell === null
          ? null
          : {
              projectId: shell.projectId,
              title: truncate(shell.title, PLUGIN_EVENT_THREAD_TITLE_MAX_LENGTH),
            },
    };
    const event: Effect.Effect<PluginEvent, Schema.SchemaError> =
      row.event_type === "run.finalized"
        ? decodeFinalized(row.payload_json).pipe(
            Effect.map((payload) => ({
              ...base,
              type: "run.finalized" as const,
              runId: payload.runId,
              outcome: payload.outcome,
            })),
          )
        : decodeFinalizationFailed(row.payload_json).pipe(
            Effect.map((payload) => ({
              ...base,
              type: "run.finalization-failed" as const,
              runId: payload.runId,
              operation: payload.operation,
            })),
          );
    return yield* event.pipe(
      Effect.catch(() =>
        Effect.logWarning("Skipping an unreadable event for plugins", {
          sequence: row.sequence,
        }).pipe(Effect.as(undefined)),
      ),
    );
  });

  const backoff = (failures: number) =>
    Duration.min(Duration.times(retryBackoff, 2 ** (failures - 1)), maxRetryBackoff);

  /** Delivers to one registration until interrupted. */
  const run = (installationId: PluginInstallationId, worker: Worker) =>
    Effect.gen(function* () {
      const generation = worker.generation;
      const wake = yield* PubSub.subscribe(wakes);
      let cursor = yield* loadCursor(installationId);
      worker.cursor = cursor;
      yield* publish({ _tag: "Started", installationId, generation, cursor });
      let failures = 0;
      while (true) {
        const head = yield* eventSink.latestSequence();
        if (cursor >= head) {
          worker.state = { _tag: "waiting" };
          yield* PubSub.take(wake);
          continue;
        }
        const through = Math.min(head, cursor + options.scanWindow);
        const rows = yield* readRows(cursor, through);
        // A full page covers the log only up to its last event.
        const covered =
          rows.length === options.pageSize ? (rows.at(-1)?.sequence ?? through) : through;
        const events = (yield* Effect.forEach(rows, project)).filter(
          (event): event is PluginEvent => event !== undefined,
        );
        if (events.length > 0) {
          worker.state = { _tag: "delivering" };
          const input = yield* encodePage({ events }).pipe(Effect.orDie);
          const exit = yield* catalog
            .invoke(installationId, PLUGIN_EVENTS_HANDLER, input, {
              timeout: options.deliveryTimeout,
              generation,
            })
            .pipe(Effect.exit);
          if (exit._tag === "Failure") {
            const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
            // Revoked or replaced: this registration is over, and a catalogue change follows.
            if (error?._tag === "PluginCatalogError" || error?._tag === "PluginStoppedError") {
              worker.state = { _tag: "stopped" };
              return yield* Effect.never;
            }
            if (error === undefined) return yield* Effect.failCause(exit.cause);
            failures++;
            const reason = error.message.slice(0, 1000);
            if (failures >= options.maxFailures) {
              worker.state = { _tag: "quarantined", failures, reason };
              yield* Effect.logWarning("Quarantined a plugin's event delivery", {
                installationId,
                cursor,
                failures,
                reason,
              });
              yield* publish({
                _tag: "Quarantined",
                installationId,
                generation,
                cursor,
                failures,
                reason,
              });
              return yield* Effect.never;
            }
            const delay = backoff(failures);
            worker.state = {
              _tag: "retrying",
              failures,
              reason,
              retryAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, delay)),
            };
            yield* publish({
              _tag: "Failed",
              installationId,
              generation,
              cursor,
              failures,
              reason,
            });
            yield* Effect.sleep(delay);
            continue;
          }
          failures = 0;
        }
        yield* saveCursor(installationId, covered);
        cursor = covered;
        worker.cursor = cursor;
        yield* publish({
          _tag: "Acknowledged",
          installationId,
          generation,
          throughSequence: covered,
          delivered: events.length,
        });
      }
    }).pipe(
      Effect.scoped,
      // Storage trouble is not the plugin's failure: wait and start over from the stored cursor.
      Effect.tapError((error) =>
        Effect.logWarning("Plugin event delivery could not read or save its cursor", {
          installationId,
          error,
        }),
      ),
      Effect.retry(Schedule.spaced(maxRetryBackoff)),
      Effect.asVoid,
    );

  const start = Effect.fnUntraced(function* (
    installationId: PluginInstallationId,
    generation: number,
    cursor: number | undefined,
  ) {
    const worker: Worker = { generation, cursor, state: { _tag: "waiting" }, fiber: undefined };
    workers.set(installationId, worker);
    worker.fiber = yield* run(installationId, worker).pipe(
      Effect.forkIn(scope, { startImmediately: true }),
    );
  });

  const stop = Effect.fnUntraced(function* (installationId: PluginInstallationId) {
    const worker = workers.get(installationId);
    if (worker === undefined) return;
    workers.delete(installationId);
    if (worker.fiber) yield* Fiber.interrupt(worker.fiber);
  });

  let known: ReadonlySet<PluginInstallationId> | undefined;

  const reconcile = (installations: ReadonlyArray<PluginInstallation>) =>
    lock.withPermit(
      Effect.gen(function* () {
        const wanted = new Map(
          installations
            .filter(receivesEvents)
            .map((installation) => [installation.installationId, installation.generation]),
        );
        for (const [installationId, worker] of workers) {
          if (wanted.get(installationId) !== worker.generation) yield* stop(installationId);
        }
        for (const [installationId, generation] of wanted) {
          if (!workers.has(installationId)) yield* start(installationId, generation, undefined);
        }
        // Removed installations forget their cursor; a later add is a new installation.
        const present = new Set(installations.map((installation) => installation.installationId));
        for (const installationId of known ?? []) {
          if (present.has(installationId)) continue;
          yield* sql`DELETE FROM plugin_event_cursors WHERE installation_id = ${installationId}`.pipe(
            Effect.andThen(publish({ _tag: "Forgotten", installationId })),
            Effect.catch((error) =>
              Effect.logWarning("Could not forget a removed plugin's event cursor", {
                installationId,
                error,
              }),
            ),
          );
        }
        known = present;
      }),
    );

  yield* catalog.subscribe.pipe(
    Stream.runForEach((snapshot) => reconcile(snapshot.installations)),
    Effect.forkScoped,
  );

  // Only commits of projected types wake workers; the events themselves are read from the store.
  const head = yield* eventSink.latestSequence().pipe(Effect.orElseSucceed(() => 0));
  yield* Stream.mergeAll(
    PLUGIN_EVENT_TYPES.map((eventType) => eventSink.stream({ eventType, afterSequence: head })),
    { concurrency: "unbounded" },
  ).pipe(
    Stream.runForEach(() => PubSub.publish(wakes, undefined)),
    Effect.tapError((error) => Effect.logWarning("Plugin event wakeups stopped", { error })),
    Effect.retry(Schedule.spaced(maxRetryBackoff)),
    Effect.forkScoped,
  );

  return PluginEventFeed.of({
    status: (installationId) =>
      Effect.sync(() =>
        Option.fromNullishOr(workers.get(installationId)).pipe(
          Option.map(({ generation, cursor, state }) => ({ generation, cursor, state })),
        ),
      ),
    resume: (installationId) =>
      lock.withPermit(
        Effect.suspend(() => {
          const worker = workers.get(installationId);
          if (worker?.state._tag !== "quarantined") return Effect.void;
          return stop(installationId).pipe(
            Effect.andThen(start(installationId, worker.generation, worker.cursor)),
          );
        }),
      ),
    subscribe: PubSub.subscribe(receipts),
  });
});

export const layer = (overrides?: Partial<PluginEventFeedOptions>) =>
  Layer.effect(PluginEventFeed, make(overrides));
