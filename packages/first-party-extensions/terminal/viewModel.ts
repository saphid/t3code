import type {
  TerminalControlAck,
  TerminalControlAttachInput,
  TerminalControlCloseInput,
  TerminalControlClearInput,
  TerminalControlOpenInput,
  TerminalControlResizeInput,
  TerminalControlRestartInput,
  TerminalControlWriteInput,
  TerminalOutputEventsClosed,
  TerminalOutputEventsValue,
  TerminalSessionMetadata,
  TerminalSessionResult,
  TerminalSessionsListEvent,
} from "@t3tools/extension-sdk/catalogue";
import { nextTerminalId, resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";

/** Matches the native client retained-output cap (client-runtime terminalOutput.ts:45). */
export const TERMINAL_BUFFER_MAX_BYTES = 512 * 1024;

/**
 * Overflow-resubscribe window: the provider preserves the subscription's
 * snapshot ahead of every `closed:overflow`, so a delivered frame cannot
 * bound a sustained flood — overflows close together in time keep counting,
 * while a quiet gap resets the streak.
 */
export const OVERFLOW_RESUBSCRIBE_WINDOW_MS = 10_000;
export const OVERFLOW_RESUBSCRIBE_MAX = 3;

export const nextOverflowAttempts = (attempts: number, lastAt: number, now: number) =>
  now - lastAt < OVERFLOW_RESUBSCRIBE_WINDOW_MS ? attempts + 1 : 1;

/** `closed` reasons a fresh output subscription can recover from. */
export const isResumableOutputClose = (
  reason: TerminalOutputEventsClosed["reason"],
  overflowAttempts: number,
) =>
  reason === "identity-changed" ||
  (reason === "overflow" && overflowAttempts <= OVERFLOW_RESUBSCRIBE_MAX);

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

/* ------------------------------------------------------------------ */
/* Interactive panel: tabs, reconcile, input, resize, lifecycle.       */
/* ------------------------------------------------------------------ */

/** Same terminal ids (order ignored) — port of the native helper. */
export function terminalIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  if (left.length === 0) return true;
  const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
  const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) return false;
  }
  return true;
}

/**
 * Server knows fewer sessions than the client, but every server id still
 * exists locally. Typical right after open: the list stream lags, and
 * reconciling would drop the fresh id. Port of the native lag rule.
 */
export function serverTerminalIdsStrictSubsetOfClient(
  serverIds: readonly string[],
  clientIds: readonly string[],
): boolean {
  if (serverIds.length >= clientIds.length || clientIds.length === 0) return false;
  const clientSet = new Set(clientIds);
  for (const id of serverIds) {
    if (!clientSet.has(id)) return false;
  }
  return true;
}

/** Snapshot reconcile: keep the client order while the server list lags. */
export function reconcileTerminalIds(
  clientIds: readonly string[],
  serverIds: readonly string[],
): string[] {
  if (terminalIdListsEqual(clientIds, serverIds)) return [...clientIds];
  if (serverTerminalIdsStrictSubsetOfClient(serverIds, clientIds)) return [...clientIds];
  return [...serverIds];
}

/** Public view-context workspace identity (extensionWorkspaceRevision payload). */
export function workspaceLaunchFromRevision(
  workspaceRevision: string | undefined,
): { cwd: string; workspaceRoot: string; worktreePath: string | null } | null {
  if (workspaceRevision === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(workspaceRevision);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      parsed[0].trim().length === 0 ||
      (parsed[1] !== null && (typeof parsed[1] !== "string" || parsed[1].trim().length === 0))
    )
      return null;
    const workspaceRoot = parsed[0] as string;
    const worktreePath = parsed[1] as string | null;
    return { cwd: worktreePath ?? workspaceRoot, workspaceRoot, worktreePath };
  } catch {
    return null;
  }
}

/** Host calls the panel makes through t3.terminal/control. */
export interface TerminalControlOps {
  open(input: TerminalControlOpenInput): Promise<TerminalSessionMetadata>;
  attach(input: TerminalControlAttachInput): Promise<TerminalSessionMetadata>;
  write(input: TerminalControlWriteInput): Promise<TerminalControlAck>;
  resize(input: TerminalControlResizeInput): Promise<TerminalControlAck>;
  clear(input: TerminalControlClearInput): Promise<TerminalControlAck>;
  restart(input: TerminalControlRestartInput): Promise<TerminalSessionMetadata>;
  close(input: TerminalControlCloseInput): Promise<TerminalControlAck>;
}

export interface TerminalLaunchContext {
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly env?: Record<string, string>;
  readonly cols?: number;
  readonly rows?: number;
}

export type TerminalConfirmAction = "close" | "restart" | "clear";

export interface TerminalTabState {
  readonly terminalId: string;
  readonly label: string;
  readonly status: SessionRow["status"];
  readonly hasRunningSubprocess: boolean;
  readonly exitCode: number | null;
  /** open/attach in flight; typed input queues behind it. */
  readonly starting: boolean;
  /** Exit observed while tracked; the banner renders until removal lands. */
  readonly exitBanner: string | null;
  readonly confirmAction: TerminalConfirmAction | null;
  readonly error: string | null;
  readonly queuedInputCount: number;
}

export interface TerminalPanelSnapshot {
  readonly terminalIds: readonly string[];
  readonly activeTerminalId: string | null;
  readonly tabs: readonly TerminalTabState[];
  readonly stream: "connecting" | "live" | "closed";
  readonly panelError: string | null;
}

const MAX_QUEUED_INPUT_BYTES = 64 * 1024;
const MAX_QUEUED_INPUT_WRITES = 128;
const MAX_WRITE_DATA_LENGTH = 65_536;

interface TabInternal {
  meta: TerminalSessionMetadata | null;
  starting: boolean;
  queue: string[];
  queueBytes: number;
  exiting: boolean;
  exitBanner: string | null;
  confirm: TerminalConfirmAction | null;
  error: string | null;
  resizeInFlight: { cols: number; rows: number } | null;
  resizePending: { cols: number; rows: number } | null;
  resizeSent: { cols: number; rows: number } | null;
}

const newTab = (): TabInternal => ({
  meta: null,
  starting: false,
  queue: [],
  queueBytes: 0,
  exiting: false,
  exitBanner: null,
  confirm: null,
  error: null,
  resizeInFlight: null,
  resizePending: null,
  resizeSent: null,
});

const clampDimension = (value: number, max: number) =>
  Number.isSafeInteger(value) && value >= 1 && value <= max ? value : null;

/**
 * Framework-free terminal panel state. The view feeds the sessions list
 * stream and user gestures in; the panel calls the injected control ops and
 * reports immutable snapshots. Exit handling mirrors the native drawer: a
 * live→exited transition writes a banner and removes the tab on the next
 * scheduled tick; `remove` rows drop tabs immediately.
 */
export class TerminalPanel {
  readonly #control: TerminalControlOps;
  readonly #launch: TerminalLaunchContext | null;
  readonly #schedule: (callback: () => void) => void;
  readonly #onChange: (() => void) | undefined;
  #ids: string[];
  #active: string | null;
  readonly #tabs = new Map<string, TabInternal>();
  #stream: "connecting" | "live" | "closed" = "connecting";
  #panelError: string | null = null;
  #disposed = false;

  constructor(options: {
    readonly control: TerminalControlOps;
    readonly launch: TerminalLaunchContext | null;
    readonly restored?: {
      readonly terminalIds: readonly string[];
      readonly activeTerminalId: string | null;
    } | null;
    readonly schedule?: (callback: () => void) => void;
    readonly onChange?: () => void;
  }) {
    this.#control = options.control;
    this.#launch = options.launch;
    this.#schedule = options.schedule ?? ((callback) => setTimeout(callback, 0));
    this.#onChange = options.onChange;
    this.#ids = normalizeTerminalIds(options.restored?.terminalIds ?? []);
    this.#active = resolveActiveTerminalId(this.#ids, options.restored?.activeTerminalId ?? null);
    for (const id of this.#ids) this.#tabs.set(id, newTab());
  }

  get snapshot(): TerminalPanelSnapshot {
    return {
      terminalIds: [...this.#ids],
      activeTerminalId: this.#active,
      tabs: this.#ids.map((id) => {
        const tab = this.#tabs.get(id)!;
        const meta = tab.meta;
        return {
          terminalId: id,
          label: resolveTerminalSessionLabel(id, meta),
          status: tab.starting ? "starting" : (meta?.status ?? "closed"),
          hasRunningSubprocess: meta?.hasRunningSubprocess ?? false,
          exitCode: meta?.exitCode ?? null,
          starting: tab.starting,
          exitBanner: tab.exitBanner,
          confirmAction: tab.confirm,
          error: tab.error,
          queuedInputCount: tab.queue.length,
        } satisfies TerminalTabState;
      }),
      stream: this.#stream,
      panelError: this.#panelError,
    };
  }

  /** Ids eligible for allocation: client list plus any tab we are tracking. */
  get allocatableTerminalIds(): readonly string[] {
    return [...new Set([...this.#ids, ...this.#tabs.keys()])];
  }

  #emit() {
    this.#onChange?.();
  }

  #tab(terminalId: string): TabInternal {
    let tab = this.#tabs.get(terminalId);
    if (!tab) {
      tab = newTab();
      this.#tabs.set(terminalId, tab);
      if (!this.#ids.includes(terminalId)) this.#ids = [...this.#ids, terminalId];
    }
    return tab;
  }

  #removeTab(terminalId: string) {
    this.#tabs.delete(terminalId);
    this.#ids = this.#ids.filter((id) => id !== terminalId);
    this.#active = resolveActiveTerminalId(this.#ids, this.#active);
    this.#emit();
  }

  /** Banner + deferred removal on a live→exited/error transition (native #29). */
  #observeMeta(next: TerminalSessionMetadata) {
    const tab = this.#tab(next.terminalId);
    const previous = tab.meta;
    tab.meta = next;
    if (
      !tab.exiting &&
      (next.status === "exited" || next.status === "error") &&
      previous !== null &&
      (previous.status === "starting" || previous.status === "running")
    ) {
      tab.exiting = true;
      tab.exitBanner =
        next.status === "exited"
          ? `Process exited (code ${next.exitCode ?? "unknown"})`
          : "Terminal error";
      this.#schedule(() => {
        if (!this.#disposed && this.#tabs.get(next.terminalId)?.exiting) {
          this.#removeTab(next.terminalId);
        }
      });
    }
  }

  applySessionsEvent(event: TerminalSessionsListEvent) {
    if (this.#disposed) return;
    switch (event.kind) {
      case "snapshot": {
        this.#stream = "live";
        // Reconcile before absorbing metadata: #observeMeta registers every
        // server id as a tracked tab, which would turn a disjoint server list
        // into a strict subset and let stale restored ids survive (#17).
        const serverIds = event.terminals.map((terminal) => terminal.terminalId);
        this.#ids = reconcileTerminalIds(this.#ids, serverIds);
        for (const terminal of event.terminals) this.#observeMeta(terminal);
        for (const id of this.#tabs.keys()) {
          if (!this.#ids.includes(id)) this.#tabs.delete(id);
        }
        this.#active = resolveActiveTerminalId(this.#ids, this.#active);
        break;
      }
      case "upsert":
        this.#observeMeta(event.terminal);
        break;
      case "remove":
        this.#removeTab(event.terminalId);
        return;
      case "closed":
        this.#stream = "closed";
        break;
    }
    this.#emit();
  }

  /**
   * A (re)subscription means the last snapshot may be stale — tabs stay
   * visible, but the stream is not authoritative until the next snapshot, so
   * openTerminal's allocation gate must wait for it. It also means the view
   * is alive: React replays effect cleanup in dev, and a tombstone from that
   * fake unmount would otherwise swallow every later sessions frame.
   */
  beginListStream() {
    this.#disposed = false;
    if (this.#stream === "connecting") return;
    this.#stream = "connecting";
    this.#emit();
  }

  markStreamDisconnected(message: string | null) {
    this.#stream = "closed";
    this.#panelError = message;
    this.#emit();
  }

  /** Open a fresh terminal; the client picks the id (#15). */
  async openTerminal(): Promise<string | null> {
    const launch = this.#launch;
    if (!launch) {
      this.#panelError = "Terminal requires a workspace scope.";
      this.#emit();
      return null;
    }
    // Allocation must be serialized against the first list snapshot: before
    // it lands, unseen server-side sessions are invisible to nextTerminalId
    // and a colliding id would attach an existing terminal instead of opening
    // a fresh one (#17 strict-subset rule depends on this ordering).
    if (this.#stream !== "live") {
      this.#panelError = "Session list is still connecting.";
      this.#emit();
      return null;
    }
    const terminalId = nextTerminalId(this.allocatableTerminalIds);
    const tab = this.#tab(terminalId);
    tab.starting = true;
    tab.error = null;
    this.#ids = [...this.#ids.filter((id) => id !== terminalId), terminalId];
    this.#active = terminalId;
    this.#emit();
    try {
      const meta = await this.#control.open({
        terminalId,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        ...(launch.cols !== undefined ? { cols: launch.cols } : {}),
        ...(launch.rows !== undefined ? { rows: launch.rows } : {}),
        ...(launch.env !== undefined ? { env: launch.env } : {}),
      });
      tab.starting = false;
      this.#observeMeta(meta);
      await this.#drain(terminalId);
    } catch (error) {
      tab.starting = false;
      tab.queue = [];
      tab.queueBytes = 0;
      tab.error = error instanceof Error ? error.message : "Terminal open failed";
      this.#emit();
    }
    return terminalId;
  }

  /** Attach a tracked id that has no live metadata (restore/edge). */
  async startSession(terminalId: string): Promise<void> {
    const launch = this.#launch;
    const tab = this.#tabs.get(terminalId);
    if (!tab || !launch || tab.starting) return;
    if (tab.meta !== null && tab.meta.status !== "exited" && tab.meta.status !== "error") return;
    tab.starting = true;
    tab.exiting = false;
    tab.exitBanner = null;
    tab.error = null;
    this.#emit();
    try {
      const meta = await this.#control.attach({
        terminalId,
        cwd: launch.cwd,
        worktreePath: launch.worktreePath,
        restartIfNotRunning: true,
        ...(launch.cols !== undefined ? { cols: launch.cols } : {}),
        ...(launch.rows !== undefined ? { rows: launch.rows } : {}),
        ...(launch.env !== undefined ? { env: launch.env } : {}),
      });
      tab.starting = false;
      this.#observeMeta(meta);
      await this.#drain(terminalId);
    } catch (error) {
      tab.starting = false;
      tab.error = error instanceof Error ? error.message : "Terminal attach failed";
      this.#emit();
    }
  }

  /** Flush queued input and the pending fit-resize after a start resolves. */
  async #drain(terminalId: string) {
    const tab = this.#tabs.get(terminalId);
    if (!tab) return;
    const queued = tab.queue;
    tab.queue = [];
    tab.queueBytes = 0;
    for (const data of queued) {
      try {
        await this.#control.write({ terminalId, data });
      } catch (error) {
        tab.error = error instanceof Error ? error.message : "Terminal write failed";
        break;
      }
    }
    const pending = tab.resizePending;
    tab.resizePending = null;
    if (pending) await this.#sendResize(terminalId, pending);
    this.#emit();
  }

  /** Type into a terminal; input sent while the session starts is queued. */
  sendInput(terminalId: string, data: string) {
    const tab = this.#tabs.get(terminalId);
    if (!tab || data.length === 0 || this.#disposed) return;
    if (data.length > MAX_WRITE_DATA_LENGTH) {
      tab.error = "Input exceeds the 64 KiB write bound.";
      this.#emit();
      return;
    }
    if (tab.starting) {
      if (
        tab.queue.length >= MAX_QUEUED_INPUT_WRITES ||
        tab.queueBytes + data.length > MAX_QUEUED_INPUT_BYTES
      ) {
        tab.error = "Input dropped: the pending-input queue is full.";
      } else {
        tab.queue.push(data);
        tab.queueBytes += data.length;
      }
      this.#emit();
      return;
    }
    this.#control.write({ terminalId, data }).catch((error: unknown) => {
      tab.error = error instanceof Error ? error.message : "Terminal write failed";
      this.#emit();
    });
  }

  /** Latest-wins resize: a new fit while one is in flight replaces the pending one. */
  resize(terminalId: string, cols: number, rows: number) {
    const safeCols = clampDimension(cols, 1000);
    const safeRows = clampDimension(rows, 500);
    if (safeCols === null || safeRows === null) return;
    const tab = this.#tabs.get(terminalId);
    if (!tab || this.#disposed) return;
    const next = { cols: safeCols, rows: safeRows };
    if (tab.resizeSent?.cols === next.cols && tab.resizeSent.rows === next.rows) return;
    if (tab.starting || tab.resizeInFlight !== null) {
      tab.resizePending = next;
      return;
    }
    void this.#sendResize(terminalId, next);
  }

  async #sendResize(terminalId: string, size: { cols: number; rows: number }) {
    const tab = this.#tabs.get(terminalId);
    if (!tab) return;
    tab.resizeInFlight = size;
    try {
      await this.#control.resize({ terminalId, cols: size.cols, rows: size.rows });
      tab.resizeSent = size;
    } catch (error) {
      tab.error = error instanceof Error ? error.message : "Terminal resize failed";
    } finally {
      tab.resizeInFlight = null;
      const pending = tab.resizePending;
      tab.resizePending = null;
      if (pending && !tab.starting) void this.#sendResize(terminalId, pending);
      this.#emit();
    }
  }

  requestAction(terminalId: string, action: TerminalConfirmAction) {
    const tab = this.#tabs.get(terminalId);
    if (!tab || this.#disposed) return;
    tab.confirm = action;
    this.#emit();
  }

  cancelAction(terminalId: string) {
    const tab = this.#tabs.get(terminalId);
    if (!tab) return;
    tab.confirm = null;
    this.#emit();
  }

  /** Confirmed destructive action; close falls back to a plain `exit\n` write. */
  async confirmAction(terminalId: string): Promise<void> {
    const tab = this.#tabs.get(terminalId);
    const action = tab?.confirm;
    if (!tab || !action) return;
    tab.confirm = null;
    if (action === "close") {
      try {
        await this.#control.close({ terminalId, deleteHistory: true });
      } catch {
        try {
          await this.#control.write({ terminalId, data: "exit\n" });
        } catch {
          // The session may already be gone; the tab still leaves.
        }
      }
      this.#removeTab(terminalId);
      return;
    }
    const launch = this.#launch;
    try {
      if (action === "clear") {
        await this.#control.clear({ terminalId });
      } else {
        if (!launch) throw new Error("Terminal requires a workspace scope.");
        tab.starting = true;
        this.#emit();
        const meta = await this.#control.restart({
          terminalId,
          cwd: launch.cwd,
          worktreePath: launch.worktreePath,
          cols: launch.cols ?? 80,
          rows: launch.rows ?? 24,
          ...(launch.env !== undefined ? { env: launch.env } : {}),
        });
        tab.starting = false;
        tab.exiting = false;
        tab.exitBanner = null;
        this.#observeMeta(meta);
        await this.#drain(terminalId);
        return;
      }
    } catch (error) {
      tab.starting = false;
      tab.error = error instanceof Error ? error.message : "Terminal action failed";
    }
    this.#emit();
  }

  activate(terminalId: string) {
    if (!this.#ids.includes(terminalId)) return;
    this.#active = terminalId;
    this.#emit();
  }

  dispose() {
    this.#disposed = true;
  }
}
