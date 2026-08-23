import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../../serverActivation.ts";
import { ThreadSummaryService } from "../../threadSummary/ThreadSummaryService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadSummaryReactor,
  type ThreadSummaryReactorShape,
} from "../Services/ThreadSummaryReactor.ts";

type SummaryRelevantEvent = Extract<
  OrchestrationEvent,
  { type: "thread.session-set" | "thread.reverted" | "thread.deleted" }
>;

const make = Effect.gen(function* () {
  const orchestration = yield* OrchestrationEngineService;
  const summaries = yield* ThreadSummaryService;

  const process = (event: SummaryRelevantEvent) =>
    (event.type === "thread.session-set"
      ? summaries.appendDueBatches(event.payload.threadId)
      : summaries.invalidate(event.payload.threadId)
    ).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("thread summary batching failed", {
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  const worker = yield* makeDrainableWorker(process);

  const start: ThreadSummaryReactorShape["start"] = Effect.fn("ThreadSummaryReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(orchestration.streamDomainEvents, (event) => {
          if (
            event.type !== "thread.reverted" &&
            event.type !== "thread.deleted" &&
            (event.type !== "thread.session-set" || event.payload.session.status !== "ready")
          ) {
            return Effect.void;
          }
          return worker.enqueue(event);
        }),
      );
    },
  );

  return ThreadSummaryReactor.of({ start, drain: worker.drain });
});

export const ThreadSummaryReactorLive = Layer.effect(ThreadSummaryReactor, make);
