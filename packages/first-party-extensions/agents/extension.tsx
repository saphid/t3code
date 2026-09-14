import { terminalControlApi, workspaceFilesApi } from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi, useApiRead } from "@t3tools/extension-sdk/authoring";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useState } from "react";

import {
  DEFERRED_SECTIONS,
  HOST_CHROME_NOTE,
  ROSTER_UNAVAILABLE_NOTICE,
  SCRIPTS_SCOPE_NOTE,
  describeScriptRun,
  parseT3ProjectFile,
  runWorkspaceScript,
  scriptRunNonce,
  workspaceFromRevision,
  type ScriptRun,
  type ScriptWorkspace,
  type WorkspaceScript,
} from "./viewModel.js";

const manifestId = "t3.agents";

const muted = "var(--muted-foreground, #667085)";
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

/**
 * Run a checked-in script through t3.terminal/control — the row-18 glue. The
 * dedicated per-script terminal is claimed first; busy or foreign sessions
 * overflow to nonce-keyed client-chosen ids, and no write ever reaches a
 * returned session that still has a foreground subprocess.
 */
async function runScript(
  host: ClientHost,
  session: ViewSession,
  script: WorkspaceScript,
  workspace: ScriptWorkspace,
  nonce: string,
  report: (run: ScriptRun) => void,
): Promise<void> {
  const api = bindApi(terminalControlApi, host, session.context);
  await runWorkspaceScript({
    control: {
      attach: (input) => api.invoke("attach", input, session.signal),
      write: (input) => api.invoke("write", input, session.signal),
    },
    script,
    workspace,
    nonce,
    report,
  });
}

function AgentsView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const workspace = workspaceFromRevision(session.context.workspaceRevision);
  const scriptsRead = useApiRead(host, session, workspaceFilesApi, "readText", {
    relativePath: "t3.json",
  });
  const [runs, setRuns] = useState<Record<string, ScriptRun>>({});
  // Fresh per panel mount: recreated panels never re-pick overflow ids their
  // previous incarnation may have left running; concurrent clients allocate
  // disjoint families.
  const [runNonce] = useState(scriptRunNonce);

  const run = (script: WorkspaceScript) => {
    if (!workspace || runs[script.name]?.kind === "running") return;
    void runScript(host, session, script, workspace, runNonce, (next) =>
      setRuns((current) => ({ ...current, [script.name]: next })),
    );
  };

  return (
    <section
      aria-label="Agents"
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
        <strong style={{ fontSize: 13 }}>Agents</strong>
        <span style={{ color: muted, fontSize: 11 }}>thread scope</span>
      </header>

      <div
        role="status"
        aria-label="Agent roster status"
        style={{
          padding: "8px 10px",
          color: muted,
          fontSize: 12,
          flexShrink: 0,
          borderBottom: "1px solid var(--border, #dfe3e8)",
        }}
      >
        {ROSTER_UNAVAILABLE_NOTICE}
      </div>

      <section
        aria-label="Project scripts"
        style={{
          flexShrink: 0,
          maxHeight: "45%",
          overflow: "auto",
          padding: "6px 10px",
          borderBottom: "1px solid var(--border, #dfe3e8)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: muted,
            padding: "2px 0 6px",
          }}
        >
          Project scripts
        </div>
        {scriptsRead.status === "loading" && (
          <p style={{ margin: "0 0 6px", color: muted, fontSize: 12 }}>Reading t3.json…</p>
        )}
        {scriptsRead.status === "unavailable" && (
          <p style={{ margin: "0 0 6px", color: muted, fontSize: 12 }}>
            t3.json is not readable in this workspace ({scriptsRead.error}).
          </p>
        )}
        {scriptsRead.status === "ready" &&
          (() => {
            const source = parseT3ProjectFile(scriptsRead.value.contents);
            if (source.kind === "invalid")
              return (
                <p style={{ margin: "0 0 6px", color: muted, fontSize: 12 }}>
                  {source.message} — fix t3.json to list its scripts here.
                </p>
              );
            if (source.kind === "empty")
              return (
                <p style={{ margin: "0 0 6px", color: muted, fontSize: 12 }}>
                  No checked-in t3.json scripts in this workspace.
                </p>
              );
            return (
              <ul
                aria-label="Checked-in t3.json scripts"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {source.scripts.map((script) => {
                  const runState = runs[script.name];
                  return (
                    <li
                      key={script.name}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        padding: "4px 0",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          aria-label={`Run ${script.name}`}
                          disabled={!workspace || runState?.kind === "running"}
                          onClick={() => run(script)}
                          style={control}
                        >
                          Run
                        </button>
                        <span
                          style={{
                            fontSize: 12,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {script.name}
                          {script.runOnWorktreeCreate && (
                            <span style={{ color: muted }}> · setup</span>
                          )}
                          {script.previewUrl && (
                            <span style={{ color: muted }}> · preview is host-only</span>
                          )}
                        </span>
                      </div>
                      <code
                        style={{
                          fontFamily:
                            "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
                          fontSize: 11,
                          color: muted,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {script.command}
                      </code>
                      {runState && (
                        <output
                          aria-label={`Run status for ${script.name}`}
                          style={{ fontSize: 11, color: muted }}
                        >
                          {describeScriptRun(runState)}
                        </output>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        <p style={{ margin: "6px 0 0", color: muted, fontSize: 11 }}>{SCRIPTS_SCOPE_NOTE}</p>
      </section>

      <section
        aria-label="Deferred capabilities"
        style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 10px" }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: muted,
            padding: "2px 0 6px",
          }}
        >
          Not available yet
        </div>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {DEFERRED_SECTIONS.map((section) => (
            <li key={section.title} style={{ fontSize: 12 }}>
              <div>{section.title}</div>
              <div style={{ color: muted, fontSize: 11 }}>
                {section.blocker} (parity rows {section.rows})
              </div>
            </li>
          ))}
        </ul>
      </section>

      <footer
        style={{
          padding: "6px 10px",
          borderTop: "1px solid var(--border, #dfe3e8)",
          color: muted,
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {HOST_CHROME_NOTE}
      </footer>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.1.0",
  requires: [requireApi(workspaceFilesApi), requireApi(terminalControlApi)],
  surfaces: [
    {
      name: "view",
      title: "Agents",
      scope: "thread",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      // The panel keeps no persisted state — same null-only rule as native.
      validateRestore: (state) => state === null,
      createView(host, session) {
        return { renderer: () => <AgentsView host={host} session={session} /> };
      },
    },
  ],
});
