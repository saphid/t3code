import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ThreadSummaryReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ThreadSummaryReactor extends Context.Service<
  ThreadSummaryReactor,
  ThreadSummaryReactorShape
>()("t3/orchestration/Services/ThreadSummaryReactor") {}
