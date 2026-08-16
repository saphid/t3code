import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  classifyHostStorage,
  hostStorageStream,
  HostStorageReadError,
  HOST_STORAGE_CRITICAL_BYTES,
  HOST_STORAGE_WARNING_BYTES,
} from "./HostStorage.ts";

describe("HostStorage", () => {
  it("does not warn when a filesystem cannot report capacity", () => {
    expect(classifyHostStorage({ totalBytes: 0, availableBytes: 0 }).status).toBe("ok");
  });

  it.effect("retries a transient read failure without ending the subscription", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const sample = Effect.gen(function* () {
        const attempt = yield* Ref.updateAndGet(attempts, (value) => value + 1);
        if (attempt === 1) {
          return yield* new HostStorageReadError({ cause: new Error("transient") });
        }
        return classifyHostStorage({ totalBytes: 200 * 1024 ** 3, availableBytes: 8 * 1024 ** 3 });
      });
      const fiber = yield* hostStorageStream(sample, "30 seconds").pipe(
        Stream.runHead,
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      expect(yield* Ref.get(attempts)).toBe(1);
      yield* TestClock.adjust("30 seconds");
      const snapshot = Option.getOrThrow(yield* Fiber.join(fiber));

      expect(snapshot.availableBytes).toBe(8 * 1024 ** 3);
      expect(yield* Ref.get(attempts)).toBe(2);
    }),
  );

  it("warns before free space reaches the critical floor", () => {
    expect(
      classifyHostStorage({ totalBytes: 200 * 1024 ** 3, availableBytes: 10 * 1024 ** 3 }).status,
    ).toBe("warning");
    expect(
      classifyHostStorage({ totalBytes: 200 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 }).status,
    ).toBe("critical");
  });

  it("uses a percentage floor for large filesystems", () => {
    const result = classifyHostStorage({
      totalBytes: 2_000 * 1024 ** 3,
      availableBytes: 50 * 1024 ** 3,
    });

    expect(result.status).toBe("warning");
    expect(result.warningThresholdBytes).toBeGreaterThan(HOST_STORAGE_WARNING_BYTES);
    expect(result.criticalThresholdBytes).toBeGreaterThan(HOST_STORAGE_CRITICAL_BYTES);
  });

  it("caps thresholds on small filesystems", () => {
    const result = classifyHostStorage({
      totalBytes: 20 * 1024 ** 3,
      availableBytes: 6 * 1024 ** 3,
    });

    expect(result.status).toBe("ok");
    expect(result.warningThresholdBytes).toBe(5 * 1024 ** 3);
    expect(result.criticalThresholdBytes).toBe(2 * 1024 ** 3);
  });
});
