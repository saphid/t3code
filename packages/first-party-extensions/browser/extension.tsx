import { filePresentationApi } from "@t3tools/extension-sdk/catalogue";
import { defineExtension } from "@t3tools/extension-sdk/authoring";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useState } from "react";

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

function restoreState(
  value: unknown,
): value is { readonly relativePath?: string; readonly url?: string } | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(
    (key) => (key === "relativePath" || key === "url") && typeof record[key] === "string",
  );
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

  const submit = (raw: string) => {
    const next = submitAddress(state, raw);
    setState(next);
    if (next.status.kind === "target") session.save({ url: next.status.url });
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
          onClick={() => setState(goBack(state))}
          style={buttonStyle}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!canGoForward(state)}
          onClick={() => setState(goForward(state))}
          style={buttonStyle}
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reload"
          disabled={state.status.kind !== "target"}
          onClick={() => setState(reload(state))}
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
