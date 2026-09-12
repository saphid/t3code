import {
  terminalOutputApi,
  terminalOutputEventsApi,
  terminalSessionsApi,
  type TerminalOutputEventsValue,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useRef, useState } from "react";

import {
  EMPTY_OUTPUT_BUFFER,
  addTerminalId,
  applyOutputEvent,
  describeSession,
  missingSessionRow,
  normalizeTerminalIds,
  removeTerminalId,
  resolveActiveTerminalId,
  type OutputBuffer,
  type SessionRow,
} from "./viewModel.js";

const manifestId = "t3.terminal";

interface RestoredState {
  readonly terminalIds: readonly string[];
  readonly activeTerminalId: string | null;
}

function restoreState(value: unknown): value is RestoredState | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as { terminalIds?: unknown; activeTerminalId?: unknown };
  return (
    Object.keys(value).every((key) => key === "terminalIds" || key === "activeTerminalId") &&
    (candidate.terminalIds === undefined ||
      (Array.isArray(candidate.terminalIds) &&
        candidate.terminalIds.every((id) => typeof id === "string"))) &&
    (candidate.activeTerminalId === undefined ||
      typeof candidate.activeTerminalId === "string" ||
      candidate.activeTerminalId === null)
  );
}

/** Inspect each known id; absent sessions stay visible as closed rows. */
function useSessionRows(
  host: ClientHost,
  session: ViewSession,
  terminalIds: readonly string[],
  visible: boolean,
  refreshRevision: number,
) {
  const [rows, setRows] = useState<{
    key: string;
    sessions: readonly SessionRow[];
    error: string | null;
  } | null>(null);
  const key = JSON.stringify([terminalIds, refreshRevision]);
  useEffect(() => {
    if (!visible || terminalIds.length === 0) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      const api = bindApi(terminalSessionsApi, host, session.context);
      try {
        const sessions = await Promise.all(
          terminalIds.map(async (terminalId) => {
            const result = await api.invoke("inspect", { terminalId }, signal);
            return describeSession(result) ?? missingSessionRow(terminalId);
          }),
        );
        if (!signal.aborted) setRows({ key, sessions, error: null });
      } catch (error) {
        if (!signal.aborted)
          setRows({
            key,
            sessions: terminalIds.map(missingSessionRow),
            error: error instanceof Error ? error.message : "Terminal status unavailable",
          });
      }
    })();
    return () => controller.abort();
  }, [host, session, visible, key, terminalIds]);
  return rows?.key === key ? rows : null;
}

/** Live output via the public output-events stream; chunk groups reassemble in the view model. */
function useTerminalOutput(
  host: ClientHost,
  session: ViewSession,
  terminalId: string | null,
  visible: boolean,
) {
  const [state, setState] = useState<{ terminalId: string; buffer: OutputBuffer } | null>(null);
  const pendingRef = useRef<{ sequence: number; count: number; parts: string[] } | null>(null);
  useEffect(() => {
    pendingRef.current = null;
    if (!visible || terminalId === null) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const stateRef = { current: EMPTY_OUTPUT_BUFFER as OutputBuffer };
    void (async () => {
      try {
        const stream = bindStreamApi(terminalOutputEventsApi, host, session.context).subscribe(
          "subscribe",
          { terminalId },
          signal,
        );
        for await (const frame of stream) {
          if (signal.aborted) return;
          const applied = applyOutputEvent(
            stateRef.current,
            frame,
            frame.value as TerminalOutputEventsValue,
            pendingRef.current,
          );
          pendingRef.current = applied.pending;
          stateRef.current = applied.buffer;
          setState({ terminalId, buffer: applied.buffer });
          if (applied.buffer.ended) return;
        }
        if (!signal.aborted && pendingRef.current !== null) {
          stateRef.current = {
            ...EMPTY_OUTPUT_BUFFER,
            status: "error",
            statusText: "Output ended with an incomplete chunk group.",
            ended: true,
          };
          setState({ terminalId, buffer: stateRef.current });
        }
      } catch (error) {
        if (!signal.aborted) {
          const buffer: OutputBuffer = {
            ...EMPTY_OUTPUT_BUFFER,
            status: "error",
            statusText: error instanceof Error ? error.message : "Terminal output unavailable",
            ended: true,
          };
          stateRef.current = buffer;
          setState({ terminalId, buffer });
        }
      }
    })();
    return () => controller.abort();
  }, [host, session, terminalId, visible]);
  return state?.terminalId === terminalId ? state.buffer : null;
}

function TerminalView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const restored =
    session.restoreState &&
    typeof session.restoreState === "object" &&
    !Array.isArray(session.restoreState)
      ? (session.restoreState as unknown as RestoredState)
      : null;
  const [terminalIds, setTerminalIds] = useState<readonly string[]>(() =>
    normalizeTerminalIds(restored?.terminalIds ?? []),
  );
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    restored?.activeTerminalId ?? null,
  );
  const [newTerminalId, setNewTerminalId] = useState("");
  const [visible, setVisible] = useState(session.visible);
  const [refreshRevision, setRefreshRevision] = useState(0);
  useEffect(() => session.onVisibility(setVisible), [session]);

  const resolvedActiveId = resolveActiveTerminalId(terminalIds, activeTerminalId);
  const sessionRows = useSessionRows(host, session, terminalIds, visible, refreshRevision);
  const output = useTerminalOutput(host, session, resolvedActiveId, visible);

  const persist = (ids: readonly string[], active: string | null) => {
    session.save({ terminalIds: [...ids], activeTerminalId: active });
  };
  const trackTerminal = () => {
    const id = newTerminalId.trim();
    if (!id) return;
    const ids = addTerminalId(terminalIds, id);
    setTerminalIds(ids);
    setActiveTerminalId(id);
    setNewTerminalId("");
    persist(ids, id);
  };
  const untrackTerminal = (terminalId: string) => {
    const ids = removeTerminalId(terminalIds, terminalId);
    const active = resolveActiveTerminalId(ids, activeTerminalId);
    setTerminalIds(ids);
    setActiveTerminalId(active);
    persist(ids, active);
  };
  const activate = (terminalId: string) => {
    setActiveTerminalId(terminalId);
    persist(terminalIds, terminalId);
  };

  const muted = "var(--muted-foreground, #667085)";
  const control = {
    padding: "4px 8px",
    border: "1px solid var(--border, #dfe3e8)",
    borderRadius: 5,
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontSize: 12,
  } as const;
  return (
    <section
      aria-label="Terminal"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        color: "var(--foreground, #20252d)",
        background: "var(--background, #fff)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: 13,
      }}
    >
      <header
        style={{
          display: "flex",
          gap: 6,
          padding: 8,
          borderBottom: "1px solid var(--border, #dfe3e8)",
          flexShrink: 0,
        }}
      >
        <input
          aria-label="Terminal ID"
          placeholder="term-1"
          value={newTerminalId}
          onChange={(event) => setNewTerminalId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") trackTerminal();
          }}
          style={{ ...control, flex: 1, minWidth: 0 }}
        />
        <button type="button" onClick={trackTerminal} style={control}>
          Attach
        </button>
        <button
          type="button"
          onClick={() => setRefreshRevision((value) => value + 1)}
          style={control}
        >
          Refresh
        </button>
      </header>
      <ul
        aria-label="Terminal sessions"
        style={{ listStyle: "none", margin: 0, padding: 6, flexShrink: 0 }}
      >
        {(sessionRows?.sessions ?? terminalIds.map(missingSessionRow)).map((row) => (
          <li key={row.terminalId} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              aria-current={row.terminalId === resolvedActiveId ? "true" : undefined}
              onClick={() => activate(row.terminalId)}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                padding: "4px 6px",
                border: "1px solid transparent",
                borderRadius: 5,
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "inherit",
                background:
                  row.terminalId === resolvedActiveId ? "var(--accent, #e8eef7)" : "transparent",
              }}
            >
              {row.label}
            </button>
            <span style={{ color: muted, fontSize: 11 }}>
              {row.status}
              {row.hasRunningSubprocess ? " · running" : ""}
            </span>
            <button
              type="button"
              aria-label={`Detach ${row.terminalId}`}
              onClick={() => untrackTerminal(row.terminalId)}
              style={control}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {terminalIds.length === 0 && (
        <p style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          No terminals tracked. Enter the id of a terminal already open in this thread.
        </p>
      )}
      {sessionRows?.error && (
        <output
          aria-label="Session status"
          style={{ padding: "4px 10px", color: muted, fontSize: 11 }}
        >
          {sessionRows.error}
        </output>
      )}
      {resolvedActiveId !== null && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            borderTop: "1px solid var(--border, #dfe3e8)",
          }}
        >
          <output
            aria-label="Output status"
            style={{ padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
          >
            {resolvedActiveId}: {output?.statusText ?? "Connecting…"}
          </output>
          <pre
            aria-label="Terminal output"
            style={{
              flex: 1,
              minHeight: 0,
              margin: 0,
              padding: 12,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--terminal-foreground, inherit)",
              background: "var(--terminal-background, transparent)",
              fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
              fontSize: 12,
            }}
          >
            {output?.contents ?? ""}
          </pre>
        </div>
      )}
      <output
        aria-label="Slice notice"
        style={{ padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
      >
        Read-only skeleton: attaches to existing sessions and renders live output text. No input,
        spawn, or VT rendering yet.
      </output>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.1.0",
  requires: [
    requireApi(terminalSessionsApi),
    requireApi(terminalOutputApi),
    requireApi(terminalOutputEventsApi),
  ],
  surfaces: [
    {
      name: "view",
      title: "Terminal",
      scope: "thread",
      placements: ["side-panel", "bottom-dock"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <TerminalView host={host} session={session} /> };
      },
    },
  ],
});
