import {
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderBusyRetryReactor,
  type ProviderBusyRetryReactorShape,
} from "../Services/ProviderBusyRetryReactor.ts";

type ThreadSessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;

/**
 * Delay before each automatic retry. The length is the retry budget; once it
 * is spent the failure stays terminal until the user sends a message.
 */
export const PROVIDER_BUSY_RETRY_DELAYS = [
  Duration.minutes(1),
  Duration.minutes(5),
  Duration.minutes(15),
] as const;

export const PROVIDER_BUSY_RETRY_TEXT =
  "The provider was temporarily at capacity and the last turn stopped. Continue where you left off.";

/**
 * Whether a turn error describes the provider or model being temporarily
 * overloaded. Conservative on purpose because a match restarts the agent: a
 * bare 503 is excluded since proxies also use it for revoked credentials.
 */
export function isProviderBusyError(message: string): boolean {
  return /\b(?:model|server|service|provider|api)s? (?:is |are )?(?:currently |temporarily )?(?:at capacity|overloaded)\b|overloaded_error|serverOverloaded/iu.test(
    message,
  );
}

interface RetryState {
  readonly attempt: number;
  /** `latestUserMessageAt` after our own retry message, to tell it from the user's. */
  readonly retryMessageAt: string | null;
}

/** Whether the thread is still sitting on the failed turn the retry was scheduled for. */
export function busyRetryStillWanted(
  thread: OrchestrationThreadShell | undefined,
  expected: { readonly turnId: TurnId | null; readonly latestUserMessageAt: string | null },
): thread is OrchestrationThreadShell {
  return (
    thread !== undefined &&
    thread.archivedAt === null &&
    thread.session?.status === "error" &&
    (thread.latestTurn?.turnId ?? null) === expected.turnId &&
    thread.latestUserMessageAt === expected.latestUserMessageAt
  );
}

/**
 * Builds the session-set handler. Kept apart from the stream wiring so tests
 * can drive it directly and advance the clock instead of sleeping.
 */
export const makeProviderBusyRetryHandler = (deps: {
  readonly dispatch: OrchestrationEngineShape["dispatch"];
  readonly readThread: (threadId: ThreadId) => Effect.Effect<OrchestrationThreadShell | undefined>;
  readonly scope: Scope.Scope;
}) => {
  const retryStates = new Map<ThreadId, RetryState>();
  const pending = new Map<ThreadId, Fiber.Fiber<void, unknown>>();
  const { readThread } = deps;

  const deliverRetry = Effect.fn("deliverProviderBusyRetry")(function* (input: {
    readonly threadId: ThreadId;
    readonly attempt: number;
    readonly turnId: TurnId | null;
    readonly latestUserMessageAt: string | null;
  }) {
    const thread = yield* readThread(input.threadId);
    if (!busyRetryStillWanted(thread, input)) {
      retryStates.delete(input.threadId);
      return;
    }
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const key = `${input.threadId}:${input.turnId ?? "no-turn"}:${input.attempt}`;
    retryStates.set(input.threadId, { attempt: input.attempt, retryMessageAt: createdAt });
    yield* deps.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`provider-busy-retry:${key}`),
      threadId: input.threadId,
      message: {
        messageId: MessageId.make(`provider-busy-retry:${key}`),
        role: "user",
        text: PROVIDER_BUSY_RETRY_TEXT,
        attachments: [],
      },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt,
    });
  });

  const processSessionSet = Effect.fn("processProviderBusySessionSet")(function* (
    event: ThreadSessionSetEvent,
  ) {
    const { threadId, session } = event.payload;
    if (session.status !== "error" || !isProviderBusyError(session.lastError ?? "")) return;
    // runtime.error and turn.completed both report the same failure.
    if (pending.has(threadId)) return;
    const thread = yield* readThread(threadId);
    if (thread === undefined || thread.archivedAt !== null) return;
    const previous = retryStates.get(threadId);
    // A user message since our last retry starts a fresh budget.
    const attempt =
      previous !== undefined && previous.retryMessageAt === thread.latestUserMessageAt
        ? previous.attempt + 1
        : 1;
    const delay = PROVIDER_BUSY_RETRY_DELAYS[attempt - 1];
    if (delay === undefined) {
      retryStates.delete(threadId);
      return;
    }
    const fiber = yield* Effect.sleep(delay).pipe(
      Effect.andThen(
        deliverRetry({
          threadId,
          attempt,
          turnId: thread.latestTurn?.turnId ?? null,
          latestUserMessageAt: thread.latestUserMessageAt,
        }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("provider busy retry failed to deliver", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
      Effect.ensuring(Effect.sync(() => pending.delete(threadId))),
      Effect.forkIn(deps.scope),
    );
    pending.set(threadId, fiber);
  });

  return processSessionSet;
};

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  let processSessionSet: ReturnType<typeof makeProviderBusyRetryHandler> | undefined;

  const processSessionSetSafely = (event: ThreadSessionSetEvent) =>
    (processSessionSet?.(event) ?? Effect.void).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider busy retry reactor failed to process event", {
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSessionSetSafely);

  const start: ProviderBusyRetryReactorShape["start"] = Effect.fn("start")(function* () {
    processSessionSet = makeProviderBusyRetryHandler({
      dispatch: orchestrationEngine.dispatch,
      readThread: (threadId) =>
        projectionSnapshotQuery.getThreadShellById(threadId).pipe(
          Effect.map(Option.getOrUndefined),
          Effect.orElseSucceed(() => undefined),
        ),
      scope: yield* Effect.scope,
    });
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.session-set") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderBusyRetryReactorShape;
});

export const ProviderBusyRetryReactorLive = Layer.effect(ProviderBusyRetryReactor, make);
