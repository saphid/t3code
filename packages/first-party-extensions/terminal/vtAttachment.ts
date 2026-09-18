import type {
  TerminalOutputEventsClosed,
  TerminalOutputEventsValue,
} from "@t3tools/extension-sdk/catalogue";

import {
  EMPTY_OVERFLOW_STREAK,
  isResumableOutputClose,
  noteOutputFrameForStreak,
} from "./viewModel.ts";

/**
 * Where the output stream lands. The real sink is the Ghostty surface; tests
 * and the not-yet-mounted window use this shape so parser input is never
 * dropped while the surface loads.
 */
export interface TerminalVtSink {
  resetAndWrite(data: string): void;
  write(data: string): void;
  /**
   * Erase the viewport and scrollback WITHOUT resetting parser state. A host
   * history clear never reaches the process — the modes it negotiated
   * (application cursor, bracketed paste, kitty keyboard, mouse tracking)
   * still apply, so an RIS-style `resetAndWrite` would desync input
   * encoding: pasted newlines would run as interactive commands.
   */
  clearScreen(): void;
  /**
   * Optional bracket around a remount replay. Replayed bytes re-execute
   * their terminal queries (DA, DSR, DECRQSS) inside the fresh parser — a
   * sink that forwards query replies to the process must suppress them or
   * every remount re-sends answers the shell is not re-asking for. The
   * Ghostty sink detaches its PTY writer for the bracket.
   */
  beginReplay?(): void;
  endReplay?(): void;
}

export type TerminalVtStatus = "connecting" | "live" | "exited" | "closed" | "error";

export interface TerminalVtAttachmentState {
  readonly status: TerminalVtStatus;
  readonly statusText: string;
  /**
   * The retained-history snapshot arrived truncated: bytes before the 8 KiB
   * tail — including mode-enabling sequences — never reached the parser, so
   * application-cursor/bracketed-paste/Kitty state can be wrong. Interactive
   * parity is unclaimed until a full snapshot or a reset re-bases the parser.
   */
  readonly degraded: boolean;
  readonly exitCode: number | null;
  /** Stream lifecycle ended (exit/closed/error); a resubscribe may follow. */
  readonly ended: boolean;
}

interface PendingChunkGroup {
  sequence: number;
  count: number;
  parts: string[];
}

const MAX_OUTPUT_CHUNK_DATA_LENGTH = 8192;
const MAX_OUTPUT_CHUNKS = 64;
/**
 * Pre-sink buffer bound (UTF-16 units): output that arrives before the
 * surface mounts is held for replay, but a stalled WASM/font load must not
 * grow it forever. Past the cap the oldest chunks drop and the replay base
 * becomes unfaithful — the same honesty rule as a truncated attach.
 */
export const MAX_PRE_SINK_OUTPUT_LENGTH = 512 * 1024;

export class TerminalVtAttachment {
  readonly terminalId: string;
  readonly #onChange: (() => void) | undefined;
  #sink: TerminalVtSink | null = null;
  /**
   * Retained post-base output for remount replay — both pre-sink bytes and
   * the bounded tail of what a live sink already rendered, so a recreated
   * surface (theme/font swap) sees the same screen instead of losing every
   * byte since the snapshot. Bounded by MAX_PRE_SINK_OUTPUT_LENGTH.
   */
  #buffered: string[] = [];
  #bufferedLength = 0;
  /** The last snapshot contents that seeded parser state, if any. */
  #base: string | null = null;
  /**
   * Whether `#base` + `#buffered` reconstructs full parser state — i.e. the
   * base was seeded by a non-truncated snapshot carrying every byte since
   * process start. A history clear or a dropped pre-sink overflow makes the
   * replay base unfaithful; a remount still replays it and flags degraded
   * instead of pretending the modes are known.
   */
  #replayFaithful = true;
  /**
   * Epoch in which a history clear was observed. The server reports
   * `truncated:false` on post-clear snapshots (nothing was dropped by
   * retention — it was explicitly cleared), but the retained bytes no longer
   * contain the mode-establishing output, so a replayed snapshot in that
   * epoch is NOT a faithful parser resync. Only a new epoch (a fresh
   * process incarnation) re-proves mode state.
   */
  #clearedEpoch: string | null = null;
  /**
   * Renderer start failure message, or null when the surface is healthy.
   * Sticky across frames: output/snapshot frames keep feeding the bounded
   * replay buffer for a later remount, but they must not re-flag the pane
   * "live" while no renderer ever started. Only a successful `attach` (a
   * renderer that actually mounted) clears it.
   */
  #sinkFailure: string | null = null;
  #pending: PendingChunkGroup | null = null;
  #state: TerminalVtAttachmentState = {
    status: "connecting",
    statusText: "Connecting…",
    degraded: false,
    exitCode: null,
    ended: false,
  };
  #sequence = 0;
  #epoch: string | null = null;
  /**
   * Last accepted native event sequence (the session's monotonic
   * eventSequence — distinct from the broker's per-subscription frame
   * sequence). Seeded by the snapshot's boundarySequence; every later
   * output/reset/exit must strictly increase, catching replays and gaps the
   * outer fence cannot see. `closed` frames carry no native sequence.
   */
  #nativeWatermark = -1;

  constructor(terminalId: string, onChange?: () => void) {
    this.terminalId = terminalId;
    this.#onChange = onChange;
  }

  get state(): TerminalVtAttachmentState {
    return this.#state;
  }

  /**
   * Surface mounted (or remounted after a theme/font swap): replay the base
   * snapshot plus every live byte seen since. `resetAndWrite` rebuilds parser
   * state, so a late surface sees the same screen as a live one — unless the
   * replay base is unfaithful (truncated attach, history clear, dropped
   * pre-sink overflow), in which case the modes it cannot reconstruct leave
   * the pane degraded.
   */
  attach(sink: TerminalVtSink) {
    this.#sink = sink;
    const wasSinkFailure = this.#sinkFailure !== null;
    this.#sinkFailure = null;
    // The replay re-parses output the process already emitted; query
    // replies inside it must not reach the PTY a second time.
    sink.beginReplay?.();
    try {
      if (this.#base !== null) sink.resetAndWrite(this.#base);
      for (const chunk of this.#buffered) sink.write(chunk);
    } finally {
      sink.endReplay?.();
    }
    if (this.#state.ended) return;
    const unfaithful = !this.#replayFaithful;
    if (wasSinkFailure || (unfaithful && !this.#state.degraded)) {
      this.#emit({
        ...this.#state,
        status: "live",
        statusText: unfaithful
          ? "Replayed without full history — modes and screen state before the retained tail are unknown, so interactive parity is not claimed (B4)."
          : "Watching live output.",
        degraded: unfaithful || this.#state.degraded,
      });
    }
  }

  detach() {
    this.#sink = null;
  }

  /**
   * A (re)subscription starts its frame sequence at 1; reset the cursor and
   * clear `ended` — a resumable close must not wedge the next incarnation.
   * The degraded flag survives: a truncated base stays truncated until a
   * full snapshot or reset re-bases the parser.
   */
  beginStream() {
    this.#sequence = 0;
    this.#pending = null;
    // The next subscription must re-prove itself: only its snapshot reseeds
    // the epoch and native watermark, so a stray pre-snapshot frame fails.
    this.#epoch = null;
    this.#nativeWatermark = -1;
    this.#emit({
      ...this.#state,
      status: "connecting",
      statusText: "Connecting…",
      ended: false,
    });
  }

  /** The stream itself failed (network/authority), not the terminal. */
  applyTransportError(message: string) {
    this.#pending = null;
    this.#emit({
      status: "error",
      statusText: message,
      degraded: this.#state.degraded,
      exitCode: null,
      ended: true,
    });
  }

  /**
   * The surface failed to mount (asset decode, DOM). The stream keeps
   * running into the bounded pre-sink buffer so a later remount can still
   * attach; the failure is visible instead of a silently dead pane. The
   * failure is sticky — later snapshot/output frames must not claim the
   * pane is live while the renderer never started.
   */
  applySinkFailure(message: string) {
    this.#sinkFailure = message;
    if (this.#state.ended) return;
    this.#emit({
      status: "error",
      statusText: message,
      degraded: this.#state.degraded,
      exitCode: null,
      ended: false,
    });
  }

  #emit(state: TerminalVtAttachmentState) {
    this.#state = state;
    this.#onChange?.();
  }

  /**
   * Status a non-lifecycle frame may claim. While a renderer start failure
   * is unresolved the pane stays visibly errored — a snapshot arriving
   * after the failure is not proof the renderer exists.
   */
  #runningStatus(): { status: "live" | "error"; statusText: string } {
    return this.#sinkFailure === null
      ? { status: "live", statusText: "Watching live output." }
      : { status: "error", statusText: this.#sinkFailure };
  }

  #fail(message: string) {
    this.#pending = null;
    this.#emit({
      status: "error",
      statusText: message,
      degraded: this.#state.degraded,
      exitCode: null,
      ended: true,
    });
  }

  #deliver(data: string) {
    this.#sink?.write(data);
    // Always retain for remount replay; trim the tail past the bound.
    this.#buffered.push(data);
    this.#bufferedLength += data.length;
    if (this.#bufferedLength <= MAX_PRE_SINK_OUTPUT_LENGTH) return;
    while (this.#buffered.length > 0 && this.#bufferedLength > MAX_PRE_SINK_OUTPUT_LENGTH) {
      this.#bufferedLength -= this.#buffered[0]!.length;
      this.#buffered.shift();
    }
    // Replay needs bytes we no longer hold. A live surface still shows
    // everything, so only flag the visible pane when there is no sink — a
    // later remount flags itself degraded via #replayFaithful.
    this.#replayFaithful = false;
    if (this.#sink === null && !this.#state.degraded && !this.#state.ended) {
      this.#emit({
        ...this.#state,
        degraded: true,
        statusText:
          this.#sinkFailure ??
          "Output outran the renderer before it attached — early bytes were dropped, so interactive parity is not claimed.",
      });
    }
  }

  /**
   * Apply one public `t3.terminal/output-events` frame. Mirrors the native
   * attach reducer — snapshot resets parser state, chunked output reassembles
   * before it reaches the parser, lifecycle frames end or re-base the stream.
   */
  applyFrame(
    frame: { readonly streamId: string; readonly sequence: number },
    value: TerminalOutputEventsValue,
  ): void {
    if (this.#state.ended && value.kind !== "closed") return;
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence !== this.#sequence + 1) {
      this.#fail("Output transport sequence is discontinuous.");
      return;
    }
    this.#sequence = frame.sequence;

    if (value.kind === "snapshot") {
      if (!Number.isSafeInteger(value.boundarySequence) || value.boundarySequence < 0) {
        this.#fail("Output snapshot boundary is invalid.");
        return;
      }
      this.#pending = null;
      this.#epoch = value.streamEpoch;
      this.#nativeWatermark = value.boundarySequence;
      this.#base = value.contents;
      this.#buffered = [];
      this.#bufferedLength = 0;
      // A snapshot only restores fidelity when the epoch's retained bytes
      // cover process start — an untruncated snapshot in a post-clear epoch
      // is still missing the mode-establishing output.
      this.#replayFaithful = !value.truncated && value.streamEpoch !== this.#clearedEpoch;
      const unfaithful = !this.#replayFaithful;
      this.#sink?.resetAndWrite(value.contents);
      const ended = value.status === "exited" || value.status === "error";
      const running = this.#runningStatus();
      this.#emit({
        status: ended ? "exited" : running.status,
        statusText: ended
          ? `Terminal is ${value.status}.`
          : this.#sinkFailure !== null
            ? this.#sinkFailure
            : value.truncated
              ? "Watching live output — earlier history was truncated, so terminal state may be incomplete."
              : unfaithful
                ? "Watching live output — history was cleared, so terminal modes may be incomplete."
                : "Watching live output.",
        degraded: unfaithful && !ended,
        exitCode: null,
        ended,
      });
      return;
    }

    if (this.#epoch === null || value.streamEpoch !== this.#epoch) {
      this.#fail("Output incarnation changed.");
      return;
    }

    if (value.kind === "closed") {
      this.#pending = null;
      this.#emit({
        status: "closed",
        statusText: `Output unavailable: ${value.reason}.`,
        degraded: this.#state.degraded,
        exitCode: null,
        ended: true,
      });
      return;
    }

    if (!Number.isSafeInteger(value.sequence)) {
      this.#fail("Output native sequence is invalid.");
      return;
    }

    if (value.kind === "reset") {
      if (this.#pending !== null) {
        this.#fail("Output chunk group is discontinuous.");
        return;
      }
      if (value.sequence <= this.#nativeWatermark) {
        this.#fail("Output event sequence is not monotonic.");
        return;
      }
      this.#nativeWatermark = value.sequence;
      this.#pending = null;
      this.#base = "";
      this.#buffered = [];
      this.#bufferedLength = 0;
      // history-cleared drops retained output only — the process and its
      // negotiated modes keep running. A parser reset (RIS) would wipe the
      // application-cursor/bracketed-paste/kitty state the shell still
      // expects, so a live surface gets a mode-preserving erase and keeps
      // its fidelity claim. With no surface the replay base is all that
      // exists, and it no longer contains the mode-establishing bytes.
      this.#replayFaithful = false;
      this.#clearedEpoch = this.#epoch;
      if (this.#sink) {
        this.#sink.clearScreen();
      }
      const running = this.#runningStatus();
      this.#emit({
        status: running.status,
        statusText:
          this.#sinkFailure !== null
            ? this.#sinkFailure
            : this.#sink !== null
              ? "Terminal history cleared. Watching live output."
              : "Terminal history cleared before the renderer attached — earlier modes are unknown.",
        degraded: this.#sink === null || this.#state.degraded,
        exitCode: null,
        ended: false,
      });
      return;
    }

    if (value.kind === "exit") {
      if (this.#pending !== null) {
        this.#fail("Terminal exited with incomplete output.");
        return;
      }
      if (value.sequence <= this.#nativeWatermark) {
        this.#fail("Output event sequence is not monotonic.");
        return;
      }
      this.#nativeWatermark = value.sequence;
      this.#emit({
        status: "exited",
        statusText: `Terminal exited (code ${value.exitCode ?? "unknown"}).`,
        degraded: this.#state.degraded,
        exitCode: value.exitCode,
        ended: true,
      });
      return;
    }

    if (
      !Number.isSafeInteger(value.chunkCount) ||
      value.chunkCount < 1 ||
      value.chunkCount > MAX_OUTPUT_CHUNKS ||
      !Number.isSafeInteger(value.chunkIndex) ||
      value.chunkIndex < 0 ||
      value.chunkIndex >= value.chunkCount ||
      typeof value.data !== "string" ||
      value.data.length > MAX_OUTPUT_CHUNK_DATA_LENGTH
    ) {
      this.#fail("Output chunk exceeds the public contract.");
      return;
    }
    if (this.#pending !== null) {
      // A chunk that does not continue the open group abandoned it — output
      // bytes are missing, so fail rather than silently swap groups.
      if (
        value.sequence !== this.#pending.sequence ||
        value.chunkCount !== this.#pending.count ||
        value.chunkIndex !== this.#pending.parts.length
      ) {
        this.#fail("Output chunk group is discontinuous.");
        return;
      }
      this.#pending.parts.push(value.data);
      if (this.#pending.parts.length < this.#pending.count) return;
      const data = this.#pending.parts.join("");
      this.#pending = null;
      this.#nativeWatermark = value.sequence;
      this.#deliver(data);
      return;
    }
    // A new group must start at chunk 0 on a fresh native sequence — never
    // at-or-before the watermark, and never mid-group.
    if (value.chunkIndex !== 0) {
      this.#fail("Output chunk group is discontinuous.");
      return;
    }
    if (value.sequence <= this.#nativeWatermark) {
      this.#fail("Output event sequence is not monotonic.");
      return;
    }
    if (value.chunkCount > 1) {
      this.#pending = {
        sequence: value.sequence,
        count: value.chunkCount,
        parts: [value.data],
      };
      return;
    }
    this.#nativeWatermark = value.sequence;
    this.#deliver(value.data);
  }
}

export interface TerminalOutputFrame {
  readonly streamId: string;
  readonly sequence: number;
  readonly value: TerminalOutputEventsValue;
}

/**
 * Live output pump: subscribe → apply frames → resubscribe on resumable
 * closes (identity-changed, bounded overflow streaks). Returns when the
 * stream ends for good or the signal aborts.
 */
export async function pumpTerminalOutput(options: {
  readonly subscribe: (signal: AbortSignal) => AsyncIterable<TerminalOutputFrame>;
  readonly attachment: TerminalVtAttachment;
  readonly signal: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}): Promise<void> {
  const { attachment, signal } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  let streak = EMPTY_OVERFLOW_STREAK;
  while (!signal.aborted) {
    attachment.beginStream();
    let resurrect = false;
    let overflowClose = false;
    try {
      for await (const frame of options.subscribe(signal)) {
        if (signal.aborted) return;
        streak = noteOutputFrameForStreak(frame.value, streak, now());
        attachment.applyFrame(frame, frame.value);
        if (frame.value.kind === "closed") {
          overflowClose = frame.value.reason === "overflow";
          resurrect = isResumableOutputClose(
            frame.value.reason as TerminalOutputEventsClosed["reason"],
            streak.attempts,
          );
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        attachment.applyTransportError(
          error instanceof Error ? error.message : "Terminal output unavailable",
        );
      }
      return;
    }
    if (signal.aborted || !resurrect) return;
    if (overflowClose && streak.attempts > 1) await sleep(300 * streak.attempts);
  }
}
