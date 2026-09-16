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

import { loadGhosttyRuntime, type GhosttyRuntime } from "./ghostty/runtime.ts";
import { GhosttyTerminalSurface, type GhosttyTerminalSurfaceOptions } from "./ghostty/surface.ts";
import {
  isTerminalClearShortcut,
  terminalDeleteShortcutData,
  terminalNavigationShortcutData,
} from "./ghostty/surfaceKeys.ts";
import { terminalThemeFromApp } from "./terminalTheme.ts";
import { TerminalVtAttachment, pumpTerminalOutput } from "./vtAttachment.ts";
import {
  EMPTY_OUTPUT_BUFFER,
  TerminalPanel,
  applyOutputEvent,
  isResumableOutputClose,
  noteOutputFrameForStreak,
  EMPTY_OVERFLOW_STREAK,
  workspaceLaunchFromRevision,
  type OutputBuffer,
  type TerminalControlOps,
  type TerminalPanelSnapshot,
} from "./viewModel.ts";

const manifestId = "t3.terminal";

const GHOSTTY_VT_ASSET = "assets/ghostty-vt.wasm";
const GHOSTTY_WRITE_PTY_ASSET = "assets/ghostty-write-pty.wasm";
const SYMBOLS_FONT_ASSET = "assets/SymbolsNerdFontMono-Regular.woff2";

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

/* ------------------------------------------------------------------ */
/* Format-4 package assets → WASM runtime + symbols font               */
/* ------------------------------------------------------------------ */

type GhosttyAssets =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly runtime: GhosttyRuntime; readonly symbolsFontUrl: string }
  | { readonly kind: "unavailable"; readonly message: string };

/**
 * Load the vendored libghostty-vt closure through `host.readAsset`. The host
 * has already verified each asset's sha256 against the package manifest; the
 * media-type check here is the last sanity gate before the bytes instantiate.
 */
function useGhosttyAssets(host: ClientHost, session: ViewSession): GhosttyAssets {
  const [state, setState] = useState<GhosttyAssets>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let symbolsFontUrl: string | null = null;
    void (async () => {
      try {
        if (!host.readAsset) throw new Error("This host cannot load package assets.");
        const readAsset = host.readAsset.bind(host);
        const [vt, writePty, font] = await Promise.all([
          readAsset(GHOSTTY_VT_ASSET, signal),
          readAsset(GHOSTTY_WRITE_PTY_ASSET, signal),
          readAsset(SYMBOLS_FONT_ASSET, signal),
        ]);
        if (signal.aborted) return;
        if (vt.mediaType !== "application/wasm" || writePty.mediaType !== "application/wasm") {
          throw new Error("Terminal WASM assets failed package verification.");
        }
        if (font.mediaType !== "font/woff2") {
          throw new Error("Terminal symbols font failed package verification.");
        }
        const runtime = await loadGhosttyRuntime({
          vt: vt.bytes.slice(),
          writePty: writePty.bytes.slice(),
        });
        if (signal.aborted) return;
        symbolsFontUrl = URL.createObjectURL(
          new Blob([font.bytes as BlobPart], { type: "font/woff2" }),
        );
        setState({ kind: "ready", runtime, symbolsFontUrl });
      } catch (error) {
        if (!signal.aborted) {
          setState({
            kind: "unavailable",
            message: error instanceof Error ? error.message : "Terminal renderer unavailable",
          });
        }
      }
    })();
    return () => {
      controller.abort();
      if (symbolsFontUrl !== null) URL.revokeObjectURL(symbolsFontUrl);
    };
  }, [host, session]);
  return state;
}

/* ------------------------------------------------------------------ */
/* Sessions list stream → panel                                        */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* VT pane: Ghostty surface + output stream + input queue wiring       */
/* ------------------------------------------------------------------ */

function writeSystemMessage(surface: Pick<GhosttyTerminalSurface, "write">, message: string) {
  surface.write(`\r\n[terminal] ${message}\r\n`);
}

/**
 * Surface-local key intercepts the plugin owns: readline-style navigation,
 * line delete, and screen clear. Host `terminal.*` command bindings are NOT
 * suppressed here — without extension-aware focus arbitration (B7) the
 * native capture-phase dispatch can still route close/split/new to the
 * native terminal, and the plugin must not pretend otherwise.
 */
function handleBeforeKey(event: KeyboardEvent, panel: TerminalPanel, terminalId: string): boolean {
  const navigationData = terminalNavigationShortcutData(event);
  if (navigationData !== null) {
    event.preventDefault();
    event.stopPropagation();
    panel.sendInput(terminalId, navigationData);
    return false;
  }
  const deleteData = terminalDeleteShortcutData(event);
  if (deleteData !== null) {
    event.preventDefault();
    event.stopPropagation();
    panel.sendInput(terminalId, deleteData);
    return false;
  }
  if (!isTerminalClearShortcut(event)) return true;
  event.preventDefault();
  event.stopPropagation();
  panel.sendInput(terminalId, "\u000c");
  return false;
}

function TerminalPane(props: {
  readonly host: ClientHost;
  readonly session: ViewSession;
  readonly panel: TerminalPanel;
  readonly terminalId: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly assets: GhosttyAssets;
}) {
  const { host, session, panel, terminalId, active, visible, assets } = props;
  const [, bump] = useReducer((value: number) => value + 1, 0);
  const [attachment] = useState(
    () =>
      new TerminalVtAttachment(terminalId, () => {
        bump();
      }),
  );
  const mountRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<GhosttyTerminalSurface | null>(null);
  const shownRef = useRef(active && visible);

  // Epoch changes and lifecycle ends make queued input stale for the new
  // process incarnation — the panel drops it the moment the stream says so.
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void pumpTerminalOutput({
      subscribe: (subscribeSignal) => {
        const source = bindStreamApi(terminalOutputEventsApi, host, session.context).subscribe(
          "subscribe",
          { terminalId },
          subscribeSignal,
        );
        return (async function* () {
          for await (const frame of source) {
            const value = frame.value as TerminalOutputEventsValue;
            // identity-changed means a new process epoch and exit/error means
            // the process is gone — pending input is stale for both. Overflow
            // keeps the same incarnation; a reset is only a screen clear.
            if (value.kind === "closed" && value.reason !== "overflow") {
              panel.resetInput(terminalId);
            }
            yield { streamId: frame.streamId, sequence: frame.sequence, value };
          }
        })();
      },
      attachment,
      signal,
    });
    return () => controller.abort();
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- panel is created once per view
  }, [host, session, panel, terminalId, attachment, visible]);

  // Mount the vendored surface once the WASM runtime is ready; output that
  // arrived while WASM loaded replays through the attachment.
  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null || assets.kind !== "ready") return;
    let cancelled = false;
    let surface: GhosttyTerminalSurface | null = null;
    const themeObserver = new MutationObserver(() => {
      surface?.setTheme(terminalThemeFromApp(mount));
    });
    void (async () => {
      const options: GhosttyTerminalSurfaceOptions = {
        runtime: assets.runtime,
        symbolsFontUrl: assets.symbolsFontUrl,
        theme: terminalThemeFromApp(mount),
        get visible() {
          return shownRef.current;
        },
        onData: (data) => panel.sendInput(terminalId, data),
        onResize: (cols, rows) => panel.resize(terminalId, cols, rows),
        onSelectionChange: () => {},
        beforeKey: (event) => handleBeforeKey(event, panel, terminalId),
        onLinkActivate: () => {
          // Detection and hover still work; opening needs host contracts
          // (t3.browser/control for URLs B1/B3, t3.file/open for paths) that
          // no host provider ships yet — say so instead of silently dropping.
          if (surface) {
            writeSystemMessage(surface, "Opening links is unavailable in this extension host.");
          }
        },
      };
      try {
        surface = await GhosttyTerminalSurface.create(mount, options);
      } catch (error) {
        // A failed mount must not leave a silently dead pane: the stream
        // keeps landing in the bounded pre-sink buffer and the error is
        // visible until a remount succeeds.
        if (!cancelled) {
          attachment.applySinkFailure(
            error instanceof Error
              ? `Terminal renderer failed to start: ${error.message}`
              : "Terminal renderer failed to start.",
          );
        }
        return;
      }
      if (cancelled) {
        surface.dispose();
        surface = null;
        return;
      }
      surface.setVisible(shownRef.current);
      // The theme observer is not installed yet; re-read in case the app
      // toggled light/dark while the surface was loading.
      surface.setTheme(terminalThemeFromApp(mount));
      surfaceRef.current = surface;
      attachment.attach(surface);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    })();
    return () => {
      cancelled = true;
      themeObserver.disconnect();
      attachment.detach();
      surface?.dispose();
      surfaceRef.current = null;
    };
  }, [assets, attachment, panel, terminalId]);

  useEffect(() => {
    shownRef.current = active && visible;
    surfaceRef.current?.setVisible(active && visible);
    if (active && visible) surfaceRef.current?.focus();
  }, [active, visible]);

  const state = attachment.state;
  const muted = "var(--muted-foreground, #667085)";
  return (
    <div
      style={{
        display: active ? "flex" : "none",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <output
        aria-label="Output status"
        style={{ padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
      >
        {terminalId}: {state.statusText}
      </output>
      {state.degraded && (
        <output
          aria-label="Attach degraded"
          style={{ padding: "4px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
        >
          Attached with truncated history — modes and screen state before the retained tail are
          unknown, so interactive parity is not claimed until the next full snapshot (B4).
        </output>
      )}
      <div
        ref={mountRef}
        aria-label="Terminal output"
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          background: "var(--terminal-background, transparent)",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Text fallback for hosts without package-asset reads (design Q3)     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

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
  const assets = useGhosttyAssets(host, session);
  const snapshot: TerminalPanelSnapshot = panel.snapshot;
  const activeId = snapshot.activeTerminalId;
  const activeTab = snapshot.tabs.find((tab) => tab.terminalId === activeId) ?? null;
  const textFallback = assets.kind === "unavailable";
  const output = useTerminalOutput(
    host,
    session,
    textFallback ? activeId : null,
    visible && textFallback,
  );
  useFitResize(panel, textFallback ? activeId : null, outputRef);

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
      {activeTab?.inputStopped && (
        <div
          role="alert"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "6px 10px",
            fontSize: 11,
            color: muted,
            borderTop: "1px solid var(--border, #dfe3e8)",
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{activeTab.inputMessage}</span>
          <button
            type="button"
            onClick={() => activeId !== null && panel.resumeInput(activeId)}
            style={control}
          >
            Resume input
          </button>
        </div>
      )}
      {assets.kind === "loading" && activeId !== null && (
        <output
          aria-label="Renderer status"
          style={{ padding: "6px 10px", color: muted, fontSize: 11 }}
        >
          Loading terminal renderer…
        </output>
      )}
      {assets.kind === "unavailable" && (
        <output
          aria-label="Renderer status"
          style={{ padding: "6px 10px", color: muted, fontSize: 11 }}
        >
          VT renderer unavailable ({assets.message}) — showing a plain-text view.
        </output>
      )}
      {!textFallback &&
        snapshot.tabs.map((tab) => (
          <TerminalPane
            key={tab.terminalId}
            host={host}
            session={session}
            panel={panel}
            terminalId={tab.terminalId}
            active={tab.terminalId === activeId}
            visible={visible}
            assets={assets}
          />
        ))}
      {textFallback && activeId !== null && activeTab !== null && (
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
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.3.0",
  requires: [
    requireApi(terminalSessionsApi),
    requireApi(terminalOutputApi),
    requireApi(terminalOutputEventsApi),
    requireApi(terminalControlApi),
  ],
  assets: [
    { path: GHOSTTY_VT_ASSET, mediaType: "application/wasm" },
    { path: GHOSTTY_WRITE_PTY_ASSET, mediaType: "application/wasm" },
    { path: SYMBOLS_FONT_ASSET, mediaType: "font/woff2" },
    { path: "assets/SymbolsNerdFontMono-LICENSE.txt", mediaType: "application/octet-stream" },
    { path: "assets/libghostty-vt-LICENSE.txt", mediaType: "application/octet-stream" },
    { path: "assets/libghostty-vt-VERSION.txt", mediaType: "application/octet-stream" },
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
