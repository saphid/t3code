import { FileTree, useFileTree, useFileTreeSearch, useFileTreeSelector } from "@pierre/trees/react";
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
import { useEffect, useMemo, useRef, useState } from "react";

import {
  allDirectoriesExpanded,
  buildTreePathUpdates,
  revealAncestors,
  setAllDirectoriesExpanded,
  treePath,
  type NativeTreeEntry,
} from "./treeLogic.js";

const manifestId = "example.native-files-tree";

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

const emptyEntries: readonly NativeTreeEntry[] = [];
function useCompleteTree(host: ClientHost, session: ViewSession) {
  const [snapshot, setSnapshot] = useState<{
    entries: readonly NativeTreeEntry[];
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
        const next: NativeTreeEntry[] = [];
        let completed = false;
        let streamTruncated = false;
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
            streamTruncated = streamTruncated || event.truncated;
          } else if (event.kind === "complete") {
            if (event.entryCount !== next.length)
              throw new Error("Workspace tree snapshot count was inconsistent.");
            streamTruncated = streamTruncated || event.truncated;
            completed = true;
            break;
          } else throw new Error("Workspace tree returned an unknown snapshot event.");
        }
        if (!completed) throw new Error("Workspace tree snapshot ended before completion.");
        signal.throwIfAborted();
        setSnapshot({
          entries: next,
          revision: refresh,
          status: streamTruncated ? "Files ready (index truncated)" : "Files ready",
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

function TreeView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const { entries, status, refresh, revision, visible } = useCompleteTree(host, session);
  const paths = useMemo(() => entries.map(treePath), [entries]);
  const directories = useMemo(() => paths.filter((path) => path.endsWith("/")), [paths]);
  const kindByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind])),
    [entries],
  );
  const entryKinds = useRef(kindByPath);
  useEffect(() => {
    entryKinds.current = kindByPath;
  }, [kindByPath]);
  const previous = useRef<readonly string[] | null>(null);
  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    paths: [],
    search: false,
    onSelectionChange: (paths) => {
      const path = paths.at(-1)?.replace(/\/$/, "");
      if (syncingSelection.current) return;
      if (path && entryKinds.current.get(path) === "file") {
        treeSelectionPath.current = path;
        setSelected(path);
        session.save({ relativePath: path });
      }
    },
  });
  const search = useFileTreeSearch(model);
  const allExpanded = useFileTreeSelector(model, (current) =>
    allDirectoriesExpanded(current, directories),
  );
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
    session: ViewSession;
    relativePath: string;
    revision: number;
    contents: string;
    status: string;
  } | null>(null);
  const currentRead =
    read?.session === session && read.relativePath === selected && read.revision === revision
      ? read
      : null;
  const contents = currentRead?.contents ?? "";
  const readStatus = selected ? (currentRead?.status ?? "Reading file") : "Choose a file";
  const syncingSelection = useRef(false);
  const treeSelectionPath = useRef<string | null>(null);
  const handledReveal = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === null) model.resetPaths(paths);
    else {
      const updates = buildTreePathUpdates(previous.current, paths);
      if (updates.length) model.batch(updates);
    }
    previous.current = paths;
  }, [model, paths]);
  useEffect(() => {
    if (!selected) {
      handledReveal.current = null;
      return;
    }
    if (handledReveal.current === selected) return;
    if (kindByPath.get(selected) !== "file" || !model.getItem(selected)) return;
    if (
      model.getSelectedPaths().some((path) => path.replace(/\/$/, "") === selected) &&
      treeSelectionPath.current === selected
    ) {
      treeSelectionPath.current = null;
      handledReveal.current = selected;
      return;
    }
    handledReveal.current = selected;
    syncingSelection.current = true;
    model.closeSearch();
    revealAncestors(model, selected);
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
    model.getItem(selected)?.select();
    model.scrollToPath(selected, { focus: true, offset: "center" });
    queueMicrotask(() => {
      syncingSelection.current = false;
    });
  }, [kindByPath, model, selected]);
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
              session,
              relativePath: selected,
              revision,
              contents: value.contents,
              status: value.truncated ? "File truncated (read only)" : "File loaded (read only)",
            });
        },
        (error) => {
          if (!signal.aborted)
            setRead({
              session,
              relativePath: selected,
              revision,
              contents: "",
              status: error instanceof Error ? error.message : "File unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, selected, session, revision, visible]);
  return (
    <section
      aria-label="Native files tree example"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <header style={{ display: "flex", gap: 6, padding: 8 }}>
        <button type="button" onClick={refresh}>
          Refresh files
        </button>
        <input
          type="search"
          aria-label="Search workspace files"
          placeholder="Search files"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value || null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              search.close();
              event.currentTarget.blur();
            }
          }}
        />
        {directories.length > 0 && (
          <button
            type="button"
            aria-label={allExpanded ? "Collapse all folders" : "Expand all folders"}
            onClick={() => setAllDirectoriesExpanded(model, directories, !allExpanded)}
          >
            {allExpanded ? "Collapse folders" : "Expand folders"}
          </button>
        )}
      </header>
      <FileTree
        model={model}
        aria-label="Workspace files"
        style={{ minHeight: 0, flex: 1, overflow: "hidden" }}
      />
      <output aria-label="Tree status">{status}</output>
      {selected && <output aria-label="File status">{selected + ": " + readStatus}</output>}
      {selected && (
        <pre aria-label="File contents" style={{ overflow: "auto", flex: 1, margin: 0 }}>
          {contents}
        </pre>
      )}
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "1.0.0",
  provides: [filePresentationApi.definition],
  serverEntry: "server.ts",
  requires: [requireApi(workspaceTreeApi), requireApi(workspaceFilesApi)],
  surfaces: [
    {
      name: "view",
      title: "Native Files tree",
      scope: "project",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <TreeView host={host} session={session} /> };
      },
    },
  ],
});
