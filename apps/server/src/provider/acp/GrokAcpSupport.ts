import {
  type GrokSettings,
  ProviderDriverKind,
  type ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import { finiteNonNegativeTokenCount, finitePositiveTokenCount } from "../tokenUsage.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_API_KEY_ENV = "XAI_API_KEY";
const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const T3_CODE_OAUTH_REFERRER = "t3code";
const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

type GrokAcpRuntimeGrokSettings = Pick<GrokSettings, "binaryPath">;

interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeGrokSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeGrokSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: grokSettings?.binaryPath || "grok",
    args: ["agent", "stdio"],
    cwd,
    env: {
      ...environment,
      [GROK_OAUTH2_REFERRER_ENV]: T3_CODE_OAUTH_REFERRER,
    },
  };
}

function resolveGrokAuthMethodId(environment: NodeJS.ProcessEnv | undefined): string {
  return environment?.[GROK_API_KEY_ENV]?.trim()
    ? GROK_AUTH_METHOD_API_KEY
    : GROK_AUTH_METHOD_CACHED_TOKEN;
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(input.grokSettings, input.cwd, input.environment),
        authMethodId: resolveGrokAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    return yield* makeXAiPromptCompletionRuntime(runtime);
  });

export function resolveGrokAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : "grok-build";
  return normalizeModelSlug(base, GROK_DRIVER_KIND) ?? "grok-build";
}

export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function contextWindowsFromSessionModels(
  models: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyMap<string, number> {
  const windows = new Map<string, number>();
  for (const model of models?.availableModels ?? []) {
    const meta = isRecord(model._meta) ? model._meta : undefined;
    const maxTokens = finitePositiveTokenCount(meta?.totalContextTokens);
    if (maxTokens === undefined) {
      continue;
    }
    windows.set(model.modelId, maxTokens);
    windows.set(resolveGrokAcpBaseModelId(model.modelId), maxTokens);
  }
  return windows;
}

export function contextWindowForModelId(
  windows: ReadonlyMap<string, number>,
  modelId: string | undefined,
): number | undefined {
  if (modelId) {
    const match = windows.get(modelId) ?? windows.get(resolveGrokAcpBaseModelId(modelId));
    if (match !== undefined) {
      return match;
    }
  }
  const distinct = new Set(windows.values());
  return distinct.size === 1 ? distinct.values().next().value : undefined;
}

export function enrichGrokTokenUsage(
  usage: ThreadTokenUsageSnapshot,
  maxTokens: number | undefined,
): ThreadTokenUsageSnapshot {
  return {
    ...usage,
    ...(usage.maxTokens === undefined && maxTokens !== undefined ? { maxTokens } : {}),
    compactsAutomatically: usage.compactsAutomatically ?? true,
  };
}

export function tokenUsageFromGrokPromptMeta(
  meta: unknown,
  maxTokens: number | undefined,
): ThreadTokenUsageSnapshot | undefined {
  if (!isRecord(meta)) {
    return undefined;
  }
  const usage = isRecord(meta.usage) ? meta.usage : undefined;
  const usedTokens =
    finitePositiveTokenCount(meta.totalTokens) ?? finitePositiveTokenCount(usage?.totalTokens);
  if (usedTokens === undefined) {
    return undefined;
  }
  const inputTokens =
    finiteNonNegativeTokenCount(meta.inputTokens) ??
    finiteNonNegativeTokenCount(usage?.inputTokens);
  const outputTokens =
    finiteNonNegativeTokenCount(meta.outputTokens) ??
    finiteNonNegativeTokenCount(usage?.outputTokens);
  const cachedInputTokens =
    finiteNonNegativeTokenCount(meta.cachedReadTokens) ??
    finiteNonNegativeTokenCount(usage?.cachedReadTokens);
  const reasoningOutputTokens =
    finiteNonNegativeTokenCount(meta.reasoningTokens) ??
    finiteNonNegativeTokenCount(usage?.reasoningTokens);

  return enrichGrokTokenUsage(
    {
      usedTokens,
      lastUsedTokens: usedTokens,
      ...(inputTokens !== undefined ? { inputTokens, lastInputTokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens, lastOutputTokens: outputTokens } : {}),
      ...(cachedInputTokens !== undefined
        ? { cachedInputTokens, lastCachedInputTokens: cachedInputTokens }
        : {}),
      ...(reasoningOutputTokens !== undefined
        ? { reasoningOutputTokens, lastReasoningOutputTokens: reasoningOutputTokens }
        : {}),
    },
    maxTokens ??
      finitePositiveTokenCount(meta.totalContextTokens) ??
      finitePositiveTokenCount(usage?.totalContextTokens),
  );
}
