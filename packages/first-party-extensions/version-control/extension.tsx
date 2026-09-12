import {
  vcsChangesApi,
  vcsRefsApi,
  vcsRepositoryApi,
  vcsStatusApi,
  type VcsCapabilitiesResult,
  type VcsChangesListResult,
  type VcsListRefsResult,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useState } from "react";

import {
  CHANGE_LANES,
  CONNECTING_STATUS,
  applyStatusEvent,
  describeEntry,
  describeRef,
  describeStatus,
  laneCount,
  laneTitle,
  lanesFromChanges,
  numstatFor,
  refRows,
  repositoryState,
  retainSelection,
  type ChangeLane,
  type ChangeSelection,
  type StatusModel,
} from "./viewModel.js";

const manifestId = "t3.version-control";

interface RestoredState {
  readonly selectedPath?: string;
  readonly selectedLane?: string;
}

const LANES = new Set<string>(CHANGE_LANES);

function restoreState(value: unknown): value is RestoredState | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => key === "selectedPath" || key === "selectedLane") &&
    (record.selectedPath === undefined || typeof record.selectedPath === "string") &&
    (record.selectedLane === undefined ||
      (typeof record.selectedLane === "string" && LANES.has(record.selectedLane)))
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
 * Live status via the public `t3.vcs/status` stream (row 2). A `closed`
 * frame or a dropped stream is recoverable — each fresh subscription
 * starts from a new snapshot — so retries are bounded like the terminal's.
 */
function useStatusStream(host: ClientHost, session: ViewSession, visible: boolean, tick: number) {
  const [model, setModel] = useState<{ key: number; status: StatusModel } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      let status: StatusModel = CONNECTING_STATUS;
      setModel({ key: tick, status });
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
            status = applyStatusEvent(status, frame.value);
            setModel({ key: tick, status });
            if (frame.value.kind === "closed") {
              closed = true;
              break;
            }
          }
        } catch (error) {
          if (!signal.aborted)
            setModel({
              key: tick,
              status: {
                ...status,
                stream: "ended",
                detail: error instanceof Error ? error.message : "Status stream unavailable",
              },
            });
          return;
        }
        if (signal.aborted) return;
        if (!closed) {
          setModel({
            key: tick,
            status: { ...status, stream: "ended", detail: "Status stream ended unexpectedly." },
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
      if (!signal.aborted)
        setModel({
          key: tick,
          status: { ...status, stream: "ended", detail: "Status stream ended repeatedly." },
        });
    })();
    return () => controller.abort();
  }, [host, session, visible, tick]);
  return model?.key === tick ? model.status : CONNECTING_STATUS;
}

/**
 * Staging lanes re-read whenever the status stream reports a local change
 * (`localRevision`) or the user refreshes — freshness rides the stream,
 * never a poll (row 31 is the adapter's obligation).
 */
function useChangesList(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
  isRepo: boolean,
  revision: number,
) {
  const [result, setResult] = useState<{
    key: number;
    changes: VcsChangesListResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible || !isRepo || revision === 0) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(vcsChangesApi, host, session.context)
      .invoke("list", {}, signal)
      .then(
        (changes) => {
          if (!signal.aborted) setResult({ key: revision, changes, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: revision,
              changes: null,
              error: error instanceof Error ? error.message : "Changes list unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, session, visible, isRepo, revision]);
  return result?.key === revision ? result : { changes: null, error: null };
}

/** Branch/ref listing (row 9) on the same freshness revision as changes. */
function useRefsList(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
  isRepo: boolean,
  revision: number,
) {
  const [result, setResult] = useState<{
    key: number;
    refs: VcsListRefsResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible || !isRepo || revision === 0) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(vcsRefsApi, host, session.context)
      .invoke("list", { refKind: "all" }, signal)
      .then(
        (refs) => {
          if (!signal.aborted) setResult({ key: revision, refs, error: null });
        },
        (error) => {
          if (!signal.aborted)
            setResult({
              key: revision,
              refs: null,
              error: error instanceof Error ? error.message : "Refs list unavailable",
            });
        },
      );
    return () => controller.abort();
  }, [host, session, visible, isRepo, revision]);
  return result?.key === revision ? result : { refs: null, error: null };
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

function VersionControlView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const [visible, setVisible] = useState(session.visible);
  const [tick, setTick] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  useEffect(() => session.onVisibility(setVisible), [session]);

  const restored =
    session.restoreState &&
    typeof session.restoreState === "object" &&
    !Array.isArray(session.restoreState)
      ? (session.restoreState as RestoredState)
      : null;
  const [selection, setSelection] = useState<ChangeSelection | null>(() =>
    restored?.selectedPath && restored.selectedLane && LANES.has(restored.selectedLane)
      ? { path: restored.selectedPath, lane: restored.selectedLane as ChangeLane }
      : null,
  );

  const { capabilities, error: capsError } = useCapabilities(host, session, visible, tick);
  const repo = repositoryState(capabilities, capsError);
  const status = useStatusStream(host, session, visible && repo.kind === "ready", tick);
  const isRepo = status.local?.isRepo === true;
  const changes = useChangesList(host, session, visible, isRepo, status.localRevision);
  const refs = useRefsList(host, session, visible, isRepo, status.localRevision);

  const lanes = useMemo(() => lanesFromChanges(changes.changes?.entries ?? []), [changes.changes]);
  const selected = retainSelection(selection, lanes);
  const selectedEntry =
    selected === null ? null : (lanes[selected.lane].find((e) => e.path === selected.path) ?? null);
  const selectedStat = selected === null ? null : numstatFor(status.local, selected.path);
  const rows = useMemo(() => refRows(refs.refs), [refs.refs]);

  const refresh = () => {
    // status.refresh is a declared read (effect:"read", t3.vcs/read); the
    // recompute lands back on the stream and bumps localRevision, which
    // re-reads the lists. The tick covers hosts whose refresh changes
    // nothing observable.
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(vcsStatusApi, host, session.context)
      .invoke("refresh", {}, signal)
      .then(
        () => setRefreshError(null),
        (error) =>
          setRefreshError(error instanceof Error ? error.message : "Status refresh unavailable"),
      )
      .finally(() => controller.abort());
    setTick((value) => value + 1);
  };

  const select = (path: string, lane: ChangeLane) => {
    setSelection({ path, lane });
    session.save({ selectedPath: path, selectedLane: lane });
  };

  const muted = "var(--muted-foreground, #667085)";
  return (
    <section
      aria-label="Version Control"
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
        {repo.kind === "ready" && repo.capabilities.operations["status.refresh"] === true && (
          <button type="button" onClick={refresh} style={control}>
            Refresh
          </button>
        )}
        <span style={{ color: muted, fontSize: 11 }}>
          {refreshError ?? describeStatus(status)}
        </span>
      </header>

      {repo.kind === "loading" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Reading repository capabilities…
        </p>
      )}
      {repo.kind === "unavailable" && (
        <p role="alert" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Repository status unavailable — {repo.detail}
        </p>
      )}
      {repo.kind === "no-repository" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          This workspace is not a repository
          {repo.detail ? ` — ${repo.detail}` : ""}. Repository init and clone controls arrive with
          the mutation slice (t3.vcs/mutate).
        </p>
      )}
      {repo.kind === "unsupported" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Unsupported repository driver: {repo.driverKind}. {repo.detail}
        </p>
      )}

      {repo.kind === "ready" && isRepo && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 6 }}>
          {changes.error !== null && (
            <output
              aria-label="Changes status"
              style={{ display: "block", padding: "4px 6px", color: muted, fontSize: 11 }}
            >
              {changes.error}
            </output>
          )}
          {changes.changes !== null && laneCount(lanes) === 0 && (
            <p style={{ padding: "4px 6px", color: muted, fontSize: 12, margin: 0 }}>
              Working tree clean — nothing staged, modified, or untracked.
            </p>
          )}
          {CHANGE_LANES.map((lane) =>
            lanes[lane].length === 0 ? null : (
              <section key={lane} aria-label={laneTitle(lane)} style={{ marginBottom: 8 }}>
                <h3
                  style={{
                    margin: 0,
                    padding: "2px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: muted,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {laneTitle(lane)} ({lanes[lane].length})
                </h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {lanes[lane].map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        aria-current={
                          selected?.path === entry.path && selected.lane === lane
                            ? "true"
                            : undefined
                        }
                        onClick={() => select(entry.path, lane)}
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
                            selected?.path === entry.path && selected.lane === lane
                              ? "var(--accent, #e8eef7)"
                              : "transparent",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.path}
                        <span style={{ color: muted }}> — {describeEntry(entry)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}

          <section aria-label="Refs" style={{ marginTop: 4 }}>
            <h3
              style={{
                margin: 0,
                padding: "2px 6px",
                fontSize: 11,
                fontWeight: 600,
                color: muted,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              Refs{refs.refs ? ` (${refs.refs.totalCount})` : ""}
            </h3>
            {refs.error !== null && (
              <output
                aria-label="Refs status"
                style={{ display: "block", padding: "4px 6px", color: muted, fontSize: 11 }}
              >
                {refs.error}
              </output>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((row) => (
                <li
                  key={(row.remote ?? "") + row.name}
                  style={{ padding: "3px 6px", fontSize: 12 }}
                >
                  {row.remote !== null ? `${row.remote}/${row.name}` : row.name}
                  {describeRef(row) !== "" && (
                    <span style={{ color: muted }}> — {describeRef(row)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {selected !== null && selectedEntry !== null && (
        <output
          aria-label="Selection"
          style={{
            padding: "6px 10px",
            color: muted,
            fontSize: 11,
            borderTop: "1px solid var(--border, #dfe3e8)",
            flexShrink: 0,
          }}
        >
          {selected.path} — {describeEntry(selectedEntry)}
          {selectedStat !== null ? ` (+${selectedStat.insertions} −${selectedStat.deletions})` : ""}
        </output>
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
        Read-only skeleton on t3.vcs: status, staging lanes, and refs. Stage/commit/branch/pull,
        pull requests, and diff rendering are deferred slices.
      </output>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.1.0",
  requires: [
    requireApi(vcsStatusApi),
    requireApi(vcsChangesApi),
    requireApi(vcsRefsApi),
    requireApi(vcsRepositoryApi),
  ],
  surfaces: [
    {
      name: "view",
      title: "Version Control",
      scope: "project",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <VersionControlView host={host} session={session} /> };
      },
    },
  ],
});
