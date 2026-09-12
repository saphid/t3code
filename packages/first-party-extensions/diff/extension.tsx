import {
  vcsDiffApi,
  vcsRepositoryApi,
  type VcsCapabilitiesResult,
  type VcsDiffFileContentsResult,
  type VcsDiffPreviewResult,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useState } from "react";

import {
  canExpandFile,
  changeTypeLabel,
  describeSource,
  diffCapabilityState,
  displayPath,
  fileContentsInput,
  fileRows,
  fileStatLabel,
  previewState,
  renderableFromPatch,
  retainFileSelection,
  selectSource,
  type DiffFileRow,
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
}

function restoreState(value: unknown): value is RestoredState | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => key === "sourceId" || key === "fileKey") &&
    (record.sourceId === undefined || typeof record.sourceId === "string") &&
    (record.fileKey === undefined || typeof record.fileKey === "string")
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
 * Diff preview via `t3.vcs/diff.getPreview` (row 34). Freshness is an
 * explicit Refresh control in this slice — no status stream is required,
 * so the panel never polls.
 */
function useDiffPreview(host: ClientHost, session: ViewSession, visible: boolean, tick: number) {
  const [result, setResult] = useState<{
    key: number;
    preview: VcsDiffPreviewResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(vcsDiffApi, host, session.context)
      .invoke("getPreview", {}, signal)
      .then(
        (preview) => {
          if (!signal.aborted) setResult({ key: tick, preview, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: tick,
              preview: null,
              error: error instanceof Error ? error.message : "Diff preview unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, session, visible, tick]);
  return result?.key === tick ? result : { preview: null, error: null };
}

/**
 * Full-file contents for the selected file via `t3.vcs/diff.getFileContents`
 * (row 35) — invoked lazily on the expand affordance, keyed by file +
 * source hash so a stale expansion cannot paint over a newer selection.
 */
function useFileContents(
  host: ClientHost,
  session: ViewSession,
  request: { key: string; input: ReturnType<typeof fileContentsInput> } | null,
) {
  const [result, setResult] = useState<{
    key: string;
    contents: VcsDiffFileContentsResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (request === null) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(vcsDiffApi, host, session.context)
      .invoke("getFileContents", request.input, signal)
      .then(
        (contents) => {
          if (!signal.aborted) setResult({ key: request.key, contents, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: request.key,
              contents: null,
              error: error instanceof Error ? error.message : "File contents unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, session, request]);
  return result?.key === request?.key ? result : null;
}

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

function DiffRow({ row }: { row: ReturnType<typeof fileRows>[number] }) {
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
  const [expandKey, setExpandKey] = useState<string | null>(null);

  const { capabilities, error: capsError } = useCapabilities(host, session, visible, tick);
  const gate = diffCapabilityState(capabilities, capsError);
  const ready = gate.kind === "ready";
  const { preview: previewData, error: previewError } = useDiffPreview(
    host,
    session,
    visible && ready,
    tick,
  );
  const preview = previewState(previewData, previewError);

  const source = selectSource(preview.kind === "ready" ? preview.result : null, sourceId);
  const renderable = source === null ? null : renderableFor(source.diffHash, source.diff);
  const files = renderable?.kind === "files" ? renderable.files : [];
  const selected = retainFileSelection(files, fileKey);

  const expandRequest =
    selected !== null && source !== null && expandKey === selected.key && canExpandFile(selected)
      ? { key: `${source.diffHash}:${selected.key}`, input: fileContentsInput(source, selected) }
      : null;
  const expansion = useFileContents(host, session, expandRequest);
  const expanded = expansion?.contents ?? undefined;
  const rows = selected === null ? [] : fileRows(selected, expanded);

  const persist = (nextSource: string | null, nextFile: string | null) => {
    session.save({
      ...(nextSource !== null ? { sourceId: nextSource } : {}),
      ...(nextFile !== null ? { fileKey: nextFile } : {}),
    });
  };
  const chooseSource = (id: string) => {
    setSourceId(id);
    setFileKey(null);
    setExpandKey(null);
    persist(id, null);
  };
  const chooseFile = (row: DiffFileRow) => {
    const next = row.key === fileKey ? null : row.key;
    setFileKey(next);
    setExpandKey(null);
    persist(source?.id ?? null, next);
  };

  const muted = "var(--muted-foreground, #667085)";
  const sources = preview.kind === "ready" ? preview.result.sources : [];
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

      {ready && preview.kind === "ready" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
                  maxHeight: "38%",
                  borderBottom: "1px solid var(--border, #dfe3e8)",
                }}
              >
                {files.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      aria-current={selected?.key === row.key ? "true" : undefined}
                      onClick={() => chooseFile(row)}
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
                        background:
                          selected?.key === row.key ? "var(--accent, #e8eef7)" : "transparent",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayPath(row)}
                      <span style={{ color: muted }}>
                        {" "}
                        — {row.binary ? "binary" : changeTypeLabel(row.changeType)}
                        {fileStatLabel(row) !== "" ? ` ${fileStatLabel(row)}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} aria-label="File diff">
                {selected === null && (
                  <p style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
                    Select a file to inspect its changes.
                  </p>
                )}
                {selected !== null && selected.binary && (
                  <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12 }}>
                    {selected.path} is a binary file — no text diff is available.
                  </p>
                )}
                {selected !== null && selected.textless && (
                  <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12 }}>
                    No textual changes in the patch for {displayPath(selected)}.
                  </p>
                )}
                {selected !== null &&
                  !selected.binary &&
                  !selected.textless &&
                  rows.map((row) => <DiffRow key={row.ordinal} row={row} />)}
              </div>

              {selected !== null && canExpandFile(selected) && (
                <footer
                  style={{
                    padding: "6px 10px",
                    borderTop: "1px solid var(--border, #dfe3e8)",
                    flexShrink: 0,
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {expanded === undefined && expansion === null && (
                    <button
                      type="button"
                      style={control}
                      onClick={() => setExpandKey(selected.key)}
                    >
                      Load full file context
                    </button>
                  )}
                  {expandRequest !== null && expansion === null && (
                    <span style={{ color: muted, fontSize: 11 }}>Loading file contents…</span>
                  )}
                  {expansion?.error != null && (
                    <span role="alert" style={{ color: muted, fontSize: 11 }}>
                      {expansion.error}
                    </span>
                  )}
                  {expanded !== undefined && (
                    <span style={{ color: muted, fontSize: 11 }}>
                      Full file context loaded via t3.vcs/diff.
                    </span>
                  )}
                </footer>
              )}
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
        Read-only diff skeleton on t3.vcs/diff: workspace + base-range previews, per-file hunks,
        full-context expansion. Turn diffs, line comments, and navigation chrome are deferred
        slices.
      </output>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.1.0",
  requires: [requireApi(vcsDiffApi), requireApi(vcsRepositoryApi)],
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
