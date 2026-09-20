import type {
  NodeId,
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderFailureClass,
  OrchestrationV2ProviderRetry,
  OrchestrationV2TurnItem,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";

import type { IdAllocatorV2Shape } from "./IdAllocator.ts";

export const MAX_PROVIDER_FAILURE_MESSAGE_LENGTH = 4_096;
export const MAX_PROVIDER_FAILURE_CODE_LENGTH = 128;

/**
 * Delay before each automatic retry of a run that failed as `provider_busy`.
 * The length is the retry budget; once it is spent the failure stays terminal.
 */
export const PROVIDER_BUSY_RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;

const DEFAULT_PROVIDER_FAILURE_MESSAGE = "Provider turn failed.";

function stringField(value: unknown, key: "message" | "code"): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function redactUrl(match: string): string {
  const trailing = /[),.;!?]+$/u.exec(match)?.[0] ?? "";
  const candidate = trailing.length === 0 ? match : match.slice(0, -trailing.length);
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return `${url.toString()}${trailing}`;
  } catch {
    return "[REDACTED_URL]";
  }
}

function replaceUnsafeControlCharacters(value: string): string {
  const sanitized: Array<string> = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized.push(
      codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x0c) ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f
        ? " "
        : character,
    );
  }
  return sanitized.join("");
}

/** Removes common credential forms before provider text crosses a transport boundary. */
function redactProviderFailureText(value: string): string {
  return replaceUnsafeControlCharacters(value)
    .replace(/\bhttps?:\/\/[^\s<>"']+/giu, redactUrl)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(
      /(["'](?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)["']\s*:\s*["'])[^"']*(["'])/giu,
      "$1[REDACTED]$2",
    )
    .replace(
      /(\b(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1[REDACTED]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, "[REDACTED]")
    .trim();
}

function boundedText(value: string, maxLength: number): string {
  const redacted = redactProviderFailureText(value);
  if (redacted.length <= maxLength) return redacted;
  let end = Math.max(0, maxLength - 1);
  const finalCodeUnit = redacted.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    end -= 1;
  }
  return `${redacted.slice(0, end)}…`;
}

export function makeProviderFailure(input: {
  readonly cause?: unknown;
  readonly message?: string | undefined;
  readonly code?: string | null | undefined;
  readonly class?: OrchestrationV2ProviderFailureClass;
  readonly retryable?: boolean | null;
}): OrchestrationV2ProviderFailure {
  const rawMessage = input.message ?? DEFAULT_PROVIDER_FAILURE_MESSAGE;
  const message = boundedText(rawMessage, MAX_PROVIDER_FAILURE_MESSAGE_LENGTH);
  const rawCode = input.code ?? stringField(input.cause, "code") ?? null;
  const code =
    rawCode === null ? null : boundedText(rawCode, MAX_PROVIDER_FAILURE_CODE_LENGTH) || null;

  // Adapters report overload as an ordinary provider error. Reclassifying it
  // here keeps every adapter consistent; only `provider_error` is upgraded so
  // an adapter's more specific class always wins.
  const busy =
    input.class === "provider_error" && isProviderBusyFailureSignal({ message: rawMessage, code });
  return {
    class: busy ? "provider_busy" : (input.class ?? "unknown"),
    message: message || DEFAULT_PROVIDER_FAILURE_MESSAGE,
    code,
    retryable: busy ? true : (input.retryable ?? null),
  };
}

/**
 * Whether a provider failure describes the provider or model being temporarily
 * overloaded or at capacity. Such runs are retried automatically, so this is
 * conservative on purpose: a bare 503 is excluded because proxies also use it
 * for permanent conditions such as revoked credentials.
 */
export function isProviderBusyFailureSignal(input: {
  readonly message: string;
  readonly code: string | null;
}): boolean {
  if (input.code !== null) {
    const normalized = input.code.toLowerCase().replace(/[\s-]+/gu, "_");
    if (normalized.includes("overloaded") || normalized.endsWith("_529") || normalized === "529") {
      return true;
    }
  }
  return /\b(?:model|server|service|provider|api)s? (?:is |are )?(?:currently |temporarily )?(?:at capacity|overloaded)\b|overloaded_error/iu.test(
    input.message,
  );
}

/**
 * Whether a provider failure describes the account exhausting a quota window
 * (tokens, credits, request rate) rather than a defect. Adapters with
 * structured signals should still pass them through `code`; this heuristic
 * covers providers that only send human-readable text. Conservative on
 * purpose: a false positive relabels a real error as "out of tokens".
 */
export function isUsageLimitFailureSignal(input: {
  readonly message: string;
  readonly code: string | null;
}): boolean {
  if (input.code !== null) {
    const normalized = input.code.toLowerCase().replace(/[\s-]+/gu, "_");
    if (
      !normalized.includes("disk_quota") &&
      (normalized.includes("usage_limit") ||
        normalized.includes("usagelimit") ||
        normalized.includes("rate_limit") ||
        normalized.includes("ratelimit") ||
        normalized.includes("quota") ||
        normalized.endsWith("_429") ||
        normalized === "429")
    ) {
      return true;
    }
  }
  return (
    /usage limit|usage_limit|rate limit|too many requests|out of tokens|out of credits|credit balance is too low|insufficient credits|insufficient(?:(?!disk).){0,16}quota|exceeded(?:(?!disk).){0,24}quota|(?<!disk )quota (?:was |is )?exceeded/iu.test(
      input.message,
    ) === true
  );
}

function terminalFailureTitle(failure: OrchestrationV2ProviderFailure): string {
  if (failure.class === "usage_limit") return "Out of tokens";
  return failure.class === "provider_busy" ? "Provider busy" : "Provider error";
}

export function makeProviderFailureTurnItem(input: {
  readonly idAllocator: IdAllocatorV2Shape;
  readonly driver: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly nodeId: NodeId | null;
  readonly providerThreadId: ProviderThreadId;
  readonly providerTurnId: ProviderTurnId;
  readonly itemOrdinal: number;
  readonly failure: OrchestrationV2ProviderFailure;
  readonly retry?: OrchestrationV2ProviderRetry;
  readonly retryStartedAt?: DateTime.Utc;
  readonly occurredAt: DateTime.Utc;
}): Extract<OrchestrationV2TurnItem, { readonly type: "error" }> {
  return {
    id: input.idAllocator.derive.turnItemFromProviderItem({
      driver: input.driver,
      nativeItemId: `terminal-failure:${input.providerTurnId}`,
    }),
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.nodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.itemOrdinal,
    status: "failed",
    title: terminalFailureTitle(input.failure),
    startedAt: input.retryStartedAt ?? input.occurredAt,
    completedAt: input.occurredAt,
    updatedAt: input.occurredAt,
    type: "error",
    failure: input.failure,
    ...(input.retry === undefined ? {} : { retry: input.retry }),
  };
}

export function makeProviderRetryTurnItem(input: {
  readonly idAllocator: IdAllocatorV2Shape;
  readonly driver: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly nodeId: NodeId | null;
  readonly providerThreadId: ProviderThreadId;
  readonly providerTurnId: ProviderTurnId;
  readonly itemOrdinal: number;
  readonly failure: OrchestrationV2ProviderFailure;
  readonly retry: OrchestrationV2ProviderRetry;
  readonly status: Extract<
    OrchestrationV2TurnItem["status"],
    "running" | "completed" | "failed" | "interrupted" | "cancelled"
  >;
  readonly startedAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
}): Extract<OrchestrationV2TurnItem, { readonly type: "error" }> {
  const completed = input.status !== "running";
  let title = "Provider retry";
  if (input.status === "completed") {
    title = "Provider recovered";
  } else if (input.status === "failed") {
    title = terminalFailureTitle(input.failure);
  } else if (input.status === "interrupted" || input.status === "cancelled") {
    title = "Provider retry stopped";
  }
  return {
    id: input.idAllocator.derive.turnItemFromProviderItem({
      driver: input.driver,
      nativeItemId: `terminal-failure:${input.providerTurnId}`,
    }),
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.nodeId,
    providerThreadId: input.providerThreadId,
    providerTurnId: input.providerTurnId,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.itemOrdinal,
    status: input.status,
    title,
    startedAt: input.startedAt,
    completedAt: completed ? input.updatedAt : null,
    updatedAt: input.updatedAt,
    type: "error",
    failure: input.failure,
    retry: input.retry,
  };
}
