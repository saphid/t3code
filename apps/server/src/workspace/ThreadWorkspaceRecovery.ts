import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";

export interface ThreadWorkspaceCandidate {
  readonly path: string;
  readonly isProjectRoot: boolean;
  readonly dirty: boolean;
}

export type ThreadWorkspaceInspection =
  | { readonly _tag: "Current" }
  | { readonly _tag: "Relocate"; readonly candidate: ThreadWorkspaceCandidate }
  | {
      readonly _tag: "ChoiceRequired";
      readonly reason:
        | "missing-branch"
        | "missing-project"
        | "missing-repository"
        | "no-match"
        | "dirty-match"
        | "ambiguous-match";
      readonly candidates: ReadonlyArray<ThreadWorkspaceCandidate>;
      readonly canRecreate: boolean;
    };

export type ThreadWorkspaceRecoverySelection =
  | { readonly strategy: "main-project" }
  | { readonly strategy: "matching-worktree"; readonly targetPath: string }
  | { readonly strategy: "recreate-worktree" };

export class ThreadWorkspaceRecoveryError extends Schema.TaggedErrorClass<ThreadWorkspaceRecoveryError>()(
  "ThreadWorkspaceRecoveryError",
  {
    reason: Schema.Literals([
      "missing-branch",
      "missing-project",
      "missing-repository",
      "invalid-target",
      "repository-mismatch",
      "branch-mismatch",
      "target-exists",
      "branch-checked-out",
      "git-failed",
    ]),
    detail: Schema.String,
  },
) {}

export class ThreadWorkspaceRecovery extends Context.Service<
  ThreadWorkspaceRecovery,
  {
    readonly inspect: (input: {
      readonly projectWorkspaceRoot: string;
      readonly recordedWorktreePath: string;
      readonly branch: string | null;
    }) => Effect.Effect<ThreadWorkspaceInspection>;
    readonly recover: (input: {
      readonly projectWorkspaceRoot: string;
      readonly recordedWorktreePath: string;
      readonly branch: string | null;
      readonly selection: ThreadWorkspaceRecoverySelection;
    }) => Effect.Effect<ThreadWorkspaceCandidate, ThreadWorkspaceRecoveryError>;
  }
>()("t3/workspace/ThreadWorkspaceRecovery") {}

interface WorktreeEntry {
  readonly path: string;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly prunable: boolean;
}

function parseWorktreeEntries(stdout: string): ReadonlyArray<WorktreeEntry> {
  const entries: Array<WorktreeEntry> = [];
  let path: string | null = null;
  let branch: string | null = null;
  let detached = false;
  let prunable = false;

  const flush = () => {
    if (path !== null) {
      entries.push({ path, branch, detached, prunable });
    }
    path = null;
    branch = null;
    detached = false;
    prunable = false;
  };

  for (const field of stdout.split("\0")) {
    if (field === "") {
      flush();
    } else if (field.startsWith("worktree ")) {
      path = field.slice("worktree ".length);
    } else if (field.startsWith("branch refs/heads/")) {
      branch = field.slice("branch refs/heads/".length);
    } else if (field === "detached") {
      detached = true;
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      prunable = true;
    }
  }
  flush();
  return entries;
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const gitWorkflow = yield* GitWorkflowService;

  const runGit = Effect.fn("ThreadWorkspaceRecovery.runGit")(function* (
    cwd: string,
    args: ReadonlyArray<string>,
  ) {
    return yield* processRunner
      .run({
        command: "git",
        args: ["-C", cwd, ...args],
        timeout: "10 seconds",
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.option);
  });

  const canonicalPath = Effect.fn("ThreadWorkspaceRecovery.canonicalPath")(function* (
    value: string,
  ) {
    return yield* fileSystem
      .realPath(value)
      .pipe(Effect.orElseSucceed(() => pathService.resolve(value)));
  });

  const pathExists = (value: string) =>
    fileSystem.exists(value).pipe(Effect.orElseSucceed(() => false));

  const repositoryIdentity = Effect.fn("ThreadWorkspaceRecovery.repositoryIdentity")(function* (
    cwd: string,
  ) {
    const result = yield* runGit(cwd, ["rev-parse", "--git-common-dir"]);
    if (result._tag === "None" || result.value.code !== 0 || result.value.timedOut) {
      return null;
    }
    const raw = result.value.stdout.trim();
    if (raw.length === 0) return null;
    const resolved = pathService.isAbsolute(raw) ? raw : pathService.resolve(cwd, raw);
    return yield* canonicalPath(resolved);
  });

  const currentBranch = Effect.fn("ThreadWorkspaceRecovery.currentBranch")(function* (cwd: string) {
    const result = yield* runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (result._tag === "None" || result.value.code !== 0 || result.value.timedOut) {
      return null;
    }
    const value = result.value.stdout.trim();
    return value.length > 0 ? value : null;
  });

  const isDirty = Effect.fn("ThreadWorkspaceRecovery.isDirty")(function* (cwd: string) {
    const result = yield* runGit(cwd, ["status", "--porcelain=v1", "-z"]);
    if (result._tag === "None" || result.value.code !== 0 || result.value.timedOut) {
      return true;
    }
    return result.value.stdout.length > 0;
  });

  const validateCandidate = Effect.fn("ThreadWorkspaceRecovery.validateCandidate")(
    function* (input: {
      readonly projectWorkspaceRoot: string;
      readonly targetPath: string;
      readonly branch: string;
      readonly allowDirty: boolean;
    }): Effect.fn.Return<ThreadWorkspaceCandidate | null> {
      if (!(yield* pathExists(input.targetPath))) return null;
      const [projectIdentity, targetIdentity, targetBranch] = yield* Effect.all(
        [
          repositoryIdentity(input.projectWorkspaceRoot),
          repositoryIdentity(input.targetPath),
          currentBranch(input.targetPath),
        ],
        { concurrency: 3 },
      );
      if (
        projectIdentity === null ||
        targetIdentity === null ||
        projectIdentity !== targetIdentity ||
        targetBranch !== input.branch
      ) {
        return null;
      }
      const dirty = yield* isDirty(input.targetPath);
      if (dirty && !input.allowDirty) return null;
      const [targetPath, projectPath] = yield* Effect.all(
        [canonicalPath(input.targetPath), canonicalPath(input.projectWorkspaceRoot)],
        { concurrency: 2 },
      );
      return {
        path: targetPath,
        isProjectRoot: targetPath === projectPath,
        dirty,
      };
    },
  );

  const matchingCandidates = Effect.fn("ThreadWorkspaceRecovery.matchingCandidates")(
    function* (input: {
      readonly projectWorkspaceRoot: string;
      readonly branch: string;
      readonly allowDirty: boolean;
    }) {
      const list = yield* runGit(input.projectWorkspaceRoot, [
        "worktree",
        "list",
        "--porcelain",
        "-z",
      ]);
      if (list._tag === "None" || list.value.code !== 0 || list.value.timedOut) {
        return [];
      }
      const entries = parseWorktreeEntries(list.value.stdout).filter(
        (entry) => !entry.detached && !entry.prunable && entry.branch === input.branch,
      );
      return yield* Effect.forEach(
        entries,
        (entry) =>
          validateCandidate({
            projectWorkspaceRoot: input.projectWorkspaceRoot,
            targetPath: entry.path,
            branch: input.branch,
            allowDirty: input.allowDirty,
          }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((candidates) => candidates.filter((candidate) => candidate !== null)));
    },
  );

  const inspect: ThreadWorkspaceRecovery["Service"]["inspect"] = Effect.fn(
    "ThreadWorkspaceRecovery.inspect",
  )(function* (input) {
    if (yield* pathExists(input.recordedWorktreePath)) {
      return { _tag: "Current" } as const;
    }
    if (!input.branch) {
      return {
        _tag: "ChoiceRequired",
        reason: "missing-branch",
        candidates: [],
        canRecreate: false,
      } as const;
    }
    if (!(yield* pathExists(input.projectWorkspaceRoot))) {
      return {
        _tag: "ChoiceRequired",
        reason: "missing-project",
        candidates: [],
        canRecreate: false,
      } as const;
    }
    if ((yield* repositoryIdentity(input.projectWorkspaceRoot)) === null) {
      return {
        _tag: "ChoiceRequired",
        reason: "missing-repository",
        candidates: [],
        canRecreate: false,
      } as const;
    }

    const allCandidates = yield* matchingCandidates({
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      branch: input.branch,
      allowDirty: true,
    });
    const cleanCandidates = allCandidates.filter((candidate) => !candidate.dirty);
    if (cleanCandidates.length === 1) {
      return { _tag: "Relocate", candidate: cleanCandidates[0]! } as const;
    }
    return {
      _tag: "ChoiceRequired",
      reason:
        cleanCandidates.length > 1
          ? "ambiguous-match"
          : allCandidates.length > 0
            ? "dirty-match"
            : "no-match",
      candidates: allCandidates,
      canRecreate: allCandidates.length === 0,
    } as const;
  });

  const requireBranch = (branch: string | null) =>
    branch
      ? Effect.succeed(branch)
      : Effect.fail(
          new ThreadWorkspaceRecoveryError({
            reason: "missing-branch",
            detail: "The removed worktree has no recorded branch to recover.",
          }),
        );

  const recover: ThreadWorkspaceRecovery["Service"]["recover"] = Effect.fn(
    "ThreadWorkspaceRecovery.recover",
  )(function* (input) {
    const branch = yield* requireBranch(input.branch);
    if (!(yield* pathExists(input.projectWorkspaceRoot))) {
      return yield* new ThreadWorkspaceRecoveryError({
        reason: "missing-project",
        detail: "The main project directory is no longer available.",
      });
    }
    const projectIdentity = yield* repositoryIdentity(input.projectWorkspaceRoot);
    if (projectIdentity === null) {
      return yield* new ThreadWorkspaceRecoveryError({
        reason: "missing-repository",
        detail: "The main project is not an available Git repository.",
      });
    }

    if (input.selection.strategy === "recreate-worktree") {
      if (yield* pathExists(input.recordedWorktreePath)) {
        return yield* new ThreadWorkspaceRecoveryError({
          reason: "target-exists",
          detail:
            "The original worktree path now exists. Refresh before choosing a recovery target.",
        });
      }
      const checkedOut = yield* matchingCandidates({
        projectWorkspaceRoot: input.projectWorkspaceRoot,
        branch,
        allowDirty: true,
      });
      if (checkedOut.length > 0) {
        return yield* new ThreadWorkspaceRecoveryError({
          reason: "branch-checked-out",
          detail: "That branch is already checked out. Select its current checkout instead.",
        });
      }
      const prune = yield* runGit(input.projectWorkspaceRoot, [
        "worktree",
        "prune",
        "--expire",
        "now",
      ]);
      if (prune._tag === "None" || prune.value.code !== 0 || prune.value.timedOut) {
        return yield* new ThreadWorkspaceRecoveryError({
          reason: "git-failed",
          detail: "Git could not prune the removed worktree metadata.",
        });
      }
      yield* gitWorkflow
        .createWorktree({
          cwd: input.projectWorkspaceRoot,
          refName: branch,
          path: input.recordedWorktreePath,
        })
        .pipe(
          Effect.mapError(
            () =>
              new ThreadWorkspaceRecoveryError({
                reason: "git-failed",
                detail: "Git could not recreate the removed worktree.",
              }),
          ),
        );
      const candidate = yield* validateCandidate({
        projectWorkspaceRoot: input.projectWorkspaceRoot,
        targetPath: input.recordedWorktreePath,
        branch,
        allowDirty: false,
      });
      if (candidate) return candidate;
      return yield* new ThreadWorkspaceRecoveryError({
        reason: "branch-mismatch",
        detail: "The recreated worktree did not resolve to the expected repository and branch.",
      });
    }

    const targetPath =
      input.selection.strategy === "main-project"
        ? input.projectWorkspaceRoot
        : input.selection.targetPath;
    const candidate = yield* validateCandidate({
      projectWorkspaceRoot: input.projectWorkspaceRoot,
      targetPath,
      branch,
      allowDirty: true,
    });
    if (!candidate) {
      return yield* new ThreadWorkspaceRecoveryError({
        reason: "invalid-target",
        detail: "The selected checkout no longer matches the thread's repository and branch.",
      });
    }
    if (input.selection.strategy === "main-project" && !candidate.isProjectRoot) {
      return yield* new ThreadWorkspaceRecoveryError({
        reason: "repository-mismatch",
        detail: "The selected checkout is not the main project.",
      });
    }
    return candidate;
  });

  return ThreadWorkspaceRecovery.of({ inspect, recover });
});

export const layer = Layer.effect(ThreadWorkspaceRecovery, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
