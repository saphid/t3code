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

export class TerminalVtAttachment {
  readonly terminalId: string;
  readonly #onChange: (() => void) | undefined;
  #sink: TerminalVtSink | null = null;
  /** Live output held while the surface is loading; replayed on attach. */
  #buffered: string[] = [];
  /** The last snapshot/reset contents that seeded parser state, if any. */
  #base: string | null = null;
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
   * state, so a late surface sees the same screen as a live one.
   */
  attach(sink: TerminalVtSink) {
    this.#sink = sink;
    if (this.#base !== null) sink.resetAndWrite(this.#base);
    for (const chunk of this.#buffered) sink.write(chunk);
    this.#buffered = [];
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

  #emit(state: TerminalVtAttachmentState) {
    this.#state = state;
    this.#onChange?.();
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
    if (this.#sink) this.#sink.write(data);
    else this.#buffered.push(data);
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
      this.#base = value.contents;
      this.#buffered = [];
      this.#sink?.resetAndWrite(value.contents);
      const ended = value.status === "exited" || value.status === "error";
      this.#emit({
        status: ended ? "exited" : "live",
        statusText: ended
          ? `Terminal is ${value.status}.`
          : value.truncated
            ? "Watching live output — earlier history was truncated, so terminal state may be incomplete."
            : "Watching live output.",
        degraded: value.truncated && !ended,
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
      this.#pending = null;
      this.#base = "";
      this.#buffered = [];
      this.#sink?.resetAndWrite("");
      // A full reset re-bases the parser: every byte from here on is live and
      // known, so the truncated-attach degradation no longer applies.
      this.#emit({
        status: "live",
        statusText: "Terminal history cleared. Watching live output.",
        degraded: false,
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
    const group =
      this.#pending !== null &&
      this.#pending.sequence === value.sequence &&
      this.#pending.count === value.chunkCount
        ? this.#pending
        : value.chunkIndex === 0
          ? { sequence: value.sequence, count: value.chunkCount, parts: [] as string[] }
          : null;
    if (group === null || group.parts.length !== value.chunkIndex) {
      this.#fail("Output chunk group is discontinuous.");
      return;
    }
    group.parts.push(value.data);
    this.#pending = group.parts.length < group.count ? group : null;
    if (this.#pending === null) this.#deliver(group.parts.join(""));
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
