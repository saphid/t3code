/**
 * Pure view-model for the Version Control panel skeleton (P10-A). Owns the
 * read-side model the view renders over the public `t3.vcs/*` contracts:
 * staging-lane grouping from `t3.vcs/changes` porcelain flags, the status
 * stream reduction, branch/upstream/ahead-behind text, refs rows, and the
 * repository-capability gate.
 *
 * Dispositions covered: vcs-diff-binding-disposition.md rows 1, 2, 3, 9,
 * 14, 17, 30. Mutations (stage/commit/branch/pull) are the B slice — the
 * lanes here are read-only by design. Types come from the SDK catalogue;
 * the private wire shapes and client-runtime atoms stay host-side.
 */
import type {
  VcsCapabilitiesResult,
  VcsChangeEntry,
  VcsListRefsResult,
  VcsRefEntry,
  VcsStatusLocal,
  VcsStatusRemote,
  VcsStatusStreamEvent,
} from "@t3tools/extension-sdk/catalogue";

/* ---------------- staging lanes (disposition row 3) ---------------- */

/**
 * Staging lanes rendered by the panel. `staged` and `changes` are
 * membership sets, not a partition: porcelain `MM` puts one path in both.
 * `conflicted` is exclusive by contract construction (the host parser
 * reports UU/AA/DD with all other flags false); `untracked` (`??`)
 * carries neither index flag.
 */
export type ChangeLane = "conflicted" | "staged" | "changes" | "untracked";

export const CHANGE_LANES: readonly ChangeLane[] = ["conflicted", "staged", "changes", "untracked"];

export interface LaneGroups {
  readonly conflicted: readonly VcsChangeEntry[];
  readonly staged: readonly VcsChangeEntry[];
  readonly changes: readonly VcsChangeEntry[];
  readonly untracked: readonly VcsChangeEntry[];
}

export const EMPTY_LANES: LaneGroups = {
  conflicted: [],
  staged: [],
  changes: [],
  untracked: [],
};

/** Group change entries into display lanes, preserving host order. */
export function lanesFromChanges(entries: readonly VcsChangeEntry[]): LaneGroups {
  const groups: {
    conflicted: VcsChangeEntry[];
    staged: VcsChangeEntry[];
    changes: VcsChangeEntry[];
    untracked: VcsChangeEntry[];
  } = { conflicted: [], staged: [], changes: [], untracked: [] };
  for (const entry of entries) {
    if (entry.conflicted) groups.conflicted.push(entry);
    if (entry.staged) groups.staged.push(entry);
    if (entry.unstaged) groups.changes.push(entry);
    if (entry.untracked) groups.untracked.push(entry);
    // A contract-valid entry always sets at least one flag; an entry with
    // none would vanish from every lane, so keep it visible under changes
    // rather than silently dropping a reported path.
    if (!entry.conflicted && !entry.staged && !entry.unstaged && !entry.untracked)
      groups.changes.push(entry);
  }
  return groups;
}

export function laneTitle(lane: ChangeLane): string {
  switch (lane) {
    case "conflicted":
      return "Merge conflicts";
    case "staged":
      return "Staged changes";
    case "changes":
      return "Changes";
    case "untracked":
      return "Untracked files";
  }
}

export function laneCount(lanes: LaneGroups): number {
  return (
    lanes.conflicted.length + lanes.staged.length + lanes.changes.length + lanes.untracked.length
  );
}

/** State flags of one entry as a short label, e.g. "staged, modified". */
export function describeEntry(entry: VcsChangeEntry): string {
  if (entry.conflicted) return "conflicted";
  if (entry.untracked) return "untracked";
  if (entry.staged && entry.unstaged) return "staged, also modified";
  if (entry.staged) return "staged";
  if (entry.unstaged) return "modified";
  return "changed";
}

/* ---------------- selection ---------------- */

export interface ChangeSelection {
  readonly path: string;
  readonly lane: ChangeLane;
}

/**
 * Keep a selection across refreshes: same lane when the path stayed, the
 * first lane (in CHANGE_LANES order) when it moved — e.g. a file staged
 * outside the panel — and null once the path is clean.
 */
export function retainSelection(
  selection: ChangeSelection | null,
  lanes: LaneGroups,
): ChangeSelection | null {
  if (selection === null) return null;
  if (lanes[selection.lane].some((entry) => entry.path === selection.path)) return selection;
  for (const lane of CHANGE_LANES) {
    if (lanes[lane].some((entry) => entry.path === selection.path)) {
      return { path: selection.path, lane };
    }
  }
  return null;
}

/* ---------------- status stream model (rows 1, 2, 17) ---------------- */

export interface StatusModel {
  readonly local: VcsStatusLocal | null;
  readonly remote: VcsStatusRemote | null;
  readonly stream: "connecting" | "live" | "ended";
  readonly detail: string | null;
  /**
   * Bumped on every local-carrying frame (snapshot, localUpdated). The
   * changes/refs lists re-read on it — the host stream is the freshness
   * signal, the panel never polls.
   */
  readonly localRevision: number;
}

export const CONNECTING_STATUS: StatusModel = {
  local: null,
  remote: null,
  stream: "connecting",
  detail: null,
  localRevision: 0,
};

/**
 * Fold a `t3.vcs/status` stream event into the displayed model — the same
 * merge the native client applies (shared/git.ts applyGitStatusStreamEvent)
 * re-derived over the public `kind`-tagged event shape.
 */
export function applyStatusEvent(model: StatusModel, event: VcsStatusStreamEvent): StatusModel {
  switch (event.kind) {
    case "snapshot":
      return {
        local: event.local,
        remote: event.remote,
        stream: "live",
        detail: null,
        localRevision: model.localRevision + 1,
      };
    case "localUpdated":
      return {
        ...model,
        local: event.local,
        stream: "live",
        localRevision: model.localRevision + 1,
      };
    case "remoteUpdated":
      return { ...model, remote: event.remote };
    case "closed":
      return {
        ...model,
        stream: "ended",
        detail:
          event.reason === "overflow"
            ? "The status stream overflowed its event queue."
            : "The status stream reported a status error.",
      };
  }
}

export function branchLabel(local: VcsStatusLocal): string {
  return local.refName ?? "detached HEAD";
}

/** Upstream sync text for the header (row 17 — incl. the default-ref fallback). */
export function syncLabel(remote: VcsStatusRemote | null): string {
  if (remote === null) return "upstream pending";
  if (!remote.hasUpstream) {
    const ahead = remote.aheadOfDefaultCount;
    return ahead !== undefined && ahead > 0 ? `↑${ahead} vs default branch` : "no upstream";
  }
  if (remote.aheadCount === 0 && remote.behindCount === 0) return "in sync with upstream";
  const parts: string[] = [];
  if (remote.aheadCount > 0) parts.push(`↑${remote.aheadCount}`);
  if (remote.behindCount > 0) parts.push(`↓${remote.behindCount}`);
  return parts.join(" ") + " vs upstream";
}

/** Working-tree summary, e.g. "3 files changed (+12 −4)" or "clean". */
export function workingTreeLabel(local: VcsStatusLocal): string {
  const tree = local.workingTree;
  if (!local.hasWorkingTreeChanges && tree.files.length === 0) return "clean";
  const count = tree.files.length;
  const stat = `+${tree.insertions} −${tree.deletions}`;
  return `${count} file${count === 1 ? "" : "s"} changed (${stat})${tree.truncated ? ", list truncated" : ""}`;
}

/** Per-path numstat from the status payload, when the host reported one. */
export function numstatFor(
  local: VcsStatusLocal | null,
  path: string,
): { readonly insertions: number; readonly deletions: number } | null {
  const file = local?.workingTree.files.find((entry) => entry.path === path);
  return file ? { insertions: file.insertions, deletions: file.deletions } : null;
}

/** One-line status for the footer/header, honest about every panel state. */
export function describeStatus(model: StatusModel): string {
  if (model.stream === "ended") return `Status updates ended — ${model.detail ?? "stream closed"}`;
  if (model.local === null) return "Reading repository status…";
  if (!model.local.isRepo) return "This workspace is not a repository";
  const pr = model.remote?.pr;
  const parts = [branchLabel(model.local), syncLabel(model.remote), workingTreeLabel(model.local)];
  if (pr) parts.push(`PR #${pr.number} ${pr.state}`);
  return parts.join(" — ");
}

/* ---------------- refs (rows 9, 14) ---------------- */

export interface RefRow {
  readonly name: string;
  readonly current: boolean;
  readonly isDefault: boolean;
  readonly remote: string | null;
  readonly worktreePath: string | null;
}

/** Project the refs payload to display rows; remote refs carry `remote/name`. */
export function refRows(result: VcsListRefsResult | null): readonly RefRow[] {
  if (result === null) return [];
  return result.refs.map((ref: VcsRefEntry) => ({
    name: ref.name,
    current: ref.current,
    isDefault: ref.isDefault,
    remote: ref.isRemote ? (ref.remoteName ?? "remote") : null,
    worktreePath: ref.worktreePath,
  }));
}

/** Trailing badges for one ref row, e.g. "current · worktree". */
export function describeRef(row: RefRow): string {
  const badges: string[] = [];
  if (row.current) badges.push("current");
  if (row.isDefault) badges.push("default");
  if (row.remote !== null) badges.push(row.remote);
  if (row.worktreePath !== null) badges.push("worktree");
  return badges.join(" · ");
}

/* ---------------- repository capability gate (row 30) ---------------- */

export type RepositoryState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | { readonly kind: "no-repository"; readonly detail: string | null }
  | { readonly kind: "unsupported"; readonly driverKind: string; readonly detail: string }
  | { readonly kind: "ready"; readonly capabilities: VcsCapabilitiesResult };

/**
 * The honesty gate: `repository.getCapabilities` decides whether the panel
 * renders real state, a real empty state, or a named unsupported driver —
 * never a fabricated clean repo. A detected driver must serve the four
 * reads this slice consumes before the panel calls itself ready.
 */
export function repositoryState(
  capabilities: VcsCapabilitiesResult | null,
  error: string | null,
): RepositoryState {
  if (error !== null) return { kind: "unavailable", detail: error };
  if (capabilities === null) return { kind: "loading" };
  if (!capabilities.detected) {
    return { kind: "no-repository", detail: capabilities.detail };
  }
  const ops = capabilities.operations;
  const required = ["status.get", "status.subscribe", "changes.list", "refs.list"] as const;
  if (required.some((operation) => !ops[operation])) {
    const kind = capabilities.kind ?? "unknown";
    return {
      kind: "unsupported",
      driverKind: kind,
      detail: `The detected ${kind} driver does not serve every status/changes/refs read this panel needs.`,
    };
  }
  return { kind: "ready", capabilities };
}
