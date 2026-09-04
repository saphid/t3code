// @effect-diagnostics globalDate:off -- ISO day/window arithmetic uses wall-clock reads through Effect Clock.
// @effect-diagnostics globalDateInEffect:off -- Pure timestamp conversion runs inside scan effects without reading the clock.
// @effect-diagnostics preferSchemaOverJson:off -- JSON.stringify is used for stable identity keys, not payload decoding.
/**
 * UsageService - scans provider transcripts and returns priced usage buckets.
 *
 * The scan reads the provider CLIs' own session files (Claude Code, Codex, and
 * Grok Build) rather than T3 Code's orchestration projections, so usage covers
 * turns driven outside T3 Code too. This is the approach `ccusage` takes.
 *
 * Transcripts are append-only, so parsed records are memoised per file by
 * `(size, mtime)`. A cold 30-day scan of ~1.4 GB lands around 2-3 seconds; warm
 * scans only reparse files that changed, and a file that merely grew resumes
 * from its cached parse position so only the appended bytes are read.
 *
 * @module UsageService
 */
import * as NodeOS from "node:os";

import {
  USAGE_CONTRACT_VERSION,
  ProjectId,
  UsageDay,
  UsageSummary as UsageSummarySchema,
  UsageSource as UsageSourceSchema,
  type UsageProviderKind,
  type UsageSource,
  type UsagePricing,
  type UsageSummary,
  type UsageSummaryInput,
  type UsageThreadBreakdown,
  type UsageThreadBreakdownInput,
  UsageReadError,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { makeDayFormatter, makeProjectResolver, UsageAggregator } from "./usageAggregation.ts";
import { addTotals, EMPTY_TOTALS, type UsageRecord } from "./usageTranscripts.ts";
import { parseRateTable, priceUsage, type RateTable } from "./usagePricing.ts";
import {
  listTranscriptFilesDetailed,
  readDirectoryVolumeIdDetailed,
  readTranscriptRecordsDetailed,
  readTranscriptTitle,
} from "./usageTranscriptReader.ts";
import { foldThreadRows, ThreadUsageAccumulator, type ThreadRef } from "./usageThreads.ts";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type ScanCache,
} from "./usageScanCache.ts";

const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Rates move rarely; a day-old table keeps the page working offline. */
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

/** An explicit refresh ignores the TTL, but not a table fetched this recently. */
const RATES_REFRESH_FLOOR_MS = 60 * 1000;

/**
 * Files are filtered by mtime before opening. The slack covers a session whose
 * last write lands just before local midnight on the window's first day.
 */
// Covers the full supported UTC offset spread plus DST and filesystem write
// skew when a remote viewer's calendar day differs from the server's.
const MTIME_SLACK_MS = 72 * 60 * 60 * 1000;
const MAX_HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_HALF_HOUR_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Longest window the UI offers, plus slack. Older entries are pruned. */
const CACHE_RETENTION_DAYS = 90;

/**
 * Maximum rows sent per breakdown request, including grouped remainders. A
 * window can hold thousands of sessions, so lower-cost rows fold together.
 */
const THREAD_ROW_CAP = 40;

/** On-disk shape of the rate snapshot. */
const RatesCacheFile = Schema.Struct({
  fetchedAtMs: Schema.Number,
  document: Schema.Unknown,
});
const decodeRatesCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);
const encodeRatesCache = Schema.encodeEffect(
  Schema.fromJsonString(RatesCacheFile as unknown as Schema.Codec<typeof RatesCacheFile.Type>),
);

/** The scan cache is narrowed by hand in `usageScanCache`, so JSON is enough here. */
const ScanCacheJson = Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>);
const decodeScanCacheFile = Schema.decodeUnknownEffect(ScanCacheJson);
const encodeScanCacheFile = Schema.encodeEffect(ScanCacheJson);

const UsageSnapshotFile = Schema.Struct({
  version: Schema.Literal(1),
  entries: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      summary: UsageSummarySchema,
    }),
  ),
});
const UsageLedgerRecord = Schema.Struct({
  hostId: Schema.String,
  provider: Schema.Literals(["claude", "codex", "grok"]),
  resolvedHomePath: Schema.String,
  volumeId: Schema.String,
  record: Schema.Struct({
    provider: Schema.Literals(["claude", "codex", "grok"]),
    timestampMs: Schema.Number,
    model: Schema.String,
    sessionId: Schema.String,
    totals: Schema.Struct({
      uncachedInputTokens: Schema.Number,
      cachedInputTokens: Schema.Number,
      cacheCreationTokens: Schema.Number,
      cacheCreation5mTokens: Schema.optional(Schema.Number),
      cacheCreation1hTokens: Schema.optional(Schema.Number),
      outputTokens: Schema.Number,
      reasoningTokens: Schema.Number,
    }),
    reportedCostUsd: Schema.NullOr(Schema.Number),
    dedupeKey: Schema.NullOr(Schema.String),
  }),
});
const UsageLedgerAggregate = Schema.Struct({
  hostId: Schema.String,
  provider: Schema.Literals(["claude", "codex", "grok"]),
  resolvedHomePath: Schema.String,
  volumeId: Schema.String,
  /** UTC quarter-hour containing the source records. */
  bucketStartMs: Schema.Number,
  model: Schema.String,
  projectAttribution: Schema.optional(Schema.Literals(["project", "outside", "unknown"])),
  projectId: Schema.optional(ProjectId),
  project: Schema.optional(Schema.String),
  totals: Schema.Struct({
    uncachedInputTokens: Schema.Number,
    cachedInputTokens: Schema.Number,
    cacheCreationTokens: Schema.Number,
    cacheCreation5mTokens: Schema.optional(Schema.Number),
    cacheCreation1hTokens: Schema.optional(Schema.Number),
    outputTokens: Schema.Number,
    reasoningTokens: Schema.Number,
  }),
  pricedTotals: Schema.Struct({
    uncachedInputTokens: Schema.Number,
    cachedInputTokens: Schema.Number,
    cacheCreationTokens: Schema.Number,
    cacheCreation5mTokens: Schema.optional(Schema.Number),
    cacheCreation1hTokens: Schema.optional(Schema.Number),
    outputTokens: Schema.Number,
    reasoningTokens: Schema.Number,
  }),
  /** Cache tokens remain savings-eligible for provider-reported records. */
  savingsTotals: Schema.optional(
    Schema.Struct({
      uncachedInputTokens: Schema.Number,
      cachedInputTokens: Schema.Number,
      cacheCreationTokens: Schema.Number,
      cacheCreation5mTokens: Schema.optional(Schema.Number),
      cacheCreation1hTokens: Schema.optional(Schema.Number),
      outputTokens: Schema.Number,
      reasoningTokens: Schema.Number,
    }),
  ),
  /** v1 rows need the current rate table to determine whether they are priced. */
  legacyPricing: Schema.optional(Schema.Boolean),
  /** Number of null-cost v1 rows represented by this aggregate. */
  legacyPricingRecords: Schema.optional(Schema.Number),
  reportedCostUsd: Schema.Number,
  records: Schema.Number,
  unpricedRecords: Schema.Number,
  providerReportedRecords: Schema.Number,
  sessions: Schema.Array(Schema.String),
});
const UsageLedgerFileV1 = Schema.Struct({
  version: Schema.Literal(1),
  generatedAtMs: Schema.Number,
  records: Schema.Array(UsageLedgerRecord),
});
const UsageLedgerFile = Schema.Struct({
  version: Schema.Literal(2),
  generatedAtMs: Schema.Number,
  aggregates: Schema.Array(UsageLedgerAggregate),
  sources: Schema.Array(UsageSourceSchema),
});

/** Optional lifecycle hook used by the server usage tests. */
export class UsageRefreshHooks extends Context.Reference<{
  readonly beforeCanonicalScan: Effect.Effect<void>;
}>("@t3tools/UsageRefreshHooks", {
  defaultValue: () => ({ beforeCanonicalScan: Effect.void }),
}) {}
const decodeUsageSnapshotFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    UsageSnapshotFile as unknown as Schema.Codec<typeof UsageSnapshotFile.Type>,
  ),
);
const encodeUsageSnapshotFile = Schema.encodeEffect(
  Schema.fromJsonString(
    UsageSnapshotFile as unknown as Schema.Codec<typeof UsageSnapshotFile.Type>,
  ),
);
const decodeUsageLedgerFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Union([UsageLedgerFile, UsageLedgerFileV1]) as unknown as Schema.Codec<
      typeof UsageLedgerFile.Type | typeof UsageLedgerFileV1.Type
    >,
  ),
);
const encodeUsageLedgerFile = Schema.encodeEffect(
  Schema.fromJsonString(UsageLedgerFile as unknown as Schema.Codec<typeof UsageLedgerFile.Type>),
);

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKGROUND_REFRESH_INTERVAL = "30 minutes";
const BACKGROUND_REFRESH_TIMEOUT = "5 minutes";
const MAX_USAGE_SNAPSHOTS = 16;
// Keep two days of timezone slack so a 90-day calendar window can be rebuilt
// after a UTC/local-midnight rollover without losing its first day.
const USAGE_LEDGER_RETENTION_MS = 92 * DAY_MS;

/** Runs the initial refresh immediately, then schedules one refresh per interval. */
export const backgroundRefreshSchedule = (refresh: Effect.Effect<void>) =>
  refresh.pipe(
    Effect.andThen(
      Effect.forever(Effect.sleep(BACKGROUND_REFRESH_INTERVAL).pipe(Effect.andThen(refresh))),
    ),
  );

function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function previousCalendarDay(timeZone: string, nowMs: number): string {
  const today = makeDayFormatter(timeZone)(nowMs);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  return new Date(todayMs - DAY_MS).toISOString().slice(0, 10);
}

function formatInstant(epochMs: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(epochMs));
}

function snapshotKey(input: UsageSummaryInput): string {
  return JSON.stringify([
    input.timeZone,
    input.sinceDay,
    input.untilDay,
    input.resolution ?? "day",
    input.sinceTime ?? null,
    input.untilTime ?? null,
  ]);
}

function isCommonPreset(input: UsageSummaryInput): boolean {
  if (input.resolution === "hour" || input.resolution === "halfHour") {
    if (input.sinceTime === undefined || input.untilTime === undefined) return false;
    const sinceTimeMs = Date.parse(input.sinceTime);
    const untilTimeMs = Date.parse(input.untilTime);
    const quarterHour = 15 * 60 * 1000;
    const durationDays = (untilTimeMs - sinceTimeMs) / DAY_MS;
    return (
      Number.isFinite(sinceTimeMs) &&
      Number.isFinite(untilTimeMs) &&
      sinceTimeMs % quarterHour === 0 &&
      untilTimeMs % quarterHour === 0 &&
      (input.resolution === "hour"
        ? durationDays === 1
        : durationDays === 1 || durationDays === 7 || durationDays === 30 || durationDays === 90)
    );
  }
  const days =
    (Date.parse(`${input.untilDay}T00:00:00Z`) - Date.parse(`${input.sinceDay}T00:00:00Z`)) /
      DAY_MS +
    1;
  return days === 1 || days === 7 || days === 30 || days === 90;
}

function localStartOfDayMs(timeZone: string, day: string): number {
  const [yearText, monthText, dayText] = day.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const calendarDay = Number(dayText);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(calendarDay)
  ) {
    return Number.NaN;
  }

  // `compatible` chooses the first occurrence for a repeated midnight and
  // the first valid instant after a midnight gap. Validate the resulting
  // civil date because a whole date can be skipped (for example, Apia in
  // 2011), in which case the adjusted value belongs to the following date.
  const zone = Option.getOrElse(DateTime.zoneMakeNamed(timeZone), () =>
    DateTime.zoneMakeNamedUnsafe("UTC"),
  );
  const resolved = DateTime.makeZoned(
    { year, month, day: calendarDay, hour: 0, minute: 0, second: 0, millisecond: 0 },
    { timeZone: zone, adjustForTimeZone: true, disambiguation: "compatible" },
  );
  if (Option.isNone(resolved)) return Number.NaN;
  const parts = DateTime.toParts(resolved.value);
  return parts.year === year && parts.month === month && parts.day === calendarDay
    ? DateTime.toEpochMillis(resolved.value)
    : Number.NaN;
}

function isWithinLedgerRetention(input: UsageSummaryInput, nowMs: number): boolean {
  const sinceMs =
    input.resolution !== "day" && input.sinceTime !== undefined
      ? Date.parse(input.sinceTime)
      : localStartOfDayMs(input.timeZone, input.sinceDay);
  return Number.isFinite(sinceMs) && sinceMs >= nowMs - USAGE_LEDGER_RETENTION_MS;
}

function isCanonicalLedgerInput(input: UsageSummaryInput): boolean {
  if (input.resolution === "hour" || input.resolution === "halfHour") return false;
  const days =
    (Date.parse(`${input.untilDay}T00:00:00Z`) - Date.parse(`${input.sinceDay}T00:00:00Z`)) /
      DAY_MS +
    1;
  return days === 90;
}

type SourceFingerprint = {
  readonly hostId: string;
  readonly provider: UsageProviderKind;
  readonly resolvedHomePath: string;
  readonly volumeId: string;
};

function sourceKey(source: SourceFingerprint): string {
  return JSON.stringify([source.hostId, source.provider, source.resolvedHomePath, source.volumeId]);
}

function ledgerAggregateKey(aggregate: {
  readonly hostId: string;
  readonly provider: UsageProviderKind;
  readonly resolvedHomePath: string;
  readonly volumeId: string;
  readonly bucketStartMs: number;
  readonly projectAttribution?: UsageSummary["buckets"][number]["projectAttribution"];
  readonly projectId?: ProjectId;
  readonly project?: string;
  readonly model: string;
}): string {
  return JSON.stringify([
    aggregate.hostId,
    aggregate.provider,
    aggregate.resolvedHomePath,
    aggregate.volumeId,
    aggregate.bucketStartMs,
    aggregate.projectAttribution ?? "unknown",
    aggregate.projectId ?? "",
    aggregate.project ?? "",
    aggregate.model,
  ]);
}

function ledgerAggregateFromRecord(entry: {
  readonly hostId: string;
  readonly provider: UsageProviderKind;
  readonly resolvedHomePath: string;
  readonly volumeId: string;
  readonly record: Omit<UsageRecord, "cwd"> & { readonly cwd?: string };
}): LedgerAggregate {
  const { record } = entry;
  const reported = record.reportedCostUsd === null ? 0 : record.reportedCostUsd;
  return {
    hostId: entry.hostId,
    provider: entry.provider,
    resolvedHomePath: entry.resolvedHomePath,
    volumeId: entry.volumeId,
    bucketStartMs: Math.floor(record.timestampMs / (15 * 60 * 1000)) * (15 * 60 * 1000),
    model: record.model,
    totals: record.totals,
    // v1 did not persist pricing provenance. Preserve token totals and any
    // reported cost; legacyPricing lets reads resolve null-cost rows safely.
    pricedTotals: record.reportedCostUsd === null ? record.totals : EMPTY_TOTALS,
    reportedCostUsd: reported,
    records: 1,
    // Keep null-cost rows in pricedTotals so a cached rate can recover their
    // cost. Unknown models are counted as unpriced at read time.
    unpricedRecords: 0,
    savingsTotals: record.totals,
    legacyPricing: record.reportedCostUsd === null,
    legacyPricingRecords: record.reportedCostUsd === null ? 1 : 0,
    providerReportedRecords: record.reportedCostUsd === null ? 0 : 1,
    sessions: record.sessionId.length === 0 ? [] : [record.sessionId],
  };
}

function mergeLedgerAggregate(
  ledger: Map<string, LedgerAggregate>,
  incoming: LedgerAggregate,
): void {
  const key = ledgerAggregateKey(incoming);
  const existing = ledger.get(key);
  if (existing === undefined) {
    ledger.set(key, incoming);
    return;
  }
  const sessions = new Set(existing.sessions);
  for (const session of incoming.sessions) sessions.add(session);
  ledger.set(key, {
    ...existing,
    totals: addTotals(existing.totals, incoming.totals),
    pricedTotals: addTotals(existing.pricedTotals, incoming.pricedTotals),
    savingsTotals: addTotals(existing.savingsTotals, incoming.savingsTotals),
    legacyPricing: existing.legacyPricing || incoming.legacyPricing,
    legacyPricingRecords: existing.legacyPricingRecords + incoming.legacyPricingRecords,
    reportedCostUsd: existing.reportedCostUsd + incoming.reportedCostUsd,
    records: existing.records + incoming.records,
    unpricedRecords: existing.unpricedRecords + incoming.unpricedRecords,
    providerReportedRecords: existing.providerReportedRecords + incoming.providerReportedRecords,
    sessions: [...sessions],
  });
}

interface LedgerAggregate {
  readonly hostId: string;
  readonly provider: UsageProviderKind;
  readonly resolvedHomePath: string;
  readonly volumeId: string;
  readonly bucketStartMs: number;
  readonly model: string;
  readonly projectAttribution?: UsageSummary["buckets"][number]["projectAttribution"];
  readonly projectId?: ProjectId;
  readonly project?: string;
  readonly totals: UsageRecord["totals"];
  readonly pricedTotals: UsageRecord["totals"];
  readonly savingsTotals: UsageRecord["totals"];
  readonly legacyPricing: boolean;
  readonly legacyPricingRecords: number;
  readonly reportedCostUsd: number;
  readonly records: number;
  readonly unpricedRecords: number;
  readonly providerReportedRecords: number;
  readonly sessions: readonly string[];
}

interface ScanResult {
  readonly summary: UsageSummary;
  readonly ledgerAggregates: readonly LedgerAggregate[];
  readonly ledgerSources: UsageSummary["sources"];
  readonly scanStartedAtMs: number;
}

export function isValidUsageDay(day: string): boolean {
  const parsed = DateTime.make(`${day}T00:00:00Z`);
  return Option.isSome(parsed) && DateTime.formatIso(parsed.value).slice(0, 10) === day;
}

export class UsageService extends Context.Service<
  UsageService,
  {
    readonly readSummary: (input: UsageSummaryInput) => Effect.Effect<UsageSummary, UsageReadError>;
    /** Refetches the rate table ahead of its TTL. See `ensureRates`. */
    readonly refreshRates: Effect.Effect<UsagePricing>;
    readonly refreshSummary: (
      input: UsageSummaryInput,
    ) => Effect.Effect<UsageSummary, UsageReadError>;
    readonly startBackgroundRefresh: Effect.Effect<void>;
    readonly readThreadBreakdown: (
      input: UsageThreadBreakdownInput,
    ) => Effect.Effect<UsageThreadBreakdown, UsageReadError>;
  }
>()("t3/usage/UsageService") {}

const EMPTY_PRICING: UsagePricing = {
  status: "unavailable",
  source: LITELLM_RATES_URL,
  fetchedAt: null,
  knownModels: 0,
};

/** Empty summary, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  UsageService,
  UsageService.of({
    readSummary: (input) =>
      Effect.succeed({
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: "1970-01-01T00:00:00.000Z",
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        resolution: input.resolution ?? "day",
        buckets: [],
        sources: [],
        pricing: EMPTY_PRICING,
        coverage: {
          availableThroughDay: input.untilDay,
          availableThroughTime: null,
          generatedAt: "1970-01-01T00:00:00.000Z",
        },
        scanDurationMs: 0,
      }),
    refreshRates: Effect.succeed(EMPTY_PRICING),
    startBackgroundRefresh: Effect.void,
    refreshSummary: (_input) =>
      Effect.fail(
        new UsageReadError({ reason: "scanFailed", detail: "Usage refresh is unavailable." }),
      ),
    readThreadBreakdown: (input) =>
      Effect.succeed({
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: "1970-01-01T00:00:00.000Z",
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        rows: [],
        truncatedRows: 0,
        scanDurationMs: 0,
      }),
  }),
);

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const refreshHooks = yield* UsageRefreshHooks;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const hostEnvironment = yield* HostProcessEnvironment;
  const projectRepository = yield* ProjectionProjectRepository;
  const threadRepository = yield* ProjectionThreadRepository;
  const runtimeRepository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;

  const fileCache: ScanCache = new Map();
  let cacheDirty = false;
  const usageSnapshots = new Map<string, UsageSummary>();
  let snapshotsDirty = false;
  const scanSemaphore = yield* Semaphore.make(1);

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, "usage-scan-cache.json");
  const usageSnapshotPath = path.join(config.stateDir, "usage-snapshot.json");
  const usageLedgerPath = path.join(config.stateDir, "usage-record-ledger.json");
  const usageLedger = new Map<string, LedgerAggregate>();
  const usageLedgerSources = new Map<string, UsageSummary["sources"][number]>();
  let usageLedgerGeneratedAtMs = 0;
  let usageLedgerSupportsProjects = true;
  let usageLedgerDirty = false;
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: UsagePricing["status"] = "unavailable";
  // One fetch at a time. A burst of refreshes from several clients waits on
  // the first fetch and then sees a table young enough to skip its own.
  const ratesLock = yield* Semaphore.make(1);

  const pricing = (): UsagePricing => ({
    status: ratesStatus,
    source: LITELLM_RATES_URL,
    fetchedAt:
      ratesFetchedAtMs === null ? null : DateTime.formatIso(DateTime.makeUnsafe(ratesFetchedAtMs)),
    knownModels: rates.size,
  });

  /**
   * Loads the LiteLLM rate table, preferring a fresh copy and falling back to
   * the on-disk snapshot. With neither, every model reports as unpriced rather
   * than the page failing. `force` refetches inside the TTL so a model that
   * LiteLLM added since the last fetch gets priced now.
   */
  const loadRates = Effect.fn("UsageService.loadRates")(function* (options: {
    readonly allowNetwork: boolean;
    readonly force: boolean;
  }) {
    const now = yield* Clock.currentTimeMillis;
    const maxAgeMs = options.force ? RATES_REFRESH_FLOOR_MS : RATES_TTL_MS;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < maxAgeMs) return;

    if (ratesFetchedAtMs === null) {
      const fromDisk = yield* fileSystem.readFileString(ratesCachePath).pipe(
        Effect.flatMap((raw) => decodeRatesCache(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (fromDisk !== null) {
        const parsed = parseRateTable(fromDisk.document);
        if (parsed.size > 0) {
          rates = parsed;
          ratesFetchedAtMs = fromDisk.fetchedAtMs;
          ratesStatus = "cached";
          if (now - fromDisk.fetchedAtMs < maxAgeMs) return;
        }
      }
    }

    if (!options.allowNetwork) return;

    const fetched = yield* httpClient.get(LITELLM_RATES_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(10_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) {
      // The refresh failed; whatever we are serving is now past its TTL and
      // must not keep claiming to be fresh.
      if (rates.size > 0) ratesStatus = "cached";
      return;
    }

    const parsed = parseRateTable(fetched);
    if (parsed.size === 0) return;

    rates = parsed;
    ratesFetchedAtMs = now;
    ratesStatus = "fresh";

    yield* encodeRatesCache({ fetchedAtMs: now, document: fetched }).pipe(
      Effect.flatMap((serialized) => fileSystem.writeFileString(ratesCachePath, serialized)),
      Effect.catchCause(() => Effect.void),
    );
  });

  const ensureRates = (options: { readonly allowNetwork: boolean; readonly force: boolean }) =>
    ratesLock.withPermit(loadRates(options));

  const refreshRates = ensureRates({ allowNetwork: true, force: true }).pipe(
    Effect.map(pricing),
    Effect.withSpan("UsageService.refreshRates"),
  );

  /**
   * Claude's config dir is the home itself when overridden, but a default
   * install nests transcripts under `~/.claude/projects`. Probe both.
   */
  const resolveClaudeTranscriptDir = (homePath: string) =>
    Effect.gen(function* () {
      const nested = path.join(homePath, ".claude", "projects");
      const nestedExists = yield* fileSystem
        .exists(nested)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      return nestedExists ? nested : path.join(homePath, "projects");
    });

  /** Resolves the transcript directory for each provider. */
  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* () {
    // A settings failure must surface as an error: swallowing it here would
    // present "zero usage from every provider" as a valid answer.
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(
        (cause) =>
          new UsageReadError({
            reason: "scanFailed",
            // Bounded description; the squashed failure travels as the cause.
            // Squashed, not the Cause tree: a full tree in a Defect field is
            // the unbounded wire payload the bounded detail exists to avoid.
            detail: "Server settings could not be read.",
            cause: Cause.squash(cause),
          }),
      ),
    );

    const claudeHome = yield* resolveClaudeHomePath(settings.providers.claudeAgent);
    const claudeDir = yield* resolveClaudeTranscriptDir(claudeHome);
    const codexLayout = yield* resolveCodexHomeLayout(settings.providers.codex);
    // Grok Settings only expose the binary path; home is `$GROK_HOME` or `~/.grok`.
    // Empty/whitespace GROK_HOME must fall back: coalescing alone would scan cwd.
    const grokHomeEnv = hostEnvironment["GROK_HOME"]?.trim() ?? "";
    const grokHome =
      grokHomeEnv.length > 0
        ? path.resolve(expandHomePath(grokHomeEnv))
        : path.join(NodeOS.homedir(), ".grok");

    return [
      { provider: "claude" as const, dir: claudeDir },
      { provider: "codex" as const, dir: path.join(codexLayout.sharedHomePath, "sessions") },
      {
        provider: "grok" as const,
        dir: path.join(grokHome, "sessions"),
        fileName: "updates.jsonl",
      },
    ];
  });

  /**
   * Builds the cwd → project-title resolver for one scan.
   *
   * Projects are re-read every scan so a project created or renamed since the
   * last refresh attributes correctly. A repository failure degrades to "no
   * attribution" rather than failing the page.
   */
  const resolveProjects = Effect.fn("UsageService.resolveProjects")(function* () {
    const projects = yield* projectRepository
      .listAll()
      .pipe(Effect.catchCause(() => Effect.succeed<readonly never[]>([])));
    const projectRoots = yield* Effect.forEach(
      projects,
      Effect.fnUntraced(function* (project) {
        const threads = yield* threadRepository
          .listByProjectId({ projectId: project.projectId })
          .pipe(Effect.catchCause(() => Effect.succeed<readonly never[]>([])));
        const root = {
          projectId: project.projectId,
          workspaceRoot: project.workspaceRoot,
          title: project.title,
          deleted: project.deletedAt !== null,
        };
        return [
          root,
          ...threads.flatMap((thread) =>
            thread.worktreePath === null ? [] : [{ ...root, workspaceRoot: thread.worktreePath }],
          ),
        ];
      }),
      { concurrency: 8 },
    );
    return makeProjectResolver(projectRoots.flat(), path.sep);
  });

  /**
   * Loads the persisted scan cache exactly once per process.
   *
   * `Effect.cached` makes concurrent first readers await the same load rather
   * than each seeing a "loaded" flag set before the read finished and cold
   * scanning against an empty cache.
   */
  const ensureScanCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const document = yield* fileSystem.readFileString(scanCachePath).pipe(
        Effect.flatMap((raw) => decodeScanCacheFile(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (document === null) return;
      for (const [path, entry] of decodeScanCache(document)) fileCache.set(path, entry);
    }),
  );

  /** Loads final summaries before serving the first usage request. */
  const ensureUsageSnapshotsLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const document = yield* fileSystem.readFileString(usageSnapshotPath).pipe(
        Effect.flatMap((raw) => decodeUsageSnapshotFile(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (document === null) return;
      for (const entry of document.entries) {
        usageSnapshots.set(entry.key, entry.summary);
      }
      for (const [key] of [...usageSnapshots.entries()]
        .toSorted(([, left], [, right]) =>
          (right.coverage?.generatedAt ?? right.readAt).localeCompare(
            left.coverage?.generatedAt ?? left.readAt,
          ),
        )
        .slice(MAX_USAGE_SNAPSHOTS)) {
        usageSnapshots.delete(key);
      }
    }),
  );

  const ensureUsageLedgerLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const document = yield* fileSystem.readFileString(usageLedgerPath).pipe(
        Effect.flatMap((raw) => decodeUsageLedgerFile(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (document === null) return;
      usageLedgerGeneratedAtMs = document.generatedAtMs;
      if (document.version === 2) {
        usageLedgerSupportsProjects = document.aggregates.every(
          (entry) => entry.projectAttribution !== undefined,
        );
        for (const source of document.sources) {
          usageLedgerSources.set(sourceKey(source.fingerprint), source);
        }
        for (const entry of document.aggregates) {
          const { projectAttribution, projectId, project, ...rest } = entry;
          const aggregate: LedgerAggregate = {
            ...rest,
            ...(projectAttribution === undefined ? {} : { projectAttribution }),
            ...(projectId === undefined ? {} : { projectId }),
            ...(project === undefined ? {} : { project }),
            savingsTotals: entry.savingsTotals ?? entry.totals,
            legacyPricing: entry.legacyPricing ?? false,
            legacyPricingRecords: entry.legacyPricingRecords ?? 0,
          };
          usageLedger.set(ledgerAggregateKey(aggregate), aggregate);
        }
        return;
      }
      // Migrate the pre-v2 raw record ledger in memory. It is rewritten in
      // compact form after the next successful canonical refresh.
      usageLedgerSupportsProjects = false;
      for (const entry of document.records) {
        const aggregate = ledgerAggregateFromRecord(entry);
        mergeLedgerAggregate(usageLedger, aggregate);
      }
    }),
  );

  const persistUsageSnapshots = Effect.fn("UsageService.persistUsageSnapshots")(function* () {
    if (!snapshotsDirty) return;
    const entries = [...usageSnapshots.entries()]
      .toSorted(([, left], [, right]) =>
        (right.coverage?.generatedAt ?? right.readAt).localeCompare(
          left.coverage?.generatedAt ?? left.readAt,
        ),
      )
      .slice(0, MAX_USAGE_SNAPSHOTS)
      .map(([key, summary]) => ({ key, summary }));
    yield* encodeUsageSnapshotFile({ version: 1, entries }).pipe(
      Effect.flatMap((serialized) =>
        writeFileStringAtomically({ filePath: usageSnapshotPath, contents: serialized }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.map(() => {
        snapshotsDirty = false;
      }),
      // A durable snapshot is an optimization. A failed write leaves the
      // previous last-good file intact and the next refresh retries it.
      Effect.tapCause((cause) => Effect.logWarning("Failed to persist usage snapshots", { cause })),
      Effect.catchCause(() => Effect.void),
    );
  });

  const persistUsageLedger = Effect.fn("UsageService.persistUsageLedger")(function* () {
    if (!usageLedgerDirty) return;
    const aggregates = [...usageLedger.values()];
    yield* encodeUsageLedgerFile({
      version: 2,
      generatedAtMs: usageLedgerGeneratedAtMs,
      aggregates,
      sources: [...usageLedgerSources.values()],
    }).pipe(
      Effect.flatMap((serialized) =>
        writeFileStringAtomically({ filePath: usageLedgerPath, contents: serialized }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.map(() => {
        usageLedgerDirty = false;
      }),
      Effect.tapCause((cause) => Effect.logWarning("Failed to persist usage ledger", { cause })),
      Effect.catchCause(() => Effect.void),
    );
  });

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!cacheDirty) return;
    // Cleared only after the write lands, so a failed persist is retried on
    // the next scan instead of leaving disk permanently stale.
    yield* encodeScanCacheFile(encodeScanCache(fileCache)).pipe(
      Effect.flatMap((serialized) => fileSystem.writeFileString(scanCachePath, serialized)),
      Effect.map(() => {
        cacheDirty = false;
      }),
      // A cache we cannot write is a slower next start, not a failed read.
      Effect.tapCause((cause) =>
        Effect.logWarning("Failed to persist usage scan cache", { cause }),
      ),
      Effect.catchCause(() => Effect.void),
    );
  });
  /**
   * Parses one transcript, reusing the cached result when it is unchanged.
   *
   * A file that only grew re-parses from the cached position, so an actively
   * written multi-hundred-megabyte rollout costs its appended bytes per scan
   * rather than a full re-read. The reader verifies the position's guard bytes
   * and silently restarts from byte 0 when they no longer match.
   */
  const readFileRecords = (
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: UsageProviderKind,
  ): Effect.Effect<{
    readonly records: readonly UsageRecord[];
    readonly issue: "missing" | "failed" | null;
  }> =>
    Effect.gen(function* () {
      const cached = fileCache.get(filePath);
      // Provider is part of the identity: if both providers were ever pointed
      // at one directory, a hit parsed by the other parser must not be reused.
      if (
        cached &&
        cached.size === size &&
        cached.mtimeMs === mtimeMs &&
        cached.provider === provider
      ) {
        return {
          records:
            cached.tailRecords.length === 0
              ? cached.records
              : dedupeWithinFile([...cached.records, ...cached.tailRecords]),
          issue: null,
        };
      }

      // Only a strictly grown file may resume. Same size with a new mtime, or
      // a shrunken file, means rewritten content; re-parse it whole.
      const resumeFrom =
        cached !== undefined && cached.provider === provider && size > cached.size
          ? cached.position
          : undefined;

      const parsed = yield* Effect.promise(() =>
        readTranscriptRecordsDetailed(filePath, provider, resumeFrom),
      );
      // A read failure is not an empty transcript: caching it under this
      // (size, mtime) would silently drop the file's usage until it changes.
      if (parsed.status !== "ok") return { records: [], issue: parsed.status };

      // Stored already de-duplicated within the file, which is 99% of all
      // duplicates. The final snapshot wins so a resumed Claude parse can
      // replace an earlier progressive snapshot from the cached base.
      const base = parsed.result.resumed && cached !== undefined ? cached.records : [];
      const records = dedupeWithinFile([...base, ...parsed.result.records]);
      const tailRecords = dedupeWithinFile(parsed.result.tailRecords);

      fileCache.set(filePath, {
        size,
        mtimeMs,
        provider,
        records,
        tailRecords,
        position: parsed.result.position,
      });
      cacheDirty = true;
      return {
        records:
          tailRecords.length === 0 ? records : dedupeWithinFile([...records, ...tailRecords]),
        issue: null,
      };
    });

  /** One provider directory's walk and parse, before rates are involved. */
  interface ScannedDir {
    readonly provider: UsageProviderKind;
    readonly dir: string;
    readonly volumeId: string;
    /** Parsed records per file, or `null` when the directory does not exist. */
    readonly files:
      | readonly { readonly path: string; readonly records: readonly UsageRecord[] }[]
      | null;
    readonly complete: boolean;
  }

  const collectDirs = Effect.fn("UsageService.collectDirs")(function* (windowStartMs: number) {
    // The home resolvers ask for `Path` themselves; satisfy them from the
    // instance we already hold so the scan stays context-free.
    const dirs = yield* resolveTranscriptDirs().pipe(Effect.provideService(Path.Path, path));
    const scanned: ScannedDir[] = [];
    for (const { provider, dir, fileName } of dirs) {
      const volume = yield* Effect.promise(() => readDirectoryVolumeIdDetailed(dir));
      const exists = yield* fileSystem
        .exists(dir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (!exists) {
        scanned.push({
          provider,
          dir,
          volumeId: volume.volumeId,
          files: null,
          // Only stat's explicit ENOENT is a confirmed missing source. An
          // exists/stat disagreement can be a permission or I/O failure.
          complete: volume.status !== "failed",
        });
        continue;
      }
      const walk = yield* Effect.promise(() =>
        listTranscriptFilesDetailed(
          dir,
          windowStartMs,
          fileName === undefined ? undefined : { fileName },
        ),
      );
      let complete = volume.status === "ok" && walk.complete;
      const parsedFiles: { path: string; records: readonly UsageRecord[] }[] = [];
      for (const file of walk.files) {
        const result = yield* readFileRecords(file.path, file.size, file.mtimeMs, provider);
        if (result.issue === "missing") {
          complete = false;
          continue;
        }
        if (result.issue === "failed") {
          complete = false;
          continue;
        }
        parsedFiles.push({ path: file.path, records: result.records });
      }
      scanned.push({
        provider,
        dir,
        volumeId: volume.volumeId,
        files: parsedFiles,
        complete,
      });
    }
    return scanned;
  });

  const scanSummary = Effect.fn("UsageService.scanSummary")(function* (input: UsageSummaryInput) {
    if (input.sinceDay > input.untilDay) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is after untilDay '${input.untilDay}'`,
      });
    }

    let hourlyWindow: { readonly sinceTimeMs: number; readonly untilTimeMs: number } | null = null;
    if (input.resolution === "hour" || input.resolution === "halfHour") {
      const sinceTime =
        input.sinceTime === undefined ? Option.none() : DateTime.make(input.sinceTime);
      const untilTime =
        input.untilTime === undefined ? Option.none() : DateTime.make(input.untilTime);
      if (Option.isNone(sinceTime) || Option.isNone(untilTime)) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Hourly usage requires valid sinceTime and untilTime instants",
        });
      }
      const sinceTimeMs = DateTime.toEpochMillis(sinceTime.value);
      const untilTimeMs = DateTime.toEpochMillis(untilTime.value);
      const durationMs = untilTimeMs - sinceTimeMs;
      const maxWindowMs =
        input.resolution === "halfHour" ? MAX_HALF_HOUR_WINDOW_MS : MAX_HOURLY_WINDOW_MS;
      if (durationMs <= 0 || durationMs > maxWindowMs) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: `Usage timeline must be greater than zero and at most ${input.resolution === "halfHour" ? "90 days" : "24 hours"}`,
        });
      }
      hourlyWindow = { sinceTimeMs, untilTimeMs };
    }

    const startedAtMs = yield* Clock.currentTimeMillis;
    const completeThroughDay = previousCalendarDay(input.timeZone, startedAtMs);
    yield* ensureScanCacheLoaded;

    const hostId = NodeOS.hostname();
    const windowStart = DateTime.make(`${input.sinceDay}T00:00:00Z`);
    if (Option.isNone(windowStart)) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is not a valid date`,
      });
    }
    const windowStartMs =
      (hourlyWindow?.sinceTimeMs ?? DateTime.toEpochMillis(windowStart.value)) - MTIME_SLACK_MS;

    // Pricing only matters once records are aggregated, so the rate table
    // loads while transcripts stream instead of gating them: a cold rates
    // fetch on a slow network no longer delays the scan by its own timeout.
    const [, scannedDirs] = yield* Effect.all(
      [ensureRates({ allowNetwork: true, force: false }), collectDirs(windowStartMs)],
      { concurrency: 2 },
    );

    const projectResolver = yield* resolveProjects();
    const aggregator = new UsageAggregator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay:
        input.resolution !== "day" || input.untilDay < completeThroughDay
          ? input.untilDay
          : UsageDay.make(completeThroughDay),
      resolution: input.resolution ?? "day",
      ...hourlyWindow,
      rates,
      resolveProject: projectResolver,
    });

    const sources: UsageSource[] = [];
    const ledgerAggregates = new Map<string, LedgerAggregate>();
    type PendingLedgerRecord = {
      readonly provider: UsageProviderKind;
      readonly dir: string;
      readonly dedupeScope: string;
      readonly volumeId: string;
      readonly record: UsageRecord;
    };
    const summaryRecordsByKey = new Map<string, PendingLedgerRecord>();
    const unkeyedSummaryRecords: PendingLedgerRecord[] = [];
    const ledgerRecordsByKey = new Map<string, PendingLedgerRecord>();
    const unkeyedLedgerRecords: PendingLedgerRecord[] = [];
    const ledgerStartMs = startedAtMs - USAGE_LEDGER_RETENTION_MS;
    const livePaths = new Set<string>();
    const walkedRoots: string[] = [];

    let scanComplete = true;
    for (const { provider, dir, volumeId, files, complete } of scannedDirs) {
      if (!complete) scanComplete = false;
      if (files === null) {
        sources.push({
          fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
          status: "missing",
          scannedFiles: 0,
          skippedFiles: 0,
          malformedRecords: 0,
          distinctSessions: 0,
          message: "No transcript directory on this environment.",
        });
        continue;
      }

      walkedRoots.push(dir);
      let scannedFiles = 0;
      let skippedFiles = 0;
      for (const file of files) {
        livePaths.add(file.path);
        if (file.records.length === 0) {
          skippedFiles += 1;
          continue;
        }
        scannedFiles += 1;
        for (const record of file.records) {
          // The scan-start instant is the upper bound for both the summary and
          // the durable ledger. Records appended while the walk is in flight
          // belong to the next refresh.
          if (record.timestampMs >= startedAtMs) continue;

          const pending = { provider, dir, dedupeScope: path.dirname(file.path), volumeId, record };
          if (record.dedupeKey === null) {
            unkeyedSummaryRecords.push(pending);
          } else {
            summaryRecordsByKey.set(
              `${hostId}\u0000${provider}\u0000${pending.dedupeScope}\u0000${volumeId}\u0000${record.dedupeKey}`,
              pending,
            );
          }

          // The canonical ledger is normalized independently of the requested
          // viewer zone. Keep quarter-hour cells so IANA offsets at :30/:45
          // and rolling windows aligned to the half hour can be rebucketed
          // without retaining every transcript record.
          if (record.timestampMs < ledgerStartMs || record.timestampMs >= startedAtMs) continue;

          if (record.dedupeKey === null) {
            unkeyedLedgerRecords.push(pending);
          } else {
            ledgerRecordsByKey.set(
              `${hostId}\u0000${provider}\u0000${pending.dedupeScope}\u0000${volumeId}\u0000${record.dedupeKey}`,
              pending,
            );
          }
        }
      }

      sources.push({
        fingerprint: { hostId, provider, resolvedHomePath: dir, volumeId },
        status: "ok",
        scannedFiles,
        skippedFiles,
        malformedRecords: 0,
        distinctSessions: 0,
        message: null,
      });
    }

    if (!scanComplete) {
      return yield* new UsageReadError({
        reason: "scanFailed",
        detail:
          "Usage refresh could not read every transcript file; the last-good snapshot remains active.",
      });
    }

    const sessionsBySource = new Map<string, Set<string>>();
    for (const { provider, dir, volumeId, record } of [
      ...unkeyedSummaryRecords,
      ...summaryRecordsByKey.values(),
    ]) {
      if (!aggregator.add(record) || record.sessionId.length === 0) continue;
      const key = sourceKey({ hostId, provider, resolvedHomePath: dir, volumeId });
      const sessions = sessionsBySource.get(key) ?? new Set<string>();
      sessions.add(record.sessionId);
      sessionsBySource.set(key, sessions);
    }
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (source === undefined) continue;
      sources[index] = {
        ...source,
        distinctSessions: sessionsBySource.get(sourceKey(source.fingerprint))?.size ?? 0,
      };
    }

    // Settle copied and progressive snapshots before writing the normalized
    // ledger. This keeps snapshot-derived project totals identical to the
    // direct scan rather than preserving the first, incomplete Claude copy.
    for (const { provider, dir, volumeId, record } of [
      ...unkeyedLedgerRecords,
      ...ledgerRecordsByKey.values(),
    ]) {
      const priced = priceUsage(rates, record.model, record.totals, record.reportedCostUsd);
      const resolvedProject = projectResolver(record.cwd);
      const aggregate: LedgerAggregate = {
        hostId,
        provider,
        resolvedHomePath: dir,
        volumeId,
        bucketStartMs: Math.floor(record.timestampMs / (15 * 60 * 1000)) * (15 * 60 * 1000),
        model: record.model,
        projectAttribution:
          resolvedProject !== null ? "project" : record.cwd.length === 0 ? "unknown" : "outside",
        ...(resolvedProject === null
          ? {}
          : { projectId: resolvedProject.projectId, project: resolvedProject.title }),
        totals: record.totals,
        pricedTotals: priced.costSource === "modelPriced" ? record.totals : EMPTY_TOTALS,
        savingsTotals: record.totals,
        legacyPricing: false,
        legacyPricingRecords: 0,
        reportedCostUsd:
          priced.costSource === "providerReported" ? (record.reportedCostUsd ?? 0) : 0,
        records: 1,
        unpricedRecords: priced.costSource === "unpriced" ? 1 : 0,
        providerReportedRecords: priced.costSource === "providerReported" ? 1 : 0,
        sessions: record.sessionId.length === 0 ? [] : [record.sessionId],
      };
      mergeLedgerAggregate(ledgerAggregates, aggregate);
    }

    const pruned = pruneScanCache(fileCache, {
      livePaths,
      walkedRoots,
      windowStartMs,
      retentionCutoffMs: startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    });
    if (pruned > 0) cacheDirty = true;
    yield* persistScanCache();

    const aggregated = aggregator.finish();
    const readAt = yield* DateTime.now;
    const finishedAtMs = yield* Clock.currentTimeMillis;
    const availableThroughDay =
      hourlyWindow === null
        ? input.untilDay < completeThroughDay
          ? input.untilDay
          : UsageDay.make(completeThroughDay)
        : UsageDay.make(
            makeDayFormatter(input.timeZone)(Math.min(hourlyWindow.untilTimeMs, startedAtMs) - 1),
          );
    const availableThroughTime =
      hourlyWindow === null
        ? null
        : DateTime.formatIso(DateTime.makeUnsafe(Math.min(hourlyWindow.untilTimeMs, startedAtMs)));

    return {
      summary: {
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: DateTime.formatIso(readAt),
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        resolution: input.resolution ?? "day",
        buckets: aggregated.buckets,
        sources,
        pricing: pricing(),
        coverage: {
          availableThroughDay,
          availableThroughTime,
          generatedAt: DateTime.formatIso(DateTime.makeUnsafe(startedAtMs)),
        },
        scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
      },
      ledgerAggregates: [...ledgerAggregates.values()],
      ledgerSources: sources,
      scanStartedAtMs: startedAtMs,
    } satisfies ScanResult;
  });

  /**
   * In-flight scans by window, so concurrent identical requests (the usage
   * page open on two clients at once) share one scan instead of racing over
   * the same corpus twice.
   */
  const inflightScans = new Map<string, Deferred.Deferred<UsageSummary, UsageReadError>>();
  let canonicalRefreshWaiter: Deferred.Deferred<
    Exit.Exit<UsageSummary, UsageReadError>,
    never
  > | null = null;

  const scanKey = snapshotKey;

  const scanAndPersist = (input: UsageSummaryInput) => {
    const scan = (isCanonicalLedgerInput(input) ? ensureUsageLedgerLoaded : Effect.void).pipe(
      Effect.andThen(scanSummary(input)),
      Effect.tap((result) =>
        Effect.sync(() => {
          const summary = result.summary;
          usageSnapshots.set(scanKey(input), summary);
          while (usageSnapshots.size > MAX_USAGE_SNAPSHOTS) {
            const oldest = [...usageSnapshots.entries()].toSorted(([, left], [, right]) =>
              (left.coverage?.generatedAt ?? left.readAt).localeCompare(
                right.coverage?.generatedAt ?? right.readAt,
              ),
            )[0];
            if (oldest === undefined) break;
            usageSnapshots.delete(oldest[0]);
          }
          snapshotsDirty = true;
          if (
            isCanonicalLedgerInput(input) &&
            isWithinLedgerRetention(input, result.scanStartedAtMs)
          ) {
            // A complete canonical scan is a replacement, not a merge. This
            // removes records for deleted or rewritten transcripts while the
            // last-good file remains intact if the scan failed above.
            usageLedger.clear();
            usageLedgerSources.clear();
            for (const aggregate of result.ledgerAggregates) {
              usageLedger.set(ledgerAggregateKey(aggregate), aggregate);
            }
            for (const source of result.ledgerSources) {
              usageLedgerSources.set(sourceKey(source.fingerprint), source);
            }
            usageLedgerGeneratedAtMs = result.scanStartedAtMs;
            usageLedgerSupportsProjects = true;
            usageLedgerDirty = true;
          }
        }).pipe(Effect.andThen(persistUsageSnapshots), Effect.andThen(persistUsageLedger)),
      ),
    );
    // Reject malformed day ranges before entering the serialized lane. This
    // keeps invalid requests synchronous and cannot consume the scan permit.
    const summary = scan.pipe(Effect.map((result) => result.summary));
    return input.sinceDay > input.untilDay ? summary : scanSemaphore.withPermits(1)(summary);
  };

  const runBackgroundRefresh = (input: UsageSummaryInput) => {
    // Do not enroll a waiter while merely constructing the effect. An
    // unauthorized RPC can construct and discard this effect before it ever
    // executes, which would otherwise wedge all later canonical refreshes.
    return Effect.suspend(() =>
      Effect.gen(function* () {
        const requestedCommonPreset = isCommonPreset(input);
        const nowMs = yield* Clock.currentTimeMillis;
        if (!requestedCommonPreset || !isWithinLedgerRetention(input, nowMs)) {
          return yield* scanAndPersist(input);
        }
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const canonicalSummary = (summary: UsageSummary) =>
              requestedCommonPreset && !isCanonicalLedgerInput(input)
                ? readPresetFromLedger(input).pipe(
                    Effect.flatMap((preset) =>
                      preset === null
                        ? Effect.fail(
                            new UsageReadError({
                              reason: "scanFailed",
                              detail: "The canonical usage refresh did not complete.",
                            }),
                          )
                        : Effect.succeed(preset),
                    ),
                  )
                : Effect.succeed(summary);

            if (canonicalRefreshWaiter !== null) {
              const summary = yield* restore(awaitCanonicalRefresh());
              return yield* summary === null
                ? Effect.fail(
                    new UsageReadError({
                      reason: "scanFailed",
                      detail: "The canonical usage refresh did not complete.",
                    }),
                  )
                : readPresetFromLedger(input).pipe(
                    Effect.flatMap((requested) =>
                      requested === null
                        ? Effect.fail(
                            new UsageReadError({
                              reason: "scanFailed",
                              detail: "The canonical usage refresh did not complete.",
                            }),
                          )
                        : Effect.succeed(requested),
                    ),
                  );
            }

            const waiter = Deferred.makeUnsafe<Exit.Exit<UsageSummary, UsageReadError>, never>();
            canonicalRefreshWaiter = waiter;
            const canonicalInput = isCanonicalLedgerInput(input)
              ? input
              : (yield* defaultDailyInputs)[0]!;
            yield* refreshHooks.beforeCanonicalScan;
            const summary = yield* restore(scanAndPersist(canonicalInput)).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (canonicalRefreshWaiter === waiter) canonicalRefreshWaiter = null;
                }).pipe(Effect.andThen(Deferred.succeed(waiter, exit))),
              ),
            );
            return yield* canonicalSummary(summary);
          }),
        );
      }),
    );
  };

  const awaitCanonicalRefresh = () =>
    canonicalRefreshWaiter === null
      ? Effect.succeed(null)
      : Deferred.await(canonicalRefreshWaiter).pipe(
          Effect.flatMap((exit) =>
            Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.succeed(null),
          ),
        );

  /** Derives a requested preset from the durable normalized record ledger. */
  const readPresetFromLedger = Effect.fn("UsageService.readPresetFromLedger")(function* (
    input: UsageSummaryInput,
  ) {
    yield* ensureUsageLedgerLoaded;
    if (usageLedgerGeneratedAtMs <= 0 && canonicalRefreshWaiter !== null) {
      yield* awaitCanonicalRefresh();
    }
    // `generatedAtMs` is the scan marker. An empty ledger is a valid complete
    // zero snapshot and must not be confused with a never-scanned ledger.
    if (usageLedgerGeneratedAtMs <= 0) return null;
    if (!isWithinLedgerRetention(input, usageLedgerGeneratedAtMs)) return null;
    // Preset reads are foreground-fast and may use a durable cached rate
    // table, but never perform a network fetch. Background/manual scans own
    // rate refreshes.
    yield* ensureRates({ allowNetwork: false, force: false });

    const generatedAtMs = usageLedgerGeneratedAtMs;
    const completeThroughDay = previousCalendarDay(input.timeZone, generatedAtMs);
    let hourlyWindow: { readonly sinceTimeMs: number; readonly untilTimeMs: number } | null = null;
    if (input.resolution === "hour" || input.resolution === "halfHour") {
      if (input.sinceTime === undefined || input.untilTime === undefined) return null;
      const sinceTimeMs = Date.parse(input.sinceTime);
      const observedUntilMs = Math.min(Date.parse(input.untilTime), generatedAtMs);
      if (!Number.isFinite(sinceTimeMs) || observedUntilMs <= sinceTimeMs) return null;
      const periodMs = input.resolution === "halfHour" ? 30 * 60 * 1000 : 60 * 60 * 1000;
      const completePeriods = Math.floor((observedUntilMs - sinceTimeMs) / periodMs);
      const untilTimeMs = sinceTimeMs + completePeriods * periodMs;
      if (untilTimeMs <= sinceTimeMs) return null;
      hourlyWindow = { sinceTimeMs, untilTimeMs };
    }

    const effectiveUntil =
      input.resolution !== "day"
        ? input.untilDay
        : input.untilDay < completeThroughDay
          ? input.untilDay
          : UsageDay.make(completeThroughDay);
    const aggregator = new UsageAggregator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: effectiveUntil,
      resolution: input.resolution ?? "day",
      ...hourlyWindow,
      rates,
    });
    const sessions = new Map<string, Set<string>>();
    for (const entry of usageLedger.values()) {
      if (!aggregator.addAggregate(entry)) continue;
      const key = sourceKey(entry);
      const sourceSessions = sessions.get(key) ?? new Set<string>();
      for (const session of entry.sessions) sourceSessions.add(session);
      sessions.set(key, sourceSessions);
    }
    const aggregated = aggregator.finish();
    const readAt = yield* DateTime.now;
    const availableThroughTime =
      hourlyWindow === null ? null : formatInstant(hourlyWindow.untilTimeMs);
    const sourceEntries = new Map<string, UsageSource>();
    for (const [key, source] of usageLedgerSources) {
      sourceEntries.set(key, {
        ...source,
        distinctSessions: sessions.get(key)?.size ?? 0,
      });
    }
    // v1 ledgers had no source metadata. Reconstruct it from the aggregates so
    // old installs remain readable until their next canonical refresh.
    for (const entry of usageLedger.values()) {
      const key = sourceKey(entry);
      if (sourceEntries.has(key)) continue;
      sourceEntries.set(key, {
        fingerprint: {
          hostId: entry.hostId,
          provider: entry.provider,
          resolvedHomePath: entry.resolvedHomePath,
          volumeId: entry.volumeId,
        },
        status: "ok",
        scannedFiles: 0,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: sessions.get(key)?.size ?? 0,
        message: null,
      });
    }
    return {
      contractVersion: USAGE_CONTRACT_VERSION,
      readAt: DateTime.formatIso(readAt),
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      resolution: input.resolution ?? "day",
      buckets: aggregated.buckets,
      sources: [...sourceEntries.values()],
      pricing: {
        status: ratesStatus,
        source: LITELLM_RATES_URL,
        fetchedAt: ratesFetchedAtMs === null ? null : formatInstant(ratesFetchedAtMs),
        knownModels: rates.size,
      },
      coverage: {
        availableThroughDay:
          input.resolution !== "day"
            ? UsageDay.make(makeDayFormatter(input.timeZone)(hourlyWindow!.untilTimeMs - 1))
            : effectiveUntil,
        availableThroughTime,
        generatedAt: formatInstant(generatedAtMs),
      },
      scanDurationMs: 0,
    } satisfies UsageSummary;
  });

  const readSummary = Effect.fn("UsageService.readSummary")(function* (input: UsageSummaryInput) {
    const key = scanKey(input);
    if (isCommonPreset(input)) {
      const normalized = yield* readPresetFromLedger(input);
      if (normalized !== null) return normalized;
      // The project dimension was added after the compact ledger. Rebuild an
      // older ledger before serving a half-hour request, otherwise its totals
      // are correct but every historical bucket is labelled unknown.
      if (input.resolution === "halfHour" && !usageLedgerSupportsProjects) {
        return yield* runBackgroundRefresh(input);
      }
      // Older servers may have persisted a common snapshot without a ledger.
      // It is still a useful last-good fallback, but never wins over current
      // canonical ledger data above.
      const cached = usageSnapshots.get(key);
      if (cached !== undefined) return cached;
      return yield* new UsageReadError({
        reason: "scanFailed",
        detail: "Usage preset is waiting for the next background snapshot.",
      });
    }
    const cached = usageSnapshots.get(key);
    if (cached !== undefined) return cached;

    const deferred = yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const existing = inflightScans.get(key);
        if (existing !== undefined) return existing;

        // Enrollment and detached-fiber creation must be atomic. Otherwise a
        // canceled first caller can leave a Deferred with no scan to finish it.
        const created = Deferred.makeUnsafe<UsageSummary, UsageReadError>();
        inflightScans.set(key, created);
        // Detached so one departing client cannot tear the scan out from under
        // the fibers awaiting it; a finished scan warms the cache either way.
        yield* scanAndPersist(input).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => inflightScans.delete(key)).pipe(
              Effect.andThen(Deferred.done(created, exit)),
            ),
          ),
          Effect.forkDetach,
        );
        return created;
      }),
    );
    // Waiting stays interruptible. The detached scan continues for other
    // callers and still warms the cache if this caller leaves.
    return yield* Deferred.await(deferred);
  });

  const refreshSummary = (input: UsageSummaryInput) =>
    refreshRates.pipe(Effect.andThen(runBackgroundRefresh(input)));

  const defaultDailyInputs = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const timeZone = serverTimeZone();
    const untilDay = previousCalendarDay(timeZone, nowMs);
    const untilMs = Date.parse(`${untilDay}T00:00:00Z`);
    const sinceDay = new Date(untilMs - 89 * DAY_MS).toISOString().slice(0, 10);
    // One canonical retention-window scan populates the normalized ledger.
    // Every daily and rolling hourly preset is derived from it without a
    // second corpus walk or ledger rewrite.
    return [
      {
        sinceDay: UsageDay.make(sinceDay),
        untilDay: UsageDay.make(untilDay),
        timeZone,
        resolution: "day" as const,
      } satisfies UsageSummaryInput,
    ];
  });

  const startBackgroundRefresh = Effect.gen(function* () {
    const refresh = Effect.gen(function* () {
      const inputs = yield* defaultDailyInputs;
      yield* Effect.forEach(
        inputs,
        (input) =>
          runBackgroundRefresh(input).pipe(
            Effect.timeout(BACKGROUND_REFRESH_TIMEOUT),
            // The per-input timeout is intentionally converted to a best
            // effort refresh, so observe its Cause before `ignore` erases it.
            Effect.tapCause((cause) =>
              Effect.logWarning("Usage background refresh failed", { cause }),
            ),
            Effect.ignore,
          ),
        {
          concurrency: 1,
          discard: true,
        },
      );
    }).pipe(
      Effect.tapCause((cause) => Effect.logWarning("Usage background refresh failed", { cause })),
      Effect.ignore,
    );

    return yield* backgroundRefreshSchedule(refresh);
  });

  yield* Effect.uninterruptible(ensureUsageSnapshotsLoaded);

  /**
   * Maps each thread's current provider session to the thread, from resume
   * cursors. Historic sessions of the same thread attribute through the
   * worktree map instead; sessions that never ran through T3 Code stay
   * session-granular.
   */
  const loadThreadAttribution = Effect.fn("UsageService.loadThreadAttribution")(function* () {
    const sessionToThread = new Map<string, ThreadRef>();
    const worktreeToThread = new Map<string, ThreadRef>();
    const titles = new Map<string, string>();

    const projects = yield* projectRepository
      .listAll()
      .pipe(Effect.catchCause(() => Effect.succeed<readonly never[]>([])));
    const worktreeClaims = new Map<string, { ref: ThreadRef; shared: boolean }>();
    for (const project of projects) {
      const threads = yield* threadRepository
        .listByProjectId({ projectId: project.projectId })
        .pipe(Effect.catchCause(() => Effect.succeed<readonly never[]>([])));
      for (const thread of threads) {
        const title = thread.title.trim();
        if (title.length > 0) titles.set(thread.threadId, title);
        const worktree = thread.worktreePath?.trim() ?? "";
        // The project root is not a dedicated worktree: interactive sessions
        // run there too, and several threads usually share it.
        if (worktree.length === 0 || worktree === project.workspaceRoot) continue;
        const ref: ThreadRef = { threadId: thread.threadId, title: title || thread.threadId };
        const claim = worktreeClaims.get(worktree);
        if (claim === undefined) worktreeClaims.set(worktree, { ref, shared: false });
        else claim.shared = true;
      }
    }
    for (const [worktree, claim] of worktreeClaims) {
      if (!claim.shared) worktreeToThread.set(worktree, claim.ref);
    }

    const runtimes = yield* runtimeRepository
      .list()
      .pipe(Effect.catchCause(() => Effect.succeed<readonly never[]>([])));
    for (const runtime of runtimes) {
      const cursor = runtime.resumeCursor;
      if (typeof cursor !== "object" || cursor === null) continue;
      const cursorRecord = cursor as Record<string, unknown>;
      // Claude cursors carry the transcript uuid as `resume`; Codex cursors
      // carry the rollout uuid as `threadId`. Other providers do not surface
      // usage transcripts, so their cursors are irrelevant here.
      const sessionId =
        runtime.providerName === "claudeAgent"
          ? cursorRecord["resume"]
          : runtime.providerName === "codex"
            ? cursorRecord["threadId"]
            : undefined;
      if (typeof sessionId !== "string" || sessionId.length === 0) continue;
      const provider = runtime.providerName === "claudeAgent" ? "claude" : "codex";
      sessionToThread.set(`${provider}:${sessionId}`, {
        threadId: runtime.threadId,
        title: titles.get(runtime.threadId) ?? runtime.threadId,
      });
    }

    return { sessionToThread, worktreeToThread };
  });

  const readThreadBreakdown = Effect.fn("UsageService.readThreadBreakdown")(function* (
    input: UsageThreadBreakdownInput,
  ) {
    if (input.sinceDay > input.untilDay) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: `sinceDay '${input.sinceDay}' is after untilDay '${input.untilDay}'`,
      });
    }
    const windowStart = DateTime.make(`${input.sinceDay}T00:00:00Z`);
    const windowEnd = DateTime.make(`${input.untilDay}T00:00:00Z`);
    if (
      Option.isNone(windowStart) ||
      Option.isNone(windowEnd) ||
      !isValidUsageDay(input.sinceDay) ||
      !isValidUsageDay(input.untilDay)
    ) {
      return yield* new UsageReadError({
        reason: "invalidWindow",
        detail: "Thread usage requires valid sinceDay and untilDay dates",
      });
    }

    let exactWindow: { readonly sinceTimeMs: number; readonly untilTimeMs: number } | null = null;
    if (input.sinceTime !== undefined || input.untilTime !== undefined) {
      const sinceTime =
        input.sinceTime === undefined ? Option.none() : DateTime.make(input.sinceTime);
      const untilTime =
        input.untilTime === undefined ? Option.none() : DateTime.make(input.untilTime);
      if (Option.isNone(sinceTime) || Option.isNone(untilTime)) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Thread usage requires both valid sinceTime and untilTime instants",
        });
      }
      const sinceTimeMs = DateTime.toEpochMillis(sinceTime.value);
      const untilTimeMs = DateTime.toEpochMillis(untilTime.value);
      const durationMs = untilTimeMs - sinceTimeMs;
      if (durationMs <= 0 || durationMs > MAX_HALF_HOUR_WINDOW_MS) {
        return yield* new UsageReadError({
          reason: "invalidWindow",
          detail: "Thread usage exact window must be greater than zero and at most 90 days",
        });
      }
      exactWindow = { sinceTimeMs, untilTimeMs };
    }

    const startedAtMs = yield* Clock.currentTimeMillis;
    yield* ensureRates({ allowNetwork: false, force: false });
    yield* ensureScanCacheLoaded;

    const dirs = yield* resolveTranscriptDirs().pipe(Effect.provideService(Path.Path, path));
    const windowStartMs =
      (exactWindow?.sinceTimeMs ?? DateTime.toEpochMillis(windowStart.value)) - MTIME_SLACK_MS;

    const accumulator = new ThreadUsageAccumulator({
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      ...exactWindow,
      rates,
      resolveProject: yield* resolveProjects(),
    });

    // Preferred transcript per session for title extraction: the main file,
    // never a subagent's.
    const titleFiles = new Map<
      string,
      { readonly path: string; readonly provider: UsageProviderKind }
    >();
    const livePaths = new Set<string>();
    const walkedRoots: string[] = [];

    for (const { provider, dir, fileName } of dirs) {
      if (input.providers !== undefined && !input.providers.includes(provider)) continue;
      const exists = yield* fileSystem
        .exists(dir)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      if (!exists) continue;
      walkedRoots.push(dir);

      const walk = yield* Effect.promise(() =>
        listTranscriptFilesDetailed(
          dir,
          windowStartMs,
          fileName === undefined ? undefined : { fileName },
        ),
      );
      for (const file of walk.files) {
        livePaths.add(file.path);
        const { records } = yield* readFileRecords(file.path, file.size, file.mtimeMs, provider);
        if (records.length === 0) continue;
        const isSubagent =
          provider === "claude" && path.basename(path.dirname(file.path)) === "subagents";
        const agentId = isSubagent ? path.basename(file.path, ".jsonl") : null;
        for (const record of records) {
          const sessionKey =
            record.sessionId.length > 0
              ? `${provider}:${record.sessionId}`
              : `${provider}:file:${path.basename(path.dirname(file.path))}:${path.basename(file.path, ".jsonl")}`;
          accumulator.add(record, { sessionKey, agentId });
          if (!isSubagent && !titleFiles.has(sessionKey)) {
            titleFiles.set(sessionKey, { path: file.path, provider });
          }
        }
      }
    }

    const pruned = pruneScanCache(fileCache, {
      livePaths,
      walkedRoots,
      windowStartMs,
      retentionCutoffMs: startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    });
    if (pruned > 0) cacheDirty = true;
    // A thread-only client must warm and bound the same durable cache as the
    // summary RPC, otherwise restarts repeat parsing and stale entries grow.
    yield* persistScanCache();

    const attribution = yield* loadThreadAttribution();
    const folded = foldThreadRows(accumulator.finish(), attribution, {
      cap: THREAD_ROW_CAP,
      ...(input.projectKey === undefined ? {} : { projectFilter: input.projectKey }),
    });

    // Transcript titles only for retained unattributed rows. Grouped remainder
    // rows already carry a generated title.
    const rows = yield* Effect.forEach(
      folded.rows,
      Effect.fnUntraced(function* ({ titleSessionKey, ...row }) {
        if (row.title !== null) return { ...row, title: row.title };
        const source = titleFiles.get(titleSessionKey);
        const transcriptTitle =
          source === undefined
            ? null
            : yield* Effect.promise(() => readTranscriptTitle(source.path, source.provider));
        const fallback = row.key.startsWith("remainder:")
          ? row.key
          : shortSessionLabel(titleSessionKey);
        return { ...row, title: transcriptTitle ?? fallback };
      }),
      { concurrency: 8 },
    );

    const readAt = yield* DateTime.now;
    const finishedAtMs = yield* Clock.currentTimeMillis;
    return {
      contractVersion: USAGE_CONTRACT_VERSION,
      readAt: DateTime.formatIso(readAt),
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      rows,
      truncatedRows: folded.truncatedRows,
      scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
    } satisfies UsageThreadBreakdown;
  });

  return {
    readSummary,
    refreshRates,
    refreshSummary,
    startBackgroundRefresh,
    readThreadBreakdown,
  } as const;
});

/** `claude:8f14e45f-...` reads as `Session 8f14e45f`. */
export function shortSessionLabel(sessionKey: string): string {
  if (sessionKey.includes(":file:")) return "Untitled session";
  const sessionId = sessionKey.slice(sessionKey.lastIndexOf(":") + 1);
  return sessionId.length > 8 ? `Session ${sessionId.slice(0, 8)}` : `Session ${sessionId}`;
}

export const layer = Layer.effect(UsageService, make);
