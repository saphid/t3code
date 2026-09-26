/**
 * Per-project URL history over the public `t3.browser/history` contract —
 * the same list the native preview keeps per project, so a visit in one
 * thread is a recent in every thread of the project and outlives the thread.
 *
 * The view's own `session.save` list (`historyStore.ts`) stays the fallback:
 * until the project list arrives, and whenever the contract cannot serve it,
 * the panel shows its own rows. A failure is a named state, never a spinner.
 */
import {
  BROWSER_READ_HISTORY,
  BROWSER_RECORD_HISTORY,
  type BrowserHistoryList,
} from "@t3tools/extension-sdk/catalogue";

import { type BrowserHistoryEntry, sanitizeHistoryEntries } from "./historyStore.ts";

export type ProjectHistoryState =
  /** No project list yet — the view shows its own rows, without a spinner. */
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly entries: readonly BrowserHistoryEntry[] }
  /** The contract cannot serve this view; its own rows stand in, and say so. */
  | { readonly kind: "unavailable"; readonly message: string };

type HistoryOp = "list" | "record" | "setTitle" | "remove";

/** The structural shape `bindApi(browserHistoryApi, …)` returns — tests inject a fake. */
export interface ProjectHistoryApi {
  invoke(
    method: "list",
    input: Record<string, never>,
    signal: AbortSignal,
  ): Promise<BrowserHistoryList>;
  invoke(
    method: "record" | "remove",
    input: { url: string },
    signal: AbortSignal,
  ): Promise<BrowserHistoryList>;
  invoke(
    method: "setTitle",
    input: { url: string; title: string },
    signal: AbortSignal,
  ): Promise<BrowserHistoryList>;
}

/**
 * A failed op → named state. The broker names a missing grant as
 * `API capability denied: <grant>`; a host with no connected history
 * provider (or any other failure) is reported with its detail.
 */
export function projectHistoryErrorState(
  op: HistoryOp,
  error: unknown,
): Extract<ProjectHistoryState, { readonly kind: "unavailable" }> {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("capability denied")) {
    const named = /capability denied: (\S+)/.exec(text)?.[1];
    // Reads need the read grant; writes need both, and the broker names the first missing.
    const grant = named ?? (op === "list" ? BROWSER_READ_HISTORY : BROWSER_RECORD_HISTORY);
    return {
      kind: "unavailable",
      message: `Showing this view's history only — this installation is missing the ${grant} grant.`,
    };
  }
  return {
    kind: "unavailable",
    message: `Showing this view's history only — project history is unavailable${text ? ` (${text.slice(0, 300)})` : ""}.`,
  };
}

/**
 * The rows the recents list renders: the project list once it has arrived,
 * otherwise the view's own list.
 */
export function displayedHistory(
  state: ProjectHistoryState,
  own: readonly BrowserHistoryEntry[],
): readonly BrowserHistoryEntry[] {
  return state.kind === "ready" ? state.entries : own;
}

/**
 * Issues history ops for one view. Every op answers with the whole list, so
 * the latest-issued answer is the truth: an older answer that lands late is
 * dropped, and nothing is reported after `signal` aborts.
 */
export function createProjectHistory(
  api: ProjectHistoryApi,
  signal: AbortSignal,
  onState: (state: ProjectHistoryState) => void,
) {
  let issued = 0;
  const run = (op: HistoryOp, request: (signal: AbortSignal) => Promise<BrowserHistoryList>) => {
    const sequence = ++issued;
    const current = () => !signal.aborted && sequence === issued;
    void request(signal).then(
      (result) => {
        if (current()) onState({ kind: "ready", entries: sanitizeHistoryEntries(result?.entries) });
      },
      (error) => {
        if (current()) onState(projectHistoryErrorState(op, error));
      },
    );
  };
  return {
    refresh: () => run("list", (abort) => api.invoke("list", {}, abort)),
    record: (url: string) => run("record", (abort) => api.invoke("record", { url }, abort)),
    setTitle: (url: string, title: string) =>
      run("setTitle", (abort) => api.invoke("setTitle", { url, title }, abort)),
    remove: (url: string) => run("remove", (abort) => api.invoke("remove", { url }, abort)),
  };
}

export type ProjectHistory = ReturnType<typeof createProjectHistory>;

/**
 * The page title native writes back once a recorded page loads: only a
 * loaded page with a title, never a workspace-file presentation. Returns the
 * `url`/`title` pair to send, or null.
 */
export function titleUpdate(
  navigation: { readonly kind: string; readonly url: string | null; readonly title: string } | null,
  presentingFile: boolean,
  isLeaseUrl: (url: string) => boolean,
): { readonly url: string; readonly title: string } | null {
  if (!navigation || navigation.kind !== "loaded" || presentingFile) return null;
  const { url, title } = navigation;
  if (!url || !title.trim() || isLeaseUrl(url)) return null;
  return { url, title };
}
