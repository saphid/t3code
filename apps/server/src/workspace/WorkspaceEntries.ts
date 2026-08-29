// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";

import * as Context from "effect/Context";
import * as Cache from "effect/Cache";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as RcMap from "effect/RcMap";
import * as Schema from "effect/Schema";

import type {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@t3tools/shared/path";
import { normalizeSearchQuery, scoreQueryMatch } from "@t3tools/shared/searchRanking";

import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspaceDotEntries from "./WorkspaceDotEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import * as WorkspaceSearchIndex from "./WorkspaceSearchIndex.ts";

export class WorkspaceEntriesWindowsPathUnsupportedError extends Schema.TaggedErrorClass<WorkspaceEntriesWindowsPathUnsupportedError>()(
  "WorkspaceEntriesWindowsPathUnsupportedError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    platform: Schema.String,
  },
) {
  override get message(): string {
    const cwd = this.cwd ? ` from '${this.cwd}'` : "";
    return `Windows-style workspace path '${this.partialPath}' is not supported on '${this.platform}'${cwd}.`;
  }
}

export class WorkspaceEntriesCurrentProjectRequiredError extends Schema.TaggedErrorClass<WorkspaceEntriesCurrentProjectRequiredError>()(
  "WorkspaceEntriesCurrentProjectRequiredError",
  {
    partialPath: Schema.String,
  },
) {
  override get message(): string {
    return `A current project is required to browse relative workspace path '${this.partialPath}'.`;
  }
}

export class WorkspaceEntriesReadDirectoryError extends Schema.TaggedErrorClass<WorkspaceEntriesReadDirectoryError>()(
  "WorkspaceEntriesReadDirectoryError",
  {
    cwd: Schema.optional(Schema.String),
    partialPath: Schema.String,
    parentPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const cwd = this.cwd ? ` from '${this.cwd}'` : "";
    return `Failed to read workspace directory '${this.parentPath}' while browsing '${this.partialPath}'${cwd}.`;
  }
}

class WorkspaceDotEntriesScanFailed extends Schema.TaggedErrorClass<WorkspaceDotEntriesScanFailed>()(
  "WorkspaceDotEntriesScanFailed",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const WorkspaceEntriesBrowseError = Schema.Union([
  WorkspaceEntriesWindowsPathUnsupportedError,
  WorkspaceEntriesCurrentProjectRequiredError,
  WorkspaceEntriesReadDirectoryError,
]);
export type WorkspaceEntriesBrowseError = typeof WorkspaceEntriesBrowseError.Type;

export const WorkspaceEntriesError = Schema.Union([
  WorkspacePaths.WorkspaceRootNotExistsError,
  WorkspacePaths.WorkspaceRootCreateFailedError,
  WorkspacePaths.WorkspaceRootStatFailedError,
  WorkspacePaths.WorkspaceRootNotDirectoryError,
  WorkspaceSearchIndex.WorkspaceSearchIndexCreateFailed,
  WorkspaceSearchIndex.WorkspaceSearchIndexScanTimedOut,
  WorkspaceSearchIndex.WorkspaceSearchIndexSearchFailed,
]);
export type WorkspaceEntriesError = typeof WorkspaceEntriesError.Type;

export class WorkspaceEntries extends Context.Service<
  WorkspaceEntries,
  {
    readonly browse: (
      input: FilesystemBrowseInput,
    ) => Effect.Effect<FilesystemBrowseResult, WorkspaceEntriesBrowseError>;
    readonly list: (
      input: ProjectListEntriesInput,
    ) => Effect.Effect<ProjectListEntriesResult, WorkspaceEntriesError>;
    readonly search: (
      input: ProjectSearchEntriesInput,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceEntriesError>;
    readonly searchContents: (
      input: ProjectSearchContentsInput,
    ) => Effect.Effect<ProjectSearchContentsResult, WorkspaceEntriesError>;
    readonly refresh: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/workspace/WorkspaceEntries") {}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return NodeOS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(NodeOS.homedir(), input.slice(2));
  }
  return input;
}

const resolveBrowseTarget = Effect.fn("WorkspaceEntries.resolveBrowseTarget")(function* (
  input: FilesystemBrowseInput,
  path: Path.Path,
): Effect.fn.Return<string, WorkspaceEntriesBrowseError> {
  const platform = yield* HostProcessPlatform;
  if (platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    return yield* new WorkspaceEntriesWindowsPathUnsupportedError({
      cwd: input.cwd,
      partialPath: input.partialPath,
      platform,
    });
  }

  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath, path));
  }

  if (!input.cwd) {
    return yield* new WorkspaceEntriesCurrentProjectRequiredError({
      partialPath: input.partialPath,
    });
  }
  return path.resolve(expandHomePath(input.cwd, path), input.partialPath);
});

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const vcsDrivers = yield* VcsDriverRegistry.VcsDriverRegistry;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceSearchIndexes = yield* WorkspaceSearchIndex.WorkspaceSearchIndexMap;
  const repositoryStates = new Map<string, boolean>();
  const dotEntriesCache = yield* Cache.make({
    capacity: 2_048,
    timeToLive: "30 seconds",
    lookup: (cwd: string) =>
      Effect.tryPromise({
        try: (signal) => WorkspaceDotEntries.scanWorkspaceDotEntries(cwd, signal),
        catch: (cause) => new WorkspaceDotEntriesScanFailed({ cwd, cause }),
      }),
  });

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceEntriesError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd);
  });

  const prepareWorkspaceIndex = Effect.fn("WorkspaceEntries.prepareWorkspaceIndex")(function* (
    cwd: string,
  ) {
    const isGitRepository = yield* Effect.gen(function* () {
      const git = yield* vcsDrivers.get("git");
      return yield* git.isInsideWorkTree(cwd);
    }).pipe(Effect.orElseSucceed(() => true));
    const previousState = repositoryStates.get(cwd);
    repositoryStates.set(cwd, isGitRepository);
    if (previousState !== undefined && previousState !== isGitRepository) {
      yield* Cache.invalidate(dotEntriesCache, cwd);
      yield* Effect.forEach(
        WorkspaceSearchIndex.WORKSPACE_SEARCH_INDEX_VARIANTS,
        (variant) =>
          workspaceSearchIndexes.invalidate(
            WorkspaceSearchIndex.workspaceSearchIndexKey(cwd, variant),
          ),
        { discard: true },
      );
    }
    return isGitRepository;
  });

  const dotEntries = Effect.fn("WorkspaceEntries.dotEntries")(function* (
    cwd: string,
    isGitRepository: boolean,
  ) {
    if (isGitRepository) return { entries: [], truncated: false };
    return yield* Cache.get(dotEntriesCache, cwd).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to scan non-Git workspace dot entries", { cwd, cause }).pipe(
          Effect.as({ entries: [], truncated: false }),
        ),
      ),
    );
  });

  const mergeEntries = (
    primary: ReadonlyArray<ProjectListEntriesResult["entries"][number]>,
    additional: ReadonlyArray<ProjectListEntriesResult["entries"][number]>,
  ) => {
    const entries = new Map(primary.map((entry) => [entry.path, entry]));
    for (const entry of additional) entries.set(entry.path, entry);
    return Array.from(entries.values());
  };

  const searchDotEntries = (
    entries: ReadonlyArray<ProjectListEntriesResult["entries"][number]>,
    query: string,
    limit: number,
    kind?: ProjectSearchEntriesInput["kind"],
    imageOnly?: boolean,
  ) =>
    entries
      .filter((entry) => kind === undefined || entry.kind === kind)
      .filter((entry) => !imageOnly || isWorkspaceImagePreviewPath(entry.path))
      .flatMap((entry) => {
        if (!query) return [{ entry, score: 0 }];
        const pathScore = scoreQueryMatch({
          value: entry.path.toLowerCase(),
          query,
          exactBase: 0,
          prefixBase: 100,
          boundaryBase: 200,
          includesBase: 300,
          fuzzyBase: 400,
        });
        const nameScore = scoreQueryMatch({
          value: path.basename(entry.path).toLowerCase(),
          query,
          exactBase: 0,
          prefixBase: 50,
          includesBase: 150,
          fuzzyBase: 350,
        });
        const score = Math.min(pathScore ?? Number.POSITIVE_INFINITY, nameScore ?? Infinity);
        return Number.isFinite(score) ? [{ entry, score }] : [];
      })
      .toSorted(
        (left, right) =>
          left.score - right.score || left.entry.path.localeCompare(right.entry.path),
      )
      .slice(0, limit)
      .map(({ entry }) => entry);

  const refresh: WorkspaceEntries["Service"]["refresh"] = Effect.fn("WorkspaceEntries.refresh")(
    function* (cwd) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(
        Effect.orElseSucceed(() => cwd),
      );
      yield* Cache.invalidate(dotEntriesCache, normalizedCwd);
      yield* prepareWorkspaceIndex(normalizedCwd);
      for (const variant of WorkspaceSearchIndex.WORKSPACE_SEARCH_INDEX_VARIANTS) {
        const indexKey = WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, variant);
        if (!(yield* RcMap.has(workspaceSearchIndexes.rcMap, indexKey))) {
          continue;
        }
        const recoverRefreshFailure = (
          cause:
            | WorkspaceSearchIndex.WorkspaceSearchIndexCreateFailed
            | WorkspaceSearchIndex.WorkspaceSearchIndexScanTimedOut
            | WorkspaceSearchIndex.WorkspaceSearchIndexRefreshFailed,
        ) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("Failed to refresh workspace search index", {
              cwd,
              variant,
              cause,
            });
            yield* workspaceSearchIndexes.invalidate(indexKey);
          });
        yield* Effect.gen(function* () {
          const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
          yield* searchIndex.refresh();
        }).pipe(
          Effect.provide(workspaceSearchIndexes.get(indexKey)),
          Effect.catchTags({
            WorkspaceSearchIndexCreateFailed: recoverRefreshFailure,
            WorkspaceSearchIndexScanTimedOut: recoverRefreshFailure,
            WorkspaceSearchIndexRefreshFailed: recoverRefreshFailure,
          }),
        );
      }
    },
  );

  const browse: WorkspaceEntries["Service"]["browse"] = Effect.fn("WorkspaceEntries.browse")(
    function* (input) {
      const resolvedInputPath = yield* resolveBrowseTarget(input, path);
      const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
      const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
      const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

      const dirents = yield* Effect.tryPromise({
        try: () => NodeFSP.readdir(parentPath, { withFileTypes: true }),
        catch: (cause) =>
          new WorkspaceEntriesReadDirectoryError({
            cwd: input.cwd,
            partialPath: input.partialPath,
            parentPath,
            cause,
          }),
      }).pipe(
        Effect.catchIf(
          (error) => {
            const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
            return code === "EACCES" || code === "EPERM";
          },
          () => Effect.succeed([]),
        ),
      );

      const showHidden = endsWithSeparator || prefix.startsWith(".");
      const lowerPrefix = prefix.toLowerCase();
      const entries: Array<{ readonly name: string; readonly fullPath: string }> = [];
      for (const dirent of dirents) {
        if (
          dirent.isDirectory() &&
          dirent.name.toLowerCase().startsWith(lowerPrefix) &&
          (showHidden || !dirent.name.startsWith("."))
        ) {
          entries.push({
            name: dirent.name,
            fullPath: path.join(parentPath, dirent.name),
          });
        }
      }

      return {
        parentPath,
        entries: entries.toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  );

  const search: WorkspaceEntries["Service"]["search"] = Effect.fn("WorkspaceEntries.search")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const isGitRepository = yield* prepareWorkspaceIndex(normalizedCwd);
      const normalizedQuery = normalizeSearchQuery(input.query, {
        trimLeadingPattern: /^[@./]+/,
      });
      const indexed = yield* Effect.gen(function* () {
        const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
        return yield* searchIndex.search(normalizedQuery, input.limit, input.kind, input.imageOnly);
      }).pipe(
        Effect.provide(
          workspaceSearchIndexes.get(
            WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "paths"),
          ),
        ),
      );
      const supplemental = yield* dotEntries(normalizedCwd, isGitRepository);
      const matchedDotEntries = searchDotEntries(
        supplemental.entries,
        normalizedQuery,
        input.limit,
        input.kind,
        input.imageOnly,
      );
      const merged = mergeEntries(matchedDotEntries, indexed.entries);
      const entries = merged.slice(0, input.limit);
      return {
        entries,
        truncated: indexed.truncated || supplemental.truncated || entries.length < merged.length,
      };
    },
  );

  const searchContents: WorkspaceEntries["Service"]["searchContents"] = Effect.fn(
    "WorkspaceEntries.searchContents",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    yield* prepareWorkspaceIndex(normalizedCwd);
    return yield* Effect.gen(function* () {
      const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
      return yield* searchIndex.searchContents(input);
    }).pipe(
      Effect.provide(
        workspaceSearchIndexes.get(
          WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "content"),
        ),
      ),
    );
  });

  const list: WorkspaceEntries["Service"]["list"] = Effect.fn("WorkspaceEntries.list")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      const isGitRepository = yield* prepareWorkspaceIndex(normalizedCwd);
      const indexed = yield* Effect.gen(function* () {
        const searchIndex = yield* WorkspaceSearchIndex.WorkspaceSearchIndex;
        return yield* searchIndex.list();
      }).pipe(
        Effect.provide(
          workspaceSearchIndexes.get(
            WorkspaceSearchIndex.workspaceSearchIndexKey(normalizedCwd, "paths"),
          ),
        ),
      );
      const supplemental = yield* dotEntries(normalizedCwd, isGitRepository);
      const merged = mergeEntries(indexed.entries, supplemental.entries).toSorted((left, right) =>
        left.path.localeCompare(right.path),
      );
      const entries = merged.slice(0, 25_000);
      return {
        entries,
        truncated: indexed.truncated || supplemental.truncated || entries.length < merged.length,
      };
    },
  );

  return WorkspaceEntries.of({ browse, list, refresh, search, searchContents });
});

export const layer = Layer.effect(WorkspaceEntries, make).pipe(
  Layer.provide(WorkspaceSearchIndex.WorkspaceSearchIndexMap.layer),
);
