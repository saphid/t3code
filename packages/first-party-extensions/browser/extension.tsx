import { filePresentationApi } from "@t3tools/extension-sdk/catalogue";
import { defineExtension } from "@t3tools/extension-sdk/authoring";
import type { Json } from "@t3tools/extension-sdk/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useState } from "react";

import {
  type BrowserHistoryEntry,
  fitHistoryToSaveBudget,
  recentHistoryEntries,
  recordHistoryVisit,
  removeHistoryUrl,
  sanitizeHistoryEntries,
} from "./historyStore.js";
import {
  canGoBack,
  canGoForward,
  currentUrl,
  describeStatus,
  ENGINE_UNAVAILABLE_NOTICE,
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

type PersistedViewState = {
  readonly relativePath?: string;
  readonly url?: string;
  readonly history?: Json;
};

function restoreState(value: unknown): value is PersistedViewState | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => {
    if (key === "relativePath" || key === "url") return typeof record[key] === "string";
    // Any malformed history container sanitizes to [] on read — the native
    // migrate step drops a bad list but keeps the browser usable, so the
    // container is never a reason to take the whole view unavailable.
    if (key === "history") return true;
    return false;
  });
}

/**
 * Skeleton chrome row + honest engine-gap body (P08-A). The navigation
 * state machine and requested-targets history are real and panel-local;
 * the webview area names the missing contract instead of rendering a
 * placeholder page (inventory rows #2/#5, mediaPreviewNotice precedent).
 */
function BrowserView(props: { host: ClientHost; session: ViewSession }) {
  const { session } = props;
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

  /**
   * Persist the restore record: the url the view reopens on plus the
   * per-project history list. fitHistoryToSaveBudget keeps the record under
   * the SDK's bounded save envelope by dropping the oldest entries.
   */
  const persist = (entries: readonly BrowserHistoryEntry[], url: string | null) => {
    const base: { url?: string; relativePath?: string } = url
      ? { url }
      : restored?.relativePath
        ? { relativePath: restored.relativePath }
        : {};
    session.save({ ...base, history: fitHistoryToSaveBudget(base, entries) });
  };

  /** Commit a navigation state; every landed target is a recorded visit. */
  const commit = (next: NavigationState) => {
    setState(next);
    if (next.status.kind !== "target") return;
    const entries = recordHistoryVisit(history, next.status.url, Date.now());
    setHistory(entries);
    persist(entries, next.status.url);
  };

  const submit = (raw: string) => commit(submitAddress(state, raw));

  const removeRecent = (rawUrl: string) => {
    const entries = removeHistoryUrl(history, rawUrl);
    setHistory(entries);
    persist(entries, currentUrl(state));
  };

  const url = currentUrl(state);
  const muted = "var(--muted-foreground, #667085)";
  const buttonStyle = {
    font: "inherit",
    fontSize: 12,
    padding: "2px 8px",
    border: "1px solid var(--border, #dfe3e8)",
    borderRadius: 5,
    background: "transparent",
    color: "inherit",
  } as const;

  return (
    <section
      aria-label="Browser"
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
          aria-label="Back"
          disabled={!canGoBack(state)}
          onClick={() => commit(goBack(state))}
          style={buttonStyle}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canGoForward(state)}
          onClick={() => commit(goForward(state))}
          style={buttonStyle}
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reload"
          disabled={state.status.kind !== "target"}
          onClick={() => commit(reload(state))}
          style={buttonStyle}
        >
          ⟳
        </button>
        <input
          type="text"
          aria-label="Address"
          placeholder="Search or enter address"
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
        {describeStatus(state)}
      </div>
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
        {state.status.kind === "target" ? (
          <p role="note" style={{ margin: 0, fontSize: 12, color: muted, maxWidth: "36rem" }}>
            {url}: {ENGINE_UNAVAILABLE_NOTICE}
          </p>
        ) : (
          <p role="note" style={{ margin: 0, fontSize: 12, color: muted, maxWidth: "36rem" }}>
            {ENGINE_UNAVAILABLE_NOTICE}
          </p>
        )}
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
        {state.status.kind === "target" && recentTargets(state).length > 0 && (
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
                        ? "var(--foreground, #20252d)"
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
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.1.0",
  provides: [filePresentationApi.definition],
  serverEntry: "server.ts",
  requires: [],
  surfaces: [
    {
      name: "view",
      title: "Browser",
      scope: "thread",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <BrowserView host={host} session={session} /> };
      },
    },
  ],
});
