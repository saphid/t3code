import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const ProjectLayer = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer, { excludeTestServices: true })("WorkspaceFileSystemLive", (it) => {
  describe("readFile", () => {
    it.effect("reads UTF-8 files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/index.ts", "export const answer = 42;\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/index.ts",
        });

        expect(result).toMatchObject({
          relativePath: "src/index.ts",
          contents: "export const answer = 42;\n",
          byteLength: 26,
          truncated: false,
          encoding: "utf8",
          lineEnding: "lf",
          mode: 0o644,
        });
        expect(result.version).toMatch(/^v1-[a-f0-9]{64}$/);
      }),
    );

    it.effect("rejects reads outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "../escape.md" })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );
      }),
    );

    it.effect("rejects symlinks that resolve outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(outsideDir, "secret.txt", "outside\n");
        yield* fileSystem.symlink(
          path.join(outsideDir, "secret.txt"),
          path.join(cwd, "linked-secret.txt"),
        );

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "linked-secret.txt" })
          .pipe(Effect.flip);
        const resolvedWorkspaceRoot = yield* fileSystem.realPath(cwd);
        const resolvedPath = yield* fileSystem.realPath(path.join(outsideDir, "secret.txt"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "linked-secret.txt",
          resolvedWorkspaceRoot,
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects directories without manufacturing an I/O cause", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "src" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(path.join(cwd, "src"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspacePathNotFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "src",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects binary files without leaking their contents into the error", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const absolutePath = path.join(cwd, "asset.bin");
        yield* fileSystem.writeFile(absolutePath, Uint8Array.from([0x61, 0, 0x62]));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "asset.bin" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(absolutePath);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceBinaryFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "asset.bin",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
        expect("contents" in error).toBe(false);
      }),
    );

    it.effect("preserves the real cause and path for I/O failures", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const resolvedPath = path.join(cwd, "missing.txt");

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "missing.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFileSystemOperationError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "missing.txt",
          resolvedPath,
          operationPath: resolvedPath,
          operation: "realpath-target",
        });
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toMatchObject({
          status: "written",
          relativePath: "plans/effect-rpc.md",
        });
        expect(result.status === "written" ? result.version : "").toMatch(/^v1-[a-f0-9]{64}$/);
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("rejects a stale observed version without overwriting newer contents", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "notes.md", "loaded\n");
        const loaded = yield* workspaceFileSystem.readFile({ cwd, relativePath: "notes.md" });
        yield* fileSystem.writeFileString(path.join(cwd, "notes.md"), "agent update\n");

        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "notes.md",
          contents: "mine\n",
          expectedVersion: loaded.version,
          encoding: loaded.encoding,
          lineEnding: loaded.lineEnding,
          mode: loaded.mode,
        });

        expect(result).toMatchObject({
          status: "conflict",
          relativePath: "notes.md",
          current: { contents: "agent update\n" },
        });
        expect(yield* fileSystem.readFileString(path.join(cwd, "notes.md"))).toBe("agent update\n");
      }),
    );

    it.effect("reports deletion or rename as a conflict instead of recreating the old path", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const originalPath = path.join(cwd, "draft.md");
        const renamedPath = path.join(cwd, "renamed.md");
        yield* writeTextFile(cwd, "draft.md", "loaded\n");
        const loaded = yield* workspaceFileSystem.readFile({ cwd, relativePath: "draft.md" });
        yield* fileSystem.rename(originalPath, renamedPath);

        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "draft.md",
          contents: "mine\n",
          expectedVersion: loaded.version,
        });

        expect(result).toEqual({
          status: "conflict",
          relativePath: "draft.md",
          current: null,
        });
        expect(yield* fileSystem.readFileString(renamedPath)).toBe("loaded\n");
        expect(yield* fileSystem.exists(originalPath)).toBe(false);
      }),
    );

    it.effect("allows only one concurrent client to write an observed version", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "shared.md", "loaded\n");
        const loaded = yield* workspaceFileSystem.readFile({ cwd, relativePath: "shared.md" });
        const write = (contents: string) =>
          workspaceFileSystem.writeFile({
            cwd,
            relativePath: "shared.md",
            contents,
            expectedVersion: loaded.version,
          });

        const results = yield* Effect.all([write("client one\n"), write("client two\n")], {
          concurrency: "unbounded",
        });
        const written = results.filter((result) => result.status === "written");
        const conflicts = results.filter((result) => result.status === "conflict");
        const saved = yield* fileSystem.readFileString(path.join(cwd, "shared.md"));

        expect(written).toHaveLength(1);
        expect(conflicts).toHaveLength(1);
        expect(["client one\n", "client two\n"]).toContain(saved);
        expect(conflicts[0]).toMatchObject({ current: { contents: saved } });
      }),
    );

    it.effect("creates a Save Copy target only while it is absent", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const first = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "notes conflict copy.md",
          contents: "mine\n",
          expectedVersion: null,
        });
        const second = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "notes conflict copy.md",
          contents: "other\n",
          expectedVersion: null,
        });

        expect(first.status).toBe("written");
        expect(second).toMatchObject({
          status: "conflict",
          current: { contents: "mine\n" },
        });
      }),
    );

    it.effect("preserves UTF-16, CRLF, and permissions on normal saves and copies", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sourcePath = path.join(cwd, "script.txt");
        const encoded = Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from("one\r\ntwo\r\n", "utf16le"),
        ]);
        yield* fileSystem.writeFile(sourcePath, encoded);
        yield* fileSystem.chmod(sourcePath, 0o640);
        const loaded = yield* workspaceFileSystem.readFile({ cwd, relativePath: "script.txt" });

        const saved = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "script.txt",
          contents: "one\ntwo\nthree\n",
          expectedVersion: loaded.version,
          encoding: loaded.encoding,
          lineEnding: loaded.lineEnding,
          mode: loaded.mode,
        });
        const copied = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "script conflict copy.txt",
          contents: "mine\n",
          expectedVersion: null,
          encoding: loaded.encoding,
          lineEnding: loaded.lineEnding,
          mode: loaded.mode,
        });
        const savedBytes = Buffer.from(yield* fileSystem.readFile(sourcePath));
        const copiedPath = path.join(cwd, "script conflict copy.txt");
        const copiedBytes = Buffer.from(yield* fileSystem.readFile(copiedPath));

        expect(loaded).toMatchObject({
          contents: "one\r\ntwo\r\n",
          encoding: "utf16-le",
          lineEnding: "crlf",
          mode: 0o640,
        });
        expect(saved.status).toBe("written");
        expect(copied.status).toBe("written");
        expect(savedBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
        expect(savedBytes.subarray(2).toString("utf16le")).toBe("one\r\ntwo\r\nthree\r\n");
        expect(copiedBytes.subarray(2).toString("utf16le")).toBe("mine\r\n");
        expect((yield* fileSystem.stat(sourcePath)).mode & 0o777).toBe(0o640);
        expect((yield* fileSystem.stat(copiedPath)).mode & 0o777).toBe(0o640);
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.list({ cwd });
        expect(beforeWrite.entries.some((entry) => entry.path === "plans/effect-rpc.md")).toBe(
          false,
        );

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.list({ cwd });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.orElseSucceed(() => null));
        expect(escapedStat).toBeNull();
      }),
    );
  });
});
