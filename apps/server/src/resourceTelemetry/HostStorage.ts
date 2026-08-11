// @effect-diagnostics nodeBuiltinImport:off - Effect FileSystem does not expose filesystem capacity.
import type { HostStorageSnapshot, HostStorageStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as Duration from "effect/Duration";
import * as NodeFSP from "node:fs/promises";

const GIB = 1024 ** 3;

export const HOST_STORAGE_WARNING_BYTES = 10 * GIB;
export const HOST_STORAGE_CRITICAL_BYTES = 5 * GIB;

export class HostStorageReadError extends Schema.TaggedErrorClass<HostStorageReadError>()(
  "HostStorageReadError",
  { cause: Schema.Defect() },
) {}

export function classifyHostStorage(input: {
  readonly totalBytes: number;
  readonly availableBytes: number;
}): HostStorageSnapshot {
  if (input.totalBytes <= 0) {
    return {
      totalBytes: 0,
      availableBytes: Math.max(0, input.availableBytes),
      warningThresholdBytes: 0,
      criticalThresholdBytes: 0,
      status: "ok",
    };
  }
  const warningThresholdBytes = Math.ceil(
    Math.min(
      Math.max(HOST_STORAGE_WARNING_BYTES, input.totalBytes * 0.05),
      input.totalBytes * 0.25,
    ),
  );
  const criticalThresholdBytes = Math.ceil(
    Math.min(
      Math.max(HOST_STORAGE_CRITICAL_BYTES, input.totalBytes * 0.01),
      input.totalBytes * 0.1,
    ),
  );
  const status: HostStorageStatus =
    input.availableBytes <= criticalThresholdBytes
      ? "critical"
      : input.availableBytes <= warningThresholdBytes
        ? "warning"
        : "ok";

  return {
    totalBytes: input.totalBytes,
    availableBytes: input.availableBytes,
    warningThresholdBytes,
    criticalThresholdBytes,
    status,
  };
}

/** Reads the filesystem that contains T3's durable state. */
export function sampleHostStorage(
  path: string,
): Effect.Effect<HostStorageSnapshot, HostStorageReadError> {
  return Effect.tryPromise({
    try: () => NodeFSP.statfs(path),
    catch: (cause) => new HostStorageReadError({ cause }),
  }).pipe(
    Effect.map((stats) =>
      classifyHostStorage({
        totalBytes: stats.blocks * stats.bsize,
        availableBytes: stats.bavail * stats.bsize,
      }),
    ),
  );
}

export function hostStorageStream(
  sample: Effect.Effect<HostStorageSnapshot, HostStorageReadError>,
  interval: Duration.Input = "30 seconds",
): Stream.Stream<HostStorageSnapshot> {
  const resilientSample = sample.pipe(
    Effect.tapError((error) =>
      Effect.logWarning("Failed to read host storage capacity", {
        cause: String(error.cause),
      }),
    ),
    Effect.retry(
      Schedule.exponential(interval).pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(Duration.min(duration, Duration.minutes(5))),
        ),
      ),
    ),
    Effect.orDie,
  );
  return Stream.unfold(true, (initial) =>
    (initial ? resilientSample : Effect.sleep(interval).pipe(Effect.andThen(resilientSample))).pipe(
      Effect.map((value) => [value, false] as const),
    ),
  ).pipe(
    Stream.changesWith(
      (previous, current) =>
        previous.status === current.status &&
        displayAvailableBucket(previous.availableBytes) ===
          displayAvailableBucket(current.availableBytes),
    ),
  );
}

function displayAvailableBucket(bytes: number): number {
  const gibibytes = bytes / GIB;
  return gibibytes < 10 ? Math.round(gibibytes * 10) : Math.round(gibibytes);
}
