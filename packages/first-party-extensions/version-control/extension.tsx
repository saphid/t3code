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
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CHANGE_LANES,
  CONNECTING_STATUS,
  IDLE_MUTATION,
  applyStatusEvent,
  describeEntry,
  describeMutation,
  describeRef,
  describeStatus,
  entryMutation,
  laneCount,
  laneMutation,
  laneTitle,
  lanesFromChanges,
  numstatFor,
  planCommit,
  planRefCreate,
  refRows,
  refSwitchState,
  refSwitchTarget,
  repositoryState,
  retainSelection,
  settleMutation,
  startMutation,
  VCS_PATHS_MAX,
  type ChangeLane,
  type ChangeSelection,
  type MutationOp,
  type MutationPhase,
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
 * Staging lanes re-read whenever the revision changes — the status
 * stream's `localRevision` for working-tree/HEAD changes plus the panel's
 * `mutationSerial` for index-only mutations (stage/unstage change no
 * status fingerprint, so the stream stays silent for them — verified
 * VcsStatusBroadcaster.ts:254-349). Freshness is re-read through the
 * contract, never edited locally and never polled.
 */
function useChangesList(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
  isRepo: boolean,
  revision: string,
) {
  const [result, setResult] = useState<{
    key: string;
    changes: VcsChangesListResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible || !isRepo || revision === "") return;
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
            setResult((prev) => ({
              key: revision,
              // A failed re-read keeps the last-good lanes — a settled
              // mutation re-reads every time, so blanking on each settle
              // would flash the panel empty once per click.
              changes: prev?.changes ?? null,
              error: error instanceof Error ? error.message : "Changes list unavailable",
            }));
        },
      );
    return () => controller.abort();
  }, [host, session, visible, isRepo, revision]);
  if (result === null) return { changes: null, error: null };
  // While a newer revision is in flight, keep showing the last payload;
  // its error belongs to the revision that produced it.
  return { changes: result.changes, error: result.key === revision ? result.error : null };
}

/** Branch/ref listing (row 9) on the same freshness revision as changes. */
function useRefsList(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
  isRepo: boolean,
  revision: string,
) {
  const [result, setResult] = useState<{
    key: string;
    refs: VcsListRefsResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible || !isRepo || revision === "") return;
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
            setResult((prev) => ({
              key: revision,
              refs: prev?.refs ?? null,
              error: error instanceof Error ? error.message : "Refs list unavailable",
            }));
        },
      );
    return () => controller.abort();
  }, [host, session, visible, isRepo, revision]);
  if (result === null) return { refs: null, error: null };
  return { refs: result.refs, error: result.key === revision ? result.error : null };
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

const muted = "var(--muted-foreground, #667085)";

function VersionControlView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const [visible, setVisible] = useState(session.visible);
  const [tick, setTick] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<MutationPhase>(IDLE_MUTATION);
  const [mutationSerial, setMutationSerial] = useState(0);
  const [commitMessage, setCommitMessage] = useState("");
  const [newRefName, setNewRefName] = useState("");
  const inFlight = useRef(false);
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
  // The list revision folds the stream's localRevision with the panel's
  // mutationSerial so index-only mutations (stage/unstage emit no stream
  // frame) still re-read the contracts after they settle.
  const listRevision =
    status.localRevision === 0 ? "" : `${status.localRevision}:${mutationSerial}`;
  const changes = useChangesList(host, session, visible, isRepo, listRevision);
  const refs = useRefsList(host, session, visible, isRepo, listRevision);

  const lanes = useMemo(() => lanesFromChanges(changes.changes?.entries ?? []), [changes.changes]);
  const selected = retainSelection(selection, lanes);
  const selectedEntry =
    selected === null ? null : (lanes[selected.lane].find((e) => e.path === selected.path) ?? null);
  const selectedStat = selected === null ? null : numstatFor(status.local, selected.path);
  const rows = useMemo(() => refRows(refs.refs), [refs.refs]);

  // Per-operation support from the capability gate — each control renders
  // only when its operation exists for the detected driver.
  const ops = repo.kind === "ready" ? repo.capabilities.operations : null;
  const canStage = ops?.["changes.stage"] === true;
  const canUnstage = ops?.["changes.unstage"] === true;
  const canCommit = ops?.["changes.commit"] === true;
  const canCreateRef = ops?.["refs.create"] === true;
  const canSwitchRef = ops?.["refs.switch"] === true;
  const busy = mutation.kind === "running";
  const commit = planCommit(lanes, commitMessage);
  const create = planRefCreate(newRefName, rows);
  const currentBranch = rows.find((row) => row.current && row.remote === null)?.name ?? null;

  /**
   * Single-flight mutation runner: one invoke at a time (the panel's
   * analog of native's serialized VCS actions), the running label shown
   * while in flight, rejections surfaced by name, and a settled success
   * bumping `mutationSerial` so the lists re-read the real post-mutation
   * state — the stream cannot confirm index-only changes.
   */
  const runMutation = (
    op: MutationOp,
    label: string,
    invoke: (signal: AbortSignal) => Promise<string>,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    // The ref is the synchronous guard; startMutation is the same
    // single-flight rule expressed on the visible phase.
    setMutation((phase) => startMutation(phase, op, label) ?? phase);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    invoke(signal)
      .then(
        (detail) => setMutation(settleMutation(op, { ok: true, detail })),
        (error) =>
          setMutation(
            settleMutation(op, {
              ok: false,
              detail: `${label} failed: ${error instanceof Error ? error.message : "operation unavailable"}`,
            }),
          ),
      )
      .finally(() => {
        inFlight.current = false;
        controller.abort();
        // Every settled mutation re-reads the lists — even a rejected one,
        // since a chunked bulk op may have partially applied before failing.
        setMutationSerial((value) => value + 1);
      });
  };

  const runPaths = (op: "stage" | "unstage", paths: readonly string[], label: string) =>
    runMutation(op, label, async (signal) => {
      const changesApi = bindApi(vcsChangesApi, host, session.context);
      for (let index = 0; index < paths.length; index += VCS_PATHS_MAX) {
        await changesApi.invoke(op, { paths: paths.slice(index, index + VCS_PATHS_MAX) }, signal);
      }
      const noun = `${paths.length} path${paths.length === 1 ? "" : "s"}`;
      return op === "stage" ? `Staged ${noun}` : `Unstaged ${noun}`;
    });

  const runCommit = () => {
    const plan = planCommit(lanes, commitMessage);
    if (plan.disabled !== null) return;
    const message = commitMessage.trim();
    runMutation("commit", "Committing", (signal) =>
      bindApi(vcsChangesApi, host, session.context)
        .invoke(
          "commit",
          plan.paths === undefined ? { message } : { message, paths: [...plan.paths] },
          signal,
        )
        .then((result) => {
          setCommitMessage("");
          return `Committed ${result.commitSha.slice(0, 12)}${
            result.refName !== null ? ` on ${result.refName}` : ""
          }`;
        }),
    );
  };

  const runCreateRef = () => {
    const plan = planRefCreate(newRefName, rows);
    if (plan.refName === null) return;
    const refName = plan.refName;
    runMutation("ref-create", `Creating branch ${refName}`, (signal) =>
      bindApi(vcsRefsApi, host, session.context)
        .invoke("create", { refName, switchRef: true }, signal)
        .then((result) => {
          setNewRefName("");
          return `Created and switched to ${result.refName}`;
        }),
    );
  };

  const runSwitchRef = (refName: string) =>
    runMutation("ref-switch", `Switching to ${refName}`, (signal) =>
      bindApi(vcsRefsApi, host, session.context)
        .invoke("switch", { refName }, signal)
        .then((result) => `Switched to ${result.refName ?? refName}`),
    );

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
        <span style={{ color: muted, fontSize: 11 }}>{refreshError ?? describeStatus(status)}</span>
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
          {repo.detail ? ` — ${repo.detail}` : ""}. Repository init and clone controls remain a
          deferred slice.
        </p>
      )}
      {repo.kind === "unsupported" && (
        <p role="note" style={{ padding: "6px 10px", color: muted, fontSize: 12, margin: 0 }}>
          Unsupported repository driver: {repo.driverKind}. {repo.detail}
        </p>
      )}

      {repo.kind === "ready" && isRepo && (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 6 }}>
          {describeMutation(mutation) !== null && (
            <output
              aria-label="Mutation status"
              role={mutation.kind === "failed" ? "alert" : "status"}
              style={{
                display: "block",
                padding: "4px 6px",
                color: mutation.kind === "failed" ? "var(--destructive, #b42318)" : muted,
                fontSize: 11,
              }}
            >
              {describeMutation(mutation)}
            </output>
          )}
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
          {CHANGE_LANES.map((lane) => {
            const bulk = laneMutation(lane);
            const rowAction = entryMutation(lane);
            const bulkAllowed = bulk !== null && (bulk.op === "stage" ? canStage : canUnstage);
            const rowAllowed =
              rowAction !== null && (rowAction.op === "stage" ? canStage : canUnstage);
            return lanes[lane].length === 0 ? null : (
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
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>
                    {laneTitle(lane)} ({lanes[lane].length})
                  </span>
                  {bulkAllowed && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runPaths(
                          bulk.op,
                          lanes[lane].map((entry) => entry.path),
                          `${bulk.op === "stage" ? "Staging" : "Unstaging"} ${lanes[lane].length} paths`,
                        )
                      }
                      style={{ ...control, padding: "1px 6px", fontSize: 11 }}
                    >
                      {bulk.label}
                    </button>
                  )}
                </h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {lanes[lane].map((entry) => (
                    <li key={entry.path} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        type="button"
                        aria-current={
                          selected?.path === entry.path && selected.lane === lane
                            ? "true"
                            : undefined
                        }
                        onClick={() => select(entry.path, lane)}
                        style={{
                          flex: 1,
                          minWidth: 0,
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
                      {rowAllowed && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runPaths(
                              rowAction.op,
                              [entry.path],
                              `${rowAction.op === "stage" ? "Staging" : "Unstaging"} ${entry.path}`,
                            )
                          }
                          style={{ ...control, padding: "1px 6px", fontSize: 11, flexShrink: 0 }}
                        >
                          {rowAction.label}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {canCommit && (
            <section aria-label="Commit" style={{ marginTop: 4, marginBottom: 8 }}>
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
                Commit
              </h3>
              {status.local?.isDefaultRef === true && (
                <p
                  style={{
                    margin: 0,
                    padding: "2px 6px",
                    fontSize: 11,
                    color: "var(--warning, #b54708)",
                  }}
                >
                  Warning: committing on the default branch
                </p>
              )}
              <textarea
                aria-label="Commit message"
                value={commitMessage}
                disabled={busy}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
                rows={2}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  margin: "4px 0",
                  padding: "4px 6px",
                  font: "inherit",
                  fontSize: 12,
                  border: "1px solid var(--border, #dfe3e8)",
                  borderRadius: 5,
                  background: "transparent",
                  color: "inherit",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  disabled={busy || commit.disabled !== null}
                  onClick={runCommit}
                  style={control}
                >
                  {commit.label}
                </button>
                {commit.disabled !== null && (
                  <span style={{ color: muted, fontSize: 11 }}>{commit.disabled}</span>
                )}
              </div>
            </section>
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
            {canCreateRef && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px 4px",
                }}
              >
                <input
                  aria-label="New branch name"
                  value={newRefName}
                  disabled={busy}
                  onChange={(event) => setNewRefName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") runCreateRef();
                  }}
                  placeholder="New branch name"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    font: "inherit",
                    fontSize: 12,
                    padding: "3px 6px",
                    border: "1px solid var(--border, #dfe3e8)",
                    borderRadius: 5,
                    background: "transparent",
                    color: "inherit",
                  }}
                />
                <button
                  type="button"
                  disabled={busy || create.refName === null}
                  onClick={runCreateRef}
                  style={{ ...control, padding: "2px 6px", fontSize: 11, flexShrink: 0 }}
                >
                  Create &amp; switch
                </button>
              </div>
            )}
            {canCreateRef && create.disabled !== null && newRefName.trim() !== "" && (
              <output
                aria-label="Branch create status"
                style={{ display: "block", padding: "0 6px 4px", color: muted, fontSize: 11 }}
              >
                {create.disabled}
              </output>
            )}
            {refs.error !== null && (
              <output
                aria-label="Refs status"
                style={{ display: "block", padding: "4px 6px", color: muted, fontSize: 11 }}
              >
                {refs.error}
              </output>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((row) => {
                const switchState = refSwitchState(row, currentBranch);
                return (
                  <li
                    key={`${row.remote ?? ""}:${row.name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 6px",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.name}
                      {describeRef(row) !== "" && (
                        <span style={{ color: muted }}> — {describeRef(row)}</span>
                      )}
                    </span>
                    {canSwitchRef && !row.current && !switchState.ok && (
                      <span style={{ color: muted, fontSize: 11, flexShrink: 0 }}>
                        {switchState.reason}
                      </span>
                    )}
                    {canSwitchRef && switchState.ok && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runSwitchRef(refSwitchTarget(row))}
                        style={{ ...control, padding: "1px 6px", fontSize: 11, flexShrink: 0 }}
                      >
                        Switch
                      </button>
                    )}
                  </li>
                );
              })}
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
        Version Control on t3.vcs: status, staging lanes, stage/unstage/commit, and branch
        create/switch (t3.vcs/mutate). Pull/init/worktrees, pull requests, and diff rendering are
        deferred slices.
      </output>
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.2.0",
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
