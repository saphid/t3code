// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file read/write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";

import type {
  ProjectFileSnapshot,
  ProjectLineEnding,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectTextEncoding,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;

function textEncoding(bytes: Uint8Array): ProjectTextEncoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf8-bom";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf16-le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf16-be";
  return "utf8";
}

function decodeText(bytes: Uint8Array, encoding: ProjectTextEncoding): string {
  switch (encoding) {
    case "utf8-bom":
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3));
    case "utf16-le":
      return Buffer.from(bytes.subarray(2)).toString("utf16le");
    case "utf16-be": {
      const body = Buffer.from(bytes.subarray(2, bytes.length - ((bytes.length - 2) % 2)));
      body.swap16();
      return body.toString("utf16le");
    }
    case "utf8":
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}

function detectLineEnding(contents: string): ProjectLineEnding {
  const crlf = contents.match(/\r\n/g)?.length ?? 0;
  const withoutCrlf = contents.replace(/\r\n/g, "");
  const lf = withoutCrlf.match(/\n/g)?.length ?? 0;
  const cr = withoutCrlf.match(/\r/g)?.length ?? 0;
  const kinds = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0);
  if (kinds === 0) return "none";
  if (kinds > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (cr > 0) return "cr";
  return "lf";
}

function normalizeLineEndings(contents: string, lineEnding: ProjectLineEnding | undefined): string {
  if (lineEnding === undefined || lineEnding === "none" || lineEnding === "mixed") {
    return contents;
  }
  const replacement = lineEnding === "crlf" ? "\r\n" : lineEnding === "cr" ? "\r" : "\n";
  return contents.replace(/\r\n|\r|\n/g, replacement);
}

function encodeText(
  contents: string,
  encoding: ProjectTextEncoding | undefined,
  lineEnding: ProjectLineEnding | undefined,
): Uint8Array {
  const normalized = normalizeLineEndings(contents, lineEnding);
  switch (encoding) {
    case "utf8-bom":
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(normalized, "utf8")]);
    case "utf16-le":
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(normalized, "utf16le")]);
    case "utf16-be": {
      const body = Buffer.from(normalized, "utf16le");
      body.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
    }
    case "utf8":
    case undefined:
      return Buffer.from(normalized, "utf8");
  }
}

export class WorkspaceFileSystemOperationError extends Schema.TaggedErrorClass<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
      "chmod",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedErrorClass<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedErrorClass<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedErrorClass<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;

/** Service tag for workspace file operations. */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    /** Read a UTF-8 text file relative to the workspace root. */
    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /**
     * Write a file relative to the workspace root.
     *
     * Creates parent directories as needed and rejects paths that escape the
     * workspace root.
     */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const writeLocksRef = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());

  const getWriteLock = Effect.fn("WorkspaceFileSystem.getWriteLock")(function* (key: string) {
    const existing = (yield* Ref.get(writeLocksRef)).get(key);
    if (existing) return existing;

    const created = yield* Semaphore.make(1);
    return yield* Ref.modify(writeLocksRef, (locks) => {
      const current = locks.get(key);
      if (current) return [current, locks] as const;
      const next = new Map(locks);
      next.set(key, created);
      return [created, next] as const;
    });
  });

  const readFileImpl = Effect.fn("WorkspaceFileSystem.readFile")(function* (
    input: ProjectReadFileInput,
  ) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.cwd),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    });
    const realTargetPath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(target.absolutePath),
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    const relativeRealPath = path.relative(realWorkspaceRoot, realTargetPath);
    if (
      relativeRealPath.startsWith(`..${path.sep}`) ||
      relativeRealPath === ".." ||
      path.isAbsolute(relativeRealPath)
    ) {
      return yield* new WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => NodeFSP.open(realTargetPath, "r"),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }),
      (handle) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = yield* Effect.tryPromise({
            try: () => handle.read(buffer, 0, bytesToRead, 0),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "read",
                cause,
              }),
          });
          const fileBytes = buffer.subarray(0, bytesRead);
          const encoding = textEncoding(fileBytes);
          if (encoding === "utf8" && fileBytes.includes(0)) {
            return yield* new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }
          const contents = yield* Effect.try({
            try: () => decodeText(fileBytes, encoding),
            catch: () =>
              new WorkspaceBinaryFileError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
              }),
          });
          const versionHash = NodeCrypto.createHash("sha256");
          versionHash.update(
            `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:`,
          );
          versionHash.update(fileBytes);

          return {
            relativePath: target.relativePath,
            contents,
            byteLength: stat.size,
            truncated: stat.size > PROJECT_READ_FILE_MAX_BYTES,
            version: `v1-${versionHash.digest("hex")}`,
            encoding,
            lineEnding: detectLineEnding(contents),
            mode: stat.mode & 0o777,
          };
        }),
      (handle) =>
        Effect.tryPromise({
          try: () => handle.close(),
          catch: (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
              operationPath: realTargetPath,
              operation: "close",
              cause,
            }),
        }),
    );
  });

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = readFileImpl;

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const lock = yield* getWriteLock(target.absolutePath);
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const current =
          input.expectedVersion === undefined
            ? null
            : yield* readFileImpl(input).pipe(
                Effect.map(
                  ({ relativePath: _, ...snapshot }): ProjectFileSnapshot | null => snapshot,
                ),
                Effect.catchTag("WorkspaceFileSystemOperationError", (error) => {
                  const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
                  return error.operation === "realpath-target" && code === "ENOENT"
                    ? Effect.succeed(null)
                    : Effect.fail(error);
                }),
              );

        if (
          input.expectedVersion !== undefined &&
          (input.expectedVersion === null
            ? current !== null
            : current?.version !== input.expectedVersion)
        ) {
          return {
            status: "conflict" as const,
            relativePath: target.relativePath,
            current,
          };
        }

        yield* fileSystem
          .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: target.absolutePath,
                  operationPath: path.dirname(target.absolutePath),
                  operation: "make-directory",
                  cause,
                }),
            ),
          );
        yield* fileSystem
          .writeFile(
            target.absolutePath,
            encodeText(input.contents, input.encoding, input.lineEnding),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: target.absolutePath,
                  operationPath: target.absolutePath,
                  operation: "write-file",
                  cause,
                }),
            ),
          );
        if (input.mode !== undefined) {
          yield* fileSystem.chmod(target.absolutePath, input.mode).pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: target.absolutePath,
                  operationPath: target.absolutePath,
                  operation: "chmod",
                  cause,
                }),
            ),
          );
        }
        const saved = yield* readFileImpl(input);
        yield* workspaceEntries.refresh(input.cwd);
        const expectedContents = normalizeLineEndings(input.contents, input.lineEnding);
        if (
          input.expectedVersion !== undefined &&
          (saved.truncated || saved.contents !== expectedContents)
        ) {
          const { relativePath: _, ...current } = saved;
          return {
            status: "conflict" as const,
            relativePath: target.relativePath,
            current,
          };
        }
        return {
          status: "written" as const,
          relativePath: target.relativePath,
          version: saved.version,
        };
      }),
    );
  });

  return WorkspaceFileSystem.of({ readFile, writeFile });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
