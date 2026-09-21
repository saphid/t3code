import {
  terminalControlApi,
  terminalOutputApi,
  terminalOutputEventsApi,
  terminalSessionsApi,
  uiKeybindingsApi,
  uiPanelsApi,
  uiThemeApi,
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
  EMPTY_OVERFLOW_STREAK,
  TERMINAL_GLOBAL_COMMANDS,
  TERMINAL_SURFACE_ID,
  TerminalPanel,
  applyOutputEvent,
  asTerminalAppearance,
  dispatchTerminalCommand,
  isResumableOutputClose,
  noteOutputFrameForStreak,
  registerPanelCommands,
  terminalAppearanceVars,
  themeVarOverrides,
  workspaceLaunchFromRevision,
  type OutputBuffer,
  type TerminalCommandActions,
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
      // new epoch's snapshot. `overflow` is the provider's retained window
      // filling before the first pulls drained it — a fresh subscription
      // starts from a new snapshot that already carries the retained tail,
      // so resubscribing recovers without losing content. The streak is
      // windowed in time because the preserved snapshot lands before every
      // overflow close — delivered frames cannot bound a flood — and repeat
      // overflows back off; exit/error reasons stay ended — the banner and
      // list stream carry that UX.
      let streak = EMPTY_OVERFLOW_STREAK;
      let overflowClose = false;
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
            streak = noteOutputFrameForStreak(value, streak, Date.now());
            if (value.kind === "closed") {
              overflowClose = value.reason === "overflow";
              resurrect = isResumableOutputClose(value.reason, streak.attempts);
              // Other closed reasons (exit/error/exhausted overflow) still
              // end the buffer — apply the frame so the rendered state
              // tells the truth.
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
        // Repeat overflow means the provider window is still saturated —
        // back off before resubscribing like the sessions loop does.
        if (overflowClose && streak.attempts > 1 && !signal.aborted)
          await new Promise((resolve) => setTimeout(resolve, 300 * streak.attempts));
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

/**
 * `t3.ui/theme` consumer. `getTokens` resolves the host's *effective* theme —
 * the provider's projection already folds the stored preference, live session
 * overlays, and external previews into the painted state — and each
 * `subscribeState` frame re-reads the tokens, so the panel tracks exactly
 * what the host paints without interpreting overlay semantics itself. The map
 * lands on the view root as `--t3-terminal-*` custom properties; an ungranted
 * or provider-less host yields null and every style falls back to its legacy
 * `var()` chain — the honest degraded path.
 */
function useThemeVars(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
): Record<string, string> | null {
  const [vars, setVars] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const api = bindApi(uiThemeApi, host, session.context);
    const streams = bindStreamApi(uiThemeApi, host, session.context);
    let generation = 0;
    const refresh = () => {
      const at = ++generation;
      void api.invoke("getTokens", {}, signal).then(
        (value) => {
          if (!signal.aborted && at === generation)
            setVars(themeVarOverrides(value.tokens, value.cssVars));
        },
        // Denial or absence leaves the last good map; initially that is the
        // untouched legacy chain.
        () => {},
      );
    };
    refresh();
    void (async () => {
      try {
        for await (const frame of streams.subscribe("subscribeState", {}, signal)) {
          if (signal.aborted || frame.type === "closed") return;
          refresh();
        }
      } catch {
        // Stream loss only stops re-reads — the last resolved map stands.
      }
    })();
    return () => controller.abort();
  }, [host, session, visible]);
  return vars;
}

/**
 * `subscribeTerminalAppearance` consumer — the host's real terminal colors
 * and font, published on the output pane so they win over the generic token
 * roles of the same name. The stream opens with a snapshot frame, so no
 * separate `getTerminalAppearance` call is needed; a host without the
 * provider leaves the token layer (or the legacy chain) governing.
 */
function useTerminalAppearanceVars(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
): Record<string, string> | null {
  const [vars, setVars] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const streams = bindStreamApi(uiThemeApi, host, session.context);
    void (async () => {
      try {
        for await (const frame of streams.subscribe("subscribeTerminalAppearance", {}, signal)) {
          if (signal.aborted || frame.type === "closed") return;
          const appearance = asTerminalAppearance(frame.value);
          if (appearance !== null) setVars(terminalAppearanceVars(appearance));
        }
      } catch {
        // No terminal-appearance provider — the token layer stands.
      }
    })();
    return () => controller.abort();
  }, [host, session, visible]);
  return vars;
}

/** `t3.ui/panels` closeSurface against this view's own surface+thread. */
function closeOwnSurface(host: ClientHost, session: ViewSession): Promise<void> {
  const threadId = session.context.resource.threadId;
  if (threadId === undefined) return Promise.resolve();
  return bindApi(uiPanelsApi, host, session.context)
    .invoke("closeSurface", { surfaceId: TERMINAL_SURFACE_ID, threadId }, session.signal)
    .then(
      () => undefined,
      () => {
        throw new Error("The host could not close this panel.");
      },
    );
}

/**
 * `t3.ui/keybindings` consumer: registers the view's command set (toggle/new/
 * close) and binds the dispatch handler for the focused-view and thread
 * arbitration tiers. Every action stays panel-local — `new`/`close` drive the
 * tab model (close keeps the inline confirm), `toggle` dismisses the hosting
 * surface through `t3.ui/panels`. An ungranted or provider-less host leaves
 * the toolbar buttons as the only path — nothing else changes.
 */
function usePanelCommands(
  host: ClientHost,
  session: ViewSession,
  panel: TerminalPanel,
  visible: boolean,
) {
  useEffect(() => {
    // bindCommands throws on a hidden view ("View is inactive") — registration
    // waits for visibility and unwinds when it drops.
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let release: (() => void) | null = null;
    const actions: TerminalCommandActions = {
      newTerminal: () => void panel.openTerminal(),
      closeTerminal: () => {
        const activeId = panel.snapshot.activeTerminalId;
        if (activeId !== null) panel.requestAction(activeId, "close");
      },
      toggleSurface: () =>
        void closeOwnSurface(host, session).catch((error: unknown) =>
          panel.notePanelError(error instanceof Error ? error.message : "Panel action failed"),
        ),
    };
    void registerPanelCommands({
      client: host,
      context: session.context,
      signal,
      bindCommands: (token, handler) => session.bindCommands(token, handler),
      onCommand: (commandId) => void dispatchTerminalCommand(commandId, actions),
    }).then(
      (registration) => {
        if (registration === null) return;
        if (signal.aborted) registration.release();
        else release = registration.release;
      },
      () => {
        // Ungranted or provider-less host: no panel commands.
      },
    );
    return () => {
      controller.abort();
      release?.();
    };
  }, [host, session, panel, visible]);
}

const control = {
  padding: "4px 8px",
  border: "1px solid var(--t3-terminal-border, var(--border, #dfe3e8))",
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
  usePanelCommands(host, session, panel, visible);
  const themeVars = useThemeVars(host, session, visible);
  const appearanceVars = useTerminalAppearanceVars(host, session, visible);
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

  const muted = "var(--t3-terminal-muted, var(--muted-foreground, #667085))";
  const border = "1px solid var(--t3-terminal-border, var(--border, #dfe3e8))";
  return (
    <section
      aria-label="Terminal"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        color: "var(--t3-terminal-text, var(--foreground, #20252d))",
        background: "var(--t3-terminal-canvas, var(--background, #fff))",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: 13,
        ...themeVars,
      }}
    >
      <header
        style={{
          display: "flex",
          gap: 6,
          padding: 8,
          borderBottom: border,
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
                background:
                  tab.terminalId === activeId
                    ? "var(--t3-terminal-accent-surface, var(--accent, #e8eef7))"
                    : "transparent",
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
            borderTop: border,
          }}
        >
          <output
            aria-label="Output status"
            style={{ padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
          >
            {activeId}: {activeTab.exitBanner ?? output?.statusText ?? "Connecting…"}
            {activeTab.error ? ` — ${activeTab.error}` : ""}
          </output>
          <style>
            {
              "[data-t3-terminal-output]::selection{background:var(--t3-terminal-selection,Highlight)}"
            }
          </style>
          <pre
            ref={outputRef}
            aria-label="Terminal output"
            data-t3-terminal-output
            style={{
              flex: 1,
              minHeight: 0,
              margin: 0,
              padding: 12,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--t3-terminal-foreground, var(--terminal-foreground, inherit))",
              background: "var(--t3-terminal-background, var(--terminal-background, transparent))",
              fontFamily:
                "var(--t3-terminal-font-family, var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace))",
              fontSize: "var(--t3-terminal-font-size, 12px)",
              lineHeight: "var(--t3-terminal-line-height, normal)",
              fontVariantLigatures: "var(--t3-terminal-ligatures, normal)",
              colorScheme: "var(--t3-terminal-color-scheme, normal)",
              ...appearanceVars,
            }}
          >
            {output?.contents ?? ""}
          </pre>
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: 8,
              borderTop: border,
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
              style={{
                ...control,
                flex: 1,
                minWidth: 0,
                cursor: "text",
                background: "var(--t3-terminal-input, var(--input, transparent))",
              }}
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
        Interactive text terminal over the public control contract; theme and panel keybindings
        follow the host's t3.ui/* providers. VT rendering (Ghostty) and link activation are deferred
        slices, so there are no transient toasts to route through t3.ui/notifications.
      </output>
    </section>
  );
}

const authored = defineExtension({
  id: manifestId,
  version: "0.2.0",
  requires: [
    requireApi(terminalSessionsApi),
    requireApi(terminalOutputApi),
    requireApi(terminalOutputEventsApi),
    requireApi(terminalControlApi),
    // Adopted opportunistically: every consumer degrades to the pre-contract
    // path when the host cannot serve these, so they never gate mounting.
    requireApi(uiThemeApi),
    requireApi(uiKeybindingsApi),
    requireApi(uiPanelsApi),
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

const clientFactory = authored.client;

export default {
  ...authored,
  ...(clientFactory === undefined
    ? {}
    : {
        client(host: ClientHost) {
          // Installation-tier command set: the toggle's cold-open activation
          // fallback. Staged at factory time; the host flushes it once the
          // installation commits and a client-provider connection is live.
          // Absent on hosts without the seam — the view set still works.
          host.registerGlobalCommands?.(TERMINAL_GLOBAL_COMMANDS);
          return clientFactory(host);
        },
      }),
};
