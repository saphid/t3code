/**
 * Offers pending provider approvals to the enabled plugins that declare the
 * `approvals` capability, and records the first answer through the
 * orchestrator.
 *
 * It watches committed `runtime-request.updated` events. For a pending, live
 * approval of a kind some plugin declares, it calls each such plugin's
 * `t3.approval.decide` handler at once, each with its own deadline. An approve
 * or deny becomes a `runtime-request.plugin-respond` command, which the
 * orchestrator accepts only while the request is still pending, so the first
 * answer recorded wins, whether it came from the user or a plugin. Abstaining,
 * an invalid answer, a failure, the deadline, and disabling the plugin all
 * leave the request to the user. When the request stops being pending, calls
 * still running are cancelled.
 *
 * Only requests committed while this service runs are offered: after a
 * restart, an older pending request waits for the user. Plugin work never runs
 * on EventSink's commit path; the subscription is bounded and resumes from the
 * last event it saw when it falls behind.
 */
import {
  CommandId,
  PLUGIN_APPROVAL_HANDLER,
  PLUGIN_APPROVAL_LIMITS,
  PLUGIN_APPROVALS_CAPABILITY,
  PluginApprovalAnswer,
  PluginApprovalKind,
  PluginApprovalRequest,
  type EnvironmentId,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2StoredEvent,
  type PluginCatalogError,
  type PluginInstallation,
  type PluginInstallationId,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { EventSinkV2, type EventSinkV2Error } from "../orchestration-v2/EventSink.ts";
import { LiveStreamBufferError } from "../orchestration-v2/LiveStreamBudget.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { userFacingDispatchErrorMessage } from "../orchestration-v2/UserFacingErrors.ts";
import { PluginCatalog } from "./PluginCatalog.ts";
import type { PluginInvokeError } from "./PluginSupervisor.ts";

/** Why a plugin's call left the request to the user. */
export type PluginApprovalAbstainCause =
  /** The plugin answered `abstain` or `null`. */
  | "abstained"
  /** The answer did not match `PluginApprovalAnswer`. */
  | "invalid"
  | "deadline"
  /** Disabled, removed, re-registered, stopped, busy, or otherwise not callable. */
  | "unavailable"
  /** The handler threw, the process crashed, or the result was too large. */
  | "failed"
  /** The request stopped being pending (answered, cancelled, or no longer answerable) first. */
  | "withdrawn";

/** Progress of one plugin's call for one request, in order. Tests wait on these. */
export type PluginApprovalReceipt =
  | {
      readonly _tag: "Asked";
      readonly requestId: RuntimeRequestId;
      readonly installationId: PluginInstallationId;
    }
  | {
      readonly _tag: "Abstained";
      readonly requestId: RuntimeRequestId;
      readonly installationId: PluginInstallationId;
      readonly cause: PluginApprovalAbstainCause;
      readonly message?: string;
    }
  /** The plugin's answer was recorded and sent to the provider. */
  | {
      readonly _tag: "Applied";
      readonly requestId: RuntimeRequestId;
      readonly installationId: PluginInstallationId;
      readonly decision: "accept" | "decline";
    }
  /** The orchestrator refused the answer, usually because another answer was recorded first. */
  | {
      readonly _tag: "Refused";
      readonly requestId: RuntimeRequestId;
      readonly installationId: PluginInstallationId;
      readonly decision: "accept" | "decline";
      readonly message: string;
    };

export class PluginApprovals extends Context.Service<
  PluginApprovals,
  {
    /** Subscribes before returning, so no receipt after this point is missed (sliding, 1024). */
    readonly subscribe: Effect.Effect<
      PubSub.Subscription<PluginApprovalReceipt>,
      never,
      Scope.Scope
    >;
  }
>()("t3/plugins/PluginApprovals") {}

/** Requests remembered so a repeated pending update is not offered twice. */
const MAX_REMEMBERED_REQUESTS = 1024;

const isPluginApprovalKind = Schema.is(PluginApprovalKind);
const encodeRequest = Schema.encodeEffect(PluginApprovalRequest);
const decodeAnswer = Schema.decodeUnknownResult(PluginApprovalAnswer);
const isLiveStreamBufferError = Schema.is(LiveStreamBufferError);

/** Cuts `text` to `max` UTF-16 units without splitting a surrogate pair. */
const truncate = (text: string, max: number) => {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
};

/** True for an installation that is enabled, registered, consented to `approvals`, and declares `kind`. */
const answers = (installation: PluginInstallation, kind: PluginApprovalKind) =>
  installation.enabled &&
  installation.hostState !== undefined &&
  installation.consent?.capabilities.includes(PLUGIN_APPROVALS_CAPABILITY) === true &&
  installation.manifest?.approvals?.kinds.includes(kind) === true;

const abstainCause = (
  error: PluginCatalogError | PluginInvokeError,
): PluginApprovalAbstainCause => {
  switch (error._tag) {
    case "PluginTimeoutError":
      return "deadline";
    case "PluginCatalogError":
    case "PluginStoppedError":
    case "PluginNotEnabledError":
    case "PluginUnavailableError":
    case "PluginIncompatibleError":
    case "PluginBusyError":
      return "unavailable";
    default:
      return "failed";
  }
};

export const make = Effect.fn("PluginApprovals.make")(function* () {
  const catalog = yield* PluginCatalog;
  const eventSink = yield* EventSinkV2;
  const projections = yield* ProjectionStoreV2;
  const orchestrator = yield* OrchestratorV2;
  const environmentId: EnvironmentId = yield* (yield* ServerEnvironment).getEnvironmentId;
  const scope = yield* Effect.scope;
  const receipts = yield* PubSub.sliding<PluginApprovalReceipt>(1024);
  const publish = (receipt: PluginApprovalReceipt) =>
    PubSub.publish(receipts, receipt).pipe(Effect.asVoid);

  /** One plugin's call for one request. Its answer is recorded even if the request is withdrawn meanwhile. */
  const ask = (
    installation: PluginInstallation,
    threadId: ThreadId,
    requestId: RuntimeRequestId,
    input: Schema.Json,
  ) => {
    const { installationId, generation } = installation;
    const ids = { requestId, installationId };
    const abstain = (cause: PluginApprovalAbstainCause, message?: string) =>
      publish({ _tag: "Abstained", ...ids, cause, ...(message === undefined ? {} : { message }) });
    const timeoutSeconds =
      installation.manifest?.approvals?.timeoutSeconds ??
      PLUGIN_APPROVAL_LIMITS.defaultTimeoutSeconds;
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* publish({ _tag: "Asked", ...ids });
        const called = yield* restore(
          catalog.invoke(installationId, PLUGIN_APPROVAL_HANDLER, input, {
            timeout: `${timeoutSeconds} seconds`,
            generation,
          }),
        ).pipe(Effect.result);
        if (Result.isFailure(called))
          return yield* abstain(abstainCause(called.failure), called.failure.message);
        const answer = decodeAnswer(called.success);
        if (Result.isFailure(answer)) return yield* abstain("invalid", answer.failure.message);
        if (answer.success === null || answer.success.decision === "abstain")
          return yield* abstain("abstained", answer.success?.reason);
        const decision = answer.success.decision === "approve" ? "accept" : "decline";
        const { reason } = answer.success;
        const recorded = yield* orchestrator
          .dispatch({
            type: "runtime-request.plugin-respond",
            commandId: CommandId.make(
              `plugin-approval:${requestId}:${installationId}:${generation}`,
            ),
            threadId,
            requestId,
            resolvedBy: {
              _tag: "plugin",
              pluginId: installation.manifest?.id ?? "",
              pluginName: installation.manifest?.name ?? "",
              decision,
              ...(reason === undefined || reason.trim() === "" ? {} : { reason: reason.trim() }),
            },
          })
          .pipe(Effect.result);
        yield* Result.isSuccess(recorded)
          ? publish({ _tag: "Applied", ...ids, decision })
          : publish({
              _tag: "Refused",
              ...ids,
              decision,
              message: userFacingDispatchErrorMessage(recorded.failure) ?? recorded.failure.message,
            });
      }),
    ).pipe(Effect.onInterrupt(() => abstain("withdrawn")));
  };

  /** Asks every plugin that answers this kind, all at once. Nothing to ask starts no process. */
  const offer = Effect.fn("PluginApprovals.offer")(
    function* (threadId: ThreadId, requestId: RuntimeRequestId, kind: PluginApprovalKind) {
      const participants = (yield* catalog.list).installations.filter((installation) =>
        answers(installation, kind),
      );
      if (participants.length === 0) return;
      const context = yield* projections.getRuntimeResponseContext(threadId, requestId);
      if (context.request?.status !== "pending") return;
      const thread = yield* projections.getThreadShell(threadId);
      if (thread === null) return;
      const prompt = context.item?.type === "approval_request" ? context.item.prompt : undefined;
      const input = yield* encodeRequest({
        requestId,
        kind,
        ...(prompt === undefined
          ? {}
          : { prompt: truncate(prompt, PLUGIN_APPROVAL_LIMITS.maxPromptLength) }),
        context: {
          environmentId,
          projectId: thread.projectId,
          threadId,
          runId: context.node?.runId ?? null,
          provider: context.session?.driver ?? null,
        },
      });
      yield* Effect.forEach(
        participants,
        (installation) => ask(installation, threadId, requestId, input),
        { concurrency: "unbounded", discard: true },
      );
    },
    Effect.catch((error) =>
      Effect.logWarning("Could not offer an approval to plugins; it waits for the user", {
        error,
      }),
    ),
  );

  // Keyed by thread and request; insertion order makes the oldest the first to forget.
  const offers = new Map<string, Fiber.Fiber<void>>();
  const consider = (request: OrchestrationV2RuntimeRequest, threadId: ThreadId) =>
    Effect.suspend(() => {
      const key = `${threadId}\u0000${request.id}`;
      const answerable = request.status === "pending" && request.responseCapability.type === "live";
      const current = offers.get(key);
      if (!answerable) {
        if (current === undefined) return Effect.void;
        offers.delete(key);
        // Withdraws the calls still running, without waiting for an answer being recorded.
        return Fiber.interrupt(current).pipe(Effect.forkIn(scope), Effect.asVoid);
      }
      if (current !== undefined || !isPluginApprovalKind(request.kind)) return Effect.void;
      return offer(threadId, request.id, request.kind).pipe(
        Effect.forkIn(scope),
        Effect.map((fiber) => {
          offers.set(key, fiber);
          if (offers.size > MAX_REMEMBERED_REQUESTS)
            offers.delete(offers.keys().next().value as string);
        }),
      );
    });

  // A resubscription resumes after the last event seen, so no request is skipped.
  let lastSequence = yield* eventSink.latestSequence();
  const watch = Effect.suspend(() =>
    eventSink
      .stream({ eventType: "runtime-request.updated", afterSequence: lastSequence, bounded: true })
      .pipe(
        Stream.runForEach((stored: OrchestrationV2StoredEvent) => {
          lastSequence = stored.sequence;
          return stored.event.type === "runtime-request.updated"
            ? consider(stored.event.payload, stored.event.threadId)
            : Effect.void;
        }),
      ),
  );
  const fellBehind = (error: EventSinkV2Error) =>
    error._tag === "EventSinkStreamError" && isLiveStreamBufferError(error.cause);
  yield* watch.pipe(
    Effect.retry({ while: fellBehind }),
    Effect.tapError((error) => Effect.logWarning("Plugin approval offers stopped", { error })),
    Effect.retry(Schedule.spaced("1 minute")),
    Effect.forkScoped,
  );

  return PluginApprovals.of({ subscribe: PubSub.subscribe(receipts) });
});

export const layer = Layer.effect(PluginApprovals, make());
