import {
  filePresentationApi,
  workspaceFilesApi,
  workspaceTreeApi,
  type WorkspaceTreeEvent,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useState } from "react";

import { parentPath, toggleExpanded, visibleRows, type TreeEntry } from "./viewModel.js";

const manifestId = "t3.files";

function restoreState(value: unknown): value is { readonly relativePath: string } | null {
  if (value === null) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { relativePath?: unknown }).relativePath === "string"
  );
}

const emptyEntries: readonly TreeEntry[] = [];

/** Finite `t3.workspace/tree` snapshot consumed to completion, then swapped in. */
function useWorkspaceTree(host: ClientHost, session: ViewSession) {
  const [snapshot, setSnapshot] = useState<{
    entries: readonly TreeEntry[];
    status: string;
    revision: number;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(session.visible);
  useEffect(() => session.onVisibility(setVisible), [session]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      try {
        const next: TreeEntry[] = [];
        let completed = false;
        let truncated = false;
        const stream = bindStreamApi(workspaceTreeApi, host, session.context).subscribe(
          "snapshot",
          {},
          signal,
        );
        for await (const frame of stream) {
          signal.throwIfAborted();
          const event: WorkspaceTreeEvent = frame.value;
          if (event.kind === "chunk") {
            if (event.entries.length > 200)
              throw new Error("Workspace tree chunk exceeded 200 entries.");
            next.push(...event.entries);
            if (next.length > 25000)
              throw new Error("Workspace tree exceeded the 25,000-entry limit.");
            truncated = truncated || event.truncated;
          } else if (event.kind === "complete") {
            if (event.entryCount !== next.length)
              throw new Error("Workspace tree snapshot count was inconsistent.");
            truncated = truncated || event.truncated;
            completed = true;
            break;
          } else throw new Error("Workspace tree returned an unknown snapshot event.");
        }
        if (!completed) throw new Error("Workspace tree snapshot ended before completion.");
        setSnapshot({
          entries: next,
          revision: refresh,
          status: truncated ? "Files ready (index truncated)" : "Files ready",
        });
      } catch (error) {
        if (!signal.aborted)
          setSnapshot((previous) => ({
            entries: previous?.entries ?? emptyEntries,
            revision: refresh,
            status: error instanceof Error ? error.message : "Workspace tree unavailable",
          }));
      }
    })();
    return () => controller.abort();
  }, [host, refresh, session, visible]);
  return {
    entries: snapshot?.entries ?? emptyEntries,
    status: snapshot?.revision === refresh ? snapshot.status : "Loading files",
    revision: refresh,
    visible,
    refresh: () => setRefresh((value) => value + 1),
  };
}

function FilesView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const { entries, status, refresh, revision, visible } = useWorkspaceTree(host, session);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const restoredPath =
    session.restoreState &&
    typeof session.restoreState === "object" &&
    !Array.isArray(session.restoreState)
      ? (session.restoreState as { readonly relativePath?: unknown }).relativePath
      : null;
  const [selected, setSelected] = useState<string | null>(
    typeof restoredPath === "string" ? restoredPath : null,
  );
  const [read, setRead] = useState<{
    relativePath: string;
    revision: number;
    contents: string;
    status: string;
  } | null>(null);
  const currentRead = read?.relativePath === selected && read.revision === revision ? read : null;
  const kindByPath = useMemo(() => new Map(entries.map((e) => [e.path, e.kind])), [entries]);
  const rows = useMemo(() => visibleRows(entries, expanded, query), [entries, expanded, query]);

  const select = (path: string) => {
    setSelected(path);
    session.save({ relativePath: path });
    const ancestors: string[] = [];
    for (let ancestor = parentPath(path); ancestor !== null; ancestor = parentPath(ancestor))
      ancestors.push(ancestor);
    if (ancestors.length) setExpanded((previous) => new Set([...previous, ...ancestors]));
  };

  useEffect(() => {
    if (!selected || !visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(workspaceFilesApi, host, session.context)
      .invoke("readText", { relativePath: selected }, signal)
      .then(
        (value) => {
          if (!signal.aborted)
            setRead({
              relativePath: selected,
              revision,
              contents: value.contents,
              status: value.truncated ? "File truncated (read only)" : "File loaded (read only)",
            });
        },
        (error) => {
          if (!signal.aborted)
            setRead({
              relativePath: selected,
              revision,
              contents: "",
              status: error instanceof Error ? error.message : "File unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, selected, session, revision, visible]);

  const muted = "var(--muted-foreground, #667085)";
  return (
    <section
      aria-label="Files"
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
        <button type="button" onClick={refresh}>
          Refresh files
        </button>
        <input
          type="search"
          aria-label="Filter workspace files"
          placeholder="Filter files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
      </header>
      <ul
        aria-label="Workspace files"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 6,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {rows.map((row) => (
          <li key={row.entry.path}>
            <button
              type="button"
              aria-expanded={row.expandable ? expanded.has(row.entry.path) : undefined}
              aria-current={row.entry.path === selected ? "true" : undefined}
              onClick={() =>
                row.expandable
                  ? setExpanded((previous) => toggleExpanded(previous, row.entry.path))
                  : select(row.entry.path)
              }
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                font: "inherit",
                fontSize: 12,
                padding: "4px 6px",
                paddingLeft: 6 + row.depth * 14,
                border: "1px solid transparent",
                borderRadius: 5,
                cursor: "pointer",
                color: "var(--foreground, #20252d)",
                background: row.entry.path === selected ? "var(--accent, #e8eef7)" : "transparent",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.expandable ? (expanded.has(row.entry.path) ? "▾ " : "▸ ") : ""}
              {row.entry.path.split("/").at(-1)}
              {row.expandable ? "/" : ""}
            </button>
          </li>
        ))}
      </ul>
      <output aria-label="Tree status" style={{ padding: "6px 10px", color: muted, fontSize: 11 }}>
        {status}
        {kindByPath.size > 0 ? ` — ${entries.length} entries` : ""}
      </output>
      {selected && (
        <output
          aria-label="File status"
          style={{ padding: "6px 10px", color: muted, fontSize: 11 }}
        >
          {selected + ": " + (currentRead?.status ?? "Reading file")}
        </output>
      )}
      {selected && (
        <pre
          aria-label="File contents"
          style={{
            overflow: "auto",
            flex: 1,
            margin: 0,
            padding: 12,
            borderTop: "1px solid var(--border, #dfe3e8)",
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
            fontSize: 12,
          }}
        >
          {currentRead?.contents ?? ""}
        </pre>
      )}
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.1.0",
  provides: [filePresentationApi.definition],
  serverEntry: "server.ts",
  requires: [requireApi(workspaceTreeApi), requireApi(workspaceFilesApi)],
  surfaces: [
    {
      name: "view",
      title: "Files",
      scope: "project",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <FilesView host={host} session={session} /> };
      },
    },
  ],
});
