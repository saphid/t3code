import {
  defineExtension,
  requireApi,
  useBrowserSurfaceSlot,
} from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import {
  browserSessionsApi,
  filePresentationApi,
  uiKeybindingsApi,
  uiNotificationsApi,
  uiPanelsApi,
  uiThemeApi,
  type BrowserSession,
  type BrowserSessionReceipt,
  type BrowserSessionStreamValue,
} from "@t3tools/extension-sdk/catalogue";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useRef, useState } from "react";

import {
  type BrowserHistoryEntry,
  fitHistoryToSaveBudget,
  recentHistoryEntries,
  recordHistoryVisit,
  removeHistoryUrl,
  sanitizeHistoryEntries,
} from "./historyStore.js";
import {
  BROWSER_GLOBAL_COMMANDS,
  BROWSER_VIEW_COMMANDS,
  notifyToggleFailure,
  themeVarOverrides,
  togglePanelSurface,
} from "./uiContracts.js";
import {
  canGoBack,
  canGoForward,
  currentUrl,
  describeStatus,
  NO_SESSION_NOTICE,
  goBack,
  goForward,
  initialNavigationState,
  isBrowserPreviewFile,
  recentTargets,
  reload,
  submitAddress,
  type NavigationState,
} from "./viewModel.js";

const manifestId = "t3.browser";

// Every theme-backed value chains a `--t3-browser-*` hop (published on the
// view root from `t3.ui/theme` tokens) ahead of the legacy host vars. When
// the contract is unavailable the hop never resolves and the legacy chain
// renders — the honest degraded path.
const muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
const border = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
const buttonStyle = {
  font: "inherit",
  fontSize: 12,
  padding: "2px 8px",
  border,
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
} as const;

/**
 * `t3.ui/theme` consumer. `getTokens` resolves the host's *effective* theme —
 * the provider's projection already folds the stored preference, live session
 * overlays, and external previews into the painted state — and each
 * `subscribeState` frame re-reads the tokens, so the panel tracks exactly
 * what the host paints without interpreting overlay semantics itself. The map
 * lands on the view root as `--t3-browser-*` custom properties; an ungranted
 * or provider-less host yields null and every style falls back to its legacy
 * `var()` chain.
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
 * `t3.ui/panels` behind the staged `toggle` command: dispatch supplies the
 * active thread's context (or the registration's own when no thread is
 * active — no thread means nothing to toggle). A failed hop toasts through
 * `t3.ui/notifications` when that grant exists, mirroring the native
 * `preview.toggle` "desktop-only" notice; without it the press is silent.
 */
function runGlobalBrowserCommand(
  host: ClientHost,
  call: { readonly commandId: string; readonly context: ViewContext },
): void {
  if (call.commandId !== "toggle") return;
  const threadId = call.context.resource.threadId;
  if (!threadId) return;
  void togglePanelSurface(
    bindApi(uiPanelsApi, host, call.context),
    threadId,
    AbortSignal.timeout(10_000),
  ).catch((error: unknown) => {
    void notifyToggleFailure(
      bindApi(uiNotificationsApi, host, call.context),
      threadId,
      error,
      AbortSignal.timeout(5_000),
    ).catch(() => {});
  });
}

/** Session identity held by this panel — tabId + serverEpoch fence the lease. */
interface HeldSession {
  readonly tabId: string;
  readonly serverEpoch: string;
  /** Latest engine-reported generation; commands fence on it. */
  readonly engineGeneration: string | null;
}

type PersistedViewState = {
  readonly relativePath?: string;
  readonly url?: string;
  readonly tabId?: string;
  readonly serverEpoch?: string;
  readonly history?: Json;
};

function restoreState(value: unknown): value is PersistedViewState | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => {
    if (key === "relativePath" || key === "url" || key === "tabId" || key === "serverEpoch")
      return typeof record[key] === "string";
    // Any malformed history container sanitizes to [] on read — the native
    // migrate step drops a bad list but keeps the browser usable, so the
    // container is never a reason to take the whole view unavailable.
    if (key === "history") return true;
    return false;
  });
}

/**
 * Browser panel on public contracts: chrome + navigation state are
 * panel-local (`viewModel.ts`); URL history persists through the bounded
 * `session.save` record (`historyStore.ts`); the page area is a
 * plugin-owned slot composited by the host through `t3.browser/surface`.
 * Session lifecycle is driven through `t3.browser/sessions` — `open`
 * creates the session the slot presents, `navigate`/commands carry the
 * epoch + engine-generation guards, and the events stream is the only
 * source of engine/navigation truth.
 */
function BrowserView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const restored = restoreState(session.restoreState) ? session.restoreState : null;
  const [state, setState] = useState<NavigationState>(() => {
    if (restored?.url) return submitAddress(initialNavigationState, restored.url);
    if (restored?.relativePath && isBrowserPreviewFile(restored.relativePath))
      return submitAddress(initialNavigationState, restored.relativePath);
    return initialNavigationState;
  });
  const [address, setAddress] = useState<string>(restored?.url ?? restored?.relativePath ?? "");
  const [history, setHistory] = useState<readonly BrowserHistoryEntry[]>(() =>
    sanitizeHistoryEntries(restored?.history),
  );
  const [held, setHeld] = useState<HeldSession | null>(() =>
    restored?.tabId && restored?.serverEpoch
      ? {
          tabId: restored.tabId,
          serverEpoch: restored.serverEpoch,
          engineGeneration: null,
        }
      : null,
  );
  const [live, setLive] = useState<BrowserSession | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [visible, setVisible] = useState(session.visible);
  const heldRef = useRef(held);
  const historyRef = useRef(history);
  const lastRevision = useRef(-1);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const themeVars = useThemeVars(host, session, visible);
  useEffect(() => {
    heldRef.current = held;
  }, [held]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => session.onVisibility(setVisible), [session]);

  // The events stream is authoritative: snapshot validates a restored or
  // adopted session, upserts carry engine/navigation truth, removal and close
  // reasons end the panel's hold honestly.
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      try {
        const api = bindStreamApi(browserSessionsApi, host, session.context);
        let pending: BrowserSession[] | null = null;
        for await (const frame of api.subscribe("events", {}, signal)) {
          signal.throwIfAborted();
          const value: BrowserSessionStreamValue | undefined = frame.value;
          if (!value) continue;
          const current = heldRef.current;
          switch (value.kind) {
            case "snapshot-start":
              pending = [];
              break;
            case "snapshot-chunk":
              pending?.push(...value.sessions);
              break;
            case "snapshot-complete": {
              if (current) {
                const found = pending?.find((item) => item.tabId === current.tabId);
                if (value.serverEpoch !== current.serverEpoch || !found) {
                  heldRef.current = null;
                  setHeld(null);
                  setLive(null);
                  setFault(
                    value.serverEpoch !== current.serverEpoch
                      ? "Session ended (epoch-changed)"
                      : "Session ended (session-closed)",
                  );
                } else {
                  setLive(found);
                  lastRevision.current = value.revision;
                }
              }
              pending = null;
              break;
            }
            case "session-upsert":
              if (current && value.session.tabId === current.tabId) {
                setLive(value.session);
                lastRevision.current = Math.max(lastRevision.current, value.revision);
                setHeld((previous) =>
                  previous
                    ? { ...previous, engineGeneration: value.session.engine.generation }
                    : previous,
                );
              }
              break;
            case "session-removed":
              if (current && value.tabId === current.tabId) {
                heldRef.current = null;
                setHeld(null);
                setLive(null);
                setFault(`Session ended (session-closed: ${value.reason})`);
              }
              break;
            case "closed":
              if (current) {
                heldRef.current = null;
                setHeld(null);
                setLive(null);
              }
              setFault(`Sessions stream closed (${value.reason})`);
              break;
          }
        }
      } catch (error) {
        if (!signal.aborted)
          setFault(error instanceof Error ? error.message : "Sessions stream unavailable");
      }
    })();
    return () => controller.abort();
  }, [host, session]);

  const {
    ref: surfaceSlotRef,
    lease: surfaceLease,
    denial: surfaceDenial,
  } = useBrowserSurfaceSlot(host, session, {
    session: held,
    visible: visible && held !== null,
    cornerRadius: 8,
  });

  /**
   * Persist the restore record: the url the view reopens on, the held
   * session identity, and the per-view history list.
   * fitHistoryToSaveBudget keeps the record under the SDK's bounded save
   * envelope by dropping the oldest entries.
   */
  const persist = (
    entries: readonly BrowserHistoryEntry[],
    url: string | null,
    heldSession: HeldSession | null,
  ) => {
    const base: {
      url?: string;
      relativePath?: string;
      tabId?: string;
      serverEpoch?: string;
    } = {
      ...(url ? { url } : restored?.relativePath ? { relativePath: restored.relativePath } : {}),
      ...(heldSession ? { tabId: heldSession.tabId, serverEpoch: heldSession.serverEpoch } : {}),
    };
    session.save({ ...base, history: fitHistoryToSaveBudget(base, entries) });
  };

  /** Commit a navigation state; every landed target is a recorded visit. */
  const commit = (next: NavigationState) => {
    setState(next);
    if (next.status.kind !== "target") return;
    const entries = recordHistoryVisit(history, next.status.url, Date.now());
    setHistory(entries);
    historyRef.current = entries;
    persist(entries, next.status.url, heldRef.current);
  };

  const removeRecent = (rawUrl: string) => {
    const entries = removeHistoryUrl(history, rawUrl);
    setHistory(entries);
    historyRef.current = entries;
    persist(entries, currentUrl(state), heldRef.current);
  };

  const dispatch = (run: (signal: AbortSignal) => Promise<BrowserSessionReceipt>) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void run(signal).then(
      (receipt) => {
        // Stale receipts (older revision than already applied) never win.
        if (signal.aborted || receipt.revision < lastRevision.current) return;
        lastRevision.current = receipt.revision;
        if (receipt.outcome !== "accepted") {
          setFault(`Browser command ${receipt.outcome}`);
          return;
        }
        const next = {
          tabId: receipt.session.tabId,
          serverEpoch: receipt.serverEpoch,
          engineGeneration: receipt.session.engine.generation,
        };
        heldRef.current = next;
        setHeld(next);
        setLive(receipt.session);
        setFault(null);
        const base: { url?: string; tabId: string; serverEpoch: string } = {
          ...(receipt.session.requestedUrl ? { url: receipt.session.requestedUrl } : {}),
          tabId: next.tabId,
          serverEpoch: next.serverEpoch,
        };
        session.save({ ...base, history: fitHistoryToSaveBudget(base, historyRef.current) });
      },
      (error) => {
        if (!signal.aborted)
          setFault(error instanceof Error ? error.message : "Browser command failed");
      },
    );
  };

  const submit = (raw: string) => {
    const next = submitAddress(state, raw);
    commit(next);
    if (next.status.kind !== "target") return;
    const url = next.status.url;
    const api = bindApi(browserSessionsApi, host, session.context);
    // An ended lease means the held session is suspect — open fresh rather
    // than navigate a session the host already fenced off.
    const usable = held && surfaceLease?.state.kind !== "ended" ? held : null;
    dispatch((signal) =>
      usable
        ? api.invoke(
            "navigate",
            {
              tabId: usable.tabId,
              serverEpoch: usable.serverEpoch,
              url,
              expectedEngineGeneration: usable.engineGeneration,
            },
            signal,
          )
        : api.invoke("open", { url }, signal),
    );
  };

  const command = (method: "back" | "forward" | "reload") => {
    if (!held) return;
    if (method === "back") commit(goBack(state));
    else if (method === "forward") commit(goForward(state));
    else commit(reload(state));
    const api = bindApi(browserSessionsApi, host, session.context);
    dispatch((signal) =>
      api.invoke(
        method,
        {
          tabId: held.tabId,
          serverEpoch: held.serverEpoch,
          expectedEngineGeneration: held.engineGeneration,
        },
        signal,
      ),
    );
  };

  // `t3.ui/keybindings` — view-local commands register under this view's own
  // thread context (a staged installation context can never deep-equal it)
  // and bind to this session, so arbitration's focused-view tier reaches the
  // handler. Registration is idempotent across sibling views on the same
  // context; a denied grant or absent seam leaves the chords unclaimed.
  const runViewCommand = useRef<(commandId: string) => void>(() => {});
  useEffect(() => {
    runViewCommand.current = (commandId) => {
      if (commandId === "reload") {
        if (held) command("reload");
        else commit(reload(state));
      } else if (commandId === "focusAddress") {
        addressRef.current?.focus();
      }
    };
  });
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(uiKeybindingsApi, host, session.context)
      .invoke("registerCommands", { commands: BROWSER_VIEW_COMMANDS }, signal)
      .then(
        ({ commandSetToken }) => {
          if (signal.aborted) return;
          try {
            session.bindCommands(commandSetToken, (call) => runViewCommand.current(call.commandId));
          } catch {
            // A stale token or a host without the binding seam leaves this
            // view without claimed shortcuts — the chords fall through.
          }
        },
        () => {},
      );
    return () => controller.abort();
  }, [host, session, visible]);

  const leaseState = surfaceLease?.state;
  const surfaceNotice = surfaceDenial
    ? `Native presentation is unavailable — ${surfaceDenial.reason}${
        surfaceDenial.grant ? ` (missing grant: ${surfaceDenial.grant})` : ""
      }: ${surfaceDenial.detail}`
    : leaseState?.kind === "ended"
      ? `Surface ended (${leaseState.reason}). Enter an address to open a new session.`
      : leaseState?.kind === "active" && !leaseState.presentation.supported
        ? `This client cannot composite a native browser surface (${leaseState.presentation.reason}). The session is still open — view it from the desktop app.`
        : null;

  return (
    <section
      aria-label="Browser"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        color: "var(--t3-browser-text, var(--foreground, #20252d))",
        background: "var(--t3-browser-canvas, var(--background, #fff))",
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
          aria-label="Back"
          disabled={held ? !(live?.canGoBack ?? false) : !canGoBack(state)}
          onClick={() => (held ? command("back") : commit(goBack(state)))}
          style={buttonStyle}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={held ? !(live?.canGoForward ?? false) : !canGoForward(state)}
          onClick={() => (held ? command("forward") : commit(goForward(state)))}
          style={buttonStyle}
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reload"
          disabled={state.status.kind !== "target"}
          onClick={() => (held ? command("reload") : commit(reload(state)))}
          style={buttonStyle}
        >
          ⟳
        </button>
        <input
          type="text"
          aria-label="Address"
          placeholder="Search or enter address"
          ref={addressRef}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit(address);
            if (event.key === "Escape") event.currentTarget.blur();
          }}
          style={{ flex: 1, minWidth: 0, font: "inherit", fontSize: 12 }}
        />
      </header>
      <div
        role="status"
        aria-label="Browser status"
        style={{ padding: "6px 10px", color: muted, fontSize: 11, flexShrink: 0 }}
      >
        {fault ??
          (held && live
            ? `${live.navigation.title || live.navigation.url || "session"} — engine ${live.engine.state}, navigation ${live.navigation.kind}`
            : describeStatus(state))}
      </div>
      {held ? (
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <div
            ref={surfaceSlotRef}
            aria-label="Browser surface"
            style={{ position: "absolute", inset: 0 }}
          />
          {surfaceNotice && (
            <p
              role="note"
              style={{
                position: "absolute",
                inset: 0,
                margin: 0,
                padding: 12,
                fontSize: 12,
                color: muted,
                background: "var(--t3-browser-canvas, var(--background, #fff))",
              }}
            >
              {surfaceNotice}
            </p>
          )}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: 12,
            display: "grid",
            gap: 10,
            alignContent: "start",
            justifyItems: "start",
          }}
        >
          <p role="note" style={{ margin: 0, fontSize: 12, color: muted, maxWidth: "36rem" }}>
            {NO_SESSION_NOTICE}
          </p>
          {state.status.kind !== "target" && recentHistoryEntries(history).length > 0 && (
            <ul
              aria-label="Recently used"
              style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}
            >
              {recentHistoryEntries(history).map((entry) => {
                const parsed = new URL(entry.url);
                const path = parsed.pathname === "/" ? "" : parsed.pathname;
                const label = `${parsed.host}${path}${parsed.search}${parsed.hash}`;
                return (
                  <li key={entry.url} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <button
                      type="button"
                      onClick={() => submit(entry.url)}
                      style={{
                        ...buttonStyle,
                        border: "none",
                        padding: "2px 0",
                        textAlign: "left",
                        textDecoration: "underline",
                        color: muted,
                      }}
                    >
                      {entry.title ? `${entry.title} — ${label}` : label}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from history`}
                      onClick={() => removeRecent(entry.url)}
                      style={{ ...buttonStyle, border: "none", padding: "0 2px", color: muted }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {recentTargets(state).length > 0 && (
            <ul
              aria-label="Requested targets"
              style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}
            >
              {recentTargets(state).map((target, position) => (
                <li key={target}>
                  <button
                    type="button"
                    aria-current={state.history.length - 1 - position === state.index}
                    onClick={() => submit(target)}
                    style={{
                      ...buttonStyle,
                      border: "none",
                      padding: "2px 0",
                      textAlign: "left",
                      textDecoration: "underline",
                      color:
                        state.history.length - 1 - position === state.index
                          ? "var(--t3-browser-text, var(--foreground, #20252d))"
                          : muted,
                    }}
                  >
                    {target}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const authored = defineExtension({
  id: manifestId,
  version: "0.1.0",
  provides: [filePresentationApi.definition],
  serverEntry: "server.ts",
  requires: [
    requireApi(browserSessionsApi),
    requireApi(uiThemeApi),
    requireApi(uiKeybindingsApi),
    requireApi(uiPanelsApi),
    requireApi(uiNotificationsApi),
  ],
  surfaces: [
    {
      name: "view",
      title: "Browser",
      scope: "thread",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      // Stays empty: this field gates mounting on host services reached
      // through `session.invoke` — `t3.ui/*` are brokered APIs (bindApi,
      // opportunistic under grants) and `t3.browser/surface` rides
      // `host.browserSurface`, so no required service belongs here.
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <BrowserView host={host} session={session} /> };
      },
    },
  ],
});

const client = authored.client;

export default {
  ...authored,
  ...(client === undefined
    ? {}
    : {
        client(host: ClientHost) {
          // Factory-time staging: only this path's `t3.extensions`-scoped
          // context makes `scope:"global"` + `activation` legal, and the host
          // flushes the set once a client-provider connection is live.
          host.registerGlobalCommands?.(BROWSER_GLOBAL_COMMANDS, (call) =>
            runGlobalBrowserCommand(host, call),
          );
          return client(host);
        },
      }),
};
