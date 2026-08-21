import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentCapabilities } from "./environment.ts";

const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);

describe("ExecutionEnvironmentCapabilities", () => {
  it("treats an omitted guarded-turn-start capability as unsupported", () => {
    const capabilities = decodeCapabilities({ repositoryIdentity: true });

    expect(capabilities.guardedTurnStart).toBeUndefined();
  });

  it("preserves explicit guarded-turn-start support states", () => {
    expect(
      decodeCapabilities({ repositoryIdentity: true, guardedTurnStart: true }).guardedTurnStart,
    ).toBe(true);
    expect(
      decodeCapabilities({ repositoryIdentity: true, guardedTurnStart: false }).guardedTurnStart,
    ).toBe(false);
  });
});
