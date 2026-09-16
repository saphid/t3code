/**
 * The pull-request browser — the Version Control panel's primary
 * surface (the native surface is a PR browser; rows 18–21 of
 * vcs-diff-binding-disposition.md). Everything here reads through the
 * public `t3.prs/read` contract: the capability gate names unavailable
 * states, the list sends state/involvement/search to the host, detail
 * sections load independently so one failing read cannot blank the
 * rest, and `streamDiff` frames verify before a single byte renders.
 *
 * Mutations are a later control contract — the panel renders the named
 * deferral, never fake controls.
 */
import {
  prsReadApi,
  type PrsActivity,
  type PrsCapabilitiesResult,
  type PrsCheck,
  type PrsComment,
  type PrsDetail,
  type PrsLinkedThreadsResult,
  type PrsListEntry,
  type PrsListResult,
  type PrsOperationsSupport,
  type PrsRef,
  type PrsReviewThread,
  type PrsStack,
  type PrsThreadComment,
} from "@t3tools/extension-sdk/catalogue";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  PRS_INVOLVEMENTS,
  PRS_LIST_STATES,
  PRS_MUTATIONS_DEFERRED,
  collectPrsDiffStream,
  displayPath,
  changeTypeLabel,
  fileRows,
  fileStatLabel,
  formatRelativeTime,
  mergePrsDiffSegment,
  mergePrsEntries,
  prsActorLabel,
  prsAuthoredByViewer,
  prsChecksLabel,
  prsChecksSummary,
  prsCheckStatusLabel,
  prsGate,
  prsListHasMore,
  prsListInput,
  prsMergeabilityLabel,
  prsOmittedFilesLabel,
  prsProviderLabel,
  prsRefKey,
  prsRefreshClosedLabel,
  prsReviewLabel,
  prsReviewVerdictLabel,
  prsRowMeta,
  prsStackLabel,
  prsThreadAnchor,
  prsThreadMoreLabel,
  prsThreadStateLabel,
  prsUnavailableLabel,
  renderableFromPatch,
  type DiffFileRow,
  type PrsDiffDelivery,
  type PrsInvolvement,
  type PrsListState,
} from "./prsViewModel.js";

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

const iconButton = { ...control, padding: "2px 6px", fontSize: 11 } as const;

const inputStyle = {
  flex: 1,
  minWidth: 0,
  font: "inherit",
  fontSize: 12,
  padding: "3px 6px",
  border: "1px solid var(--border, #dfe3e8)",
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
} as const;

const noteStyle = {
  margin: 0,
  padding: "4px 10px",
  color: muted,
  fontSize: 12,
} as const;

const headingStyle = {
  margin: 0,
  padding: "2px 10px",
  fontSize: 11,
  fontWeight: 600,
  color: muted,
  textTransform: "uppercase",
  letterSpacing: 0.4,
} as const;

/**
 * A paged tail can repeat a comment the head already carried (host-side
 * edits, retried pages) — merge by id so a duplicate never double-renders
 * or collides on a React key.
 */
const mergeThreadComments = (
  head: readonly PrsThreadComment[],
  tail: readonly PrsThreadComment[],
) => {
  const seen = new Set(head.map((comment) => comment.id));
  const merged = [...head];
  for (const comment of tail)
    if (!seen.has(comment.id)) {
      seen.add(comment.id);
      merged.push(comment);
    }
  return merged;
};

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/* ---------------- data hooks ---------------- */

/** One-shot `prs.getCapabilities`; the named gate decides what the panel may show. */
function usePrsCapabilities(
  host: ClientHost,
  session: ViewSession,
  visible: boolean,
  tick: number,
) {
  const [result, setResult] = useState<{
    key: number;
    capabilities: PrsCapabilitiesResult | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(prsReadApi, host, session.context)
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
              error: message(error, "Pull-request capabilities unavailable"),
            });
        },
      );
    return () => controller.abort();
  }, [host, session, visible, tick]);
  return result?.key === tick ? result : { capabilities: null, error: null };
}

/**
 * Host-driven freshness via `prs.subscribeRefreshes` — the panel never
 * polls. Each `refreshed` frame bumps the tick that re-reads list and
 * detail; `closed` frames resubscribe with the same bounded retry the
 * status stream uses, and an ended stream is named, not silent.
 */
function usePrsRefreshes(host: ClientHost, session: ViewSession, enabled: boolean) {
  const [state, setState] = useState<{ tick: number; live: boolean; detail: string | null }>({
    tick: 0,
    live: false,
    detail: null,
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt += 1) {
        let closed: string | null = null;
        try {
          const stream = bindStreamApi(prsReadApi, host, session.context).subscribe(
            "subscribeRefreshes",
            {},
            signal,
          );
          for await (const frame of stream) {
            if (signal.aborted) return;
            const event = frame.value;
            if (event.kind === "refreshed") {
              setState((prev) => ({ tick: prev.tick + 1, live: true, detail: null }));
            } else {
              closed = prsRefreshClosedLabel(event.reason);
              break;
            }
          }
        } catch (error) {
          if (!signal.aborted)
            setState((prev) => ({
              ...prev,
              live: false,
              detail: message(error, "Refresh stream unavailable"),
            }));
          return;
        }
        if (signal.aborted) return;
        if (closed === null) {
          setState((prev) => ({
            ...prev,
            live: false,
            detail: "Refresh stream ended unexpectedly.",
          }));
          return;
        }
        setState((prev) => ({ ...prev, live: false, detail: closed }));
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
      if (!signal.aborted)
        setState((prev) => ({
          ...prev,
          live: false,
          detail: "Refresh stream ended repeatedly.",
        }));
    })();
    return () => controller.abort();
  }, [host, session, enabled]);
  return state;
}

interface PrsListModel {
  readonly key: string;
  /** Query identity without the refresh tick — same question, newer ask. */
  readonly inputKey: string;
  readonly entries: readonly PrsListEntry[];
  readonly result: PrsListResult | null;
  readonly error: string | null;
  readonly pending: boolean;
  readonly loadingMore: boolean;
}

/**
 * `prs.list` with re-read + continuation: the key folds the input and
 * the refresh tick; each fresh read replaces entries in place, and
 * "load more" appends the next host-cursored page. Rows are displayed
 * only for the query that produced them — a filter change never shows
 * another question's rows, and a revision bump keeps the last answer
 * until the fresh page lands. A failed re-read keeps the last page of
 * the same query — same rule the staging lanes follow. In-flight
 * continuations are aborted on any key change and merge only into the
 * generation that requested them, so a late page can't contaminate a
 * newer query.
 */
function usePrsList(
  host: ClientHost,
  session: ViewSession,
  enabled: boolean,
  input: ReturnType<typeof prsListInput>,
  revision: string,
) {
  const inputKey = useMemo(() => JSON.stringify(input), [input]);
  const key = `${revision}|${inputKey}`;
  const [state, setState] = useState<PrsListModel | null>(null);
  const continuation = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(prsReadApi, host, session.context)
      .invoke("list", input, signal)
      .then(
        (result) => {
          if (!signal.aborted)
            setState(() => ({
              key,
              inputKey,
              // A re-read answers the same question — a row that left the
              // fresh page (a closed PR under the open filter, a renamed
              // search hit) must leave the list rather than linger stale.
              // Continuation pages merge on their own path in loadMore.
              entries: result.entries,
              result,
              error: null,
              pending: false,
              loadingMore: false,
            }));
        },
        (error) => {
          if (!signal.aborted)
            setState((prev) => ({
              key,
              inputKey,
              entries: prev?.inputKey === inputKey ? prev.entries : [],
              result: prev?.inputKey === inputKey ? prev.result : null,
              error: message(error, "Pull requests unavailable"),
              pending: false,
              loadingMore: false,
            }));
        },
      );
    return () => {
      controller.abort();
      // A continuation still in flight belongs to this generation.
      continuation.current?.abort();
      continuation.current = null;
    };
    // input identity is folded into key.
  }, [host, session, enabled, key, inputKey, input]);

  const loadMore = () => {
    if (
      state === null ||
      state.key !== key ||
      state.result === null ||
      !prsListHasMore(state.result)
    )
      return;
    const cursors = state.result.nextCursors;
    setState((prev) => (prev === null || prev.key !== key ? prev : { ...prev, loadingMore: true }));
    continuation.current?.abort();
    const controller = new AbortController();
    continuation.current = controller;
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(prsReadApi, host, session.context)
      .invoke("list", { ...input, cursors }, signal)
      .then(
        (page) => {
          if (!signal.aborted)
            setState((prev) =>
              prev === null || prev.key !== key
                ? prev
                : {
                    ...prev,
                    entries: mergePrsEntries(prev.entries, page.entries),
                    result: page,
                    loadingMore: false,
                  },
            );
        },
        (error) => {
          if (!signal.aborted)
            setState((prev) =>
              prev === null || prev.key !== key
                ? prev
                : { ...prev, error: message(error, "Next page unavailable"), loadingMore: false },
            );
        },
      )
      .finally(() => {
        if (continuation.current === controller) continuation.current = null;
        controller.abort();
      });
  };

  const sameQuestion = state !== null && state.inputKey === inputKey;
  return {
    entries: sameQuestion ? state.entries : [],
    result: sameQuestion ? state.result : null,
    error: state?.key === key ? state.error : null,
    pending: state?.key !== key || state.pending,
    loadingMore: state?.key === key ? state.loadingMore : false,
    loadMore,
  };
}

interface PrsDetailSections {
  key: string;
  /** PR identity — retention and display never cross this boundary. */
  refKey: string;
  detail: PrsDetail | null;
  detailError: string | null;
  activity: PrsActivity | null;
  activityError: string | null;
  linked: PrsLinkedThreadsResult | null;
  linkedError: string | null;
  stack: PrsStack | null;
  stackError: string | null;
}

const EMPTY_SECTIONS: Omit<PrsDetailSections, "key" | "refKey"> = {
  detail: null,
  detailError: null,
  activity: null,
  activityError: null,
  linked: null,
  linkedError: null,
  stack: null,
  stackError: null,
};

/**
 * The detail bundle: `detail`, `activity`, `linkedThreads`, and `stack`
 * read in parallel and settle independently — a denied or failing
 * section reports its own error instead of blanking the panel.
 */
function usePrsDetail(
  host: ClientHost,
  session: ViewSession,
  ref: PrsRef | null,
  operations: PrsOperationsSupport | null,
  revision: string,
) {
  const refKey = ref === null ? null : prsRefKey(ref);
  const key = refKey === null ? null : `${revision}|${refKey}`;
  const [sections, setSections] = useState<PrsDetailSections | null>(null);
  useEffect(() => {
    if (ref === null || refKey === null || key === null || operations === null) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const api = bindApi(prsReadApi, host, session.context);
    // Each section publishes as its own read settles — a slow or failing
    // read never withholds a sibling that already resolved. Retained
    // fields require the same PR (refKey): a failed re-read keeps
    // last-good data alongside its disclosed error, and nothing ever
    // crosses a selection boundary.
    const read = <T,>(
      field: "detail" | "activity" | "linked" | "stack",
      errorField: "detailError" | "activityError" | "linkedError" | "stackError",
      supported: boolean,
      run: () => Promise<T>,
    ) => {
      if (!supported) return;
      void run().then(
        (value) => {
          if (!signal.aborted)
            setSections((prev) => ({
              ...(prev?.refKey === refKey ? prev : { ...EMPTY_SECTIONS }),
              key,
              refKey,
              [field]: value,
              [errorField]: null,
            }));
        },
        (error: unknown) => {
          if (!signal.aborted)
            setSections((prev) => ({
              ...(prev?.refKey === refKey ? prev : { ...EMPTY_SECTIONS }),
              key,
              refKey,
              [errorField]: message(error, `${field} unavailable`),
            }));
        },
      );
    };
    read("detail", "detailError", operations["prs.detail"], () =>
      api.invoke("detail", ref, signal),
    );
    read("activity", "activityError", operations["prs.activity"], () =>
      api.invoke("activity", ref, signal),
    );
    read("linked", "linkedError", operations["prs.linkedThreads"], () =>
      api.invoke("linkedThreads", ref, signal),
    );
    read("stack", "stackError", operations["prs.stack"], () => api.invoke("stack", ref, signal));
    return () => controller.abort();
    // ref identity is folded into key.
  }, [host, session, ref, refKey, operations, key]);
  return sections?.refKey === refKey && refKey !== null
    ? sections
    : { key: key ?? "", refKey: refKey ?? "", ...EMPTY_SECTIONS };
}

type PrsDiffState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly detail: string }
  | { readonly status: "ready"; readonly delivery: PrsDiffDelivery; readonly loadingMore: boolean };

/** A stream failure as a named line — the same wording family the diff panel reports. */
function prsDiffFailure(detail: { readonly kind: string; readonly detail?: string }): string {
  switch (detail.kind) {
    case "protocol":
      return `Diff stream protocol error: ${detail.detail ?? "unknown"}`;
    case "incomplete":
      return `Diff stream ended before completing — ${detail.detail ?? "unknown"}. Refresh to retry.`;
    case "mismatch":
      return `Diff verification failed: ${detail.detail ?? "unknown"}. Nothing is shown.`;
    default:
      return "Diff stream unavailable";
  }
}

/**
 * `prs.streamDiff` → fold → sha256 verify → deliver. A truncated
 * manifest keeps `nextCursor`; "load more" resumes with that cursor as
 * a fresh, independently verified stream whose patch text appends.
 */
function usePrsDiff(
  host: ClientHost,
  session: ViewSession,
  ref: PrsRef | null,
  enabled: boolean,
  revision: string,
) {
  const refKey = ref === null ? null : prsRefKey(ref);
  const key = refKey === null ? null : `${revision}|${refKey}`;
  const [state, setState] = useState<{ key: string; value: PrsDiffState } | null>(null);
  useEffect(() => {
    if (!enabled || ref === null || key === null) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void collectPrsDiffStream(
      bindStreamApi(prsReadApi, host, session.context).subscribe("streamDiff", ref, signal),
      signal,
    ).then(
      (outcome) => {
        if (signal.aborted || outcome.kind === "cancelled") return;
        setState(
          outcome.kind === "verified"
            ? {
                key,
                value: {
                  status: "ready",
                  delivery: mergePrsDiffSegment(null, outcome.manifest, outcome.patch),
                  loadingMore: false,
                },
              }
            : { key, value: { status: "error", detail: prsDiffFailure(outcome) } },
        );
      },
      (error) => {
        if (!signal.aborted)
          setState({
            key,
            value: { status: "error", detail: message(error, "Diff stream unavailable") },
          });
      },
    );
    return () => controller.abort();
    // ref identity is folded into key.
  }, [host, session, ref, enabled, key]);

  const loadMore = () => {
    if (ref === null || state === null || state.key !== key || state.value.status !== "ready")
      return;
    const cursor = state.value.delivery.nextCursor;
    if (cursor === null) return;
    setState({ key: state.key, value: { ...state.value, loadingMore: true } });
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void collectPrsDiffStream(
      bindStreamApi(prsReadApi, host, session.context).subscribe(
        "streamDiff",
        { ...ref, cursor },
        signal,
      ),
      signal,
    )
      .then(
        (outcome) => {
          if (signal.aborted || outcome.kind === "cancelled") return;
          setState((prev) => {
            if (prev === null || prev.key !== key || prev.value.status !== "ready") return prev;
            // A failed continuation keeps the verified segments — the
            // panel reports the failure and still shows what verified.
            if (outcome.kind !== "verified")
              return {
                key: prev.key,
                value: { status: "error", detail: prsDiffFailure(outcome) },
              };
            return {
              key: prev.key,
              value: {
                status: "ready",
                delivery: mergePrsDiffSegment(prev.value.delivery, outcome.manifest, outcome.patch),
                loadingMore: false,
              },
            };
          });
        },
        (error) => {
          if (!signal.aborted)
            setState((prev) =>
              prev === null || prev.key !== key
                ? prev
                : {
                    key: prev.key,
                    value: { status: "error", detail: message(error, "Diff stream unavailable") },
                  },
            );
        },
      )
      .finally(() => controller.abort());
  };

  const value = state?.key === key ? state.value : { status: "loading" as const };
  return { diff: value, loadMore };
}

/** Debounce the search text so each keystroke is not a host query. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ---------------- list ---------------- */

function badge(text: string, tone: "open" | "closed" | "merged" | "muted") {
  const colors: Record<string, string> = {
    open: "var(--success, #2da44e)",
    closed: "var(--muted-foreground, #667085)",
    merged: "var(--info, #8250df)",
    muted: "var(--muted-foreground, #667085)",
  };
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 10,
        padding: "0 5px",
        borderRadius: 8,
        border: `1px solid ${colors[tone]}`,
        color: colors[tone],
      }}
    >
      {text}
    </span>
  );
}

function stateBadge(entry: { readonly state: string; readonly isDraft?: boolean }) {
  if (entry.state === "open" && entry.isDraft) return badge("Draft", "muted");
  if (entry.state === "open") return badge("Open", "open");
  if (entry.state === "merged") return badge("Merged", "merged");
  return badge("Closed", "closed");
}

function PrListRow(props: {
  entry: PrsListEntry;
  viewers: Readonly<Record<string, string>>;
  onSelect: () => void;
}) {
  const { entry, viewers, onSelect } = props;
  const review = prsReviewLabel(entry.reviewDecision);
  const checks = prsChecksLabel(entry.checksState);
  const stack = prsStackLabel(entry.stack);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          font: "inherit",
          fontSize: 12,
          padding: "5px 8px",
          border: "1px solid transparent",
          borderRadius: 5,
          cursor: "pointer",
          color: "var(--foreground, #20252d)",
          background: "transparent",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {stateBadge(entry)}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.title}
          </span>
          {entry.viewerReviewRequested && badge("Review requested", "open")}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            marginTop: 2,
            fontSize: 11,
            color: muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {prsRowMeta(entry)}
            {prsAuthoredByViewer(entry, viewers) ? " · you" : ""}
          </span>
          {review !== null && badge(review, review === "Approved" ? "open" : "closed")}
          {checks !== null &&
            badge(
              checks,
              entry.checksState === "passing"
                ? "open"
                : entry.checksState === "failing"
                  ? "closed"
                  : "muted",
            )}
          {stack !== null && badge(stack, "merged")}
        </span>
        {entry.labels.length > 0 && (
          <span
            style={{
              display: "flex",
              gap: 4,
              marginTop: 3,
              flexWrap: "wrap",
            }}
          >
            {entry.labels.map((label) => (
              <span
                key={label.name}
                style={{
                  fontSize: 10,
                  padding: "0 5px",
                  borderRadius: 8,
                  border: "1px solid var(--border, #dfe3e8)",
                  color: muted,
                }}
              >
                {label.name}
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

/* ---------------- detail ---------------- */

function metaRow(label: string, value: string) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "1px 0", fontSize: 12 }}>
      <span style={{ width: 110, flexShrink: 0, color: muted }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

function CheckRow({ check }: { check: PrsCheck }) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        padding: "2px 10px",
        fontSize: 12,
      }}
    >
      <span
        style={{
          color:
            check.status === "success"
              ? "var(--success, #2da44e)"
              : check.status === "failure" || check.status === "action-required"
                ? "var(--destructive, #b42318)"
                : muted,
          flexShrink: 0,
        }}
      >
        {prsCheckStatusLabel(check.status)}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{check.name}</span>
      {check.description !== null && (
        <span
          style={{
            color: muted,
            fontSize: 11,
            flexShrink: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {check.description}
        </span>
      )}
    </li>
  );
}

function CommentRow({ comment }: { comment: PrsComment }) {
  const verdict = prsReviewVerdictLabel(comment.reviewState);
  return (
    <li
      style={{ padding: "4px 10px", fontSize: 12, borderTop: "1px solid var(--border, #f0f2f5)" }}
    >
      <div style={{ color: muted, fontSize: 11 }}>
        {prsActorLabel(comment.author)}
        {verdict !== null ? ` ${verdict}` : comment.kind === "review" ? " reviewed" : " commented"}
        {comment.path !== null ? ` on ${comment.path}` : ""} ·{" "}
        {formatRelativeTime(comment.createdAt)}
        {comment.url !== null ? ` — ${comment.url}` : ""}
      </div>
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 2 }}>
        {comment.body}
      </div>
      {comment.reactions !== undefined && comment.reactions.length > 0 && (
        <div style={{ color: muted, fontSize: 11, marginTop: 2 }}>
          {comment.reactions.map((r) => `${r.content} ×${r.count}`).join(" · ")}
        </div>
      )}
    </li>
  );
}

function ReviewThreadSection(props: {
  thread: PrsReviewThread;
  canPage: boolean;
  onLoadMore: (thread: PrsReviewThread) => void;
  paging: boolean;
  /** The host cut the tail and issued no cursor — a lossy terminal state, named. */
  unrecoverable: boolean;
  /** A paged continuation failed; the cursor is preserved so the button retries it. */
  pageError: string | null;
}) {
  const { thread, canPage, onLoadMore, paging, unrecoverable, pageError } = props;
  return (
    <section
      aria-label={`Thread on ${prsThreadAnchor(thread)}`}
      style={{ borderTop: "1px solid var(--border, #f0f2f5)", paddingBottom: 4 }}
    >
      <h4 style={{ ...headingStyle, padding: "4px 10px 2px", textTransform: "none" }}>
        <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
          {prsThreadAnchor(thread)}
        </span>
        <span style={{ fontWeight: 400 }}> — {prsThreadStateLabel(thread)}</span>
      </h4>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {thread.comments.map((comment) => (
          <li key={comment.id} style={{ padding: "3px 10px", fontSize: 12 }}>
            <div style={{ color: muted, fontSize: 11 }}>
              {prsActorLabel(comment.author)} · {formatRelativeTime(comment.createdAt)}
              {comment.url !== null ? ` — ${comment.url}` : ""}
            </div>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 1 }}>
              {comment.body}
            </div>
            {comment.reactions !== undefined && comment.reactions.length > 0 && (
              <div style={{ color: muted, fontSize: 11, marginTop: 1 }}>
                {comment.reactions.map((r) => `${r.content} ×${r.count}`).join(" · ")}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canPage && prsThreadMoreLabel(thread) !== null && (
        <button
          type="button"
          disabled={paging}
          onClick={() => onLoadMore(thread)}
          style={{ ...iconButton, margin: "2px 10px" }}
        >
          {paging ? "Loading…" : prsThreadMoreLabel(thread)}
        </button>
      )}
      {canPage === false && thread.nextCommentsCursor !== undefined && (
        <p style={{ ...noteStyle, fontSize: 11 }}>
          More comments exist; paging is not supported by this host.
        </p>
      )}
      {pageError !== null && (
        <p role="alert" style={{ ...noteStyle, fontSize: 11 }}>
          {pageError} — retry with the button above.
        </p>
      )}
      {unrecoverable && (
        <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
          Some comments could not be shown — the host cut this thread's tail without a cursor.
        </p>
      )}
    </section>
  );
}

/* ---------------- diff ---------------- */

const diffRowBase = {
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
  color: muted,
  userSelect: "none" as const,
};

function PrsDiffRow({ row }: { row: ReturnType<typeof fileRows>[number] }) {
  if (row.kind === "gap") {
    return (
      <div
        style={{
          ...diffRowBase,
          justifyContent: "center",
          color: muted,
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
        ...diffRowBase,
        background: addition
          ? "color-mix(in srgb, var(--success, #2da44e) 14%, transparent)"
          : deletion
            ? "color-mix(in srgb, var(--destructive, #cf222e) 12%, transparent)"
            : "transparent",
      }}
    >
      <span style={gutter}>{deletion || row.kind === "context" ? row.oldLine : ""}</span>
      <span style={gutter}>{addition || row.kind === "context" ? row.newLine : ""}</span>
      <span style={{ color: muted, userSelect: "none", width: 14 }}>
        {addition ? "+" : deletion ? "−" : " "}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{row.text}</span>
    </div>
  );
}

function PrsFileSection({ row }: { row: DiffFileRow }) {
  const [collapsed, setCollapsed] = useState(false);
  const rows = useMemo(
    () => (collapsed || row.binary || row.textless ? [] : fileRows(row)),
    [collapsed, row],
  );
  return (
    <section
      aria-label={displayPath(row)}
      style={{ borderTop: "1px solid var(--border, #f0f2f5)" }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 12,
        }}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${displayPath(row)}`}
          onClick={() => setCollapsed((value) => !value)}
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
      </header>
      {!collapsed && row.binary && (
        <p role="note" style={noteStyle}>
          {row.path} is a binary file — no text diff is available.
        </p>
      )}
      {!collapsed && row.textless && (
        <p role="note" style={noteStyle}>
          No textual changes in the patch for {displayPath(row)}.
        </p>
      )}
      {!collapsed && rows.map((line) => <PrsDiffRow key={line.ordinal} row={line} />)}
    </section>
  );
}

function PrsDiffSection(props: { diff: PrsDiffState; supported: boolean; onLoadMore: () => void }) {
  const { diff, supported, onLoadMore } = props;
  if (!supported) {
    return (
      <p role="note" style={noteStyle}>
        Diff streaming is not supported by this host (prs.streamDiff).
      </p>
    );
  }
  if (diff.status === "loading") {
    return <p style={noteStyle}>Streaming the verified diff…</p>;
  }
  if (diff.status === "error") {
    return (
      <p role="alert" style={noteStyle}>
        {diff.detail}
      </p>
    );
  }
  const { delivery } = diff;
  const renderable = renderableFromPatch(delivery.patch);
  return (
    <div>
      <p style={{ ...noteStyle, fontSize: 11 }}>
        {delivery.diffHashes[0] !== undefined
          ? `sha256 ${delivery.diffHashes[0].slice(0, 12)} · ${delivery.byteLength} bytes`
          : "empty diff"}
        {delivery.diffHashes.length > 1 ? ` · ${delivery.diffHashes.length} verified segments` : ""}
        {delivery.truncated ? " · truncated by the host" : ""}
      </p>
      {renderable === null && <p style={noteStyle}>The delivered diff is empty.</p>}
      {renderable !== null && renderable.kind === "raw" && (
        <div>
          <p style={noteStyle}>{renderable.reason}</p>
          <pre
            style={{
              margin: 0,
              padding: "4px 10px",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {renderable.text}
          </pre>
        </div>
      )}
      {renderable !== null && renderable.kind === "files" && (
        <div>
          {renderable.files.map((row) => (
            <PrsFileSection key={row.key} row={row} />
          ))}
        </div>
      )}
      {delivery.omittedFileStats.length > 0 && (
        <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
          {prsOmittedFilesLabel(delivery.omittedFileStats)}
        </p>
      )}
      {delivery.nextCursor !== null && (
        <button
          type="button"
          disabled={diff.loadingMore}
          onClick={onLoadMore}
          style={{ ...iconButton, margin: "4px 10px" }}
        >
          {diff.loadingMore ? "Loading…" : "Load remaining diff"}
        </button>
      )}
    </div>
  );
}

/* ---------------- panel ---------------- */

export function PullRequestsPanel(props: {
  host: ClientHost;
  session: ViewSession;
  visible: boolean;
  selected: PrsRef | null;
  onSelect: (ref: PrsRef | null) => void;
}) {
  const { host, session, visible, selected, onSelect } = props;
  const [tick, setTick] = useState(0);
  const [listState, setListState] = useState<PrsListState>("open");
  const [involvement, setInvolvement] = useState<PrsInvolvement>("all");
  const [query, setQuery] = useState("");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // One pending comment-page request per (scope, thread), keyed to the
  // activity head it serves — paging a second thread neither re-arms the
  // first thread's button nor lets one settle clear another's marker,
  // and a stale head's in-flight request never suppresses a fresh click.
  const [pagingThreads, setPagingThreads] = useState<ReadonlyMap<string, PrsActivity>>(new Map());
  // Paged-in comment tails keep the new cursor + truncation flag so a
  // thread pages forward instead of refetching the same page. Tails are
  // bound to the exact `activity` payload they extend — a re-read (new
  // object), a refresh, or a selection change retires them wholesale,
  // so a stale page can never append to a freshly read thread head. At
  // most one scope is retained; the next write replaces it.
  const [pagedThreads, setPagedThreads] = useState<{
    readonly scope: string;
    readonly activity: PrsActivity;
    readonly map: ReadonlyMap<
      string,
      {
        readonly comments: readonly PrsThreadComment[];
        readonly nextCursor: string | null;
        readonly truncated: boolean;
        readonly error: string | null;
      }
    >;
  } | null>(null);
  // Advances whenever the scope OR the activity payload changes; a page
  // that resolves under an older generation is dropped before it can
  // touch the map.
  const pagedGeneration = useRef({
    scope: null as string | null,
    activity: null as PrsActivity | null,
    generation: 0,
  });

  const { capabilities, error: capsError } = usePrsCapabilities(host, session, visible, tick);
  const gate = prsGate(capabilities, capsError);
  const ready = gate.kind === "ready";
  const ops = ready ? gate.operations : null;

  const refreshes = usePrsRefreshes(
    host,
    session,
    visible && ready && ops?.["prs.subscribeRefreshes"] === true,
  );
  // The re-read revision folds the manual refresh tick with the host's
  // own refresh events; either one re-reads list and detail.
  const revision = `${tick}:${refreshes.tick}`;

  const debouncedQuery = useDebounced(query, 250);
  const listInput = useMemo(
    () => prsListInput(listState, involvement, debouncedQuery),
    [listState, involvement, debouncedQuery],
  );
  const list = usePrsList(
    host,
    session,
    visible && ready && ops?.["prs.list"] === true,
    listInput,
    revision,
  );
  const sections = usePrsDetail(host, session, selected, ops, revision);
  const { diff, loadMore } = usePrsDiff(
    host,
    session,
    selected,
    visible && ready && selected !== null && ops?.["prs.streamDiff"] === true,
    revision,
  );

  const runInvalidate = () => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const api = bindApi(prsReadApi, host, session.context);
    // Listing freshness needs the empty invalidation; the selected PR's
    // detail cache needs its own reference — send both, and re-read only
    // after the host has actually invalidated.
    const invalidations = [api.invoke("invalidate", {}, signal)];
    if (selected !== null)
      invalidations.push(api.invoke("invalidate", { reference: selected }, signal));
    void Promise.all(invalidations)
      .then(
        () => {
          if (signal.aborted) return;
          setRefreshError(null);
          setTick((value) => value + 1);
        },
        (error) => {
          if (!signal.aborted) setRefreshError(message(error, "Pull-request refresh unavailable"));
        },
      )
      .finally(() => controller.abort());
  };

  const selectedKey = selected === null ? null : prsRefKey(selected);
  const pagedScope = selectedKey === null ? null : `${revision}\n${selectedKey}`;
  useEffect(() => {
    const current = pagedGeneration.current;
    if (current.scope !== pagedScope || current.activity !== sections.activity)
      pagedGeneration.current = {
        scope: pagedScope,
        activity: sections.activity,
        generation: current.generation + 1,
      };
  }, [pagedScope, sections.activity]);
  const loadThreadComments = (thread: PrsReviewThread) => {
    if (
      selected === null ||
      pagedScope === null ||
      sections.activity === null ||
      thread.nextCommentsCursor === undefined
    )
      return;
    const cursor = thread.nextCommentsCursor;
    const scope = pagedScope;
    const head = sections.activity;
    const generation = pagedGeneration.current.generation;
    const pendingKey = `${scope}\n${thread.id}`;
    // A second click while the same page is in flight would re-request the
    // identical cursor — the response would re-append the same comments.
    // A marker carrying an older head belongs to a dead generation and
    // must not suppress the click.
    if (pagingThreads.get(pendingKey) === head) return;
    setPagingThreads((prev) => new Map(prev).set(pendingKey, head));
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(prsReadApi, host, session.context)
      .invoke("threadComments", { ...selected, threadId: thread.id, cursor }, signal)
      .then(
        (page) => {
          if (signal.aborted || generation !== pagedGeneration.current.generation) return;
          setPagedThreads((prev) => {
            // Re-validate inside the updater: the response must answer the
            // live scope AND head. A stale-head response is dropped; a
            // current response replaces a stored map whose head is obsolete.
            const current = pagedGeneration.current;
            if (scope !== current.scope || head !== current.activity) return prev;
            const map = new Map(
              prev !== null && prev.scope === scope && prev.activity === head
                ? prev.map
                : undefined,
            );
            const prior = map.get(thread.id);
            map.set(thread.id, {
              comments: mergeThreadComments(prior?.comments ?? [], page.comments),
              nextCursor: page.nextCursor,
              truncated: page.truncated,
              error: null,
            });
            return { scope, activity: head, map };
          });
        },
        (error) => {
          if (signal.aborted || generation !== pagedGeneration.current.generation) return;
          // The fetched tail and the failed cursor survive — the failure
          // is named on the thread and the same button retries the page.
          setPagedThreads((prev) => {
            const current = pagedGeneration.current;
            if (scope !== current.scope || head !== current.activity) return prev;
            const map = new Map(
              prev !== null && prev.scope === scope && prev.activity === head
                ? prev.map
                : undefined,
            );
            const prior = map.get(thread.id);
            map.set(thread.id, {
              comments: prior?.comments ?? [],
              nextCursor: prior?.nextCursor ?? thread.nextCommentsCursor ?? null,
              truncated: prior?.truncated ?? false,
              error: message(error, "Comments unavailable"),
            });
            return { scope, activity: head, map };
          });
        },
      )
      .finally(() => {
        // Clear only this request's marker — a newer request for the same
        // thread under a different head must not lose its own entry.
        setPagingThreads((prev) => {
          if (prev.get(pendingKey) !== head) return prev;
          const next = new Map(prev);
          next.delete(pendingKey);
          return next;
        });
        controller.abort();
      });
  };

  const detail = sections.detail;
  const activity = sections.activity;

  return (
    <div
      aria-label="Pull requests"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border, #f0f2f5)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {selected === null ? (
          <>
            <span role="group" aria-label="State filter" style={{ display: "flex", gap: 2 }}>
              {PRS_LIST_STATES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={listState === option.value}
                  onClick={() => setListState(option.value)}
                  style={{
                    ...iconButton,
                    fontWeight: listState === option.value ? 600 : 400,
                    background:
                      listState === option.value ? "var(--accent, #e8eef7)" : "transparent",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </span>
            <select
              aria-label="Involvement"
              value={involvement}
              onChange={(event) => setInvolvement(event.target.value as PrsInvolvement)}
              style={{ ...control, padding: "2px 4px" }}
            >
              {PRS_INVOLVEMENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Search pull requests"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              style={{ ...inputStyle, maxWidth: 160 }}
            />
          </>
        ) : (
          <button type="button" onClick={() => onSelect(null)} style={control}>
            ← Pull requests
          </button>
        )}
        {ready && ops?.["prs.invalidate"] === true && (
          <button type="button" onClick={runInvalidate} style={control}>
            Refresh
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {gate.kind === "loading" && (
          <p role="note" style={noteStyle}>
            Reading pull-request capabilities…
          </p>
        )}
        {gate.kind === "error" && (
          <p role="alert" style={noteStyle}>
            Pull requests unavailable — {gate.detail}
          </p>
        )}
        {gate.kind === "unavailable" && (
          <div>
            <p role="alert" style={noteStyle}>
              {prsUnavailableLabel(gate.reason)}
              {gate.detail !== null ? ` — ${gate.detail}` : ""}
            </p>
            {gate.providers.map((provider) => (
              <p key={provider.host} style={{ ...noteStyle, fontSize: 11 }}>
                {prsProviderLabel(provider)}
              </p>
            ))}
          </div>
        )}

        {ready && (
          <>
            {refreshError !== null && (
              <p role="alert" style={{ ...noteStyle, fontSize: 11 }}>
                {refreshError}
              </p>
            )}
            {refreshes.detail !== null && (
              <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                {refreshes.detail}
              </p>
            )}

            {selected === null && (
              <div>
                {ops !== null && ops["prs.list"] !== true && (
                  <p role="note" style={noteStyle}>
                    Listing pull requests is not supported by this host (prs.list).
                  </p>
                )}
                {gate.providers.map((provider) => (
                  <p key={provider.host} style={{ ...noteStyle, fontSize: 11 }}>
                    {prsProviderLabel(provider)}
                  </p>
                ))}
                {list.error !== null && (
                  <p role="alert" style={noteStyle}>
                    {list.error}
                  </p>
                )}
                {list.result !== null &&
                  list.result.errors.map((entryError) => (
                    <p
                      key={entryError.projectId}
                      role="alert"
                      style={{ ...noteStyle, fontSize: 11 }}
                    >
                      {entryError.projectTitle}: {entryError.message}
                    </p>
                  ))}
                {list.result !== null && list.result.truncated && (
                  <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                    Results truncated by the host — narrow the search to see more.
                  </p>
                )}
                <ul style={{ listStyle: "none", margin: 0, padding: "2px 4px" }}>
                  {list.entries.map((prEntry) => (
                    <PrListRow
                      key={prsRefKey(prEntry)}
                      entry={prEntry}
                      viewers={list.result?.viewers ?? {}}
                      onSelect={() =>
                        onSelect({
                          host: prEntry.host,
                          repository: prEntry.repository,
                          number: prEntry.number,
                        })
                      }
                    />
                  ))}
                </ul>
                {!list.pending &&
                  list.error === null &&
                  list.result !== null &&
                  list.result.errors.length === 0 &&
                  list.entries.length === 0 &&
                  ops?.["prs.list"] === true && (
                    <p style={noteStyle}>
                      No {listState === "all" ? "" : `${listState} `}pull requests
                      {involvement !== "all" ? ` (${involvement})` : ""}
                      {debouncedQuery.trim() !== "" ? ` matching “${debouncedQuery.trim()}”` : ""}.
                    </p>
                  )}
                {list.pending && list.entries.length === 0 && (
                  <p style={noteStyle}>Reading pull requests…</p>
                )}
                {prsListHasMore(list.result) && (
                  <button
                    type="button"
                    disabled={list.loadingMore}
                    onClick={list.loadMore}
                    style={{ ...control, margin: "4px 10px" }}
                  >
                    {list.loadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            )}

            {selected !== null && (
              <div>
                {ops !== null && ops["prs.detail"] !== true && (
                  <p role="note" style={noteStyle}>
                    Pull-request detail is not supported by this host (prs.detail).
                  </p>
                )}
                {detail === null && sections.detailError === null && (
                  <p style={noteStyle}>Reading pull request…</p>
                )}
                {sections.detailError !== null && (
                  <p role="alert" style={noteStyle}>
                    {sections.detailError}
                    {detail !== null ? " — showing the last successful read." : ""}
                  </p>
                )}
                {detail !== null && (
                  <div>
                    <div style={{ padding: "6px 10px 2px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        {stateBadge(detail)}
                        <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                          {detail.title}
                        </strong>
                        <span style={{ color: muted, fontSize: 11 }}>
                          {detail.repository}#{detail.number}
                        </span>
                      </div>
                      <div style={{ color: muted, fontSize: 11, marginTop: 2 }}>{detail.url}</div>
                    </div>
                    <div style={{ padding: "4px 10px" }}>
                      {metaRow("Author", prsActorLabel(detail.author))}
                      {metaRow(
                        "Branches",
                        `${detail.headRepositoryNameWithOwner ?? detail.headBranch}:${detail.headBranch} → ${detail.baseBranch}`,
                      )}
                      {metaRow(
                        "Changes",
                        `+${detail.additions} −${detail.deletions} · ${detail.changedFiles} file${
                          detail.changedFiles === 1 ? "" : "s"
                        }`,
                      )}
                      {metaRow("Mergeability", prsMergeabilityLabel(detail.mergeability))}
                      {detail.baseComparison !== undefined &&
                        metaRow(
                          "Base",
                          detail.baseComparison === "behind"
                            ? `behind ${detail.baseBranch}${detail.behindBy !== undefined ? ` by ${detail.behindBy}` : ""}`
                            : detail.baseComparison,
                        )}
                      {detail.autoMergeEnabled === true &&
                        metaRow("Auto-merge", detail.autoMergeMethod ?? "enabled")}
                      {detail.workflowApprovalsRequired !== undefined &&
                        detail.workflowApprovalsRequired > 0 &&
                        metaRow(
                          "Approvals",
                          `${detail.workflowApprovalsRequired} workflow approval${
                            detail.workflowApprovalsRequired === 1 ? "" : "s"
                          } required`,
                        )}
                      {metaRow("Created", formatRelativeTime(detail.createdAt))}
                      {metaRow("Updated", formatRelativeTime(detail.updatedAt))}
                      {detail.mergedAt !== null &&
                        metaRow("Merged", formatRelativeTime(detail.mergedAt))}
                      {detail.closedAt !== null &&
                        metaRow("Closed", formatRelativeTime(detail.closedAt))}
                      {detail.reviewers.length > 0 &&
                        metaRow("Reviewers", detail.reviewers.map(prsActorLabel).join(", "))}
                      {detail.labels.length > 0 &&
                        metaRow("Labels", detail.labels.map((label) => label.name).join(", "))}
                    </div>
                    {detail.body !== "" && (
                      <pre
                        style={{
                          margin: "2px 10px",
                          padding: "6px 8px",
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                          background: "var(--muted, #f4f5f7)",
                          borderRadius: 5,
                          maxHeight: 220,
                          overflow: "auto",
                        }}
                      >
                        {detail.body}
                      </pre>
                    )}
                    {detail.bodyTruncated === true && (
                      <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                        Description truncated by the contract bound — read the rest on the host.
                      </p>
                    )}
                  </div>
                )}

                {sections.stackError !== null && (
                  <p role="alert" style={{ ...noteStyle, fontSize: 11 }}>
                    {sections.stackError}
                  </p>
                )}
                {ops !== null && ops["prs.stack"] !== true && (
                  <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                    Stack information is not supported by this host (prs.stack).
                  </p>
                )}
                {sections.stack !== null && sections.stack.layers.length > 0 && (
                  <section aria-label="Stack" style={{ paddingBottom: 4 }}>
                    <h3 style={headingStyle}>
                      Stack — base {sections.stack.base} ({sections.stack.layers.length})
                    </h3>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {sections.stack.layers.map((layer) => (
                        <li
                          key={layer.number}
                          style={{ padding: "2px 10px", fontSize: 12, color: muted }}
                        >
                          #{layer.number} {layer.title ?? ""}
                          <span> — {layer.isDraft === true ? "draft" : layer.state}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section aria-label="Checks" style={{ paddingBottom: 4 }}>
                  <h3 style={headingStyle}>
                    Checks
                    {detail !== null && prsChecksSummary(detail.checks) !== null
                      ? ` — ${prsChecksSummary(detail.checks)}`
                      : ""}
                  </h3>
                  {detail !== null && detail.checks.length === 0 && (
                    <p style={{ ...noteStyle, fontSize: 11 }}>No checks reported.</p>
                  )}
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {detail?.checks.map((check) => (
                      <CheckRow
                        key={`${check.name}:${check.status}:${check.url ?? ""}`}
                        check={check}
                      />
                    ))}
                  </ul>
                </section>

                <section aria-label="Linked threads" style={{ paddingBottom: 4 }}>
                  <h3 style={headingStyle}>Linked threads</h3>
                  {ops !== null && ops["prs.linkedThreads"] !== true && (
                    <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                      Linked threads are not supported by this host.
                    </p>
                  )}
                  {sections.linkedError !== null && (
                    <p role="alert" style={{ ...noteStyle, fontSize: 11 }}>
                      {sections.linkedError}
                    </p>
                  )}
                  {sections.linked !== null && sections.linked.threads.length === 0 && (
                    <p style={{ ...noteStyle, fontSize: 11 }}>No linked threads.</p>
                  )}
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {sections.linked?.threads.map((thread) => (
                      <li key={thread.id} style={{ padding: "2px 10px", fontSize: 12 }}>
                        {thread.title}
                        <span style={{ color: muted, fontSize: 11 }}>
                          {" "}
                          — {thread.id}
                          {thread.archivedAt !== null ? " · archived" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {sections.linked?.truncated === true && (
                    <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                      Linked-thread list truncated.
                    </p>
                  )}
                </section>

                {ops !== null && ops["prs.activity"] !== true && (
                  <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                    Review threads and comments are not supported by this host (prs.activity).
                  </p>
                )}
                {sections.activityError !== null && (
                  <p role="alert" style={{ ...noteStyle, fontSize: 11 }}>
                    {sections.activityError}
                  </p>
                )}
                {activity !== null && (
                  <>
                    <section aria-label="Review threads" style={{ paddingBottom: 4 }}>
                      <h3 style={headingStyle}>
                        Review threads
                        {activity.reviewThreads.length > 0
                          ? ` (${activity.reviewThreads.length})`
                          : ""}
                      </h3>
                      {activity.reviewThreads.length === 0 && (
                        <p style={{ ...noteStyle, fontSize: 11 }}>No review threads.</p>
                      )}
                      {activity.reviewThreads.map((thread) => {
                        const paged =
                          pagedThreads !== null &&
                          pagedThreads.scope === pagedScope &&
                          pagedThreads.activity === activity
                            ? pagedThreads.map.get(thread.id)
                            : undefined;
                        const merged: PrsReviewThread =
                          paged === undefined
                            ? thread
                            : {
                                ...thread,
                                comments: mergeThreadComments(thread.comments, paged.comments),
                                nextCommentsCursor: paged.nextCursor ?? undefined,
                              };
                        return (
                          <ReviewThreadSection
                            key={thread.id}
                            thread={merged}
                            canPage={ops?.["prs.threadComments"] === true}
                            paging={
                              pagedScope !== null &&
                              pagingThreads.get(`${pagedScope}\n${thread.id}`) === activity
                            }
                            unrecoverable={
                              paged !== undefined
                                ? paged.truncated && paged.nextCursor === null
                                : thread.nextCommentsCursor === undefined &&
                                  thread.commentCount !== undefined &&
                                  thread.commentCount > thread.comments.length
                            }
                            pageError={paged?.error ?? null}
                            onLoadMore={loadThreadComments}
                          />
                        );
                      })}
                    </section>

                    <section aria-label="Comments" style={{ paddingBottom: 4 }}>
                      <h3 style={headingStyle}>
                        Comments{activity.commentCount > 0 ? ` (${activity.commentCount})` : ""}
                      </h3>
                      {activity.comments.length === 0 && (
                        <p style={{ ...noteStyle, fontSize: 11 }}>No comments.</p>
                      )}
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {activity.comments.map((comment) => (
                          <CommentRow key={comment.id} comment={comment} />
                        ))}
                      </ul>
                      {activity.commentsTruncated && (
                        <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                          Comment list truncated by the host.
                        </p>
                      )}
                    </section>

                    {activity.commits.length > 0 && (
                      <section aria-label="Commits" style={{ paddingBottom: 4 }}>
                        <h3 style={headingStyle}>Commits ({activity.commits.length})</h3>
                        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                          {activity.commits.map((commit) => (
                            <li key={commit.oid} style={{ padding: "2px 10px", fontSize: 12 }}>
                              <span
                                style={{
                                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                                  color: muted,
                                  fontSize: 11,
                                }}
                              >
                                {commit.oid.slice(0, 8)}
                              </span>{" "}
                              {commit.messageHeadline}
                              <span style={{ color: muted, fontSize: 11 }}>
                                {" "}
                                · {formatRelativeTime(commit.committedDate)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {activity.truncated && (
                      <p role="note" style={{ ...noteStyle, fontSize: 11 }}>
                        Activity truncated — some comments, threads, or commits were not delivered.
                      </p>
                    )}
                  </>
                )}

                <section aria-label="Diff" style={{ paddingBottom: 4 }}>
                  <h3 style={headingStyle}>Diff</h3>
                  <PrsDiffSection
                    diff={diff}
                    supported={ops?.["prs.streamDiff"] === true}
                    onLoadMore={loadMore}
                  />
                </section>

                <p role="note" style={{ ...noteStyle, fontSize: 11, paddingBottom: 8 }}>
                  {PRS_MUTATIONS_DEFERRED}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
