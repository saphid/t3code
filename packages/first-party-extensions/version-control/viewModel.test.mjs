import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import {
  CHANGE_LANES,
  CONNECTING_STATUS,
  EMPTY_LANES,
  applyStatusEvent,
  branchLabel,
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
  syncLabel,
  workingTreeLabel,
} from "./viewModel.ts";

const change = (path, flags) => ({
  path,
  staged: false,
  unstaged: false,
  untracked: false,
  conflicted: false,
  ...flags,
});

const local = (overrides = {}) => ({
  isRepo: true,
  hasPrimaryRemote: false,
  isDefaultRef: false,
  refName: "main",
  hasWorkingTreeChanges: true,
  workingTree: { files: [], insertions: 0, deletions: 0, truncated: false },
  ...overrides,
});

const remote = (overrides = {}) => ({
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
  ...overrides,
});

const caps = (overrides = {}) => ({
  detected: true,
  kind: "git",
  detail: null,
  driver: {
    kind: "git",
    supportsWorktrees: true,
    supportsBookmarks: false,
    supportsAtomicSnapshot: false,
    supportsPushDefaultRemote: false,
    ignoreClassifier: "native",
  },
  operations: {
    "status.get": true,
    "status.refresh": true,
    "status.subscribe": true,
    "refs.list": true,
    "refs.create": true,
    "refs.switch": true,
    "changes.list": true,
    "changes.stage": true,
    "changes.unstage": true,
    "changes.commit": true,
    "diff.getPreview": true,
    "diff.getFileContents": true,
    "repository.pull": true,
    "repository.init": true,
    "repository.createWorktree": true,
    "repository.removeWorktree": true,
  },
  ...overrides,
});

NodeTest.describe("vcs view model — staging lanes", () => {
  NodeTest.it("assigns staged/unstaged/untracked/conflicted lanes from porcelain flags", () => {
    const lanes = lanesFromChanges([
      change("a.txt", { unstaged: true }), // modified, unstaged ( M)
      change("b.txt", { staged: true }), // staged new file (A )
      change("c.txt", { untracked: true }), // ??
      change("d.txt", { conflicted: true }), // UU
      change("e.txt", { staged: true, unstaged: true }), // MM — partially staged
    ]);
    NodeAssert.deepEqual(
      lanes.staged.map((e) => e.path),
      ["b.txt", "e.txt"],
    );
    NodeAssert.deepEqual(
      lanes.changes.map((e) => e.path),
      ["a.txt", "e.txt"],
    );
    NodeAssert.deepEqual(
      lanes.untracked.map((e) => e.path),
      ["c.txt"],
    );
    NodeAssert.deepEqual(
      lanes.conflicted.map((e) => e.path),
      ["d.txt"],
    );
    NodeAssert.equal(laneCount(lanes), 6); // e.txt counts in both lanes
  });

  NodeTest.it("keeps a flagless anomaly visible instead of dropping it", () => {
    const lanes = lanesFromChanges([change("odd.txt")]);
    NodeAssert.deepEqual(
      lanes.changes.map((e) => e.path),
      ["odd.txt"],
    );
  });

  NodeTest.it("labels lanes and describes entry state", () => {
    NodeAssert.equal(laneTitle("conflicted"), "Merge conflicts");
    NodeAssert.equal(laneTitle("staged"), "Staged changes");
    NodeAssert.equal(laneTitle("changes"), "Changes");
    NodeAssert.equal(laneTitle("untracked"), "Untracked files");
    NodeAssert.equal(
      describeEntry(change("a", { staged: true, unstaged: true })),
      "staged, also modified",
    );
    NodeAssert.equal(describeEntry(change("b", { staged: true })), "staged");
    NodeAssert.equal(describeEntry(change("c", { unstaged: true })), "modified");
    NodeAssert.equal(describeEntry(change("d", { untracked: true })), "untracked");
    NodeAssert.equal(describeEntry(change("e", { conflicted: true })), "conflicted");
    NodeAssert.equal(laneCount(EMPTY_LANES), 0);
    NodeAssert.deepEqual(CHANGE_LANES, ["conflicted", "staged", "changes", "untracked"]);
  });
});

NodeTest.describe("vcs view model — selection", () => {
  const lanes = lanesFromChanges([
    change("a.txt", { unstaged: true }),
    change("b.txt", { staged: true }),
    change("c.txt", { staged: true, unstaged: true }),
  ]);

  NodeTest.it("keeps a selection whose path stays in its lane", () => {
    const sel = { path: "a.txt", lane: "changes" };
    NodeAssert.equal(retainSelection(sel, lanes), sel);
    NodeAssert.equal(retainSelection(null, lanes), null);
  });

  NodeTest.it("re-points a selection when the path moves lanes", () => {
    // c.txt was selected under changes, then fully staged elsewhere.
    const moved = lanesFromChanges([change("c.txt", { staged: true })]);
    NodeAssert.deepEqual(retainSelection({ path: "c.txt", lane: "changes" }, moved), {
      path: "c.txt",
      lane: "staged",
    });
  });

  NodeTest.it("drops a selection whose path is clean", () => {
    NodeAssert.equal(retainSelection({ path: "gone.txt", lane: "changes" }, lanes), null);
    NodeAssert.equal(retainSelection({ path: "a.txt", lane: "changes" }, EMPTY_LANES), null);
  });
});

NodeTest.describe("vcs view model — status stream", () => {
  NodeTest.it("seeds from snapshot and bumps the local revision", () => {
    const model = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local(),
      remote: remote(),
    });
    NodeAssert.equal(model.stream, "live");
    NodeAssert.equal(model.local?.refName, "main");
    NodeAssert.equal(model.localRevision, 1);
  });

  NodeTest.it("localUpdated keeps the remote half and bumps the revision", () => {
    const seeded = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local({ refName: "main" }),
      remote: remote({ aheadCount: 2 }),
    });
    const next = applyStatusEvent(seeded, {
      kind: "localUpdated",
      local: local({ refName: "topic" }),
    });
    NodeAssert.equal(next.local?.refName, "topic");
    NodeAssert.equal(next.remote?.aheadCount, 2);
    NodeAssert.equal(next.localRevision, 2);
  });

  NodeTest.it("remoteUpdated keeps the local half without bumping the revision", () => {
    const seeded = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local(),
      remote: null,
    });
    const next = applyStatusEvent(seeded, {
      kind: "remoteUpdated",
      remote: remote({ behindCount: 3 }),
    });
    NodeAssert.equal(next.remote?.behindCount, 3);
    NodeAssert.equal(next.local?.refName, "main");
    NodeAssert.equal(next.localRevision, 1);
  });

  NodeTest.it("closed ends the stream with a named reason", () => {
    const seeded = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local(),
      remote: null,
    });
    const ended = applyStatusEvent(seeded, { kind: "closed", reason: "overflow" });
    NodeAssert.equal(ended.stream, "ended");
    NodeAssert.match(ended.detail ?? "", /overflowed/);
    const errored = applyStatusEvent(seeded, { kind: "closed", reason: "status-error" });
    NodeAssert.match(errored.detail ?? "", /status error/);
  });
});

NodeTest.describe("vcs view model — status text", () => {
  NodeTest.it("renders branch, sync and working-tree state", () => {
    const model = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local({
        workingTree: {
          files: [{ path: "a.txt", insertions: 5, deletions: 2 }],
          insertions: 5,
          deletions: 2,
          truncated: false,
        },
      }),
      remote: remote({ aheadCount: 2, behindCount: 1 }),
    });
    NodeAssert.equal(describeStatus(model), "main — ↑2 ↓1 vs upstream — 1 file changed (+5 −2)");
  });

  NodeTest.it("renders ahead/behind, no-upstream, and ahead-of-default honestly", () => {
    NodeAssert.equal(syncLabel(remote({ aheadCount: 0, behindCount: 0 })), "in sync with upstream");
    NodeAssert.equal(syncLabel(remote({ aheadCount: 4, behindCount: 0 })), "↑4 vs upstream");
    NodeAssert.equal(syncLabel(remote({ aheadCount: 0, behindCount: 7 })), "↓7 vs upstream");
    NodeAssert.equal(syncLabel(remote({ hasUpstream: false })), "no upstream");
    NodeAssert.equal(
      syncLabel(remote({ hasUpstream: false, aheadOfDefaultCount: 3 })),
      "↑3 vs default branch",
    );
    NodeAssert.equal(syncLabel(null), "upstream pending");
  });

  NodeTest.it("renders detached HEAD, clean tree, truncation, and PR badge", () => {
    NodeAssert.equal(branchLabel(local({ refName: null })), "detached HEAD");
    NodeAssert.equal(workingTreeLabel(local({ hasWorkingTreeChanges: false })), "clean");
    NodeAssert.equal(
      workingTreeLabel(
        local({
          workingTree: {
            files: [{ path: "a", insertions: 0, deletions: 1 }],
            insertions: 0,
            deletions: 1,
            truncated: true,
          },
        }),
      ),
      "1 file changed (+0 −1), list truncated",
    );
    const model = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local({ hasWorkingTreeChanges: false }),
      remote: remote({
        pr: {
          number: 42,
          title: "Ship it",
          url: "https://example.test/pr/42",
          baseRef: "main",
          headRef: "topic",
          state: "open",
        },
      }),
    });
    NodeAssert.match(describeStatus(model), /PR #42 open/);
  });

  NodeTest.it("reports connecting, ended, and non-repo states", () => {
    NodeAssert.equal(describeStatus(CONNECTING_STATUS), "Reading repository status…");
    NodeAssert.equal(
      describeStatus(
        applyStatusEvent(CONNECTING_STATUS, { kind: "closed", reason: "status-error" }),
      ),
      "Status updates ended — The status stream reported a status error.",
    );
    const notRepo = applyStatusEvent(CONNECTING_STATUS, {
      kind: "snapshot",
      local: local({ isRepo: false, refName: null }),
      remote: null,
    });
    NodeAssert.equal(describeStatus(notRepo), "This workspace is not a repository");
  });

  NodeTest.it("joins per-path numstat from the status payload", () => {
    const withStats = local({
      workingTree: {
        files: [
          { path: "a.txt", insertions: 5, deletions: 2 },
          { path: "b.txt", insertions: 0, deletions: 9 },
        ],
        insertions: 5,
        deletions: 11,
        truncated: false,
      },
    });
    NodeAssert.deepEqual(numstatFor(withStats, "b.txt"), { insertions: 0, deletions: 9 });
    NodeAssert.equal(numstatFor(withStats, "missing.txt"), null);
    NodeAssert.equal(numstatFor(null, "a.txt"), null);
  });
});

NodeTest.describe("vcs view model — refs", () => {
  NodeTest.it("projects refs to rows with current/default/worktree/remote badges", () => {
    const rows = refRows({
      isRepo: true,
      hasPrimaryRemote: true,
      nextCursor: null,
      totalCount: 3,
      refs: [
        { name: "main", current: true, isDefault: true, worktreePath: null },
        { name: "topic", current: false, isDefault: false, worktreePath: "/wt/topic" },
        {
          name: "main",
          isRemote: true,
          remoteName: "origin",
          current: false,
          isDefault: false,
          worktreePath: null,
        },
      ],
    });
    NodeAssert.equal(rows.length, 3);
    NodeAssert.equal(describeRef(rows[0]), "current · default");
    NodeAssert.equal(describeRef(rows[1]), "worktree");
    NodeAssert.equal(describeRef(rows[2]), "origin");
    NodeAssert.equal(rows[2].remote, "origin");
    NodeAssert.deepEqual(refRows(null), []);
  });
});

NodeTest.describe("vcs view model — repository gate", () => {
  NodeTest.it("gates loading, error, no-repo, unsupported and ready", () => {
    NodeAssert.deepEqual(repositoryState(null, null), { kind: "loading" });
    NodeAssert.deepEqual(repositoryState(null, "grant denied"), {
      kind: "unavailable",
      detail: "grant denied",
    });
    NodeAssert.deepEqual(
      repositoryState(caps({ detected: false, kind: null, detail: "no .git" }), null),
      { kind: "no-repository", detail: "no .git" },
    );
    const nonGit = caps({
      kind: "jj",
      operations: {
        "status.get": false,
        "status.refresh": false,
        "status.subscribe": false,
        "refs.list": false,
        "refs.create": false,
        "refs.switch": false,
        "changes.list": false,
        "changes.stage": false,
        "changes.unstage": false,
        "changes.commit": false,
        "diff.getPreview": false,
        "diff.getFileContents": false,
        "repository.pull": false,
        "repository.init": false,
        "repository.createWorktree": false,
        "repository.removeWorktree": false,
      },
    });
    const unsupported = repositoryState(nonGit, null);
    NodeAssert.equal(unsupported.kind, "unsupported");
    NodeAssert.equal(unsupported.driverKind, "jj");
    NodeAssert.equal(repositoryState(caps(), null).kind, "ready");
  });
});
