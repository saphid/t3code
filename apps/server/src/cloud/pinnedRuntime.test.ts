import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import {
  ensurePinnedRuntimeInstalled,
  pinnedRuntimePaths,
  PinnedRuntimeInstallError,
  PinnedRuntimePruneError,
  prunePinnedRuntimes,
} from "./pinnedRuntime.ts";
import { SERVICE_LAUNCHER_PROTOCOL, type ServiceState } from "./serviceProtocol.ts";

const successfulRunner = (fs: FileSystem.FileSystem, path: Path.Path) =>
  ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.gen(function* () {
        const prefixIndex = input.args.indexOf("--prefix");
        const stagingDir = input.args[prefixIndex + 1];
        if (stagingDir === undefined) return yield* Effect.die("missing npm --prefix");
        const entry = path.join(stagingDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entry), { recursive: true }).pipe(Effect.orDie);
        yield* fs.writeFileString(entry, "export {};\n").pipe(Effect.orDie);
        return {
          stdout: "",
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });

const writeCompletedRuntime = Effect.fn("test.write_completed_runtime")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  baseDir: string,
  version: string,
  payload = "runtime payload\n",
) {
  const runtime = pinnedRuntimePaths(path, baseDir, version);
  yield* fs.makeDirectory(path.dirname(runtime.entryPath), { recursive: true });
  yield* fs.writeFileString(runtime.entryPath, payload);
  yield* fs.writeFileString(runtime.sentinelPath, `${version}\n`);
  return runtime;
});

it.layer(NodeServices.layer)("ensurePinnedRuntimeInstalled", (it) => {
  it.effect("validates a staging tree before atomically publishing it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-test-" });
      const finalPaths = pinnedRuntimePaths(path, baseDir, "1.2.3");
      let validatedDirectory = "";

      const installed = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        runner: successfulRunner(fs, path),
        validate: (staging) =>
          Effect.gen(function* () {
            validatedDirectory = staging.versionDir;
            assert.isFalse(yield* fs.exists(finalPaths.versionDir));
            assert.isTrue(yield* fs.exists(staging.entryPath));
          }).pipe(Effect.orDie),
      });

      assert.notEqual(validatedDirectory, finalPaths.versionDir);
      assert.deepEqual(installed, finalPaths);
      assert.isTrue(yield* fs.exists(finalPaths.entryPath));
      assert.equal(yield* fs.readFileString(finalPaths.sentinelPath), "1.2.3\n");
    }),
  );

  it.effect("removes staging and leaves no final runtime when validation fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-test-" });
      const finalPaths = pinnedRuntimePaths(path, baseDir, "1.2.3");

      yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        runner: successfulRunner(fs, path),
        validate: () =>
          Effect.fail(new PinnedRuntimeInstallError({ step: "validating the staged runtime" })),
      }).pipe(Effect.flip);

      assert.isFalse(yield* fs.exists(finalPaths.versionDir));
      assert.deepEqual(
        (yield* fs.readDirectory(path.dirname(finalPaths.versionDir))).filter((entry) =>
          entry.startsWith(".staging-"),
        ),
        [],
      );
    }),
  );

  it.effect("replaces an incomplete pinned runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-repair-" });
      const finalPaths = pinnedRuntimePaths(path, baseDir, "1.2.3");
      yield* fs.makeDirectory(finalPaths.versionDir, { recursive: true });
      yield* fs.writeFileString(path.join(finalPaths.versionDir, "partial"), "incomplete\n");

      yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        runner: successfulRunner(fs, path),
        validate: () => Effect.void,
      });

      assert.isFalse(yield* fs.exists(path.join(finalPaths.versionDir, "partial")));
      assert.isTrue(yield* fs.exists(finalPaths.entryPath));
    }),
  );

  it.effect("preserves a completed runtime when validation fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-repair-" });
      const finalPaths = pinnedRuntimePaths(path, baseDir, "1.2.3");
      yield* fs.makeDirectory(path.dirname(finalPaths.entryPath), { recursive: true });
      yield* fs.writeFileString(finalPaths.entryPath, "broken\n");
      yield* fs.writeFileString(finalPaths.sentinelPath, "1.2.3\n");

      let validations = 0;
      yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        runner: successfulRunner(fs, path),
        validate: (paths) =>
          Effect.gen(function* () {
            validations += 1;
            const source = yield* fs.readFileString(paths.entryPath).pipe(Effect.orDie);
            if (source === "broken\n") {
              return yield* new PinnedRuntimeInstallError({ step: "validating the runtime" });
            }
          }),
      }).pipe(Effect.flip);

      assert.equal(validations, 1);
      assert.equal(yield* fs.readFileString(finalPaths.entryPath), "broken\n");
    }),
  );

  it.effect("removes staging when installation is interrupted", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-interrupt-" });
      const started = yield* Deferred.make<void>();
      const runner = ProcessRunner.ProcessRunner.of({
        run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const install = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        runner,
        validate: () => Effect.void,
      }).pipe(Effect.forkScoped);

      yield* Deferred.await(started);
      yield* Fiber.interrupt(install);
      const versionsDir = path.join(baseDir, "runtime", "versions");
      assert.deepEqual(yield* fs.readDirectory(versionsDir), []);
    }),
  );
});

it.layer(NodeServices.layer)("prunePinnedRuntimes", (it) => {
  it.effect("previews only completed unreferenced runtimes with an exact byte total", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const baseDir = path.join(root, "远程 环境");
      yield* fs.makeDirectory(baseDir);
      const first = yield* writeCompletedRuntime(fs, path, baseDir, "1.7.0");
      const second = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      const rollback = yield* writeCompletedRuntime(fs, path, baseDir, "1.9.0");
      const active = yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const newer = yield* writeCompletedRuntime(fs, path, baseDir, "2.1.0");
      const incomplete = pinnedRuntimePaths(path, baseDir, "1.6.0");
      yield* fs.makeDirectory(incomplete.versionDir, { recursive: true });
      const wrongSentinel = yield* writeCompletedRuntime(fs, path, baseDir, "1.5.0");
      yield* fs.writeFileString(wrongSentinel.sentinelPath, "wrong-version\n");
      const versionsDir = path.dirname(active.versionDir);
      const staging = path.join(versionsDir, ".staging-install");
      const unicode = path.join(versionsDir, "旧版本");
      yield* fs.makeDirectory(staging);
      yield* fs.makeDirectory(unicode);
      const linkedTarget = yield* fs.makeTempDirectoryScoped({ prefix: "t3-runtime-link-target-" });
      const linkedRuntime = pinnedRuntimePaths(path, baseDir, "1.4.0");
      yield* fs.symlink(linkedTarget, linkedRuntime.versionDir);
      const linkedEntryRuntime = yield* writeCompletedRuntime(fs, path, baseDir, "1.3.0");
      yield* fs.remove(linkedEntryRuntime.entryPath);
      yield* fs.symlink(linkedTarget, linkedEntryRuntime.entryPath);

      const state = {
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "2.0.0",
        update: {
          id: "committed-update",
          fromVersion: "1.9.0",
          targetVersion: "2.0.0",
          status: "committed",
        },
      } satisfies ServiceState;

      const preview = yield* prunePinnedRuntimes({
        baseDir,
        state,
        dryRun: true,
        fs,
        path,
        verifyState: () => Effect.void,
      });

      assert.deepEqual(preview.versions, ["1.7.0", "1.8.0"]);
      assert.isAbove(preview.recoverableBytes, 0);
      assert.equal(
        preview.recoverableBytes,
        preview.runtimes.reduce((total, runtime) => total + runtime.recoverableBytes, 0),
      );
      assert.deepEqual(
        preview.runtimes.map((runtime) => runtime.version),
        preview.versions,
      );
      assert.isFalse(yield* fs.exists(path.join(baseDir, "runtime", ".prune-lock")));
      for (const preserved of [
        first.versionDir,
        second.versionDir,
        rollback.versionDir,
        active.versionDir,
        newer.versionDir,
        incomplete.versionDir,
        wrongSentinel.versionDir,
        staging,
        unicode,
        linkedRuntime.versionDir,
        linkedEntryRuntime.versionDir,
      ]) {
        assert.isTrue(yield* fs.exists(preserved));
      }
    }),
  );

  it.effect("preserves both sides of a rolled-back update", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const removable = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      const active = yield* writeCompletedRuntime(fs, path, baseDir, "1.9.0");
      const failedTarget = yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");

      const result = yield* prunePinnedRuntimes({
        baseDir,
        state: {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.9.0",
          update: {
            id: "rolled-back-update",
            fromVersion: "1.9.0",
            targetVersion: "2.0.0",
            status: "rolled-back",
          },
        },
        dryRun: false,
        fs,
        path,
        verifyState: () => Effect.void,
      });

      assert.deepEqual(result.versions, ["1.8.0"]);
      assert.isFalse(yield* fs.exists(removable.versionDir));
      assert.isTrue(yield* fs.exists(active.versionDir));
      assert.isTrue(yield* fs.exists(failedTarget.versionDir));
    }),
  );

  it.effect("removes candidates in order and revalidates state around each removal", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const first = yield* writeCompletedRuntime(fs, path, baseDir, "1.7.0");
      const second = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      let stateChecks = 0;

      const result = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs,
        path,
        verifyState: () => Effect.sync(() => void (stateChecks += 1)),
      });

      assert.deepEqual(result.versions, ["1.7.0", "1.8.0"]);
      assert.equal(stateChecks, 4);
      assert.isFalse(yield* fs.exists(first.versionDir));
      assert.isFalse(yield* fs.exists(second.versionDir));
    }),
  );

  it.effect("preserves every candidate when service state changes before removal", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const candidate = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const stateChanged = new PinnedRuntimePruneError({
        stage: "verifying service state",
        path: path.join(baseDir, "runtime", "service-state.json"),
        removedVersions: [],
      });

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs,
        path,
        verifyState: () => Effect.fail(stateChanged),
      }).pipe(Effect.flip);

      assert.strictEqual(error, stateChanged);
      assert.isTrue(yield* fs.exists(candidate.versionDir));
    }),
  );

  it.effect("refuses a concurrent mutating prune without touching runtimes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const candidate = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const lockPath = path.join(baseDir, "runtime", ".prune-lock");
      yield* fs.makeDirectory(lockPath);

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs,
        path,
        verifyState: () => Effect.void,
      }).pipe(Effect.flip);

      assert.instanceOf(error, PinnedRuntimePruneError);
      assert.equal(error.stage, "acquiring prune lock");
      assert.deepEqual(error.removedVersions, []);
      assert.isTrue(yield* fs.exists(candidate.versionDir));
      assert.isTrue(yield* fs.exists(lockPath));
    }),
  );

  it.effect("refuses a runtime that changes between selection and removal", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const candidate = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      let changed = false;

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs,
        path,
        verifyState: () =>
          changed
            ? Effect.void
            : fs
                .writeFileString(candidate.entryPath, "changed after selection\n")
                .pipe(Effect.tap(() => Effect.sync(() => void (changed = true)))),
      }).pipe(Effect.flip);

      assert.instanceOf(error, PinnedRuntimePruneError);
      assert.equal(error.stage, "revalidating runtime");
      assert.deepEqual(error.removedVersions, []);
      assert.isTrue(yield* fs.exists(candidate.versionDir));
    }),
  );

  it.effect("fails closed when a candidate path resolves outside its runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const candidate = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const escapingFs = FileSystem.FileSystem.of({
        ...fs,
        realPath: (target) =>
          target === candidate.entryPath
            ? Effect.succeed(path.join(baseDir, "outside", "bin.mjs"))
            : fs.realPath(target),
      });

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs: escapingFs,
        path,
        verifyState: () => Effect.void,
      }).pipe(Effect.flip);

      assert.equal(error._tag, "PinnedRuntimePruneError");
      if (error._tag !== "PinnedRuntimePruneError") return;
      assert.equal(error.stage, "inspecting runtimes");
      assert.equal(error.path, candidate.entryPath);
      assert.deepEqual(error.removedVersions, []);
      assert.isTrue(yield* fs.exists(candidate.versionDir));
    }),
  );

  it.effect("fails closed when the versions directory escapes the runtime root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const baseDir = path.join(root, "service");
      const outsideBaseDir = path.join(root, "outside");
      const candidate = yield* writeCompletedRuntime(fs, path, outsideBaseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, outsideBaseDir, "2.0.0");
      yield* fs.makeDirectory(path.join(baseDir, "runtime"), { recursive: true });
      yield* fs.symlink(
        path.join(outsideBaseDir, "runtime", "versions"),
        path.join(baseDir, "runtime", "versions"),
      );

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs,
        path,
        verifyState: () => Effect.void,
      }).pipe(Effect.flip);

      assert.equal(error._tag, "PinnedRuntimePruneError");
      if (error._tag !== "PinnedRuntimePruneError") return;
      assert.equal(error.stage, "inspecting runtimes");
      assert.equal(error.path, path.join(baseDir, "runtime", "versions"));
      assert.deepEqual(error.removedVersions, []);
      assert.isTrue(yield* fs.exists(candidate.versionDir));
    }),
  );

  it.effect("serializes concurrent mutating prune calls", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const firstCheckStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondLockAttempted = yield* Deferred.make<void>();
      let firstCheck = true;
      const lockPath = path.join(baseDir, "runtime", ".prune-lock");
      const input = {
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" } as const,
        dryRun: false,
        fs,
        path,
      };
      const first = yield* prunePinnedRuntimes({
        ...input,
        verifyState: () =>
          firstCheck
            ? Effect.sync(() => void (firstCheck = false)).pipe(
                Effect.andThen(Deferred.succeed(firstCheckStarted, undefined)),
                Effect.andThen(Deferred.await(releaseFirst)),
              )
            : Effect.void,
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(firstCheckStarted);
      const secondFs = FileSystem.FileSystem.of({
        ...fs,
        makeDirectory: (target, options) =>
          target === lockPath
            ? Deferred.succeed(secondLockAttempted, undefined).pipe(
                Effect.andThen(fs.makeDirectory(target, options)),
              )
            : fs.makeDirectory(target, options),
      });
      const second = yield* prunePinnedRuntimes({
        ...input,
        fs: secondFs,
        verifyState: () => Effect.void,
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(secondLockAttempted);
      yield* Deferred.succeed(releaseFirst, undefined);

      assert.deepEqual((yield* Fiber.join(first)).versions, ["1.8.0"]);
      const secondError = yield* Fiber.join(second).pipe(Effect.flip);
      assert.equal(secondError._tag, "PinnedRuntimePruneError");
      if (secondError._tag !== "PinnedRuntimePruneError") return;
      assert.equal(secondError.stage, "acquiring prune lock");
      assert.deepEqual(secondError.removedVersions, []);
    }),
  );

  it.effect("reports completed removals when a later deletion fails partially", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const first = yield* writeCompletedRuntime(fs, path, baseDir, "1.7.0");
      const second = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const failure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "remove",
        pathOrDescriptor: second.versionDir,
      });
      const failingFs = FileSystem.FileSystem.of({
        ...fs,
        remove: (target, options) =>
          target === second.versionDir
            ? fs.remove(second.sentinelPath).pipe(Effect.andThen(Effect.fail(failure)))
            : fs.remove(target, options),
      });

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs: failingFs,
        path,
        verifyState: () => Effect.void,
      }).pipe(Effect.flip);

      assert.instanceOf(error, PinnedRuntimePruneError);
      assert.equal(error.stage, "removing runtime");
      assert.equal(error.version, "1.8.0");
      assert.deepEqual(error.removedVersions, ["1.7.0"]);
      assert.isFalse(yield* fs.exists(first.versionDir));
      assert.isTrue(yield* fs.exists(second.versionDir));
      assert.isFalse(yield* fs.exists(second.sentinelPath));
    }),
  );

  it.effect("reports removals when the prune lock cannot be released", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-pinned-runtime-prune-" });
      const candidate = yield* writeCompletedRuntime(fs, path, baseDir, "1.8.0");
      yield* writeCompletedRuntime(fs, path, baseDir, "2.0.0");
      const lockPath = path.join(baseDir, "runtime", ".prune-lock");
      const failure = PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method: "remove",
        pathOrDescriptor: lockPath,
      });
      const failingFs = FileSystem.FileSystem.of({
        ...fs,
        remove: (target, options) =>
          target === lockPath ? Effect.fail(failure) : fs.remove(target, options),
      });

      const error = yield* prunePinnedRuntimes({
        baseDir,
        state: { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "2.0.0" },
        dryRun: false,
        fs: failingFs,
        path,
        verifyState: () => Effect.void,
      }).pipe(Effect.flip);

      assert.equal(error._tag, "PinnedRuntimePruneError");
      if (error._tag !== "PinnedRuntimePruneError") return;
      assert.equal(error.stage, "releasing prune lock");
      assert.deepEqual(error.removedVersions, ["1.8.0"]);
      assert.isFalse(yield* fs.exists(candidate.versionDir));
      assert.isTrue(yield* fs.exists(lockPath));
    }),
  );
});
