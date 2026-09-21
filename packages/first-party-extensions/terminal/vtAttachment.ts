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
  /**
   * Contiguous runs of live output that were never parsed with the PTY
   * reply writer attached, in stream order. Each run carries its POSITION
   * in the replay stream (base + buffered), adjusted as snapshots re-base
   * the stream and eviction trims it — identical queries recur, so a run
   * is identified by where its bytes sit, never by rightmost content
   * match. Bytes delivered to a live sink answered their terminal queries
   * at write time; bytes buffered while detached produced no replies, so
   * replaying them suppressed would silently drop queries the process is
   * still waiting on. Replayed once with replies enabled, then cleared.
   * Snapshot/history bytes are treated as already-rendered history and
   * stay suppressed (native parity) — only live output the attachment saw
   * go undelivered earns a reply.
   */
  #unanswered: { start: number; data: string }[] = [];
  /**
   * The stream epoch that owns the pending runs. A reply queued while
   * detached belongs to the process that asked — an incarnation change
   * discards the claims before any content reconciliation.
   */
  #unansweredEpoch: string | null = null;
  /**
   * Code units evicted from the front of `#buffered` since `#base` was
   * set. While nonzero the compressed stream (base + buffered) is NOT a
   * contiguous slice of the epoch stream, so snapshot reconciliation
   * cannot prove where our bytes sit and pending claims are dropped.
   */
  #bufferedHole = 0;
  /**
   * Whether the start of the received stream is anchored: `#base` came
   * from a snapshot's contents, so our stream begins at a known retention
   * boundary and can only ever move forward. Post-clear streams
   * (`#base === ""` after a reset) start mid-window — bytes the server
   * emitted before our resubscribe sit inside the next snapshot ahead of
   * our first byte — so position-0 provenance is unprovable there.
   */
  #receivedAnchored = false;
  /**
   * Identity of the retained-history window the received stream belongs
   * to — the last snapshot's epoch + `clearGeneration`. A history clear
   * does NOT end the epoch, so a clear inside a subscription gap is
   * otherwise invisible: the next snapshot's `truncated:false` only
   * means "all CURRENT retained bytes", not "same history origin". Same
   * epoch with a different generation means the old window's bytes are
   * gone. null when the stream's window is unknown — no snapshot yet,
   * or an observed reset restarted the stream mid-window.
   */
  #baseWindow: { readonly epoch: string; readonly generation: number } | null = null;
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
  /**
   * Native sequence of the last event we consumed, persisted across
   * `beginStream` (which must reset the per-subscription watermark for
   * replay fencing). It marks the epoch-stream position where our
   * received stream ends — the anchor that makes a resnapshot's contents
   * provable when its boundary equals this sequence.
   */
  #receivedEndSequence = -1;

  constructor(terminalId: string, onChange?: () => void) {
    this.terminalId = terminalId;
    this.#onChange = onChange;
  }

  get state(): TerminalVtAttachmentState {
    return this.#state;
  }

  /**
   * Re-parse `stream` into a parser, splitting at each unanswered run:
   * bytes already parsed with replies enabled (or never seen live — plain
   * retained history) replay suppressed, unanswered runs replay with the
   * PTY writer attached so their queries get their single reply.
   */
  #replayInto(sink: TerminalVtSink, stream: string, resetBase: boolean) {
    // A pending reply releases only while its owning epoch is proven: the
    // claim must match the currently established stream epoch. A mount in
    // the beginStream→snapshot gap (epoch unproven, null) replays the
    // bytes suppressed and KEEPS the claims — a later same-epoch snapshot
    // can still prove and answer them; a different-epoch one discards
    // them before reconcile. Releasing early would write an old-epoch
    // reply to whatever process now owns the shared terminalId channel.
    const releasable = this.#unansweredEpoch === this.#epoch;
    // Runs carry their position — verify the bytes still sit where
    // bookkeeping placed them rather than re-identifying them by content:
    // a resnapshot can hold an identical later copy that must NOT inherit
    // the pending reply.
    const ranges: Array<[number, number]> = [];
    if (releasable) {
      for (const run of this.#unanswered) {
        if (stream.startsWith(run.data, run.start)) {
          ranges.push([run.start, run.start + run.data.length]);
        }
      }
    }
    const suppressed = (write: () => void) => {
      sink.beginReplay?.();
      try {
        write();
      } finally {
        sink.endReplay?.();
      }
    };
    // With a snapshot base the parser is re-based (RIS + retained
    // contents); without one it is fresh, so the answered prefix is a
    // plain suppressed write.
    let pos = ranges[0]?.[0] ?? stream.length;
    if (resetBase) {
      suppressed(() => sink.resetAndWrite(stream.slice(0, pos)));
    } else if (pos > 0) {
      suppressed(() => sink.write(stream.slice(0, pos)));
    }
    for (const [start, end] of ranges) {
      if (start > pos) suppressed(() => sink.write(stream.slice(pos, start)));
      sink.write(stream.slice(start, end));
      pos = end;
    }
    if (pos < stream.length) suppressed(() => sink.write(stream.slice(pos)));
    // Released claims were answered — consume them. Unreleased claims
    // stay pending: only epoch proof or an owner-ending lifecycle event
    // resolves them. On a mid-replay throw this line is skipped, so a
    // retry may re-answer a partially parsed query — a bounded duplicate
    // beats a dropped reply on an already-visible error path.
    if (releasable) this.#clearUnanswered();
  }

  /**
   * A snapshot re-bases the stream. Equal text is never proof that bytes
   * survived — an evicted query and a newer identical query look the same
   * — so claims are only kept where the retention boundary itself proves
   * their position, and dropped otherwise (explicit drop: nothing remains
   * to answer, and migrating a claim would send an unsolicited reply).
   *
   * Two anchors are provable:
   * - `boundarySequence === priorReceivedEnd`: no newer events exist, so
   *   contents must end at our last received byte. `endsWith` then pins
   *   both ends — contents IS our received suffix, truncation included.
   * - `!truncated` with an anchored stream in the same clear generation:
   *   an untruncated snapshot covers every retained byte, retention only
   *   drops at the far larger buffer cap, and an unchanged generation
   *   proves no clear moved the window's start — so contents position 0
   *   is provably our stream's own start. `startsWith` then verifies the
   *   server agrees byte-for-byte.
   * Everything else — a truncated resnapshot, an unanchored post-clear
   *   stream, a hole from our own eviction — leaves run positions
   *   unprovable: drop the claims.
   */
  #reconcileUnanswered(
    received: string,
    contents: string,
    boundarySequence: number,
    priorReceivedEnd: number,
    truncated: boolean,
    priorAnchored: boolean,
    priorHole: number,
  ) {
    if (this.#unanswered.length === 0) return;
    let drop = -1;
    if (priorHole === 0) {
      if (boundarySequence === priorReceivedEnd && received.endsWith(contents)) {
        drop = received.length - contents.length;
      } else if (!truncated && priorAnchored && contents.startsWith(received)) {
        drop = 0;
      }
    }
    if (drop < 0) {
      this.#unanswered = [];
      return;
    }
    this.#unanswered = this.#unanswered.flatMap((run) => {
      const end = run.start + run.data.length;
      if (end <= drop) return [];
      const start = Math.max(run.start, drop);
      return [{ start: start - drop, data: run.data.slice(start - run.start) }];
    });
  }

  /**
   * The retained buffer dropped `cutLength` bytes starting at `cutStart`
   * (the buffered tail's front). Runs never straddle the base|buffered
   * boundary, so each is either before the cut, inside it, or after it.
   */
  #mapRunsAfterCut(cutStart: number, cutLength: number) {
    const cutEnd = cutStart + cutLength;
    this.#unanswered = this.#unanswered.flatMap((run) => {
      const end = run.start + run.data.length;
      if (end <= cutStart) return [run];
      if (run.start >= cutEnd) return [{ start: run.start - cutLength, data: run.data }];
      const keep = end - Math.max(run.start, cutEnd);
      if (keep <= 0) return [];
      return [{ start: cutStart, data: run.data.slice(run.data.length - keep) }];
    });
  }

  #clearUnanswered() {
    this.#unanswered = [];
    this.#unansweredEpoch = null;
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
    const previousFailure = this.#sinkFailure;
    this.#sink = sink;
    try {
      this.#replayInto(sink, (this.#base ?? "") + this.#buffered.join(""), this.#base !== null);
    } catch (error) {
      // A failed replay leaves the parser in an unknown partial state:
      // drop the sink so output buffers for a clean remount, and keep the
      // failure sticky — only a mount that completes clears it. The
      // unanswered range is kept too, so a retry may re-answer a query the
      // throw truncated mid-parse — a bounded duplicate beats a dropped
      // reply on an error path that is already visibly broken.
      this.#sink = null;
      this.#sinkFailure =
        previousFailure ??
        (error instanceof Error
          ? `Terminal renderer failed to start: ${error.message}`
          : "Terminal renderer failed to start.");
      if (!this.#state.ended) {
        this.#emit({
          status: "error",
          statusText: this.#sinkFailure,
          degraded: this.#state.degraded,
          exitCode: null,
          ended: false,
        });
      }
      throw error;
    }
    this.#sinkFailure = null;
    if (this.#state.ended) return;
    const unfaithful = !this.#replayFaithful;
    if (previousFailure !== null || (unfaithful && !this.#state.degraded)) {
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
    this.#clearUnanswered();
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
    this.#clearUnanswered();
    this.#emit({
      status: "error",
      statusText: message,
      degraded: this.#state.degraded,
      exitCode: null,
      ended: true,
    });
  }

  #deliver(data: string) {
    const tail = (this.#base?.length ?? 0) + this.#bufferedLength;
    if (this.#sink !== null) {
      this.#sink.write(data);
    } else {
      // Never reached a parser: queries inside still await their one
      // answer on the next replay. Extend the last run only while it ends
      // exactly at the stream tail — a snapshot may have placed it
      // mid-stream, and identical bytes elsewhere must not join it.
      const last = this.#unanswered[this.#unanswered.length - 1];
      if (last !== undefined && last.start + last.data.length === tail) {
        last.data += data;
      } else {
        this.#unanswered.push({ start: tail, data });
      }
      this.#unansweredEpoch = this.#epoch;
    }
    // Always retain for remount replay; trim the tail past the bound.
    this.#buffered.push(data);
    this.#bufferedLength += data.length;
    if (this.#bufferedLength <= MAX_PRE_SINK_OUTPUT_LENGTH) return;
    let evicted = 0;
    while (this.#buffered.length > 0 && this.#bufferedLength > MAX_PRE_SINK_OUTPUT_LENGTH) {
      evicted += this.#buffered[0]!.length;
      this.#bufferedLength -= this.#buffered[0]!.length;
      this.#buffered.shift();
    }
    // Evicted bytes are gone — any unanswered queries among them are lost
    // with the bytes (already flagged degraded); keep the runs honest.
    // The stream also stops being a contiguous epoch slice, which makes
    // the next snapshot's retention boundary unprovable for the survivors.
    this.#bufferedHole += evicted;
    this.#mapRunsAfterCut(this.#base?.length ?? 0, evicted);
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
      if (
        !Number.isSafeInteger(value.boundarySequence) ||
        value.boundarySequence < 0 ||
        !Number.isSafeInteger(value.clearGeneration) ||
        value.clearGeneration < 0
      ) {
        this.#fail("Output snapshot boundary is invalid.");
        return;
      }
      this.#pending = null;
      // Capture the OLD stream's provenance before re-basing — the
      // reconcile below evaluates where OUR bytes sat, not the new
      // snapshot's. `#epoch` is unusable here (beginStream nulls it), so
      // the window identity travels with the stream itself.
      const received = (this.#base ?? "") + this.#buffered.join("");
      const priorReceivedEnd = this.#receivedEndSequence;
      const priorAnchored = this.#receivedAnchored;
      const priorHole = this.#bufferedHole;
      const priorWindow = this.#baseWindow;
      this.#epoch = value.streamEpoch;
      this.#nativeWatermark = value.boundarySequence;
      this.#receivedEndSequence = value.boundarySequence;
      this.#base = value.contents;
      this.#receivedAnchored = true;
      this.#buffered = [];
      this.#bufferedLength = 0;
      this.#bufferedHole = 0;
      this.#baseWindow = { epoch: value.streamEpoch, generation: value.clearGeneration };
      // Incarnation change: a pending reply belongs to the process that
      // asked. The new epoch's retained history never earned it — discard
      // the claims before any reconciliation, so a stale query cannot
      // attach to identical bytes in another incarnation's stream.
      //
      // Same-epoch history reset missed while detached: a clear does not
      // end the epoch, so only the snapshot's clear generation proves the
      // retained window still shares our stream's origin. A mismatch
      // means the old bytes are gone — claims die with them, and the
      // post-clear tail no longer contains mode-establishing output, so
      // the epoch counts as cleared for fidelity too.
      const missedClear =
        priorWindow !== null &&
        priorWindow.epoch === value.streamEpoch &&
        priorWindow.generation !== value.clearGeneration;
      if (missedClear) this.#clearedEpoch = value.streamEpoch;
      if (
        this.#unanswered.length > 0 &&
        (this.#unansweredEpoch !== value.streamEpoch || missedClear)
      ) {
        this.#clearUnanswered();
      } else {
        // The snapshot's retained contents may extend past the bytes we
        // last received — the server kept accepting output while the
        // subscription was closed. Claims keep their positions only where
        // the retention boundary provably anchors them; anything else is
        // an explicit drop rather than a guess against identical bytes
        // elsewhere.
        this.#reconcileUnanswered(
          received,
          value.contents,
          value.boundarySequence,
          priorReceivedEnd,
          value.truncated,
          priorAnchored,
          priorHole,
        );
      }
      // A snapshot only restores fidelity when the epoch's retained bytes
      // cover process start — an untruncated snapshot in a post-clear epoch
      // is still missing the mode-establishing output.
      this.#replayFaithful = !value.truncated && value.streamEpoch !== this.#clearedEpoch;
      const unfaithful = !this.#replayFaithful;
      if (this.#sink) {
        // Re-base the live parser; unanswered runs inside the new
        // contents still earn their one reply right now.
        this.#replayInto(this.#sink, value.contents, true);
      }
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
      // The owner of a pending reply is gone on every close except
      // overflow (same incarnation, subscription-level). Identity change,
      // terminal close, and terminal error all invalidate it now — a mount
      // before the replacement snapshot must not release an old-epoch
      // reply to the new process.
      if (value.reason !== "overflow") this.#clearUnanswered();
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
      this.#receivedEndSequence = value.sequence;
      this.#pending = null;
      this.#base = "";
      this.#receivedAnchored = false;
      this.#baseWindow = null;
      this.#buffered = [];
      this.#bufferedLength = 0;
      this.#bufferedHole = 0;
      // Cleared bytes are gone — including any unanswered queries inside
      // them; nothing remains to answer.
      this.#clearUnanswered();
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
      this.#receivedEndSequence = value.sequence;
      // The process is gone — its pending queries died with it.
      this.#clearUnanswered();
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
      this.#receivedEndSequence = value.sequence;
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
    this.#receivedEndSequence = value.sequence;
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
