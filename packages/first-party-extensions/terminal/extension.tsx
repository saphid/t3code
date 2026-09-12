import {
  terminalControlApi,
  terminalOutputApi,
  terminalOutputEventsApi,
  terminalSessionsApi,
  type TerminalOutputEventsValue,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { useEffect, useReducer, useRef, useState, type RefObject } from "react";

import {
  EMPTY_OUTPUT_BUFFER,
  TerminalPanel,
  applyOutputEvent,
  workspaceLaunchFromRevision,
  type OutputBuffer,
  type TerminalControlOps,
  type TerminalPanelSnapshot,
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

function controlOps(host: ClientHost, session: ViewSession): TerminalControlOps {
  const api = bindApi(terminalControlApi, host, session.context);
  return {
    open: (input) => api.invoke("open", input, session.signal),
    attach: (input) => api.invoke("attach", input, session.signal),
    write: (input) => api.invoke("write", input, session.signal),
    resize: (input) => api.invoke("resize", input, session.signal),
    clear: (input) => api.invoke("clear", input, session.signal),
    restart: (input) => api.invoke("restart", input, session.signal),
    close: (input) => api.invoke("close", input, session.signal),
  };
}

/** Sessions list stream → panel; snapshot/upsert/remove drive the tab model. */
function useSessionsStream(
  host: ClientHost,
  session: ViewSession,
  panel: TerminalPanel,
  visible: boolean,
) {
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      // A `closed` frame (queue overflow / terminal error) or a dropped stream
      // is recoverable: each fresh subscription starts from a new snapshot.
      // Bounded retries keep a noisy stream from spinning forever.
      for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
        panel.beginListStream();
        let closed = false;
        try {
          const stream = bindStreamApi(terminalSessionsApi, host, session.context).subscribe(
            "list",
            {},
            signal,
          );
          for await (const frame of stream) {
            if (signal.aborted) return;
            panel.applySessionsEvent(frame.value);
            if (frame.value.kind === "closed") {
              closed = true;
              break;
            }
          }
        } catch (error) {
          if (!signal.aborted)
            panel.markStreamDisconnected(
              error instanceof Error ? error.message : "Session list unavailable",
            );
          return;
        }
        if (signal.aborted) return;
        if (!closed) {
          panel.markStreamDisconnected(null);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
      if (!signal.aborted) panel.markStreamDisconnected("Session list stream ended repeatedly.");
    })();
    return () => controller.abort();
  }, [host, session, panel, visible]);
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
    void (async () => {
      // A restart changes the session incarnation: the provider closes the
      // stream with `identity-changed` and a fresh subscription starts at the
      // new epoch's snapshot. Other end states (exit/close/overflow/error)
      // stay ended — the banner and list stream carry that UX.
      while (!signal.aborted) {
        pendingRef.current = null;
        const stateRef = { current: EMPTY_OUTPUT_BUFFER as OutputBuffer };
        let resurrect = false;
        try {
          const stream = bindStreamApi(terminalOutputEventsApi, host, session.context).subscribe(
            "subscribe",
            { terminalId },
            signal,
          );
          for await (const frame of stream) {
            if (signal.aborted) return;
            const value = frame.value as TerminalOutputEventsValue;
            if (value.kind === "closed") {
              resurrect = value.reason === "identity-changed";
              // Other closed reasons (overflow/error) still end the buffer —
              // apply the frame so the rendered state tells the truth.
              if (!resurrect && !stateRef.current.ended) {
                const applied = applyOutputEvent(
                  stateRef.current,
                  frame,
                  value,
                  pendingRef.current,
                );
                pendingRef.current = applied.pending;
                stateRef.current = applied.buffer;
                setState({ terminalId, buffer: applied.buffer });
              }
              break;
            }
            if (stateRef.current.ended) continue; // scan for a trailing closed frame
            const applied = applyOutputEvent(stateRef.current, frame, value, pendingRef.current);
            pendingRef.current = applied.pending;
            stateRef.current = applied.buffer;
            setState({ terminalId, buffer: applied.buffer });
          }
          if (!signal.aborted && !resurrect && pendingRef.current !== null) {
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
            setState({ terminalId, buffer });
          }
          return;
        }
        if (!resurrect) return;
        if (!signal.aborted) setState({ terminalId, buffer: EMPTY_OUTPUT_BUFFER });
      }
    })();
    return () => controller.abort();
  }, [host, session, terminalId, visible]);
  return state?.terminalId === terminalId ? state.buffer : null;
}

/** Fit→resize on the visible terminal; latest-wins scheduling lives in the panel. */
function useFitResize(
  panel: TerminalPanel,
  terminalId: string | null,
  ref: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element || terminalId === null || typeof ResizeObserver === "undefined") return;
    // No cell metrics exist without a VT renderer; approximate columns/rows
    // from the rendered box and let the PTY see the shape change.
    const fit = () => {
      const rect = element.getBoundingClientRect();
      const cols = Math.max(1, Math.floor(rect.width / 7.5));
      const rows = Math.max(1, Math.floor(rect.height / 16));
      panel.resize(terminalId, cols, rows);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [panel, terminalId, ref]);
}

const control = {
  padding: "4px 8px",
  border: "1px solid var(--border, #dfe3e8)",
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: 12,
  cursor: "pointer",
} as const;

function TerminalView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const [, bump] = useReducer((value: number) => value + 1, 0);
  const [panel] = useState(() => {
    const restored =
      session.restoreState &&
      typeof session.restoreState === "object" &&
      !Array.isArray(session.restoreState)
        ? (session.restoreState as unknown as RestoredState)
        : null;
    const workspace = workspaceLaunchFromRevision(session.context.workspaceRevision);
    const launch =
      workspace === null
        ? null
        : {
            cwd: workspace.cwd,
            worktreePath: workspace.worktreePath,
            env: projectScriptRuntimeEnv({
              project: { cwd: workspace.workspaceRoot },
              worktreePath: workspace.worktreePath,
            }),
          };
    let panel: TerminalPanel;
    panel = new TerminalPanel({
      control: controlOps(host, session),
      launch,
      restored,
      onChange: () => {
        const snapshot = panel.snapshot;
        session.save({
          terminalIds: [...snapshot.terminalIds],
          activeTerminalId: snapshot.activeTerminalId,
        });
        bump();
      },
    });
    return panel;
  });
  const [visible, setVisible] = useState(session.visible);
  const [input, setInput] = useState("");
  const outputRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => session.onVisibility(setVisible), [session]);
  useEffect(() => () => panel.dispose(), [panel]);
  useSessionsStream(host, session, panel, visible);
  const snapshot: TerminalPanelSnapshot = panel.snapshot;
  const activeId = snapshot.activeTerminalId;
  const activeTab = snapshot.tabs.find((tab) => tab.terminalId === activeId) ?? null;
  const output = useTerminalOutput(host, session, activeId, visible);
  useFitResize(panel, activeId, outputRef);

  const send = () => {
    if (activeId === null || input.length === 0) return;
    panel.sendInput(activeId, input + "\r");
    setInput("");
  };

  const muted = "var(--muted-foreground, #667085)";
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
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => void panel.openTerminal()}
          disabled={snapshot.stream !== "live"}
          style={control}
        >
          New terminal
        </button>
        <span style={{ color: muted, fontSize: 11 }}>
          {snapshot.stream === "closed"
            ? "Session list disconnected"
            : snapshot.stream === "connecting"
              ? "Connecting…"
              : ""}
        </span>
      </header>
      <ul
        aria-label="Terminal sessions"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 6,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {snapshot.tabs.map((tab) => (
          <li key={tab.terminalId} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              aria-current={tab.terminalId === activeId ? "true" : undefined}
              onClick={() => panel.activate(tab.terminalId)}
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
                background: tab.terminalId === activeId ? "var(--accent, #e8eef7)" : "transparent",
              }}
            >
              {tab.label}
            </button>
            <span style={{ color: muted, fontSize: 11 }}>
              {tab.status}
              {tab.hasRunningSubprocess ? " · running" : ""}
              {tab.queuedInputCount > 0 ? ` · queued ${tab.queuedInputCount}` : ""}
            </span>
            {tab.confirmAction === null ? (
              <>
                {(tab.status === "exited" || tab.status === "error" || tab.status === "closed") && (
                  <button
                    type="button"
                    aria-label={`Start ${tab.terminalId}`}
                    onClick={() => void panel.startSession(tab.terminalId)}
                    style={control}
                  >
                    Start
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Clear ${tab.terminalId}`}
                  onClick={() => panel.requestAction(tab.terminalId, "clear")}
                  style={control}
                >
                  Clear
                </button>
                <button
                  type="button"
                  aria-label={`Restart ${tab.terminalId}`}
                  onClick={() => panel.requestAction(tab.terminalId, "restart")}
                  style={control}
                >
                  Restart
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.terminalId}`}
                  onClick={() => panel.requestAction(tab.terminalId, "close")}
                  style={control}
                >
                  ×
                </button>
              </>
            ) : (
              <>
                <span style={{ color: muted, fontSize: 11 }}>
                  {tab.confirmAction === "close"
                    ? "Close this terminal?"
                    : tab.confirmAction === "restart"
                      ? "Restart this terminal?"
                      : "Clear history?"}
                </span>
                <button
                  type="button"
                  aria-label={`Confirm ${tab.confirmAction} ${tab.terminalId}`}
                  onClick={() => void panel.confirmAction(tab.terminalId)}
                  style={control}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  aria-label={`Cancel ${tab.confirmAction} ${tab.terminalId}`}
                  onClick={() => panel.cancelAction(tab.terminalId)}
                  style={control}
                >
                  Cancel
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {snapshot.tabs.length === 0 && (
        <p style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          No terminals yet. New terminal opens a shell in this workspace.
        </p>
      )}
      {snapshot.panelError && (
        <output
          aria-label="Panel status"
          style={{ padding: "4px 10px", color: muted, fontSize: 11 }}
        >
          {snapshot.panelError}
        </output>
      )}
      {activeId !== null && activeTab !== null && (
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
            {activeId}: {activeTab.exitBanner ?? output?.statusText ?? "Connecting…"}
            {activeTab.error ? ` — ${activeTab.error}` : ""}
          </output>
          <pre
            ref={outputRef}
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
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: 8,
              borderTop: "1px solid var(--border, #dfe3e8)",
              flexShrink: 0,
            }}
          >
            <input
              aria-label="Terminal input"
              placeholder={activeTab.starting ? "Starting… input is queued" : "Type a command"}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") send();
              }}
              style={{ ...control, flex: 1, minWidth: 0, cursor: "text" }}
            />
            <button type="button" onClick={send} style={control}>
              Send
            </button>
          </div>
        </div>
      )}
      <output
        aria-label="Slice notice"
        style={{ padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
      >
        Interactive text terminal: input, resize, and lifecycle through the public control contract.
        VT rendering (Ghostty) and notifications are deferred slices.
      </output>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.2.0",
  requires: [
    requireApi(terminalSessionsApi),
    requireApi(terminalOutputApi),
    requireApi(terminalOutputEventsApi),
    requireApi(terminalControlApi),
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
