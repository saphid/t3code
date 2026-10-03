import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ForwardCompatibleArray, ProviderSessionId, ThreadId } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/**
 * Short status text a producer attaches to a thread, such as a Pi
 * extension's `ctx.ui.setStatus(key, text)`. The server owns these in memory
 * only: they are never persisted and disappear with their producer.
 */
export const CONTRIBUTION_STATUS_KEY_MAX_LENGTH = 64;
export const CONTRIBUTION_STATUS_TEXT_MAX_LENGTH = 80;
export const CONTRIBUTION_STATUS_TOOLTIP_MAX_LENGTH = 240;
export const CONTRIBUTION_STATUS_MAX_ITEMS_PER_SOURCE = 8;

const CONTRIBUTION_STATUS_TONES = ["neutral", "info", "success", "warning", "error"] as const;
const ContributionStatusToneLiteral = Schema.Literals(CONTRIBUTION_STATUS_TONES);
const isContributionStatusTone = Schema.is(ContributionStatusToneLiteral);

/** Tones a newer server adds decode as `neutral` instead of dropping the item. */
export const ContributionStatusTone = Schema.String.pipe(
  Schema.decodeTo(
    ContributionStatusToneLiteral,
    SchemaTransformation.transform<typeof ContributionStatusToneLiteral.Type, string>({
      decode: (tone) => (isContributionStatusTone(tone) ? tone : "neutral"),
      encode: (tone) => tone,
    }),
  ),
);
export type ContributionStatusTone = typeof ContributionStatusTone.Type;

export const ContributionStatusItem = Schema.Struct({
  /** Stable per source; setting an existing key replaces its item. */
  key: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(CONTRIBUTION_STATUS_KEY_MAX_LENGTH),
  ),
  /** Single line of plain text. Producers strip control characters and ANSI styling. */
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(CONTRIBUTION_STATUS_TEXT_MAX_LENGTH),
  ),
  /** Absent means neutral. */
  tone: Schema.optionalKey(ContributionStatusTone),
  tooltip: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(CONTRIBUTION_STATUS_TOOLTIP_MAX_LENGTH)),
  ),
});
export type ContributionStatusItem = typeof ContributionStatusItem.Type;

/** Who set a thread's items. Plugin sources are reserved for a later `kind`. */
export const ContributionStatusSource = Schema.Struct({
  kind: Schema.Literal("provider-session"),
  providerSessionId: ProviderSessionId,
  providerInstanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
});
export type ContributionStatusSource = typeof ContributionStatusSource.Type;

export const ThreadContributionStatus = Schema.Struct({
  threadId: ThreadId,
  source: ContributionStatusSource,
  /** Sorted by key, at most CONTRIBUTION_STATUS_MAX_ITEMS_PER_SOURCE, never empty. */
  items: Schema.Array(ContributionStatusItem).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CONTRIBUTION_STATUS_MAX_ITEMS_PER_SOURCE),
  ),
});
export type ThreadContributionStatus = typeof ThreadContributionStatus.Type;

/**
 * Every live status in one environment. `subscribeContributionStatus` sends
 * one on subscribe and a full replacement after each change, so a client
 * replaces its copy and never merges. Entries an older client cannot decode,
 * such as a future source kind, are dropped rather than failing the stream.
 */
export const ContributionStatusSnapshot = Schema.Struct({
  threads: ForwardCompatibleArray(ThreadContributionStatus),
});
export type ContributionStatusSnapshot = typeof ContributionStatusSnapshot.Type;
