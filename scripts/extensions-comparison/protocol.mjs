import { createHash } from "node:crypto";

export const GROUPS = ["calibrationA", "calibrationB", "baseline", "candidate"];
export const METRICS = {
  openMs: { unit: "ms", floor: 1 },
  actionMs: { unit: "ms", floor: 1 },
  cpuMs: { unit: "ms", floor: 0 },
  rssBytes: { unit: "bytes", floor: 0 },
  heapBytes: { unit: "bytes", floor: 0 },
  listeners: { unit: "count", floor: 0 },
  handles: { unit: "count", floor: 0 },
  wireBytes: { unit: "bytes", floor: 0 },
  hiddenWork: { unit: "events", floor: 0 },
  throughput: { unit: "events/s", floor: 0, higherBetter: true },
};
export const JOURNEYS = [
  { id: "files", client: "web", source: [
    "apps/web/src/components/files/fileTreeExpansion.test.ts",
    "apps/web/src/components/files/fileContentRevision.test.ts"],
    checks: ["expand-collapse-deep-tree", "open-selected-content", "same-length-edit-refresh",
      "ignored-untracked-non-git", "deleted-permission-error", "switch-project-stale-result",
      "path-traversal-rejected", "entry-points-focus-keyboard"] },
  { id: "diff", client: "web", source: [
    "apps/web/src/lib/diffFileContents.test.ts", "apps/web/src/diffPanelStore.test.ts",
    "apps/web/src/components/diffs/diffFileTree.logic.test.ts"],
    checks: ["working-tree-and-turn-selection", "large-many-changed-deleted-binary",
      "source-navigation", "own-sibling-turn-refresh", "stale-response-suppressed",
      "split-layout-restore", "missing-snapshot-error", "checkpoint-unchanged",
      "entry-points-focus-keyboard"] },
  { id: "version-control", client: "web", source: [
    "packages/client-runtime/src/state/sourceControl.test.ts",
    "packages/client-runtime/src/state/pullRequests.test.ts"],
    checks: ["destination-and-context-panel", "branch-status-refresh",
      "review-detail-draft-restore", "pagination-loading-error", "auth-rate-limit",
      "read-write-authority", "environment-identity", "unsupported-non-git",
      "entry-points-focus-keyboard"] },
  { id: "browser", client: "electron", source: [
    "apps/desktop/src/preview/Manager.test.ts",
    "apps/web/src/browser/webviewCrashRecovery.test.ts",
    "apps/web/src/browser/browserSurfaceStore.test.ts"],
    checks: ["navigate-back-forward-reload", "restore-tabs-resources", "annotation-context",
      "resize-focus", "unsafe-scheme-rejected", "navigation-failure-reconnect",
      "shared-viewer-close-retains-resource", "entry-points-focus-keyboard"] },
  { id: "terminal", client: "web", source: [
    "packages/client-runtime/src/state/terminalSession.test.ts",
    "apps/web/src/components/ThreadTerminalDrawer.test.ts",
    "apps/web/src/lib/terminalCloseConfirm.test.ts"],
    checks: ["create-connect-input-output", "unicode-ansi-resize",
      "burst-scrollback-bounded", "reconnect-history-stale-metadata",
      "multiple-viewers-hide-show", "close-versus-terminate", "exit-error",
      "no-orphan-pty", "entry-points-focus-keyboard"] },
  { id: "agents", client: "web", source: [
    "packages/client-runtime/src/state/subagentRuntime.test.ts"],
    checks: ["tree-status-parent-child-navigation", "all-lifecycle-states",
      "duplicate-late-completion-idempotent", "reconnect-interruption",
      "large-roster-updates", "no-duplicate-listeners", "no-added-control-authority",
      "entry-points-focus-keyboard"] },
];
export function fixture(seed = 20260909) {
  return {
    seed, environments: ["environment-a", "environment-b"],
    projects: ["git-a", "git-b", "non-git"], lifecycleCycles: 100,
    files: Array.from({ length: 512 }, (_, i) => ({
      path: `src/dir-${i % 16}/deep/nested/file-${i}.txt`,
      before: `seed=${seed}; file=${i}; before\n`,
      after: `seed=${seed}; file=${i}; after!\n`,
    })),
    specialFiles: {
      ignored: ".ignored/cache.txt", untracked: "new.txt", deleted: "removed.txt",
      unreadable: "private.txt", traversal: "../outside.txt",
      binaryBase64: "AP8AgAE=", large: "line\n".repeat(20000),
    },
    terminal: { text: "A\uFEFFこんにちは🙂\u001b[31mRED\u001b[0m\r\n", burstEvents: 10000 },
    agents: Array.from({ length: 500 }, (_, i) => ({
      id: `agent-${i}`, parentId: i ? "agent-0" : null,
      status: ["pending", "running", "completed", "failed", "interrupted"][i % 5],
    })),
    reviews: { count: 125, draft: "Keep this exact unsent draft.", externalWrites: false },
    faults: ["disconnect", "duplicate", "out-of-order", "cancel-after-context-switch"],
    preview: { pages: ["/fixture/a", "/fixture/b"], failure: "/fixture/unavailable" },
  };
}
export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function schedule(seed = 20260909) {
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const rows = [];
  for (let batch = 0; batch < 3; batch++) {
    for (const journey of JOURNEYS) {
      for (let iteration = -3; iteration < 10; iteration++) {
        const order = [...GROUPS];
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (const group of order) rows.push({
          id: rows.length, batch, journey: journey.id, client: journey.client,
          iteration, warmup: iteration < 0, group,
        });
      }
    }
  }
  return rows;
}
