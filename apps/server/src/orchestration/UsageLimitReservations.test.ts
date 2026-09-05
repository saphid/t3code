import type { ProviderInstanceId, ProviderSession, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { DEFAULT_MAX_CONCURRENT_THREADS } from "./UsageLimitPolicy.ts";
import { make } from "./UsageLimitReservations.ts";

function session(index: number): ProviderSession {
  return {
    threadId: `running-${index}` as ThreadId,
    status: "running",
  } as ProviderSession;
}

const standardProvider = "codex" as ProviderInstanceId;
const aiEnablers = "ai-enablers" as ProviderInstanceId;

describe("UsageLimitReservations", () => {
  it.effect("shares a custom limit between simultaneous turns and handovers", () =>
    Effect.gen(function* () {
      const reservations = make(() => Effect.succeed([]));
      const results = yield* Effect.all(
        [
          reservations.reserveTurn({
            key: "turn:one",
            threadId: "one" as ThreadId,
            providerInstanceId: standardProvider,
            activities: [],
            maxConcurrentThreads: 1,
          }),
          reservations.reserveHandover({
            key: "handover:two",
            threadId: "two" as ThreadId,
            maxConcurrentThreads: 1,
          }),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.filter((result) => result === undefined)).toHaveLength(1);
      expect(results.filter((result) => result?.code === "concurrent-turn-limit")).toHaveLength(1);
    }),
  );

  it.effect("applies changed limits to the existing reservation store", () =>
    Effect.gen(function* () {
      const reservations = make(() => Effect.succeed([]));
      const turn = { providerInstanceId: standardProvider, activities: [] };
      expect(
        yield* reservations.reserveTurn({
          ...turn,
          key: "one",
          threadId: "one" as ThreadId,
          maxConcurrentThreads: 1,
        }),
      ).toBeUndefined();
      const next = { ...turn, key: "two", threadId: "two" as ThreadId };
      expect(yield* reservations.reserveTurn({ ...next, maxConcurrentThreads: 1 })).toMatchObject({
        code: "concurrent-turn-limit",
      });
      expect(yield* reservations.reserveTurn({ ...next, maxConcurrentThreads: 2 })).toBeUndefined();
      yield* reservations.release("one");
      const handover = { key: "three", threadId: "three" as ThreadId, maxConcurrentThreads: 1 };
      expect(yield* reservations.reserveHandover(handover)).toMatchObject({
        code: "concurrent-turn-limit",
      });
      yield* reservations.release("two");
      expect(yield* reservations.reserveHandover(handover)).toBeUndefined();
    }),
  );

  it.effect("atomically reserves the final provider-work slot", () =>
    Effect.gen(function* () {
      const reservations = make(() =>
        Effect.succeed(
          Array.from({ length: DEFAULT_MAX_CONCURRENT_THREADS - 1 }, (_, index) => session(index)),
        ),
      );

      const results = yield* Effect.all(
        [
          reservations.reserveHandover({
            key: "handover:one",
            threadId: "thread-one" as ThreadId,
          }),
          reservations.reserveHandover({
            key: "handover:two",
            threadId: "thread-two" as ThreadId,
          }),
        ],
        { concurrency: "unbounded" },
      );

      expect(results.filter((result) => result === undefined)).toHaveLength(1);
      expect(results.filter((result) => result?.code === "concurrent-turn-limit")).toHaveLength(1);
    }),
  );

  it.effect("releases a handover slot after completion", () =>
    Effect.gen(function* () {
      const reservations = make(() =>
        Effect.succeed(
          Array.from({ length: DEFAULT_MAX_CONCURRENT_THREADS - 1 }, (_, index) => session(index)),
        ),
      );

      expect(
        yield* reservations.reserveHandover({
          key: "handover:first",
          threadId: "thread-first" as ThreadId,
        }),
      ).toBeUndefined();
      yield* reservations.release("handover:first");
      expect(
        yield* reservations.reserveHandover({
          key: "handover:second",
          threadId: "thread-second" as ThreadId,
        }),
      ).toBeUndefined();
    }),
  );

  it.effect("rejects duplicate generation for one source thread", () =>
    Effect.gen(function* () {
      const reservations = make(() => Effect.succeed([]));
      const threadId = "thread-source" as ThreadId;

      expect(
        yield* reservations.reserveHandover({ key: "handover:first", threadId }),
      ).toBeUndefined();
      expect(
        yield* reservations.reserveHandover({ key: "handover:second", threadId }),
      ).toMatchObject({ code: "handover-in-progress" });
    }),
  );

  it.effect("does not reserve concurrency slots for AI Enablers turns", () =>
    Effect.gen(function* () {
      const reservations = make(
        () =>
          Effect.succeed(
            Array.from({ length: DEFAULT_MAX_CONCURRENT_THREADS - 1 }, (_, index) =>
              session(index),
            ),
          ),
        (instanceId) => Effect.succeed(instanceId === aiEnablers),
      );

      expect(
        yield* reservations.reserveTurn({
          key: "turn:ai-enablers",
          threadId: "thread-ai-enablers" as ThreadId,
          providerInstanceId: aiEnablers,
          activities: [],
        }),
      ).toBeUndefined();
      expect(
        yield* reservations.reserveTurn({
          key: "turn:standard",
          threadId: "thread-standard" as ThreadId,
          providerInstanceId: standardProvider,
          activities: [],
        }),
      ).toBeUndefined();
    }),
  );
});
