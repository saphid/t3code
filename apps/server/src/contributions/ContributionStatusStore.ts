import * as NodeUtil from "node:util";

import {
  CONTRIBUTION_STATUS_KEY_MAX_LENGTH,
  CONTRIBUTION_STATUS_MAX_ITEMS_PER_SOURCE,
  CONTRIBUTION_STATUS_TEXT_MAX_LENGTH,
  CONTRIBUTION_STATUS_TOOLTIP_MAX_LENGTH,
  type ContributionStatusItem,
  type ContributionStatusSnapshot,
  type ContributionStatusSource,
  type ContributionStatusTone,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  type SnapshotSubscription,
  subscribeBeforeSnapshot,
} from "../utils/subscribeBeforeSnapshot.ts";

/** Upper bound on threads carrying statuses, independent of how many sessions are live. */
export const CONTRIBUTION_STATUS_MAX_THREADS = 256;

/**
 * One producer's statuses. A handle writes to at most one thread at a time and
 * is retired when the scope that opened it closes, clearing what it set. After
 * another handle binds the same thread, this one is stale: its writes are
 * ignored until it binds again, so a late update from a replaced session never
 * reaches the replacement's statuses.
 */
export interface ContributionStatusSourceHandle {
  /**
   * Moves this handle to `threadId`, clearing what it set on its previous
   * thread. Rebinding the thread it still owns keeps its items; binding a
   * thread another handle owns takes it over and clears that handle's items.
   */
  readonly bindThread: (threadId: ThreadId | null) => Effect.Effect<void>;
  /** Sets or replaces `key`. Text that is empty after normalization clears the key. */
  readonly set: (input: {
    readonly key: string;
    readonly text: string;
    readonly tone?: ContributionStatusTone;
    readonly tooltip?: string;
  }) => Effect.Effect<void>;
  readonly clear: (key: string) => Effect.Effect<void>;
  readonly clearAll: Effect.Effect<void>;
}

export interface ContributionStatusStoreShape {
  readonly openSource: (
    source: ContributionStatusSource,
  ) => Effect.Effect<ContributionStatusSourceHandle, never, Scope.Scope>;
  readonly snapshot: Effect.Effect<ContributionStatusSnapshot>;
  /** Latest snapshot plus later full replacements; a slow subscriber only skips intermediate ones. */
  readonly subscribe: Effect.Effect<
    SnapshotSubscription<ContributionStatusSnapshot>,
    never,
    Scope.Scope
  >;
}

const emptySnapshot: ContributionStatusSnapshot = { threads: [] };

const noopHandle: ContributionStatusSourceHandle = {
  bindThread: () => Effect.void,
  set: () => Effect.void,
  clear: () => Effect.void,
  clearAll: Effect.void,
};

/**
 * Thread statuses produced by live provider sessions. The default drops every
 * update so adapters construct without it in tests; the live layer must be the
 * same reference the WebSocket server reads, so layer memoization shares one
 * store between producers and subscribers.
 */
export class ContributionStatusStore extends Context.Reference<ContributionStatusStoreShape>(
  "t3/contributions/ContributionStatusStore",
  {
    defaultValue: () => ({
      openSource: () => Effect.succeed(noopHandle),
      snapshot: Effect.succeed(emptySnapshot),
      subscribe: Effect.succeed({ latest: emptySnapshot, changes: Stream.empty }),
    }),
  },
) {}

// Line breaks, tabs, other C0/C1 controls, DEL, and Unicode line/paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/**
 * Producer text as one plain line: terminal styling removed, controls turned
 * into spaces, whitespace collapsed, and at most `maxLength` UTF-16 units
 * without splitting a surrogate pair. `ellipsis` marks a truncated value.
 */
function normalizeContributionStatusText(
  raw: string,
  maxLength: number,
  ellipsis: boolean,
): string {
  const text = NodeUtil.stripVTControlCharacters(raw)
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const budget = ellipsis ? maxLength - 1 : maxLength;
  let truncated = "";
  for (const codePoint of text) {
    if (truncated.length + codePoint.length > budget) break;
    truncated += codePoint;
  }
  return ellipsis ? `${truncated.trimEnd()}…` : truncated;
}

interface ThreadSlot {
  readonly owner: number;
  readonly source: ContributionStatusSource;
  readonly items: Map<string, ContributionStatusItem>;
}

const sameItem = (left: ContributionStatusItem | undefined, right: ContributionStatusItem) =>
  left !== undefined &&
  left.text === right.text &&
  left.tone === right.tone &&
  left.tooltip === right.tooltip;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("contributions.status.make")(function* () {
  const slots = new Map<ThreadId, ThreadSlot>();
  const changes = yield* PubSub.sliding<ContributionStatusSnapshot>(1);
  const mutex = yield* Semaphore.make(1);
  let nextGeneration = 0;

  const currentSnapshot = (): ContributionStatusSnapshot => ({
    threads: Array.from(slots, ([threadId, slot]) => ({
      threadId,
      source: slot.source,
      items: Array.from(slot.items.values()).toSorted((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      ),
    })).filter((thread) => thread.items.length > 0),
  });

  /** Runs `mutate` under the store lock and publishes once when it reports a visible change. */
  const update = (mutate: () => boolean) =>
    mutex.withPermits(1)(
      Effect.suspend(() =>
        mutate() ? PubSub.publish(changes, currentSnapshot()).pipe(Effect.asVoid) : Effect.void,
      ),
    );

  const openSource: ContributionStatusStoreShape["openSource"] = (source) =>
    Effect.gen(function* () {
      let threadId: ThreadId | null = null;
      let generation = 0;
      let retired = false;

      /** The slot this handle still owns, or undefined when it is unbound, replaced, or retired. */
      const ownedSlot = () => {
        if (retired || threadId === null) return undefined;
        const slot = slots.get(threadId);
        return slot?.owner === generation ? slot : undefined;
      };

      const release = () => {
        const slot = ownedSlot();
        if (slot === undefined || threadId === null) return false;
        slots.delete(threadId);
        return slot.items.size > 0;
      };

      const handle: ContributionStatusSourceHandle = {
        bindThread: (nextThreadId) =>
          update(() => {
            if (retired) return false;
            if (nextThreadId !== null && nextThreadId === threadId && ownedSlot() !== undefined) {
              return false;
            }
            const released = release();
            threadId = nextThreadId;
            if (nextThreadId === null) return released;
            const replaced = slots.get(nextThreadId);
            if (replaced === undefined && slots.size >= CONTRIBUTION_STATUS_MAX_THREADS) {
              threadId = null;
              return released;
            }
            generation = ++nextGeneration;
            slots.set(nextThreadId, { owner: generation, source, items: new Map() });
            return released || (replaced !== undefined && replaced.items.size > 0);
          }),
        set: (input) =>
          update(() => {
            const slot = ownedSlot();
            if (slot === undefined) return false;
            const key = normalizeContributionStatusText(
              input.key,
              CONTRIBUTION_STATUS_KEY_MAX_LENGTH,
              false,
            );
            if (key.length === 0) return false;
            const text = normalizeContributionStatusText(
              input.text,
              CONTRIBUTION_STATUS_TEXT_MAX_LENGTH,
              true,
            );
            if (text.length === 0) return slot.items.delete(key);
            const previous = slot.items.get(key);
            if (
              previous === undefined &&
              slot.items.size >= CONTRIBUTION_STATUS_MAX_ITEMS_PER_SOURCE
            ) {
              return false;
            }
            const tooltip =
              input.tooltip === undefined
                ? ""
                : normalizeContributionStatusText(
                    input.tooltip,
                    CONTRIBUTION_STATUS_TOOLTIP_MAX_LENGTH,
                    true,
                  );
            const item: ContributionStatusItem = {
              key,
              text,
              ...(input.tone === undefined || input.tone === "neutral" ? {} : { tone: input.tone }),
              ...(tooltip.length === 0 ? {} : { tooltip }),
            };
            if (sameItem(previous, item)) return false;
            slot.items.set(key, item);
            return true;
          }),
        clear: (key) =>
          update(() => {
            const slot = ownedSlot();
            if (slot === undefined) return false;
            return slot.items.delete(
              normalizeContributionStatusText(key, CONTRIBUTION_STATUS_KEY_MAX_LENGTH, false),
            );
          }),
        clearAll: update(() => {
          const slot = ownedSlot();
          if (slot === undefined || slot.items.size === 0) return false;
          slot.items.clear();
          return true;
        }),
      };

      yield* Effect.addFinalizer(() =>
        update(() => {
          const released = release();
          retired = true;
          return released;
        }),
      );
      return handle;
    });

  return ContributionStatusStore.of({
    openSource,
    snapshot: mutex.withPermits(1)(Effect.sync(currentSnapshot)),
    subscribe: subscribeBeforeSnapshot(changes, Effect.sync(currentSnapshot), mutex),
  });
});

export const layer = Layer.effect(ContributionStatusStore, make());
