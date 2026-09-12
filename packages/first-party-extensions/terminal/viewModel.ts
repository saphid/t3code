import type {
  TerminalOutputEventsValue,
  TerminalSessionResult,
} from "@t3tools/extension-sdk/catalogue";

/** Matches the native client retained-output cap (client-runtime terminalOutput.ts:45). */
export const TERMINAL_BUFFER_MAX_BYTES = 512 * 1024;

export interface SessionRow {
  readonly terminalId: string;
  readonly label: string;
  readonly status: "starting" | "running" | "exited" | "error" | "closed" | "unknown";
  readonly hasRunningSubprocess: boolean;
  readonly exitCode: number | null;
  readonly updatedAt: string | null;
}

export interface OutputBuffer {
  readonly contents: string;
  readonly retainedBytes: number;
  readonly truncated: boolean;
  readonly status: "connecting" | "live" | "exited" | "closed" | "error";
  readonly statusText: string;
  readonly exitCode: number | null;
  readonly epoch: string | null;
  readonly sequence: number;
  readonly ended: boolean;
}

const textEncoder = new TextEncoder();
const utf8Bytes = (value: string) => textEncoder.encode(value).byteLength;

/** UTF-16-safe tail cut: never split a surrogate pair or an astral character. */
export function tailByBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  let start = encoded.byteLength - maxBytes;
  while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) start += 1;
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoded.subarray(start));
}

/** Fallback tab title when a session has no server-computed label. */
export function fallbackTerminalLabel(terminalId: string): string {
  const match = /^term-(\d+)$/.exec(terminalId);
  return match ? `Terminal ${match[1]}` : "Terminal";
}

export function describeSession(result: TerminalSessionResult): SessionRow | null {
  if (result === null) return null;
  return {
    terminalId: result.terminalId,
    label: result.label || fallbackTerminalLabel(result.terminalId),
    status: result.status,
    hasRunningSubprocess: result.hasRunningSubprocess,
    exitCode: result.exitCode,
    updatedAt: result.updatedAt,
  };
}

/** A session that inspect() reports absent keeps a visible row so the list never lies. */
export function missingSessionRow(terminalId: string): SessionRow {
  return {
    terminalId,
    label: fallbackTerminalLabel(terminalId),
    status: "closed",
    hasRunningSubprocess: false,
    exitCode: null,
    updatedAt: null,
  };
}

export function normalizeTerminalIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id.length === 0 || id.length > 128 || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function addTerminalId(ids: readonly string[], terminalId: string): string[] {
  const id = terminalId.trim();
  if (id.length === 0 || id.length > 128) return [...ids];
  return ids.includes(id) ? [...ids] : [...ids, id];
}

export function removeTerminalId(ids: readonly string[], terminalId: string): string[] {
  return ids.filter((id) => id !== terminalId);
}

export function resolveActiveTerminalId(
  ids: readonly string[],
  activeTerminalId: string | null,
): string | null {
  if (ids.length === 0) return null;
  return activeTerminalId !== null && ids.includes(activeTerminalId)
    ? activeTerminalId
    : (ids[0] ?? null);
}

export const EMPTY_OUTPUT_BUFFER: OutputBuffer = {
  contents: "",
  retainedBytes: 0,
  truncated: false,
  status: "connecting",
  statusText: "Connecting…",
  exitCode: null,
  epoch: null,
  sequence: 0,
  ended: false,
};

/**
 * Apply one public `t3.terminal/output-events` frame. Output chunks share a
 * native sequence number and arrive in chunkIndex order; a partial group is
 * buffered until complete so torn output never renders. Lifecycle frames
 * (reset/exit/closed) end or clear the buffer exactly like the native
 * attach-stream reducer.
 */
export function applyOutputEvent(
  current: OutputBuffer,
  frame: { readonly streamId: string; readonly sequence: number },
  value: TerminalOutputEventsValue,
  pending?: { sequence: number; count: number; parts: string[] } | null,
): { buffer: OutputBuffer; pending: { sequence: number; count: number; parts: string[] } | null } {
  const fail = (message: string): { buffer: OutputBuffer; pending: null } => ({
    buffer: { ...EMPTY_OUTPUT_BUFFER, status: "error", statusText: message, ended: true },
    pending: null,
  });
  if (current.ended) return fail("Output arrived after the terminal lifecycle ended.");
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence !== current.sequence + 1)
    return fail("Output transport sequence is discontinuous.");
  const sequence = frame.sequence;
  const base = { ...current, sequence };

  if (value.kind === "snapshot") {
    if (frame.sequence < 0 || !Number.isSafeInteger(value.boundarySequence))
      return fail("Output snapshot boundary is invalid.");
    const contents = tailByBytes(value.contents, TERMINAL_BUFFER_MAX_BYTES);
    const ended = value.status === "exited" || value.status === "error";
    return {
      buffer: {
        contents,
        retainedBytes: utf8Bytes(contents),
        truncated: value.truncated,
        status: ended ? "exited" : "live",
        statusText: ended
          ? `Terminal is ${value.status}.`
          : value.truncated
            ? "Watching live output. Older retained history was omitted."
            : "Watching live output.",
        exitCode: null,
        epoch: value.streamEpoch,
        sequence,
        ended,
      },
      pending: null,
    };
  }
  if (current.epoch === null || value.streamEpoch !== current.epoch)
    return fail("Output incarnation changed.");

  if (value.kind === "closed") {
    return {
      buffer: {
        ...base,
        contents: "",
        retainedBytes: 0,
        status: "closed",
        statusText: `Output unavailable: ${value.reason}. Subscribe again to recover.`,
        ended: true,
      },
      pending: null,
    };
  }
  if (!Number.isSafeInteger(value.sequence)) return fail("Output native sequence is invalid.");
  if (value.kind === "reset") {
    return {
      buffer: {
        ...base,
        contents: "",
        retainedBytes: 0,
        truncated: false,
        status: "live",
        statusText: "Terminal history cleared. Watching live output.",
      },
      pending: null,
    };
  }
  if (value.kind === "exit") {
    if (pending) return fail("Terminal exited with incomplete output.");
    return {
      buffer: {
        ...base,
        status: "exited",
        statusText: `Terminal exited (code ${value.exitCode ?? "unknown"}).`,
        exitCode: value.exitCode,
        ended: true,
      },
      pending: null,
    };
  }

  if (
    !Number.isSafeInteger(value.chunkCount) ||
    value.chunkCount < 1 ||
    value.chunkCount > 64 ||
    !Number.isSafeInteger(value.chunkIndex) ||
    value.chunkIndex < 0 ||
    value.chunkIndex >= value.chunkCount ||
    typeof value.data !== "string" ||
    value.data.length > 8192
  )
    return fail("Output chunk exceeds the public contract.");
  const group =
    pending && pending.sequence === value.sequence && pending.count === value.chunkCount
      ? pending
      : value.chunkIndex === 0
        ? { sequence: value.sequence, count: value.chunkCount, parts: [] as string[] }
        : null;
  if (group === null || group.parts.length !== value.chunkIndex)
    return fail("Output chunk group is discontinuous.");
  group.parts.push(value.data);
  if (group.parts.length < group.count) return { buffer: base, pending: group };
  const contents = tailByBytes(base.contents + group.parts.join(""), TERMINAL_BUFFER_MAX_BYTES);
  return {
    buffer: {
      ...base,
      contents,
      retainedBytes: utf8Bytes(contents),
      status: "live",
      statusText: "Watching live output.",
    },
    pending: null,
  };
}
