import {
  filePresentationApi,
  vcsDiffApi,
  vcsRefsApi,
  vcsRepositoryApi,
  vcsStatusApi,
  type VcsCapabilitiesResult,
  type VcsDiffFileContentsResult,
  type VcsDiffPreviewInput,
  type VcsDiffPreviewResult,
  type VcsListRefsResult,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  areAllDiffFilesCollapsed,
  buildBaseRefChoices,
  canExpandFile,
  changeTypeLabel,
  CONNECTING_DIFF_STATUS,
  contentsDeliveryKey,
  describePresentation,
  describeSource,
  diffCapabilityState,
  diffTreeRows,
  displayPath,
  fetchDiffPreview,
  fetchFileContents,
  fileContentsInput,
  fileRows,
  fileStatLabel,
  filterBaseRefChoices,
  foldDiffStatusEvent,
  presentationPath,
  previewDeliveryKey,
  previewState,
  renderableFromPatch,
  retainFileSelection,
  selectSource,
  toggleAllDiffFiles,
  toggleCollapsedKey,
  type DiffFileRow,
  type DiffStatusRefresh,
} from "./viewModel.js";

const manifestId = "t3.diff";

/**
 * Parses are pure functions of the delivered diff text, keyed on the
 * source's content hash so re-renders never re-parse unchanged payloads.
 * Module-scoped (not per-view) and bounded — sources are ≤8 per preview.
 */
const patchParseCache = new Map<string, ReturnType<typeof renderableFromPatch>>();

function renderableFor(diffHash: string, diff: string) {
  const cached = patchParseCache.get(diffHash);
  if (cached !== undefined) return cached;
  const value = renderableFromPatch(diff);
  if (patchParseCache.size >= 16) patchParseCache.clear();
  patchParseCache.set(diffHash, value);
  return value;
}

interface RestoredState {
  readonly sourceId?: string;
  readonly fileKey?: string;
  readonly baseRef?: string;
  readonly ignoreWhitespace?: boolean;
}

function restoreState(value: unknown): value is RestoredState | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every(
      (key) =>
        key === "sourceId" || key === "fileKey" || key === "baseRef" || key === "ignoreWhitespace",
    ) &&
    (record.sourceId === undefined || typeof record.sourceId === "string") &&
    (record.fileKey === undefined || typeof record.fileKey === "string") &&
    (record.baseRef === undefined || typeof record.baseRef === "string") &&
    (record.ignoreWhitespace === undefined || typeof record.ignoreWhitespace === "boolean")
  );
}

/** One-shot capability read; the repository gate decides what the panel may show. */
function useCapabilities(host: ClientHost, session: ViewSession, visible: boolean, tick: number) {
  const [result, setResult] = useState<{
    key: number;
    capabilities: VcsCapabilitiesResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(vcsRepositoryApi, host, session.context)
      .invoke("getCapabilities", {}, signal)
      .then(
        (capabilities) => {
          if (!signal.aborted) setResult({ key: tick, capabilities, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: tick,
              capabilities: null,
              error: error instanceof Error ? error.message : "Capabilities unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, session, visible, tick]);
  return result?.key === tick ? result : { capabilities: null, error: null };
}

/**
 * The `t3.vcs/status` stream is the only freshness signal — the panel
 * never polls. `closed` frames resubscribe with the same bounded retry
 * the version-control panel uses; errors and unexpected ends surface an
 * honest ended state while manual Refresh keeps working.
 */
function useStatusRefresh(host: ClientHost, session: ViewSession, enabled: boolean) {
  const [model, setModel] = useState<DiffStatusRefresh>(CONNECTING_DIFF_STATUS);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      let status: DiffStatusRefresh = CONNECTING_DIFF_STATUS;
      setModel(status);
      for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
        let closed = false;
        try {
          const stream = bindStreamApi(vcsStatusApi, host, session.context).subscribe(
            "subscribe",
            {},
            signal,
          );
          for await (const frame of stream) {
            if (signal.aborted) return;
            status = foldDiffStatusEvent(status, frame.value);
            setModel(status);
            if (frame.value.kind === "closed") {
              closed = true;
              break;
            }
          }
        } catch (error) {
          if (!signal.aborted)
            setModel({
              ...status,
              stream: "ended",
              detail: error instanceof Error ? error.message : "Status stream unavailable",
            });
          return;
        }
        if (signal.aborted) return;
        if (!closed) {
          setModel({
            ...status,
            stream: "ended",
            detail: "Status stream ended unexpectedly.",
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
      if (!signal.aborted)
        setModel({ ...status, stream: "ended", detail: "Status stream ended repeatedly." });
    })();
    return () => controller.abort();
  }, [host, session, enabled]);
  return model;
}

/**
 * Refs for the base-ref picker via `t3.vcs/refs.list` — local and remote
 * lanes read separately exactly like the native panel, re-read on the
 * same local-status revision so a branch operation refreshes choices.
 */
function useRefs(host: ClientHost, session: ViewSession, enabled: boolean, revision: number) {
  const [result, setResult] = useState<{
    key: number;
    refs: VcsListRefsResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const api = bindApi(vcsRefsApi, host, session.context);
    void Promise.all([
      api.invoke("list", { refKind: "local", limit: 200 }, signal),
      api.invoke("list", { refKind: "remote", limit: 200 }, signal),
    ]).then(
      ([local, remote]) => {
        if (!signal.aborted)
          setResult({
            key: revision,
            refs: {
              refs: [...local.refs, ...remote.refs],
              isRepo: local.isRepo,
              hasPrimaryRemote: local.hasPrimaryRemote,
              nextCursor: null,
              totalCount: local.totalCount + remote.totalCount,
            },
            error: null,
          });
      },
      (error) => {
        if (!signal.aborted)
          setResult((prev) => ({
            key: revision,
            refs: prev?.refs ?? null,
            error: error instanceof Error ? error.message : "Refs unavailable",
          }));
      },
    );
    return () => controller.abort();
  }, [host, session, enabled, revision]);
  return result?.key === revision ? result : { refs: null, error: null };
}

/**
 * Preview fetch: unary `getPreview` first (the cheap common case), the
 * named-envelope rejection falls back to `streamPreview` with
 * reassembly + sha256 verification before render. The last-good preview
 * stays displayed across refreshes — a refresh failure is a note, never
 * a blank panel.
 */
function useDiffPreview(
  host: ClientHost,
  session: ViewSession,
  enabled: boolean,
  requestKey: string,
  input: VcsDiffPreviewInput,
) {
  const [result, setResult] = useState<{
    key: string;
    preview: VcsDiffPreviewResult | null;
    error: string | null;
    pending: boolean;
  } | null>(null);
  const streamKeys = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const api = bindApi(vcsDiffApi, host, session.context);
    const streams = bindStreamApi(vcsDiffApi, host, session.context);
    void fetchDiffPreview({
      input,
      invoke: (next) => api.invoke("getPreview", next, signal),
      stream: (next) => streams.subscribe("streamPreview", next, signal),
      streamKeys: streamKeys.current,
      signal,
    }).then((outcome) => {
      if (signal.aborted || outcome.kind === "cancelled") return;
      setResult((prev) =>
        outcome.kind === "ready"
          ? { key: requestKey, preview: outcome.result, error: null, pending: false }
          : {
              key: requestKey,
              preview: prev?.preview ?? null,
              error: outcome.detail,
              pending: false,
            },
      );
    });
    return () => controller.abort();
    // requestKey folds tick + status revision + input identity.
  }, [host, session, enabled, requestKey, input]);
  return {
    // Last-good preview stays up across refreshes and key changes.
    preview: result?.preview ?? null,
    error: result?.key === requestKey ? result.error : null,
    pending: result?.key !== requestKey || result.pending,
  };
}

/** Per-file expansion state; keyed `sourceHash:fileKey` so stale entries can never paint. */
type Expansion =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly detail: string }
  | { readonly status: "loaded"; readonly contents: VcsDiffFileContentsResult };

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

const rowBase = {
  display: "flex",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 11,
  lineHeight: "18px",
  whiteSpace: "pre",
} as const;

const gutter = {
  width: 40,
  flexShrink: 0,
  textAlign: "right" as const,
  paddingRight: 8,
  color: "var(--muted-foreground, #667085)",
  userSelect: "none" as const,
};

const iconButton = {
  ...control,
  padding: "2px 6px",
  fontSize: 11,
} as const;

function DiffRow({ row, wrap }: { row: ReturnType<typeof fileRows>[number]; wrap: boolean }) {
  if (row.kind === "gap") {
    return (
      <div
        style={{
          ...rowBase,
          justifyContent: "center",
          color: "var(--muted-foreground, #667085)",
          background: "var(--muted, #f4f5f7)",
          fontStyle: "italic",
        }}
      >
        {row.count} unmodified line{row.count === 1 ? "" : "s"}
      </div>
    );
  }
  const addition = row.kind === "addition";
  const deletion = row.kind === "deletion";
  return (
    <div
      style={{
        ...rowBase,
        whiteSpace: wrap ? "pre-wrap" : "pre",
        wordBreak: wrap ? "break-all" : undefined,
        background: addition
          ? "color-mix(in srgb, var(--success, #2da44e) 14%, transparent)"
          : deletion
            ? "color-mix(in srgb, var(--destructive, #cf222e) 12%, transparent)"
            : "transparent",
      }}
    >
      <span style={gutter}>{deletion || row.kind === "context" ? (row.oldLine ?? "") : ""}</span>
      <span style={gutter}>{addition || row.kind === "context" ? (row.newLine ?? "") : ""}</span>
      <span style={{ color: "var(--muted-foreground, #667085)", userSelect: "none", width: 14 }}>
        {addition ? "+" : deletion ? "−" : " "}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.text}</span>
    </div>
  );
}

function FileSection({
  row,
  selected,
  collapsed,
  wrap,
  expansion,
  action,
  onToggleCollapsed,
  onExpand,
  onOpen,
  onCopy,
  registerSection,
}: {
  row: DiffFileRow;
  selected: boolean;
  collapsed: boolean;
  wrap: boolean;
  expansion: Expansion | undefined;
  action: { key: string; status: string; detail: string } | null;
  onToggleCollapsed: (key: string) => void;
  onExpand: (row: DiffFileRow) => void;
  onOpen: (row: DiffFileRow) => void;
  onCopy: (row: DiffFileRow) => void;
  registerSection: (el: HTMLElement | null) => void;
}) {
  const muted = "var(--muted-foreground, #667085)";
  const expanded = expansion?.status === "loaded" ? expansion.contents : undefined;
  const rows = useMemo(
    () => (collapsed || row.binary || row.textless ? [] : fileRows(row, expanded)),
    [collapsed, row, expanded],
  );
  return (
    <section
      ref={registerSection}
      aria-label={displayPath(row)}
      style={{
        borderBottom: "1px solid var(--border, #dfe3e8)",
        outline: selected ? "1px solid var(--accent, #b7cff0)" : undefined,
        outlineOffset: -1,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 12,
          position: "sticky",
          top: 0,
          background: "var(--background, #fff)",
          zIndex: 1,
        }}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${displayPath(row)}`}
          onClick={() => onToggleCollapsed(row.key)}
          style={{ ...iconButton, width: 20, textAlign: "center" }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span
          style={{
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {displayPath(row)}
          <span style={{ color: muted }}>
            {" "}
            — {row.binary ? "binary" : changeTypeLabel(row.changeType)}
            {fileStatLabel(row) !== "" ? ` ${fileStatLabel(row)}` : ""}
          </span>
        </span>
        {canExpandFile(row) && !collapsed && (
          <button
            type="button"
            style={iconButton}
            disabled={expansion?.status === "loading"}
            onClick={() => onExpand(row)}
          >
            {expansion?.status === "loaded" ? "Context loaded" : "Full context"}
          </button>
        )}
        <button type="button" style={iconButton} onClick={() => onOpen(row)}>
          Open
        </button>
        <button type="button" style={iconButton} onClick={() => onCopy(row)}>
          Copy path
        </button>
      </header>
      {action !== null && action.key === row.key && (
        <p
          role={action.status === "error" ? "alert" : "note"}
          style={{ margin: 0, padding: "2px 10px", color: muted, fontSize: 11 }}
        >
          {action.detail}
        </p>
      )}
      {!collapsed && row.binary && (
        <p role="note" style={{ padding: "4px 10px", color: muted, fontSize: 12, margin: 0 }}>
          {row.path} is a binary file — no text diff is available.
        </p>
      )}
      {!collapsed && row.textless && (
        <p role="note" style={{ padding: "4px 10px", color: muted, fontSize: 12, margin: 0 }}>
          No textual changes in the patch for {displayPath(row)}.
        </p>
      )}
      {!collapsed && rows.map((line) => <DiffRow key={line.ordinal} row={line} wrap={wrap} />)}
      {!collapsed && expansion?.status === "loading" && (
        <p style={{ padding: "4px 10px", color: muted, fontSize: 11, margin: 0 }}>
          Loading file contents…
        </p>
      )}
      {!collapsed && expansion?.status === "error" && (
        <p role="alert" style={{ padding: "4px 10px", color: muted, fontSize: 11, margin: 0 }}>
          {expansion.detail}
        </p>
      )}
      {!collapsed && expansion?.status === "loaded" && (
        <p style={{ padding: "4px 10px", color: muted, fontSize: 11, margin: 0 }}>
          Full file context loaded via t3.vcs/diff.
        </p>
      )}
    </section>
  );
}

function DiffPanelView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const [visible, setVisible] = useState(session.visible);
  const [tick, setTick] = useState(0);
  useEffect(() => session.onVisibility(setVisible), [session]);

  const restored =
    session.restoreState &&
    typeof session.restoreState === "object" &&
    !Array.isArray(session.restoreState)
      ? (session.restoreState as RestoredState)
      : null;
  const [sourceId, setSourceId] = useState<string | null>(restored?.sourceId ?? null);
  const [fileKey, setFileKey] = useState<string | null>(restored?.fileKey ?? null);
  const [baseRef, setBaseRef] = useState<string>(restored?.baseRef ?? "");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState<boolean>(
    restored?.ignoreWhitespace ?? false,
  );
  const [wrap, setWrap] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(new Set());
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set());
  const [expansions, setExpansions] = useState<ReadonlyMap<string, Expansion>>(new Map());
  const [action, setAction] = useState<{ key: string; status: string; detail: string } | null>(
    null,
  );
  const expandControllers = useRef(new Map<string, AbortController>());
  const contentStreamKeys = useRef(new Set<string>());
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const { capabilities, error: capsError } = useCapabilities(host, session, visible, tick);
  const gate = diffCapabilityState(capabilities, capsError);
  const ready = gate.kind === "ready";

  const status = useStatusRefresh(host, session, visible && ready);
  const previewInput = useMemo<VcsDiffPreviewInput>(
    () => ({
      ...(baseRef !== "" ? { baseRef } : {}),
      ...(ignoreWhitespace ? { ignoreWhitespace: true } : {}),
    }),
    [baseRef, ignoreWhitespace],
  );
  const requestKey = `${tick}:${status.revision}:${previewDeliveryKey(previewInput)}`;
  const {
    preview: previewData,
    error: previewError,
    pending,
  } = useDiffPreview(host, session, visible && ready, requestKey, previewInput);
  // A refresh error next to last-good data is a note; only a cold failure
  // replaces the panel with the error state.
  const preview = previewState(previewData, previewData === null ? previewError : null);
  const { refs } = useRefs(host, session, visible && ready, status.revision);

  const source = selectSource(preview.kind === "ready" ? preview.result : null, sourceId);
  const renderable = source === null ? null : renderableFor(source.diffHash, source.diff);
  const files = renderable?.kind === "files" ? renderable.files : [];
  const selected = retainFileSelection(files, fileKey);
  const treeRows = diffTreeRows(files, collapsedDirs);
  const fileKeys = files.map((row) => row.key);
  const allCollapsed = areAllDiffFilesCollapsed(fileKeys, collapsedFiles);
  const baseRefChoices = useMemo(() => buildBaseRefChoices(refs?.refs ?? []), [refs]);

  // A new source payload invalidates in-flight expansion loads; stored
  // expansions are keyed `sourceHash:fileKey` so stale entries never paint.
  const sourceKey = source?.diffHash ?? null;
  useEffect(() => {
    if (sourceKey === null) return;
    const controllers = expandControllers.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, [sourceKey]);

  // Reveal-in-file: select, uncollapse, then scroll the section into view.
  useEffect(() => {
    if (fileKey === null || sourceKey === null || collapsedFiles.has(fileKey)) return;
    sectionRefs.current.get(fileKey)?.scrollIntoView({ block: "start" });
  }, [fileKey, collapsedFiles, sourceKey]);

  const persist = (
    nextSource: string | null,
    nextFile: string | null,
    nextBase: string,
    nextWhitespace: boolean,
  ) => {
    session.save({
      ...(nextSource !== null ? { sourceId: nextSource } : {}),
      ...(nextFile !== null ? { fileKey: nextFile } : {}),
      ...(nextBase !== "" ? { baseRef: nextBase } : {}),
      ...(nextWhitespace ? { ignoreWhitespace: true } : {}),
    });
  };
  const chooseSource = (id: string) => {
    setSourceId(id);
    setFileKey(null);
    persist(id, null, baseRef, ignoreWhitespace);
  };
  const revealFile = (row: DiffFileRow) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      next.delete(row.key);
      return next;
    });
    setFileKey(row.key);
    persist(source?.id ?? null, row.key, baseRef, ignoreWhitespace);
  };
  const chooseBaseRef = (value: string) => {
    setBaseRef(value);
    persist(source?.id ?? null, fileKey, value, ignoreWhitespace);
  };
  const chooseWhitespace = (value: boolean) => {
    setIgnoreWhitespace(value);
    persist(source?.id ?? null, fileKey, baseRef, value);
  };

  const expandFile = (row: DiffFileRow) => {
    if (source === null) return;
    const key = `${source.diffHash}:${row.key}`;
    if (expansions.has(key)) return;
    const controller = new AbortController();
    expandControllers.current.set(key, controller);
    const signal = AbortSignal.any([controller.signal, session.signal]);
    setExpansions((prev) => {
      const next = new Map(prev);
      if (next.size > 64) next.clear();
      return next.set(key, { status: "loading" });
    });
    const input = fileContentsInput(source, row);
    const api = bindApi(vcsDiffApi, host, session.context);
    const streams = bindStreamApi(vcsDiffApi, host, session.context);
    void fetchFileContents({
      input,
      deliveryKey: contentsDeliveryKey(source, row),
      invoke: (next) => api.invoke("getFileContents", next, signal),
      stream: (next) => streams.subscribe("streamFileContents", next, signal),
      streamKeys: contentStreamKeys.current,
      signal,
    }).then((outcome) => {
      expandControllers.current.delete(key);
      if (signal.aborted || outcome.kind === "cancelled") return;
      setExpansions((prev) =>
        new Map(prev).set(
          key,
          outcome.kind === "ready"
            ? { status: "loaded", contents: outcome.result }
            : { status: "error", detail: outcome.detail },
        ),
      );
    });
  };

  const openInEditor = (row: DiffFileRow) => {
    const path = presentationPath(row.path);
    if (path === null) {
      setAction({
        key: row.key,
        status: "error",
        detail: `${displayPath(row)} cannot be opened — not a workspace-relative path.`,
      });
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    setAction({ key: row.key, status: "loading", detail: "Resolving presentation…" });
    void bindApi(filePresentationApi, host, session.context)
      .invoke("open", { relativePath: path }, signal)
      .then(
        (result) => {
          if (!signal.aborted)
            setAction({ key: row.key, status: "resolved", detail: describePresentation(result) });
        },
        (error) => {
          if (!signal.aborted)
            setAction({
              key: row.key,
              status: "error",
              detail: error instanceof Error ? error.message : "Presentation unavailable",
            });
        },
      );
  };

  const copyPath = (row: DiffFileRow) => {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
      setAction({ key: row.key, status: "error", detail: "Clipboard unavailable" });
      return;
    }
    void navigator.clipboard.writeText(row.path).then(
      () => setAction({ key: row.key, status: "copied", detail: `Copied ${row.path}` }),
      (error) =>
        setAction({
          key: row.key,
          status: "error",
          detail: error instanceof Error ? error.message : "Copy failed",
        }),
    );
  };

  const muted = "var(--muted-foreground, #667085)";
  const sources = preview.kind === "ready" ? preview.result.sources : [];
  const filteredBaseChoices = filterBaseRefChoices(baseRefChoices, baseRef);
  return (
    <section
      aria-label="Diff"
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
          flexWrap: "wrap",
        }}
      >
        <button type="button" onClick={() => setTick((value) => value + 1)} style={control}>
          Refresh
        </button>
        {sources.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={source?.id === item.id ? "true" : undefined}
            onClick={() => chooseSource(item.id)}
            style={{
              ...control,
              fontWeight: source?.id === item.id ? 600 : 400,
              background: source?.id === item.id ? "var(--accent, #e8eef7)" : "transparent",
            }}
          >
            {describeSource(item)}
          </button>
        ))}
        <input
          type="text"
          aria-label="Base ref"
          placeholder="Base ref (automatic)"
          list="t3-diff-base-refs"
          value={baseRef}
          onChange={(event) => chooseBaseRef(event.target.value)}
          style={{ ...control, width: 140 }}
        />
        <datalist id="t3-diff-base-refs">
          {filteredBaseChoices.map((choice) => (
            <option key={choice.id} value={choice.refName}>
              {choice.label}
            </option>
          ))}
        </datalist>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(event) => chooseWhitespace(event.target.checked)}
          />
          Ignore whitespace
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          Wrap
        </label>
        {files.length > 0 && (
          <button
            type="button"
            style={control}
            onClick={() => setCollapsedFiles(toggleAllDiffFiles(fileKeys, collapsedFiles))}
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        {status.stream === "ended" && (
          <span role="note" style={{ color: muted, fontSize: 11 }}>
            {status.detail ?? "Status stream ended"} — refresh is manual.
          </span>
        )}
      </header>

      {gate.kind === "loading" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Reading repository capabilities…
        </p>
      )}
      {gate.kind === "unavailable" && (
        <p role="alert" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Repository status unavailable — {gate.detail}
        </p>
      )}
      {gate.kind === "no-repository" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          This workspace is not a repository
          {gate.detail ? ` — ${gate.detail}` : ""}.
        </p>
      )}
      {gate.kind === "unsupported" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Unsupported repository driver: {gate.driverKind}. {gate.detail}
        </p>
      )}

      {ready && preview.kind === "loading" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Loading diff…
        </p>
      )}
      {ready && preview.kind === "error" && (
        <p role="alert" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          {preview.detail}
        </p>
      )}
      {ready && preview.kind === "empty" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          No diff sources reported for this workspace.
        </p>
      )}
      {ready && previewData !== null && previewError !== null && (
        <p role="alert" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Refresh failed — {previewError}
        </p>
      )}

      {ready && preview.kind === "ready" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {pending && (
            <p role="note" style={{ padding: "2px 10px", color: muted, fontSize: 11, margin: 0 }}>
              Refreshing…
            </p>
          )}
          {source?.truncated === true && (
            <p
              role="note"
              style={{
                margin: 0,
                padding: "6px 10px",
                fontSize: 11,
                color: muted,
                borderBottom: "1px solid var(--border, #dfe3e8)",
                flexShrink: 0,
              }}
            >
              This diff was truncated because it exceeded the preview limit. The changes shown are
              incomplete.
            </p>
          )}
          {renderable === null && (
            <p style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
              No net changes in this selection.
            </p>
          )}
          {renderable?.kind === "raw" && (
            <div style={{ padding: 8, overflow: "auto", flex: 1, minHeight: 0 }}>
              <p style={{ color: muted, fontSize: 11, margin: "0 0 6px" }}>{renderable.reason}</p>
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                  border: "1px solid var(--border, #dfe3e8)",
                  borderRadius: 6,
                  overflow: "auto",
                }}
              >
                {renderable.text}
              </pre>
            </div>
          )}
          {renderable?.kind === "files" && (
            <>
              <ul
                aria-label="Changed files"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 4,
                  overflow: "auto",
                  flexShrink: 0,
                  maxHeight: "34%",
                  borderBottom: "1px solid var(--border, #dfe3e8)",
                }}
              >
                {treeRows.map((row) =>
                  row.kind === "dir" ? (
                    <li key={row.path}>
                      <button
                        type="button"
                        aria-expanded={!row.collapsed}
                        onClick={() =>
                          setCollapsedDirs(toggleCollapsedKey(collapsedDirs, row.path))
                        }
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          font: "inherit",
                          fontSize: 12,
                          padding: "3px 6px",
                          paddingLeft: 6 + row.depth * 14,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: muted,
                        }}
                      >
                        {row.collapsed ? "▸" : "▾"} {row.name}/<span> ({row.fileCount})</span>
                      </button>
                    </li>
                  ) : (
                    <li key={row.row.key}>
                      <button
                        type="button"
                        aria-current={selected?.key === row.row.key ? "true" : undefined}
                        onClick={() => revealFile(row.row)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          font: "inherit",
                          fontSize: 12,
                          padding: "4px 6px",
                          paddingLeft: 6 + row.depth * 14 + 14,
                          border: "1px solid transparent",
                          borderRadius: 5,
                          cursor: "pointer",
                          color: "var(--foreground, #20252d)",
                          background:
                            selected?.key === row.row.key
                              ? "var(--accent, #e8eef7)"
                              : "transparent",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.name}
                        <span style={{ color: muted }}>
                          {" "}
                          — {row.row.binary ? "binary" : changeTypeLabel(row.row.changeType)}
                          {fileStatLabel(row.row) !== "" ? ` ${fileStatLabel(row.row)}` : ""}
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ul>

              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} aria-label="File diffs">
                {files.length === 0 && (
                  <p style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
                    Select a file to inspect its changes.
                  </p>
                )}
                {source !== null &&
                  files.map((row) => (
                    <FileSection
                      key={row.key}
                      row={row}
                      selected={selected?.key === row.key}
                      collapsed={collapsedFiles.has(row.key)}
                      wrap={wrap}
                      expansion={expansions.get(`${source.diffHash}:${row.key}`)}
                      action={action}
                      onToggleCollapsed={(key) =>
                        setCollapsedFiles(toggleCollapsedKey(collapsedFiles, key))
                      }
                      onExpand={expandFile}
                      onOpen={openInEditor}
                      onCopy={copyPath}
                      registerSection={(el) => {
                        if (el !== null) sectionRefs.current.set(row.key, el);
                        else sectionRefs.current.delete(row.key);
                      }}
                    />
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      <output
        aria-label="Slice notice"
        style={{
          padding: "6px 10px",
          color: muted,
          fontSize: 11,
          borderTop: "1px solid var(--border, #dfe3e8)",
          flexShrink: 0,
        }}
      >
        Read-only diff on t3.vcs/diff 1.1: unary small previews, sha256-verified streams for large
        payloads, status-driven refresh. Split view, comments, and turn diffs are deferred slices.
      </output>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.2.0",
  requires: [
    requireApi(vcsDiffApi),
    requireApi(vcsRepositoryApi),
    requireApi(vcsStatusApi),
    requireApi(vcsRefsApi),
    requireApi(filePresentationApi),
  ],
  surfaces: [
    {
      name: "view",
      title: "Diff",
      scope: "thread",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <DiffPanelView host={host} session={session} /> };
      },
    },
  ],
});
