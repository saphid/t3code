import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyPiAcpModelSelection,
  buildPiAcpSpawnInput,
  resolvePiBaseModelId,
} from "./PiAcpSupport.ts";

describe("resolvePiBaseModelId", () => {
  it("normalizes empty and custom pi model ids", () => {
    expect(resolvePiBaseModelId(undefined)).toBe("pi/default");
    expect(resolvePiBaseModelId("   ")).toBe("pi/default");
    expect(resolvePiBaseModelId("  openai/gpt-5.2  ")).toBe("openai/gpt-5.2");
    expect(resolvePiBaseModelId("anthropic/claude-opus-5")).toBe("anthropic/claude-opus-5");
  });
});

describe("buildPiAcpSpawnInput", () => {
  it("spawns the pi-acp adapter with the session cwd and environment", () => {
    const spawn = buildPiAcpSpawnInput({ binaryPath: "/usr/local/bin/pi-acp" }, "/tmp/project", {
      PI_ACP_PI_COMMAND: "/opt/pi",
    });

    expect(spawn).toEqual({
      command: "/usr/local/bin/pi-acp",
      args: [],
      cwd: "/tmp/project",
      env: {
        PI_ACP_PI_COMMAND: "/opt/pi",
      },
    });
  });

  it("falls back to the pi-acp binary on PATH when no binary path is configured", () => {
    const spawn = buildPiAcpSpawnInput({ binaryPath: "" }, "/tmp/project");

    expect(spawn.command).toBe("pi-acp");
    expect(spawn.args).toEqual([]);
    expect(spawn.cwd).toBe("/tmp/project");
  });
});

describe("applyPiAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<string> = [];
    const runtime = {
      setSessionModel: (modelId: string) =>
        Effect.gen(function* () {
          modelCalls.push(modelId);
          if (failure) return yield* failure;
          return {};
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("calls session/set_model when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyPiAcpModelSelection({
        runtime,
        currentModelId: "openai/gpt-5.2",
        requestedModelId: "anthropic/claude-opus-5",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual(["anthropic/claude-opus-5"]);
      expect(result).toBe("anthropic/claude-opus-5");
    }),
  );

  it.effect("skips set_model when requested matches current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyPiAcpModelSelection({
        runtime,
        currentModelId: "openai/gpt-5.2",
        requestedModelId: "openai/gpt-5.2",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("openai/gpt-5.2");
    }),
  );

  it.effect("skips set_model when no model is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyPiAcpModelSelection({
        runtime,
        currentModelId: "openai/gpt-5.2",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("openai/gpt-5.2");
    }),
  );

  it.effect("propagates session/set_model failures via mapError", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("session id not known");
      const { runtime } = makeRecordingRuntime(failure);
      const error = yield* Effect.flip(
        applyPiAcpModelSelection({
          runtime,
          currentModelId: undefined,
          requestedModelId: "openai/gpt-5.2",
          mapError: (cause) => cause.message,
        }),
      );
      expect(error).toBe(failure.message);
    }),
  );
});
