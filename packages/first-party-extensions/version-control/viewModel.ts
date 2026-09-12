/**
 * Pure view-model for the Version Control panel (P10-A reads, P10-B
 * mutations). Owns the model the view renders over the public `t3.vcs/*`
 * contracts: staging-lane grouping from `t3.vcs/changes` porcelain flags,
 * the status stream reduction, branch/upstream/ahead-behind text, refs
 * rows, the repository-capability gate, and the mutation controls —
 * per-row/per-lane stage actions, the commit plan, ref create/switch
 * gating, and the single-flight mutation state.
 *
 * Dispositions covered: vcs-diff-binding-disposition.md rows 1, 2, 3, 4,
 * 5, 7 (message-commit half), 9, 10, 11, 14, 17, 30, 32. Types come from
 * the SDK catalogue; the private wire shapes and client-runtime atoms
 * stay host-side.
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

/* ---------------- mutation controls (rows 4, 5, 7, 10, 11, 32) ---------------- */

/**
 * The mutation operations this slice invokes. `stage`/`unstage`/`commit`
 * map to `t3.vcs/changes` methods, `ref-create`/`ref-switch` to
 * `t3.vcs/refs` methods — all `effect:"write"` under `t3.vcs/mutate`.
 */
export type MutationOp = "stage" | "unstage" | "commit" | "ref-create" | "ref-switch";

/** The contract's vcsPathsInput bound — stage/unstage chunk to it, commit cannot exceed it. */
export const VCS_PATHS_MAX = 100;

export interface LaneMutation {
  readonly op: "stage" | "unstage";
  readonly label: string;
}

/**
 * The bulk action a lane header offers (native parity: the lanes exist so
 * the index is real state). `conflicted` offers none — the contract has
 * no conflict-resolution operation and staging a conflicted path would
 * mark it resolved silently.
 */
export function laneMutation(lane: ChangeLane): LaneMutation | null {
  switch (lane) {
    case "staged":
      return { op: "unstage", label: "Unstage all" };
    case "changes":
    case "untracked":
      return { op: "stage", label: "Stage all" };
    case "conflicted":
      return null;
  }
}

/** The per-row action inside a lane; conflicted rows offer none. */
export function entryMutation(lane: ChangeLane): LaneMutation | null {
  const bulk = laneMutation(lane);
  if (bulk === null) return null;
  return { ...bulk, label: bulk.op === "stage" ? "Stage" : "Unstage" };
}

export interface CommitPlan {
  /** Why the commit control is disabled; null when it may run. */
  readonly disabled: string | null;
  /** Button label, e.g. "Commit staged (2)" or "Commit all changes". */
  readonly label: string;
  /**
   * `paths` to hand `changes.commit` — the staged lane when one exists
   * (native's selected-subset semantics), undefined for commit-all
   * (`add -A`, native's all-selected default).
   */
  readonly paths: readonly string[] | undefined;
}

/**
 * Commit planning. The conflicted lane hard-blocks: the contract's
 * prepare step is `reset` + `add -A`, which mid-merge clears unmerged
 * index entries and stages conflict markers — native cannot see
 * conflicted state to block it, this panel can and does. A staged set
 * over the 100-path input bound also blocks: a commit cannot be chunked
 * like stage/unstage, so the button would be a fake affordance — the
 * honest out is unstaging down or unstaging all to commit-all.
 */
export function planCommit(lanes: LaneGroups, message: string): CommitPlan {
  if (lanes.conflicted.length > 0) {
    return {
      disabled: "Resolve merge conflicts before committing",
      label: "Commit",
      paths: undefined,
    };
  }
  const staged = lanes.staged.map((entry) => entry.path);
  if (staged.length > VCS_PATHS_MAX) {
    return {
      disabled: `Over ${VCS_PATHS_MAX} staged paths — unstage some, or unstage all to commit every change`,
      label: `Commit staged (${staged.length})`,
      paths: undefined,
    };
  }
  if (laneCount(lanes) === 0) {
    return { disabled: "No changes to commit", label: "Commit", paths: undefined };
  }
  if (message.trim().length === 0) {
    const label = staged.length > 0 ? `Commit staged (${staged.length})` : "Commit all changes";
    return { disabled: "Enter a commit message", label, paths: undefined };
  }
  if (staged.length > 0) {
    return {
      disabled: null,
      label: `Commit staged (${staged.length})`,
      paths: staged,
    };
  }
  return { disabled: null, label: "Commit all changes", paths: undefined };
}

/** Single-flight mutation phase — one op at a time, like native's serialized VCS actions. */
export type MutationPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly op: MutationOp; readonly label: string }
  | { readonly kind: "succeeded"; readonly op: MutationOp; readonly detail: string }
  | { readonly kind: "failed"; readonly op: MutationOp; readonly detail: string };

export const IDLE_MUTATION: MutationPhase = { kind: "idle" };

/**
 * Begin a mutation. Returns null when one is already running — the view
 * disables all mutation controls on `running`, so a null here is also the
 * guard against a raced second click.
 */
export function startMutation(
  phase: MutationPhase,
  op: MutationOp,
  label: string,
): MutationPhase | null {
  if (phase.kind === "running") return null;
  return { kind: "running", op, label };
}

/** Settle the running op: rejection detail (the named error) or a success line. */
export function settleMutation(
  op: MutationOp,
  result: { readonly ok: boolean; readonly detail: string },
): MutationPhase {
  return result.ok
    ? { kind: "succeeded", op, detail: result.detail }
    : { kind: "failed", op, detail: result.detail };
}

/** One-line rendering of the mutation phase for the panel status line. */
export function describeMutation(phase: MutationPhase): string | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "running":
      return `${phase.label}…`;
    case "succeeded":
      return phase.detail;
    case "failed":
      return phase.detail;
  }
}

/** Branch-create plan: trimmed non-empty, no duplicate local name. */
export function planRefCreate(
  input: string,
  rows: readonly RefRow[],
): { readonly refName: string | null; readonly disabled: string | null } {
  const refName = input.trim();
  if (refName.length === 0) return { refName: null, disabled: "Enter a branch name" };
  if (rows.some((row) => row.remote === null && row.name === refName)) {
    return { refName: null, disabled: `Branch ${refName} already exists` };
  }
  return { refName, disabled: null };
}

/**
 * Whether a ref row may be switched to. Current rows render no control at
 * all; a ref checked out in a worktree is disabled by name — native
 * retargets the thread to that worktree, which the project-scope panel
 * has no contract for, and git would refuse the checkout anyway. A remote
 * row whose tracking target is the current branch is a no-op, so it gets
 * the reason instead of a dead button.
 */
export function refSwitchState(
  row: RefRow,
  currentBranch: string | null,
): {
  readonly ok: boolean;
  readonly reason: string | null;
} {
  if (row.current) return { ok: false, reason: null };
  if (row.worktreePath !== null) return { ok: false, reason: "Checked out in a worktree" };
  if (row.remote !== null && row.name === currentBranch) {
    return { ok: false, reason: "Remote of the current branch" };
  }
  return { ok: true, reason: null };
}

/**
 * The `refs.switch` wire name for a row: remote refs must go out
 * remote-qualified (`origin/main`) — the driver resolves
 * `refs/remotes/<refName>` for its tracking-checkout matrix, and a bare
 * name would check out a same-named LOCAL branch instead.
 */
export function refSwitchTarget(row: RefRow): string {
  return row.remote === null ? row.name : `${row.remote}/${row.name}`;
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
