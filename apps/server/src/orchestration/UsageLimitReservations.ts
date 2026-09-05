import type {
  OrchestrationThreadActivity,
  ProviderInstanceId,
  ProviderSession,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProviderServiceError } from "../provider/Errors.ts";
import type { ProviderServiceShape } from "../provider/Services/ProviderService.ts";
import {
  evaluateHandoverStartLimits,
  evaluateTurnStartLimits,
  type UsageLimitViolation,
} from "./UsageLimitPolicy.ts";

type Reservation =
  | {
      readonly kind: "turn";
      readonly threadId: ThreadId;
      readonly providerInstanceId: ProviderInstanceId;
      readonly concurrencyExempt: boolean;
    }
  | { readonly kind: "handover"; readonly threadId: ThreadId };

export interface UsageLimitReservations {
  readonly reserveTurn: (input: {
    readonly maxConcurrentThreads?: number;
    readonly key: string;
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly contextTokenLimit?: number;
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  }) => Effect.Effect<UsageLimitViolation | undefined, ProviderServiceError>;
  readonly reserveHandover: (input: {
    readonly maxConcurrentThreads?: number;
    readonly key: string;
    readonly threadId: ThreadId;
  }) => Effect.Effect<UsageLimitViolation | undefined, ProviderServiceError>;
  readonly release: (key: string) => Effect.Effect<void>;
}

export function make(
  listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>, ProviderServiceError>,
  isConcurrencyExemptProvider: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<boolean, ProviderServiceError> = () => Effect.succeed(false),
): UsageLimitReservations {
  const reservations = new Map<string, Reservation>();

  const concurrencyExemptProviderIds = (
    sessions: ReadonlyArray<ProviderSession>,
    providerInstanceId?: ProviderInstanceId,
  ) =>
    Effect.gen(function* () {
      const instanceIds = new Set(
        sessions.flatMap((session) =>
          session.providerInstanceId === undefined ? [] : [session.providerInstanceId],
        ),
      );
      if (providerInstanceId !== undefined) instanceIds.add(providerInstanceId);

      const excluded = new Set<ProviderInstanceId>();
      yield* Effect.forEach(instanceIds, (instanceId) =>
        isConcurrencyExemptProvider(instanceId).pipe(
          Effect.tap((isExempt) =>
            isExempt
              ? Effect.sync(() => {
                  excluded.add(instanceId);
                })
              : Effect.void,
          ),
        ),
      );
      return excluded;
    });

  const release: UsageLimitReservations["release"] = (key) =>
    Effect.sync(() => {
      reservations.delete(key);
    });

  const reserveTurn: UsageLimitReservations["reserveTurn"] = Effect.fn(
    "UsageLimitReservations.reserveTurn",
  )(function* (input: Parameters<UsageLimitReservations["reserveTurn"]>[0]) {
    const sessions = yield* listSessions();
    const excludedProviderInstanceIds = yield* concurrencyExemptProviderIds(
      sessions,
      input.providerInstanceId,
    );
    return yield* Effect.sync(() => {
      const values = [...reservations.values()];
      const violation = evaluateTurnStartLimits({
        ...(input.maxConcurrentThreads === undefined
          ? {}
          : { maxConcurrentThreads: input.maxConcurrentThreads }),
        threadId: input.threadId,
        ...(input.contextTokenLimit === undefined
          ? {}
          : { contextTokenLimit: input.contextTokenLimit }),
        activities: input.activities,
        sessions,
        providerInstanceId: input.providerInstanceId,
        excludedProviderInstanceIds,
        reservedTurnThreadIds: values
          .filter((reservation) => reservation.kind === "turn" && !reservation.concurrencyExempt)
          .map((reservation) => reservation.threadId),
        reservedHandoverCount: values.filter((reservation) => reservation.kind === "handover")
          .length,
      });
      if (violation) return violation;

      reservations.set(input.key, {
        kind: "turn",
        threadId: input.threadId,
        providerInstanceId: input.providerInstanceId,
        concurrencyExempt: excludedProviderInstanceIds.has(input.providerInstanceId),
      });
      return undefined;
    });
  });

  const reserveHandover: UsageLimitReservations["reserveHandover"] = Effect.fn(
    "UsageLimitReservations.reserveHandover",
  )(function* (input: Parameters<UsageLimitReservations["reserveHandover"]>[0]) {
    const sessions = yield* listSessions();
    const excludedProviderInstanceIds = yield* concurrencyExemptProviderIds(sessions);
    return yield* Effect.sync(() => {
      const values = [...reservations.values()];
      if (
        values.some(
          (reservation) =>
            reservation.kind === "handover" && reservation.threadId === input.threadId,
        )
      ) {
        return {
          code: "handover-in-progress",
          detail: "A handover is already being generated for this thread.",
        } satisfies UsageLimitViolation;
      }

      const violation = evaluateHandoverStartLimits({
        ...(input.maxConcurrentThreads === undefined
          ? {}
          : { maxConcurrentThreads: input.maxConcurrentThreads }),
        sessions,
        excludedProviderInstanceIds,
        reservedTurnThreadIds: values
          .filter((reservation) => reservation.kind === "turn" && !reservation.concurrencyExempt)
          .map((reservation) => reservation.threadId),
        reservedHandoverCount: values.filter((reservation) => reservation.kind === "handover")
          .length,
      });
      if (violation) return violation;

      reservations.set(input.key, { kind: "handover", threadId: input.threadId });
      return undefined;
    });
  });

  return { reserveTurn, reserveHandover, release };
}

const storesByProviderService = new WeakMap<ProviderServiceShape, UsageLimitReservations>();

/** One reservation store per server-lifetime provider runtime. */
export function forProviderService(providerService: ProviderServiceShape): UsageLimitReservations {
  const existing = storesByProviderService.get(providerService);
  if (existing) return existing;
  const created = make(providerService.listSessions, (instanceId) =>
    providerService
      .getInstanceInfo(instanceId)
      .pipe(
        Effect.map(
          (instance) =>
            instance.displayName?.trim().toLowerCase().startsWith("ai enablers") === true,
        ),
      ),
  );
  storesByProviderService.set(providerService, created);
  return created;
}
