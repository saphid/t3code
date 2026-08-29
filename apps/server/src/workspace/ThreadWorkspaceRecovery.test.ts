// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, describe, expect } from "vite-plus/test";

import * as ThreadWorkspaceRecovery from "./ThreadWorkspaceRecovery.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";

const roots = new Set<string>();

function git(cwd: string, args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  }).trim();
}

function makeRepository(name = "repository"): string {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `t3-${name}-`));
  roots.add(root);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "T3 Test"]);
  NodeFS.writeFileSync(NodePath.join(root, "README.md"), "base\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

const layer = ThreadWorkspaceRecovery.layer.pipe(
  Layer.provide(NodeServices.layer),
  Layer.provide(
    Layer.mock(GitWorkflowService.GitWorkflowService)({
      createWorktree: (input) =>
        Effect.sync(() => {
          const worktreePath = input.path;
          if (worktreePath === null) throw new Error("test worktree path is required");
          git(input.cwd, ["worktree", "add", worktreePath, input.refName]);
          return { worktree: { path: worktreePath, refName: input.refName } };
        }),
    }),
  ),
);

afterEach(() => {
  for (const root of roots) {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

describe("ThreadWorkspaceRecovery", () => {
  effectIt.effect(
    "relocates a removed Unicode worktree to the one clean checkout of its exact branch",
    () =>
      Effect.gen(function* () {
        const project = makeRepository("workspace-recovery");
        const removed = NodePath.join(
          NodePath.dirname(project),
          `${NodePath.basename(project)}-消えた`,
        );
        git(project, ["worktree", "add", "-b", "feature/recovery", removed]);
        git(project, ["worktree", "remove", removed]);
        git(project, ["switch", "feature/recovery"]);
        const recovery = yield* ThreadWorkspaceRecovery.ThreadWorkspaceRecovery;
        const result = yield* recovery.inspect({
          projectWorkspaceRoot: project,
          recordedWorktreePath: removed,
          branch: "feature/recovery",
        });
        expect(result).toMatchObject({
          _tag: "Relocate",
          candidate: { path: NodeFS.realpathSync(project), isProjectRoot: true, dirty: false },
        });
      }).pipe(Effect.provide(layer)),
  );

  effectIt.effect("requires a choice rather than silently moving to a dirty checkout", () =>
    Effect.gen(function* () {
      const project = makeRepository("workspace-dirty");
      const removed = `${project}-removed`;
      git(project, ["worktree", "add", "-b", "feature/dirty", removed]);
      git(project, ["worktree", "remove", removed]);
      git(project, ["switch", "feature/dirty"]);
      NodeFS.appendFileSync(NodePath.join(project, "README.md"), "dirty\n");

      const recovery = yield* ThreadWorkspaceRecovery.ThreadWorkspaceRecovery;
      const result = yield* recovery.inspect({
        projectWorkspaceRoot: project,
        recordedWorktreePath: removed,
        branch: "feature/dirty",
      });

      expect(result).toMatchObject({
        _tag: "ChoiceRequired",
        reason: "dirty-match",
        candidates: [{ path: NodeFS.realpathSync(project), isProjectRoot: true, dirty: true }],
        canRecreate: false,
      });
    }).pipe(Effect.provide(layer)),
  );

  effectIt.effect("does not choose when Git reports more than one matching checkout", () =>
    Effect.gen(function* () {
      const project = makeRepository("workspace-ambiguous");
      const removed = `${project}-removed`;
      const duplicate = `${project}-duplicate`;
      roots.add(duplicate);
      git(project, ["worktree", "add", "-b", "feature/ambiguous", removed]);
      git(project, ["worktree", "remove", removed]);
      git(project, ["switch", "feature/ambiguous"]);
      git(project, ["worktree", "add", "--force", duplicate, "feature/ambiguous"]);

      const recovery = yield* ThreadWorkspaceRecovery.ThreadWorkspaceRecovery;
      const result = yield* recovery.inspect({
        projectWorkspaceRoot: project,
        recordedWorktreePath: removed,
        branch: "feature/ambiguous",
      });

      expect(result._tag).toBe("ChoiceRequired");
      if (result._tag === "ChoiceRequired") {
        expect(result.reason).toBe("ambiguous-match");
        expect(result.candidates).toHaveLength(2);
      }
    }).pipe(Effect.provide(layer)),
  );

  effectIt.effect("rejects an explicit checkout from another repository", () =>
    Effect.gen(function* () {
      const project = makeRepository("workspace-source");
      const other = makeRepository("workspace-other");
      git(project, ["branch", "feature/same-name"]);
      git(other, ["branch", "feature/same-name"]);
      git(other, ["switch", "feature/same-name"]);

      const recovery = yield* ThreadWorkspaceRecovery.ThreadWorkspaceRecovery;
      const exit = yield* Effect.exit(
        recovery.recover({
          projectWorkspaceRoot: project,
          recordedWorktreePath: `${project}-removed`,
          branch: "feature/same-name",
          selection: { strategy: "matching-worktree", targetPath: other },
        }),
      );

      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(layer)),
  );

  effectIt.effect("recreates the original worktree after pruning stale metadata", () =>
    Effect.gen(function* () {
      const project = makeRepository("workspace-recreate");
      const removed = `${project}-recreated`;
      roots.add(removed);
      git(project, ["branch", "feature/recreate"]);

      const recovery = yield* ThreadWorkspaceRecovery.ThreadWorkspaceRecovery;
      const candidate = yield* recovery.recover({
        projectWorkspaceRoot: project,
        recordedWorktreePath: removed,
        branch: "feature/recreate",
        selection: { strategy: "recreate-worktree" },
      });

      expect(candidate).toMatchObject({
        path: NodeFS.realpathSync(removed),
        isProjectRoot: false,
        dirty: false,
      });
      expect(git(removed, ["branch", "--show-current"])).toBe("feature/recreate");
    }).pipe(Effect.provide(layer)),
  );
});
