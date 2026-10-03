/**
 * Context that plugins add to a run between the saved user message and the
 * provider turn (see `PluginTransforms` in contracts).
 *
 * The provider-turn start effect calls `prepareRunContext` before it opens the
 * provider session. Each plugin's call is recorded as a timeline item of the
 * run: first `running`, committed before the plugin is called, then its
 * outcome, committed before the provider starts. Every later start of the same
 * run reads those items instead of calling plugins, so a worker retry or a
 * replayed effect never runs plugin code twice; an item still `running` there
 * belonged to a cut-off call and is recorded as not added. The provider
 * receives exactly the context the saved items show.
 *
 * The items are `dynamic_tool` items with an integration source, which every
 * client already decodes and renders, so older clients show them too.
 */
import {
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  PLUGIN_ENRICH_LIMITS,
  type PluginContextItem,
  type PluginEnrichInput,
  PluginContextItem as PluginContextItemSchema,
  type ProviderInstanceId,
  type ProviderThreadId,
  type RunAttemptId,
  type RunId,
  type NodeId,
  type ThreadId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as EventSink from "./EventSink.ts";
import type * as IdAllocator from "./IdAllocator.ts";

/** One plugin that adds context to runs, as the catalogue held it when enrichment began. */
export interface RunContextSource {
  readonly installationId: string;
  readonly generation: number;
  readonly pluginId: string;
  readonly name: string;
  readonly timeoutSeconds: number;
}

export type RunContextOutcome =
  | { readonly _tag: "added"; readonly context: ReadonlyArray<PluginContextItem> }
  | { readonly _tag: "skipped"; readonly reason: string };

export interface RunContextEnricherV2Shape {
  /** The plugins to call for a run starting now, in catalogue order. */
  readonly sources: Effect.Effect<ReadonlyArray<RunContextSource>>;
  /** Calls one plugin within its deadline. A failure is a `skipped` outcome, never an error. */
  readonly enrich: (
    source: RunContextSource,
    input: Omit<PluginEnrichInput, "environmentId">,
  ) => Effect.Effect<RunContextOutcome>;
}

/** Provided by the plugin host; without it runs get no plugin context. */
export class RunContextEnricherV2 extends Context.Service<
  RunContextEnricherV2,
  RunContextEnricherV2Shape
>()("t3/orchestration-v2/RunContextEnrichment/RunContextEnricherV2") {}

/** `toolName` of the timeline items that record plugin context. */
export const PLUGIN_CONTEXT_TOOL_NAME = "plugin_context";

type DynamicToolItem = Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>;

export const isPluginContextItem = (item: OrchestrationV2TurnItem): item is DynamicToolItem =>
  item.type === "dynamic_tool" &&
  item.nativeItemRef === null &&
  item.toolName === PLUGIN_CONTEXT_TOOL_NAME &&
  item.toolSource?.kind === "integration" &&
  item.toolSource.key.startsWith("plugin:");

const decodeAdded = Schema.decodeUnknownOption(
  Schema.Struct({ context: Schema.Array(PluginContextItemSchema) }),
);

const pluginNameOf = (item: DynamicToolItem) => item.toolSource?.name ?? "a plugin";

/** Closes a cut-off call's item, for paths that end a run while plugins are still answering. */
export const notAddedPluginContextItem = (
  item: DynamicToolItem,
  input: {
    readonly status: "failed" | "interrupted" | "cancelled";
    readonly reason: string;
    readonly now: DateTime.Utc;
  },
): DynamicToolItem => ({
  ...item,
  status: input.status,
  title: `Context from ${pluginNameOf(item)} not added`,
  output: { reason: input.reason },
  completedAt: input.now,
  updatedAt: input.now,
});

const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** The provider text: the saved context, delimited, ahead of the user's text. */
export const withPluginContext = (
  userText: string,
  entries: ReadonlyArray<{ readonly pluginId: string; readonly item: PluginContextItem }>,
) =>
  entries.length === 0
    ? userText
    : [
        ...entries.map(
          ({ pluginId, item }) =>
            `<plugin-context plugin="${escapeAttribute(pluginId)}" title="${escapeAttribute(item.title)}">\n${item.text}\n</plugin-context>`,
        ),
        userText,
      ].join("\n\n");

export type PreparedRunContext =
  | {
      readonly _tag: "ready";
      readonly entries: ReadonlyArray<{
        readonly pluginId: string;
        readonly item: PluginContextItem;
      }>;
    }
  /** The run left `starting` or changed attempt; the caller stops. */
  | { readonly _tag: "stale" };

const savedEntries = (items: ReadonlyArray<DynamicToolItem>): PreparedRunContext => ({
  _tag: "ready",
  entries: items.flatMap((item) =>
    item.status !== "completed"
      ? []
      : Option.match(decodeAdded(item.output), {
          onNone: () => [],
          onSome: ({ context }) =>
            context.map((entry) => ({
              pluginId: item.toolSource!.key.slice("plugin:".length),
              item: entry,
            })),
        }),
  ),
});

const outcomeItem = (
  item: DynamicToolItem,
  source: RunContextSource,
  outcome: RunContextOutcome,
  now: DateTime.Utc,
): DynamicToolItem =>
  outcome._tag === "skipped"
    ? notAddedPluginContextItem(item, { status: "failed", reason: outcome.reason, now })
    : {
        ...item,
        status: "completed",
        title:
          outcome.context.length === 0
            ? `No context from ${source.name}`
            : `Added context from ${source.name}`,
        output: { context: outcome.context },
        completedAt: now,
        updatedAt: now,
      };

/**
 * Reads the run's saved plugin context, or calls the plugins once and saves
 * what they answered. Every write is guarded by the run still being this
 * attempt's `starting` run; a refused write returns `stale`.
 */
export const prepareRunContext = Effect.fn("orchestrationV2.runContext.prepare")(function* (input: {
  readonly enricher: RunContextEnricherV2Shape;
  readonly eventSink: EventSink.EventSinkV2Shape;
  readonly idAllocator: IdAllocator.IdAllocatorV2Shape;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly runId: RunId;
  readonly attemptId: RunAttemptId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  /** The run's turn items as currently projected. */
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly userText: string;
  readonly cwd: string | null;
}) {
  const write = (items: ReadonlyArray<DynamicToolItem>, now: DateTime.Utc) =>
    Effect.gen(function* () {
      const events = yield* Effect.forEach(items, (item) =>
        Effect.gen(function* () {
          return {
            id: yield* input.idAllocator.allocate.event({ threadId: input.threadId }),
            type: "turn-item.updated",
            threadId: input.threadId,
            runId: input.runId,
            nodeId: input.rootNodeId,
            providerInstanceId: input.providerInstanceId,
            occurredAt: now,
            payload: item,
          } satisfies OrchestrationV2DomainEvent;
        }),
      );
      const result = yield* input.eventSink.writeIfRunCurrent({
        threadId: input.threadId,
        runId: input.runId,
        activeAttemptId: input.attemptId,
        expectedStatus: "starting",
        events,
      });
      return result.committed;
    });

  const saved = input.turnItems.filter(
    (item): item is DynamicToolItem => item.runId === input.runId && isPluginContextItem(item),
  );
  if (saved.length > 0) {
    // This run already began enrichment: never call a plugin again.
    const cutOff = saved.filter((item) => item.status === "running");
    if (cutOff.length === 0) return savedEntries(saved);
    const now = yield* DateTime.now;
    const closed = cutOff.map((item) =>
      notAddedPluginContextItem(item, {
        status: "failed",
        reason: "The call did not finish before the run's start was retried.",
        now,
      }),
    );
    if (!(yield* write(closed, now))) return { _tag: "stale" } as const;
    return savedEntries(saved.map((item) => closed.find((next) => next.id === item.id) ?? item));
  }

  const sources = yield* input.enricher.sources;
  if (sources.length === 0) return { _tag: "ready", entries: [] } as const;

  const now = yield* DateTime.now;
  const firstOrdinal =
    Math.max(
      0,
      ...input.turnItems.filter((item) => item.runId === input.runId).map((item) => item.ordinal),
    ) + 1;
  const started = sources.map((source, index): DynamicToolItem => ({
    id: input.idAllocator.derive.runSignalTurnItem({
      runId: input.runId,
      signal: `plugin-context:${source.installationId}`,
    }),
    type: "dynamic_tool",
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.rootNodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: firstOrdinal + index,
    status: "running",
    title: `Adding context from ${source.name}`,
    toolName: PLUGIN_CONTEXT_TOOL_NAME,
    toolSource: { key: `plugin:${source.pluginId}`, name: source.name, kind: "integration" },
    input: {
      plugin: {
        id: source.pluginId,
        name: source.name,
        installationId: source.installationId,
        generation: source.generation,
      },
    },
    startedAt: now,
    completedAt: null,
    updatedAt: now,
  }));
  const called = sources.slice(0, PLUGIN_ENRICH_LIMITS.maxPluginsPerRun);
  const overflow = started.slice(called.length).map((item) =>
    notAddedPluginContextItem(item, {
      status: "failed",
      reason: `At most ${PLUGIN_ENRICH_LIMITS.maxPluginsPerRun} plugins add context to one run.`,
      now,
    }),
  );
  // The record that this run began enrichment, committed before any plugin runs.
  if (!(yield* write([...started.slice(0, called.length), ...overflow], now)))
    return { _tag: "stale" } as const;

  const truncated = input.userText.length > PLUGIN_ENRICH_LIMITS.maxMessageTextLength;
  const enrichInput = {
    projectId: input.projectId,
    threadId: input.threadId,
    runId: input.runId,
    cwd: input.cwd,
    message: {
      text: truncated
        ? input.userText.slice(0, PLUGIN_ENRICH_LIMITS.maxMessageTextLength)
        : input.userText,
      truncated,
    },
  };
  const outcomes = yield* Effect.forEach(
    called,
    (source) => input.enricher.enrich(source, enrichInput),
    { concurrency: "unbounded" },
  );
  const answeredAt = yield* DateTime.now;
  const finished = called.map((source, index) =>
    outcomeItem(started[index]!, source, outcomes[index]!, answeredAt),
  );
  if (!(yield* write(finished, answeredAt))) return { _tag: "stale" } as const;
  return savedEntries(finished);
});
