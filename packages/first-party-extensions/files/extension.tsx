import {
  filePresentationApi,
  resourcesLeaseApi,
  textEditsApi,
  workspaceFilesApi,
  workspaceSearchApi,
  workspaceTreeApi,
  type WorkspaceTreeEvent,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  FILE_SAVE_DEBOUNCE_MS,
  FileEditCoordinator,
  type EditorSaveState,
} from "./saveCoordinator.js";
import {
  describeMediaLease,
  describeRead,
  describeSaveState,
  describeSearch,
  describeSnapshot,
  leasePreviewMode,
  mediaLeaseAssetFailed,
  mediaLeaseExpire,
  mediaLeaseFailed,
  mediaLeaseKindGate,
  mediaLeaseMinted,
  mediaLeaseRenewalDelay,
  mediaLeaseRenewing,
  mediaLeaseUrl,
  selectMediaLease,
  parentPath,
  previewKind,
  toggleExpanded,
  visibleRows,
  type EditorOpen,
  type MediaLeaseState,
  type PreviewKind,
  type SearchKindFilter,
  type SearchResults,
  type TreeEntry,
} from "./viewModel.js";

const manifestId = "t3.files";
const PREVIEW_ASSET_PATH = "assets/preview.png";
const SEARCH_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 150;

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

/**
 * Verified package-asset read (F2a path): `readAsset` re-resolves and
 * re-verifies bytes on every call, so a stale object URL is renewed by
 * re-running the effect rather than trusting a cached URL.
 */
function usePackageAsset(host: ClientHost, session: ViewSession, visible: boolean) {
  const [asset, setAsset] = useState<{ url: string; status: string } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let url: string | null = null;
    void (async () => {
      try {
        if (!host.readAsset) throw new Error("This host cannot load package assets.");
        const result = await host.readAsset(PREVIEW_ASSET_PATH, signal);
        if (signal.aborted) return;
        url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "image/png" }));
        setAsset({
          url,
          status: `Package asset verified — ${result.bytes.byteLength.toLocaleString("en-US")} bytes, sha256 ${result.sha256.slice(0, 12)}…`,
        });
      } catch (error) {
        if (!signal.aborted)
          setAsset({
            url: "",
            status: error instanceof Error ? error.message : "Package asset unavailable",
          });
      }
    })();
    return () => {
      controller.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [host, session, visible]);
  return asset;
}

interface EditorSurface {
  readonly path: string;
  readonly open: EditorOpen;
  readonly contents: string;
  readonly saveState: EditorSaveState;
}

/**
 * Editor session for one workspace path (F1 #2/#3/#4). A package-owned
 * FileEditCoordinator drives debounced autosave through the revisioned
 * `t3.workspace/text-edits@1.1.0` contract: the textarea renders the buffered
 * contents optimistically, saves compare-and-swap on the confirmed base
 * revision, conflicts halt autosave until the user resolves them, and the
 * session flushes pending edits when the file changes or the view unmounts —
 * the native panel's unmount-dispose semantics.
 */
function useFileEditor(
  host: ClientHost,
  session: ViewSession,
  selected: string | null,
  selectedKind: PreviewKind,
  refreshRevision: number,
  visible: boolean,
) {
  const [surface, setSurface] = useState<EditorSurface | null>(null);
  const activeRef = useRef<{ path: string; coordinator: FileEditCoordinator } | null>(null);
  const lastRefreshRef = useRef(-1);
  const editing = selected !== null && selectedKind === "text" && visible;

  useEffect(() => {
    const active = activeRef.current;
    if (!editing || selected === null) {
      if (active) {
        active.coordinator.dispose();
        activeRef.current = null;
      }
      // A stale surface is filtered at render (`surface.path === selected`), so
      // nothing to clear synchronously here.
      return;
    }

    const path = selected;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let current = activeRef.current;
    const pathChanged = !current || current.path !== path;
    // Re-read the snapshot on open and on every tree refresh; identical
    // revisions skip the network round-trip.
    if (!pathChanged && refreshRevision === lastRefreshRef.current) {
      return () => controller.abort();
    }
    lastRefreshRef.current = refreshRevision;
    if (pathChanged) {
      current?.coordinator.dispose();
      const coordinator = new FileEditCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        persist: async (contents, expectedRevision) => {
          try {
            return await bindApi(textEditsApi, host, session.context).invoke(
              "save",
              { relativePath: path, expectedRevision, contents },
              signal,
            );
          } catch (error) {
            return {
              kind: "error",
              message: error instanceof Error ? error.message : "Save failed",
            };
          }
        },
        onStateChange: (saveState) =>
          setSurface((previous) =>
            previous && previous.path === path ? { ...previous, saveState } : previous,
          ),
      });
      current = { path, coordinator };
      activeRef.current = current;
    }
    const coordinator = current!.coordinator;

    void (async () => {
      try {
        const snapshot = await bindApi(textEditsApi, host, session.context).invoke(
          "readSnapshot",
          { relativePath: path },
          signal,
        );
        if (signal.aborted) return;
        const open = describeSnapshot(snapshot);
        if (!open.editable) {
          setSurface({ path, open, contents: "", saveState: coordinator.state() });
          return;
        }
        const kind = coordinator.state().kind;
        if (kind === "dirty" || kind === "saving" || kind === "error") {
          // Refresh reconciliation: the remote file moved under pending edits —
          // latch the conflict rather than clobbering the user's buffer.
          coordinator.noteRemoteRevision(open.revision);
          setSurface((previous) => ({
            path,
            open,
            contents: previous?.path === path ? previous.contents : coordinator.contents(),
            saveState: coordinator.state(),
          }));
        } else {
          coordinator.seed(open.revision, open.contents);
          setSurface({
            path,
            open,
            contents: open.contents,
            saveState: coordinator.state(),
          });
        }
      } catch (error) {
        if (!signal.aborted)
          setSurface((previous) => ({
            path,
            open: {
              editable: false,
              reason: "io-error",
              message: error instanceof Error ? error.message : "File could not be read",
            },
            contents: previous?.path === path ? previous.contents : "",
            saveState: coordinator.state(),
          }));
      }
    })();
    return () => controller.abort();
  }, [host, session, selected, editing, refreshRevision]);

  // Unmount flush: pending edits persist, exactly like the native panel's
  // coordinator disposal.
  useEffect(
    () => () => {
      activeRef.current?.coordinator.dispose();
      activeRef.current = null;
    },
    [],
  );

  const change = (contents: string) => {
    const active = activeRef.current;
    if (!active || active.path !== selected) return;
    active.coordinator.change(contents);
    setSurface((previous) =>
      previous && previous.path === selected ? { ...previous, contents } : previous,
    );
  };

  /** Reload: discard local edits and adopt the remote snapshot. */
  const reload = () => {
    const active = activeRef.current;
    if (!active || active.path !== selected) return;
    const coordinator = active.coordinator;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(textEditsApi, host, session.context)
      .invoke("readSnapshot", { relativePath: active.path }, signal)
      .then((snapshot) => {
        if (signal.aborted) return;
        const open = describeSnapshot(snapshot);
        if (open.editable) {
          coordinator.adoptRemote(open.contents, open.revision);
          setSurface({
            path: active.path,
            open,
            contents: open.contents,
            saveState: coordinator.state(),
          });
        } else {
          setSurface((previous) =>
            previous && previous.path === active.path
              ? { ...previous, open, saveState: coordinator.state() }
              : previous,
          );
        }
      })
      .finally(() => controller.abort());
  };

  /** Keep mine: deliberately write the buffer over the fresh remote revision. */
  const keepMine = () => {
    const active = activeRef.current;
    if (!active || active.path !== selected) return;
    const coordinator = active.coordinator;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(textEditsApi, host, session.context)
      .invoke("readSnapshot", { relativePath: active.path }, signal)
      .then((snapshot) => {
        if (signal.aborted) return;
        const open = describeSnapshot(snapshot);
        if (open.editable) coordinator.forcePersist(open.revision);
        else
          setSurface((previous) =>
            previous && previous.path === active.path
              ? { ...previous, open, saveState: coordinator.state() }
              : previous,
          );
      })
      .finally(() => controller.abort());
  };

  const retry = () => activeRef.current?.coordinator.retry();

  return { surface, change, reload, keepMine, retry };
}

/**
 * Workspace media preview via `t3.resources/lease` (F1 #8 + #24). Selecting a
 * previewable media file mints a signed `/api/assets/*` URL rendered
 * document-relative; the lease renews `MEDIA_LEASE_RENEWAL_SKEW_MS` before
 * expiry while visible, re-mints on tree refresh, and every named denial maps
 * to an explicit state — a broken element is never the error UI. The minted
 * URL resolves on the environment's own origin; a foreign-origin presentation
 * 404s the foreign-signed token and the element's load failure lands in the
 * named unavailable state instead of a broken image.
 */
function useMediaLease(
  host: ClientHost,
  session: ViewSession,
  selected: string | null,
  selectedKind: PreviewKind,
  refreshRevision: number,
  visible: boolean,
) {
  const active = selected !== null && selectedKind !== "text" && visible;
  const mode = selected === null ? null : leasePreviewMode(selected);
  const [lease, setLease] = useState<MediaLeaseState>({ status: "idle" });
  const leaseRef = useRef<MediaLeaseState>({ status: "idle" });
  const mintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const commitLease = (next: MediaLeaseState | ((prev: MediaLeaseState) => MediaLeaseState)) => {
      setLease((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        leaseRef.current = value;
        return value;
      });
    };
    mintRef.current = null;
    if (!active || selected === null) {
      commitLease({ status: "idle" });
      return;
    }
    const path = selected;
    const threadId = session.context.resource.threadId;
    const initial = selectMediaLease({
      path,
      hasThread: typeof threadId === "string" && threadId.length > 0,
    });
    commitLease(initial);
    if (initial.status !== "minting" || threadId === undefined) return;

    const api = bindApi(resourcesLeaseApi, host, session.context);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    const clearRenewal = () => {
      if (renewalTimer !== undefined) {
        clearTimeout(renewalTimer);
        renewalTimer = undefined;
      }
    };

    const mint = async () => {
      try {
        const capabilities = await api.invoke("getCapabilities", {}, signal);
        if (signal.aborted) return;
        const gate = mediaLeaseKindGate(capabilities.supportedKinds);
        if (gate) {
          commitLease(gate);
          return;
        }
        const minted = await api.invoke(
          "createPresentationUrl",
          { resource: { _tag: "workspace-file", threadId, path } },
          signal,
        );
        if (signal.aborted) return;
        if (leasePreviewMode(path) === "document") {
          // An iframe does not reliably fire onerror for failed documents —
          // preflight the lease so a 404 lands in the named state. The frame
          // gets the minted URL itself: a blob: URL would be refused by
          // desktop's frame-src 'self' CSP, and the route's private max-age
          // cache means the frame's own fetch is not a second download.
          const response = await fetch(minted.url, { signal });
          if (signal.aborted) return;
          if (!response.ok) {
            commitLease(
              mediaLeaseAssetFailed(
                { status: "ready", url: minted.url, expiresAt: minted.expiresAt },
                Date.now(),
              ),
            );
            return;
          }
          await response.arrayBuffer();
          if (signal.aborted) return;
        }
        commitLease(mediaLeaseMinted(minted));
        clearRenewal();
        renewalTimer = setTimeout(
          () => {
            renewalTimer = undefined;
            commitLease((prev) => mediaLeaseRenewing(prev));
            void mint();
          },
          mediaLeaseRenewalDelay(minted.expiresAt, Date.now()),
        );
      } catch (error) {
        if (signal.aborted) return;
        const next = mediaLeaseFailed(error, leaseRef.current);
        commitLease(next);
        if (next.status === "ready") {
          // Renewal failed but the current lease still serves — re-arm at
          // expiresAt so the state goes expired and re-mints rather than
          // asserting a live lease past its TTL.
          clearRenewal();
          renewalTimer = setTimeout(
            () => {
              renewalTimer = undefined;
              commitLease((prev) => mediaLeaseExpire(prev));
              void mint();
            },
            Math.max(0, next.expiresAt - Date.now()),
          );
        }
      }
    };
    mintRef.current = mint;
    void mint();

    return () => {
      mintRef.current = null;
      clearRenewal();
      controller.abort();
    };
    // selectedKind gates via `active`; refreshRevision is an intentional
    // trigger — a tree refresh re-mints so refreshed bytes stay honest.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [host, session, selected, selectedKind, refreshRevision, active]);

  const notifyAssetFailed = () => {
    const previous = leaseRef.current;
    const next = mediaLeaseAssetFailed(previous, Date.now());
    if (next === previous) return;
    leaseRef.current = next;
    setLease(next);
    if (next.status === "expired") mintRef.current?.();
  };

  return { state: lease, mode, url: mediaLeaseUrl(lease), notifyAssetFailed };
}

function FilesView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const { entries, status, refresh, revision, visible } = useWorkspaceTree(host, session);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<SearchKindFilter>("all");
  const [search, setSearch] = useState<{
    key: string;
    results: SearchResults | null;
    error: string | null;
  } | null>(null);
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
    truncated: boolean;
  } | null>(null);
  const selectedKind: PreviewKind = selected ? previewKind(selected) : "text";
  const editor = useFileEditor(host, session, selected, selectedKind, revision, visible);
  const media = useMediaLease(host, session, selected, selectedKind, revision, visible);
  const packageAsset = usePackageAsset(
    host,
    session,
    visible && selected !== null && selectedKind !== "text",
  );
  const currentRead = read?.relativePath === selected && read.revision === revision ? read : null;
  const kindByPath = useMemo(() => new Map(entries.map((e) => [e.path, e.kind])), [entries]);
  const searching = query.trim() !== "";
  const rows = useMemo(() => visibleRows(entries, expanded, ""), [entries, expanded]);
  useEffect(() => {
    const needle = query.trim();
    if (!needle || !visible) return;
    const key = `${needle} ${kindFilter} ${revision}`;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const timer = setTimeout(() => {
      void bindApi(workspaceSearchApi, host, session.context)
        .invoke(
          "search",
          {
            query: needle,
            limit: SEARCH_LIMIT,
            ...(kindFilter === "all" ? {} : { kind: kindFilter }),
          },
          signal,
        )
        .then(
          (result) => {
            if (!signal.aborted) setSearch({ key, results: result, error: null });
          },
          (error) => {
            if (!signal.aborted)
              setSearch({
                key,
                results: null,
                error: error instanceof Error ? error.message : "Workspace search unavailable",
              });
          },
        );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [host, session, query, kindFilter, revision, visible]);
  const activeSearch =
    searching && search?.key === `${query.trim()} ${kindFilter} ${revision}` ? search : null;

  const select = (path: string) => {
    setSelected(path);
    session.save({ relativePath: path });
    const ancestors: string[] = [];
    for (let ancestor = parentPath(path); ancestor !== null; ancestor = parentPath(ancestor))
      ancestors.push(ancestor);
    if (ancestors.length) setExpanded((previous) => new Set([...previous, ...ancestors]));
  };

  const editorSurface = editor.surface?.path === selected ? editor.surface : null;

  useEffect(() => {
    // The bounded preview read remains the fallback for files the text-edits
    // contract reports as not-editable (oversized/binary/non-UTF-8) — shown
    // read-only with the named reason, never silently editable.
    if (!selected || !visible || selectedKind !== "text") return;
    if (editorSurface === null || editorSurface.open.editable) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(workspaceFilesApi, host, session.context)
      .invoke("readText", { relativePath: selected }, signal)
      .then(
        (value) => {
          if (!signal.aborted) {
            const described = describeRead(value);
            setRead({
              relativePath: selected,
              revision,
              contents: value.contents,
              status: described.status,
              truncated: described.truncated,
            });
          }
        },
        (error) => {
          if (!signal.aborted)
            setRead({
              relativePath: selected,
              revision,
              contents: "",
              status: error instanceof Error ? error.message : "File unavailable",
              truncated: false,
            });
        },
      );
    return () => controller.abort();
  }, [host, selected, selectedKind, session, revision, visible, editorSurface]);

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
          aria-label="Search workspace files"
          placeholder="Search files"
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
        <select
          aria-label="Search kind"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value as SearchKindFilter)}
        >
          <option value="all">All</option>
          <option value="file">Files</option>
          <option value="directory">Directories</option>
        </select>
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
        {searching
          ? (activeSearch?.results?.entries ?? []).map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  aria-current={entry.path === selected ? "true" : undefined}
                  onClick={() =>
                    entry.kind === "directory"
                      ? (setQuery(""),
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          for (
                            let ancestor: string | null = entry.path;
                            ancestor !== null;
                            ancestor = parentPath(ancestor)
                          )
                            next.add(ancestor);
                          return next;
                        }))
                      : select(entry.path)
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    font: "inherit",
                    fontSize: 12,
                    padding: "4px 6px",
                    border: "1px solid transparent",
                    borderRadius: 5,
                    cursor: "pointer",
                    color: "var(--foreground, #20252d)",
                    background: entry.path === selected ? "var(--accent, #e8eef7)" : "transparent",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.kind === "directory" ? "▸ " : ""}
                  {entry.path}
                </button>
              </li>
            ))
          : rows.map((row) => (
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
                    background:
                      row.entry.path === selected ? "var(--accent, #e8eef7)" : "transparent",
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
        {searching
          ? (activeSearch?.error ??
            describeSearch(activeSearch?.results ?? null, query, SEARCH_LIMIT))
          : status + (kindByPath.size > 0 ? ` — ${entries.length} entries` : "")}
      </output>
      {selected && (
        <output
          aria-label="File status"
          style={{ padding: "6px 10px", color: muted, fontSize: 11 }}
        >
          {selected +
            ": " +
            (selectedKind === "text"
              ? editorSurface === null
                ? "Reading file"
                : editorSurface.open.editable
                  ? describeSaveState(editorSurface.saveState)
                  : editorSurface.open.message + (currentRead ? ` — ${currentRead.status}` : "")
              : describeMediaLease(media.state))}
        </output>
      )}
      {selected && selectedKind === "text" && editorSurface?.open.editable === true && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            borderTop: "1px solid var(--border, #dfe3e8)",
          }}
        >
          <textarea
            aria-label="File editor"
            value={editorSurface.contents}
            onChange={(event) => editor.change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur();
            }}
            spellCheck={false}
            style={{
              flex: 1,
              minHeight: 0,
              resize: "none",
              border: "none",
              outline: "none",
              padding: 12,
              color: "inherit",
              background: "transparent",
              fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
              fontSize: 12,
            }}
          />
          {editorSurface.saveState.kind === "conflict" && (
            <div
              role="alert"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "6px 10px",
                borderTop: "1px solid var(--border, #dfe3e8)",
                fontSize: 11,
                color: "var(--foreground, #20252d)",
              }}
            >
              File changed on disk — your edits are kept.
              <button type="button" onClick={editor.reload}>
                Reload file
              </button>
              <button type="button" onClick={editor.keepMine}>
                Keep my version
              </button>
            </div>
          )}
          {editorSurface.saveState.kind === "error" && (
            <div
              role="alert"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "6px 10px",
                borderTop: "1px solid var(--border, #dfe3e8)",
                fontSize: 11,
                color: "var(--foreground, #20252d)",
              }}
            >
              {describeSaveState(editorSurface.saveState)}
              <button type="button" onClick={editor.retry}>
                Retry save
              </button>
            </div>
          )}
        </div>
      )}
      {selected &&
        selectedKind === "text" &&
        editorSurface !== null &&
        !editorSurface.open.editable && (
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
      {selected && selectedKind !== "text" && (
        <figure
          aria-label="Workspace media preview"
          style={{
            margin: 0,
            padding: 12,
            borderTop: "1px solid var(--border, #dfe3e8)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {media.mode === "image" && media.url !== null ? (
            <img
              src={media.url}
              alt={selected.split("/").at(-1)}
              onError={media.notifyAssetFailed}
              style={{ maxWidth: "100%", objectFit: "contain", alignSelf: "flex-start" }}
            />
          ) : null}
          {media.mode === "document" && media.url !== null ? (
            // The built-in PDF viewer needs an unsandboxed frame — parity with
            // the native FilePreviewPanel; the lease only serves workspace-owned bytes.
            // oxlint-disable-next-line react/iframe-missing-sandbox
            <iframe
              src={media.url}
              title={selected.split("/").at(-1)}
              style={{ flex: 1, minHeight: 0, width: "100%", border: 0, background: "#fff" }}
            />
          ) : null}
          <figcaption style={{ color: muted, fontSize: 11 }}>
            {describeMediaLease(media.state)}
          </figcaption>
        </figure>
      )}
      {selected && selectedKind !== "text" && (
        <figure
          aria-label="Package asset preview"
          style={{
            margin: 0,
            padding: 12,
            borderTop: "1px solid var(--border, #dfe3e8)",
            display: "grid",
            gap: 8,
            justifyItems: "start",
          }}
        >
          {packageAsset?.url ? (
            <img
              src={packageAsset.url}
              alt="Verified package asset rendered through the public asset surface"
              style={{ imageRendering: "pixelated", width: 64, height: 64 }}
            />
          ) : null}
          <figcaption style={{ color: muted, fontSize: 11 }}>
            {packageAsset?.status ?? "Loading package asset"}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.5.0",
  provides: [filePresentationApi.definition],
  assets: [{ path: PREVIEW_ASSET_PATH, mediaType: "application/octet-stream" }],
  serverEntry: "server.ts",
  requires: [
    requireApi(workspaceTreeApi),
    requireApi(workspaceFilesApi),
    requireApi(workspaceSearchApi),
    requireApi(textEditsApi),
    requireApi(resourcesLeaseApi),
  ],
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
