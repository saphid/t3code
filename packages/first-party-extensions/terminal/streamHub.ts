/**
 * Cross-placement stream coordination for the terminal extension.
 *
 * The broker caps each installation at 8 concurrent plugin streams — every
 * mounted placement of the surface draws from that ONE budget, so per-view
 * feeds multiply against it: two visible placements each holding a
 * sessions/theme/appearance feed plus one pane stream already sit at 8, and
 * the first split anywhere gets rejected ("Plugin stream limit reached").
 *
 * The hub lives once per client document (module singleton in extension.tsx)
 * and spends the budget deliberately:
 *
 * - Fixed feeds (sessions/theme/appearance) are shared: refcounted by key,
 *   one subscription per key, frames fanned out to every listening view.
 *   Two placements of the same thread cost 3 streams total, not 6. A view
 *   that joins later replays the feed's current frames — the shared
 *   subscription never re-emits its snapshot, so without the replay the
 *   second placement's panel would sit on "connecting" forever.
 * - Pane output streams come from a slot pool sized to what the budget has
 *   left. Visible panes hold mandatory slots; hidden panes may keep an
 *   optional slot (parser/query continuity across a group switch) that any
 *   newly-visible pane can preempt — least-recently-demoted first. When the
 *   pool is exhausted by mandatory slots, acquisition fails and the caller
 *   surfaces an honest waiting state instead of a rejected subscription.
 *
 * Pure coordination — no SDK imports. The view layer supplies the drivers
 * that actually open subscriptions, so the hub is unit-testable in node.
 */

/** The broker's per-installation concurrent stream cap (broker.ts `own`). */
export const BROKER_STREAM_CAP = 8;

/**
 * Frames kept per feed for late-joiner replay. Overflow resets the history —
 * a joiner then starts at the replayed status and waits for the next state
 * frame rather than reconstructing state from a lossy prefix.
 */
export const FEED_REPLAY_MAX_FRAMES = 64;

export type TerminalFeedStatus = "connecting" | "disconnected";

export interface TerminalSharedFeedListener<Frame> {
  /** A frame the shared subscription delivered. */
  onFrame(frame: Frame): void;
  /**
   * Subscription lifecycle: "connecting" at (re)subscription start,
   * "disconnected" when the feed ended or failed (message null when the
   * stream ended without an error).
   */
  onStatus(status: TerminalFeedStatus, message: string | null): void;
}

export interface TerminalFeedSink<Frame> {
  frame(frame: Frame): void;
  status(status: TerminalFeedStatus, message: string | null): void;
}

/**
 * Runs one shared subscription's lifetime. Retries and backoff live here —
 * the hub only starts the driver when the feed's listener count goes 0→1
 * and aborts it when it returns to 0.
 */
export type TerminalFeedDriver<Frame> = (
  sink: TerminalFeedSink<Frame>,
  signal: AbortSignal,
) => void;

/**
 * What a late joiner of an already-live feed replays to catch up with the
 * state earlier listeners hold. Without a policy the last frame alone is
 * kept — each frame supersedes the one before it (theme/appearance publish
 * whole values). With `isStateFrame`, the history resets on every state
 * frame and deltas after it accumulate, so the joiner hears
 * [snapshot … deltas] in delivery order; deltas with no state frame yet
 * carry no standalone state and are dropped.
 */
export interface TerminalFeedReplayPolicy<Frame> {
  readonly isStateFrame: (frame: Frame) => boolean;
}

/**
 * History for one delivered frame. Returns a fresh array — late joiners may
 * be mid-replay of the previous one. Returns `[]` (replay unavailable) when
 * a delta arrives with no state frame yet, or when the history is full.
 */
const advanceReplay = <Frame>(
  replay: readonly Frame[],
  frame: Frame,
  policy: TerminalFeedReplayPolicy<Frame> | undefined,
): readonly Frame[] => {
  if (policy === undefined || policy.isStateFrame(frame)) return [frame];
  if (replay.length === 0 || replay.length >= FEED_REPLAY_MAX_FRAMES) return [];
  return [...replay, frame];
};

export interface TerminalPaneLease {
  /**
   * A visible pane's slot is mandatory: never evicted. A hidden pane
   * demotes to optional — kept until a newly-visible pane needs the slot.
   */
  setPriority(mandatory: boolean): void;
  release(): void;
}

interface FixedFeed {
  readonly controller: AbortController;
  readonly listeners: Set<TerminalSharedFeedListener<unknown>>;
  lastStatus: { status: TerminalFeedStatus; message: string | null } | null;
  /** Frames a late joiner replays, in delivery order. Never mutated in place. */
  replay: readonly unknown[];
  readonly replayPolicy: TerminalFeedReplayPolicy<unknown> | undefined;
}

interface PaneLeaseState {
  mandatory: boolean;
  /** When the lease last demoted to optional — eviction order. */
  demotedAt: number;
  onEvicted: () => void;
}

export class TerminalStreamHub {
  readonly #feeds = new Map<string, FixedFeed>();
  readonly #panes = new Map<string, PaneLeaseState>();
  readonly #paneWaiters = new Set<() => void>();
  readonly #now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.#now = options.now ?? (() => Date.now());
  }

  /** Slots the installation budget leaves for pane output streams. */
  paneStreamBudget(): number {
    return Math.max(0, BROKER_STREAM_CAP - this.#feeds.size);
  }

  /** Whether a new mandatory pane slot can be granted right now. */
  paneSlotAvailable(): boolean {
    return this.#panes.size < this.paneStreamBudget() || this.#evictablePane() !== null;
  }

  /**
   * Joins a shared fixed feed. The driver starts on the first listener and
   * stops when the last one leaves; frames and status fan out to every
   * listener, and a late joiner immediately hears the current status and
   * then the replayed frames (per the feed's policy) so a placement that
   * mounts while the feed is already live catches up instead of waiting
   * for the next server event. Returns the detach function (a plain
   * cleanup so React effects can hand it straight back).
   */
  acquireFixedFeed<Frame>(
    key: string,
    listener: TerminalSharedFeedListener<Frame>,
    driver: TerminalFeedDriver<Frame>,
    replayPolicy?: TerminalFeedReplayPolicy<Frame>,
  ): () => void {
    let feed = this.#feeds.get(key);
    if (feed === undefined) {
      feed = {
        controller: new AbortController(),
        listeners: new Set(),
        lastStatus: null,
        replay: [],
        // The generic policy is wrapped, not cast: isStateFrame must only
        // ever see frames the driver emits through this typed call.
        replayPolicy:
          replayPolicy === undefined
            ? undefined
            : { isStateFrame: (frame: unknown) => replayPolicy.isStateFrame(frame as Frame) },
      };
      this.#feeds.set(key, feed);
      const entry = feed;
      const sink: TerminalFeedSink<Frame> = {
        frame: (frame) => {
          entry.replay = advanceReplay(entry.replay, frame, entry.replayPolicy);
          for (const listener of entry.listeners) listener.onFrame(frame);
        },
        status: (status, message) => {
          entry.lastStatus = { status, message };
          for (const listener of entry.listeners) listener.onStatus(status, message);
        },
      };
      driver(sink, feed.controller.signal);
    }
    const entry = feed;
    const bound = listener as TerminalSharedFeedListener<unknown>;
    // Replay must be a stable prefix: it is read before joining, and
    // advanceReplay always reassigns (never mutates), so a frame fanning
    // out after the join lands after the replayed history.
    const replayFrames = entry.replay;
    entry.listeners.add(bound);
    if (entry.lastStatus !== null)
      bound.onStatus(entry.lastStatus.status, entry.lastStatus.message);
    for (const frame of replayFrames) bound.onFrame(frame as Frame);
    return () => {
      if (!entry.listeners.delete(bound)) return;
      if (entry.listeners.size === 0 && this.#feeds.get(key) === entry) {
        this.#feeds.delete(key);
        entry.controller.abort();
      }
    };
  }

  /**
   * Takes a pane slot. `null` means the budget is exhausted by mandatory
   * slots — the caller shows a waiting state and retries via
   * `onPaneSlotFree`. An optional (hidden-pane) lease can be preempted at
   * any later acquisition; its `onEvicted` fires exactly once.
   */
  acquirePaneStream(
    key: string,
    options: { readonly mandatory: boolean; readonly onEvicted: () => void },
  ): TerminalPaneLease | null {
    const existing = this.#panes.get(key);
    if (existing !== undefined) {
      existing.mandatory = options.mandatory;
      existing.demotedAt = options.mandatory ? Number.POSITIVE_INFINITY : this.#now();
      existing.onEvicted = options.onEvicted;
      return this.#lease(key, existing);
    }
    let evicted: (() => void) | null = null;
    if (this.#panes.size >= this.paneStreamBudget()) {
      const victim = this.#evictablePane();
      if (victim === null) return null;
      // Remove the victim and insert the new state BEFORE its onEvicted
      // runs: the callback tears down synchronously and its release must
      // no-op (the slot already belongs to THIS acquire), and a nested
      // acquire from inside the callback must see a full pool rather than
      // steal the slot back out from under this one.
      this.#panes.delete(victim.key);
      evicted = victim.state.onEvicted;
    }
    const state: PaneLeaseState = {
      mandatory: options.mandatory,
      demotedAt: options.mandatory ? Number.POSITIVE_INFINITY : this.#now(),
      onEvicted: options.onEvicted,
    };
    this.#panes.set(key, state);
    evicted?.();
    return this.#lease(key, state);
  }

  /**
   * One-shot notification that a pane slot freed (release or eviction) —
   * waiters are dropped after firing, so a caller whose acquire fails again
   * simply registers a fresh one.
   */
  onPaneSlotFree(listener: () => void): () => void {
    this.#paneWaiters.add(listener);
    return () => {
      this.#paneWaiters.delete(listener);
    };
  }

  #lease(key: string, state: PaneLeaseState): TerminalPaneLease {
    const hub = this;
    return {
      setPriority(mandatory: boolean) {
        if (hub.#panes.get(key) !== state) return;
        state.mandatory = mandatory;
        state.demotedAt = mandatory ? Number.POSITIVE_INFINITY : hub.#now();
      },
      release() {
        if (hub.#panes.get(key) !== state) return;
        hub.#panes.delete(key);
        hub.#wakeWaiters();
      },
    };
  }

  #evictablePane(): { key: string; state: PaneLeaseState } | null {
    let victim: { key: string; state: PaneLeaseState } | null = null;
    for (const [key, state] of this.#panes) {
      if (state.mandatory) continue;
      if (victim === null || state.demotedAt < victim.state.demotedAt) victim = { key, state };
    }
    return victim;
  }

  #wakeWaiters() {
    const waiters = [...this.#paneWaiters];
    this.#paneWaiters.clear();
    for (const waiter of waiters) waiter();
  }
}
