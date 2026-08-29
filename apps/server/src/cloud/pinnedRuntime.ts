import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Semaphore from "effect/Semaphore";

import * as ProcessRunner from "../processRunner.ts";
import {
  compareExactServiceVersions,
  isExactServiceVersion,
  type ServiceState,
} from "./serviceProtocol.ts";

/**
 * A pinned runtime is an exact `t3@<version>` npm-installed into
 * <baseDir>/runtime/versions/<version>. The boot service points its unit or
 * launch agent here, and server self-update installs the target version here before
 * switching over, never `npx t3`, whose cache is ephemeral and whose
 * registry fetch at boot would make startup depend on the network.
 */

const PINNED_RUNTIME_DIR = "runtime";
const PINNED_RUNTIME_INSTALL_TIMEOUT = Duration.minutes(10);
// Boot-service setup and remote update can construct separate layers. Serialize
// the complete install transaction across every caller in this process.
const pinnedRuntimeInstallLock = Semaphore.makeUnsafe(1);

export interface PinnedRuntimePaths {
  readonly versionDir: string;
  readonly entryPath: string;
  readonly sentinelPath: string;
}

export interface PinnedRuntimePruneRuntime {
  readonly version: string;
  readonly recoverableBytes: number;
}

export interface PinnedRuntimePruneResult {
  readonly dryRun: boolean;
  readonly versions: ReadonlyArray<string>;
  readonly runtimes: ReadonlyArray<PinnedRuntimePruneRuntime>;
  readonly recoverableBytes: number;
}

export function pinnedRuntimePaths(
  path: Path.Path,
  baseDir: string,
  version: string,
): PinnedRuntimePaths {
  const versionDir = path.join(baseDir, PINNED_RUNTIME_DIR, "versions", version);
  return {
    versionDir,
    entryPath: path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs"),
    sentinelPath: path.join(versionDir, ".install-complete"),
  };
}

export class PinnedRuntimeInstallError extends Schema.TaggedErrorClass<PinnedRuntimeInstallError>()(
  "PinnedRuntimeInstallError",
  {
    step: Schema.String,
    exitCode: Schema.optional(Schema.Number),
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.exitCode === undefined
      ? `Pinned runtime install failed while ${this.step}.`
      : `Pinned runtime install failed while ${this.step} (exit code ${this.exitCode}).`;
  }
}

export class PinnedRuntimePreflightBlockedError extends Schema.TaggedErrorClass<PinnedRuntimePreflightBlockedError>()(
  "PinnedRuntimePreflightBlockedError",
  {
    version: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class PinnedRuntimePruneError extends Schema.TaggedErrorClass<PinnedRuntimePruneError>()(
  "PinnedRuntimePruneError",
  {
    stage: Schema.Literals([
      "acquiring prune lock",
      "inspecting runtimes",
      "verifying service state",
      "revalidating runtime",
      "removing runtime",
      "verifying removal",
      "releasing prune lock",
    ]),
    path: Schema.String,
    version: Schema.optional(Schema.String),
    removedVersions: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const runtime = this.version === undefined ? "" : ` t3@${this.version}`;
    const removed =
      this.removedVersions.length === 0
        ? ""
        : ` Removed before the failure: ${this.removedVersions.map((version) => `t3@${version}`).join(", ")}.`;
    return `Could not safely prune${runtime} while ${this.stage} at '${this.path}'.${removed}`;
  }
}

/**
 * Installs `t3@<version>` into the pinned runtime directory unless a complete
 * install is already there, and returns its paths. The sentinel is written
 * only after npm exits 0; checking the entry file alone is not enough. npm
 * extracts files before running native builds (node-pty), so a killed
 * install leaves a plausible-looking but broken tree behind.
 */
interface PinnedRuntimeInstallInput {
  readonly baseDir: string;
  readonly version: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly runner: ProcessRunner.ProcessRunner["Service"];
  readonly validate: (
    paths: PinnedRuntimePaths,
  ) => Effect.Effect<void, PinnedRuntimeInstallError | PinnedRuntimePreflightBlockedError>;
}

const installPinnedRuntime = Effect.fn("cloud.pinned_runtime.ensure_installed")(function* (
  input: PinnedRuntimeInstallInput,
) {
  const { fs, runner } = input;
  const paths = pinnedRuntimePaths(input.path, input.baseDir, input.version);
  const [versionDirExists, entryExists, sentinel] = yield* Effect.all([
    fs.exists(paths.versionDir),
    fs.exists(paths.entryPath),
    fs.readFileString(paths.sentinelPath).pipe(Effect.option),
  ]).pipe(
    Effect.mapError(
      (cause) => new PinnedRuntimeInstallError({ step: "checking the pinned runtime", cause }),
    ),
  );
  const alreadyPinned =
    entryExists && Option.isSome(sentinel) && sentinel.value.trim() === input.version;
  if (alreadyPinned) {
    yield* input.validate(paths);
    return paths;
  }
  if (versionDirExists) {
    yield* fs.remove(paths.versionDir, { recursive: true, force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new PinnedRuntimeInstallError({
            step: "removing an incomplete pinned runtime",
            cause,
          }),
      ),
    );
  }

  const versionsDir = input.path.dirname(paths.versionDir);
  yield* fs.makeDirectory(versionsDir, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new PinnedRuntimeInstallError({
          step: "preparing the pinned runtime directory",
          cause,
        }),
    ),
  );
  const stagingDir = yield* fs
    .makeTempDirectory({
      directory: versionsDir,
      prefix: ".staging-",
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new PinnedRuntimeInstallError({
            step: "preparing the pinned runtime directory",
            cause,
          }),
      ),
    );
  const stagingPaths: PinnedRuntimePaths = {
    versionDir: stagingDir,
    entryPath: input.path.join(stagingDir, "node_modules", "t3", "dist", "bin.mjs"),
    sentinelPath: input.path.join(stagingDir, ".install-complete"),
  };

  return yield* Effect.gen(function* () {
    const installStep = "installing the pinned t3 runtime (this can take a few minutes)";
    yield* runner
      .run({
        command: "npm",
        args: ["install", "--prefix", stagingDir, "--no-fund", "--no-audit", `t3@${input.version}`],
        // Native dependencies may compile from source on slower machines.
        timeout: PINNED_RUNTIME_INSTALL_TIMEOUT,
      })
      .pipe(
        Effect.mapError((cause) => new PinnedRuntimeInstallError({ step: installStep, cause })),
        Effect.filterOrFail(
          (result) => result.code === 0,
          (result) =>
            new PinnedRuntimeInstallError({
              step: installStep,
              exitCode: Number(result.code),
              stdoutLength: result.stdout.length,
              stderrLength: result.stderr.length,
            }),
        ),
      );

    yield* input.validate(stagingPaths);
    yield* fs
      .writeFileString(stagingPaths.sentinelPath, `${input.version}\n`)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PinnedRuntimeInstallError({ step: "recording the completed install", cause }),
        ),
      );
    const published = yield* fs.rename(stagingDir, paths.versionDir).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.all([
          fs.exists(paths.entryPath),
          fs.readFileString(paths.sentinelPath).pipe(Effect.option),
        ]).pipe(
          Effect.mapError(
            (checkCause) =>
              new PinnedRuntimeInstallError({
                step: "checking a concurrently published pinned runtime",
                cause: checkCause,
              }),
          ),
          Effect.flatMap(([publishedEntryExists, publishedSentinel]) =>
            publishedEntryExists &&
            Option.isSome(publishedSentinel) &&
            publishedSentinel.value.trim() === input.version
              ? Effect.succeed(false)
              : Effect.fail(
                  new PinnedRuntimeInstallError({
                    step: "publishing the pinned runtime",
                    cause,
                  }),
                ),
          ),
        ),
      ),
    );
    if (!published) yield* input.validate(paths);
    return paths;
  }).pipe(
    Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
});

export const ensurePinnedRuntimeInstalled = (input: PinnedRuntimeInstallInput) =>
  pinnedRuntimeInstallLock.withPermit(installPinnedRuntime(input));

interface PinnedRuntimeInspection extends PinnedRuntimePruneRuntime {
  readonly fingerprint: string;
}

const compareVersionNames = (left: string, right: string): number => {
  const precedence = compareExactServiceVersions(left, right);
  if (precedence !== 0) return precedence;
  return left < right ? -1 : left > right ? 1 : 0;
};

const inspectPinnedRuntime = Effect.fn("cloud.pinned_runtime.inspect")(function* (input: {
  readonly version: string;
  readonly realVersionsDir: string;
  readonly baseDir: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  const paths = pinnedRuntimePaths(input.path, input.baseDir, input.version);
  if (Option.isSome(yield* input.fs.readLink(paths.versionDir).pipe(Effect.option))) {
    return Option.none<PinnedRuntimeInspection>();
  }
  const rootInfo = yield* input.fs.stat(paths.versionDir).pipe(Effect.option);
  if (Option.isNone(rootInfo) || rootInfo.value.type !== "Directory") {
    return Option.none<PinnedRuntimeInspection>();
  }
  const realVersionDir = yield* input.fs.realPath(paths.versionDir);
  if (realVersionDir !== input.path.join(input.realVersionsDir, input.version)) {
    return Option.none<PinnedRuntimeInspection>();
  }

  const [entryLink, sentinelLink, entryInfo, sentinelInfo, sentinel] = yield* Effect.all([
    input.fs.readLink(paths.entryPath).pipe(Effect.option),
    input.fs.readLink(paths.sentinelPath).pipe(Effect.option),
    input.fs.stat(paths.entryPath).pipe(Effect.option),
    input.fs.stat(paths.sentinelPath).pipe(Effect.option),
    input.fs.readFileString(paths.sentinelPath).pipe(Effect.option),
  ]);
  if (
    Option.isSome(entryLink) ||
    Option.isSome(sentinelLink) ||
    Option.isNone(entryInfo) ||
    entryInfo.value.type !== "File" ||
    Option.isNone(sentinelInfo) ||
    sentinelInfo.value.type !== "File" ||
    Option.isNone(sentinel) ||
    sentinel.value.trim() !== input.version
  ) {
    return Option.none<PinnedRuntimeInspection>();
  }

  let recoverableBytes = 0;
  const fingerprint: string[] = [];
  const inspectEntry = Effect.fn("cloud.pinned_runtime.inspect_entry")(function* (
    entryPath: string,
    relativePath: string,
  ): Effect.fn.Return<void, PlatformError.PlatformError | PinnedRuntimePruneError> {
    const link = yield* input.fs.readLink(entryPath).pipe(Effect.option);
    if (Option.isSome(link)) {
      fingerprint.push(`${relativePath}\0link\0${link.value}`);
      return;
    }

    const realEntryPath = yield* input.fs.realPath(entryPath);
    if (realEntryPath !== input.path.join(realVersionDir, relativePath)) {
      return yield* new PinnedRuntimePruneError({
        stage: "inspecting runtimes",
        path: entryPath,
        version: input.version,
        removedVersions: [],
      });
    }
    const info = yield* input.fs.stat(entryPath);
    if (info.type !== "Directory" && info.type !== "File") {
      return yield* new PinnedRuntimePruneError({
        stage: "inspecting runtimes",
        path: entryPath,
        version: input.version,
        removedVersions: [],
      });
    }
    const blocks = Option.getOrElse(info.blocks, () => Math.ceil(Number(info.size) / 512));
    recoverableBytes += blocks * 512;
    fingerprint.push(
      [
        relativePath,
        info.type,
        String(info.dev),
        Option.getOrElse(info.ino, () => -1).toString(),
        Number(info.size).toString(),
        blocks.toString(),
        Option.match(info.mtime, {
          onNone: () => "",
          onSome: (value) => value.toISOString(),
        }),
      ].join("\0"),
    );
    if (info.type === "File") return;

    const entries = yield* input.fs.readDirectory(entryPath);
    entries.sort();
    for (const entry of entries) {
      const childRelativePath = relativePath === "" ? entry : input.path.join(relativePath, entry);
      yield* inspectEntry(input.path.join(entryPath, entry), childRelativePath);
    }
  });

  yield* inspectEntry(paths.versionDir, "");
  return Option.some({
    version: input.version,
    recoverableBytes,
    fingerprint: fingerprint.join("\n"),
  } satisfies PinnedRuntimeInspection);
});

export interface PinnedRuntimeStateVerificationError {
  readonly _tag: string;
}

export interface PinnedRuntimePruneInput<E extends PinnedRuntimeStateVerificationError> {
  readonly baseDir: string;
  readonly state: ServiceState;
  readonly dryRun: boolean;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly verifyState: (removedVersions: ReadonlyArray<string>) => Effect.Effect<void, E>;
}

const prunePinnedRuntimesUnlocked = Effect.fn("cloud.pinned_runtime.prune")(function* <
  E extends PinnedRuntimeStateVerificationError,
>(
  input: PinnedRuntimePruneInput<E>,
): Effect.fn.Return<
  PinnedRuntimePruneResult,
  PlatformError.PlatformError | PinnedRuntimePruneError | E
> {
  const versionsDir = input.path.join(input.baseDir, PINNED_RUNTIME_DIR, "versions");
  if (!(yield* input.fs.exists(versionsDir))) {
    return {
      dryRun: input.dryRun,
      versions: [],
      runtimes: [],
      recoverableBytes: 0,
    } satisfies PinnedRuntimePruneResult;
  }

  const protectedVersions = new Set([
    input.state.activeVersion,
    ...(input.state.update === undefined
      ? []
      : [input.state.update.fromVersion, input.state.update.targetVersion]),
  ]);
  const runtimeDir = input.path.dirname(versionsDir);
  const realRuntimeDir = yield* input.fs.realPath(runtimeDir);
  const realVersionsDir = yield* input.fs.realPath(versionsDir);
  if (realVersionsDir !== input.path.join(realRuntimeDir, "versions")) {
    return yield* new PinnedRuntimePruneError({
      stage: "inspecting runtimes",
      path: versionsDir,
      removedVersions: [],
    });
  }
  const entries = yield* input.fs.readDirectory(versionsDir);
  entries.sort();
  const inspections: PinnedRuntimeInspection[] = [];
  for (const version of entries) {
    if (
      !isExactServiceVersion(version) ||
      protectedVersions.has(version) ||
      compareExactServiceVersions(version, input.state.activeVersion) >= 0
    ) {
      continue;
    }
    const inspection = yield* inspectPinnedRuntime({
      version,
      realVersionsDir,
      baseDir: input.baseDir,
      fs: input.fs,
      path: input.path,
    });
    if (Option.isSome(inspection)) inspections.push(inspection.value);
  }
  inspections.sort((left, right) => compareVersionNames(left.version, right.version));

  if (!input.dryRun) {
    const removedVersions: string[] = [];
    for (const inspection of inspections) {
      yield* input.verifyState(removedVersions);
      const current = yield* inspectPinnedRuntime({
        version: inspection.version,
        realVersionsDir,
        baseDir: input.baseDir,
        fs: input.fs,
        path: input.path,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new PinnedRuntimePruneError({
              stage: "revalidating runtime",
              path: pinnedRuntimePaths(input.path, input.baseDir, inspection.version).versionDir,
              version: inspection.version,
              removedVersions,
              cause,
            }),
        ),
      );
      if (Option.isNone(current) || current.value.fingerprint !== inspection.fingerprint) {
        return yield* new PinnedRuntimePruneError({
          stage: "revalidating runtime",
          path: pinnedRuntimePaths(input.path, input.baseDir, inspection.version).versionDir,
          version: inspection.version,
          removedVersions,
        });
      }
      const versionDir = pinnedRuntimePaths(
        input.path,
        input.baseDir,
        inspection.version,
      ).versionDir;
      yield* input.fs.remove(versionDir, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new PinnedRuntimePruneError({
              stage: "removing runtime",
              path: versionDir,
              version: inspection.version,
              removedVersions,
              cause,
            }),
        ),
      );
      const stillExists = yield* input.fs.exists(versionDir).pipe(
        Effect.mapError(
          (cause) =>
            new PinnedRuntimePruneError({
              stage: "verifying removal",
              path: versionDir,
              version: inspection.version,
              removedVersions,
              cause,
            }),
        ),
      );
      if (stillExists) {
        return yield* new PinnedRuntimePruneError({
          stage: "verifying removal",
          path: versionDir,
          version: inspection.version,
          removedVersions,
        });
      }
      removedVersions.push(inspection.version);
      yield* input.verifyState(removedVersions);
    }
  }

  const runtimes = inspections.map(({ version, recoverableBytes }) => ({
    version,
    recoverableBytes,
  }));
  return {
    dryRun: input.dryRun,
    versions: runtimes.map((runtime) => runtime.version),
    runtimes,
    recoverableBytes: runtimes.reduce((total, runtime) => total + runtime.recoverableBytes, 0),
  } satisfies PinnedRuntimePruneResult;
});

export const prunePinnedRuntimes = <E extends PinnedRuntimeStateVerificationError>(
  input: PinnedRuntimePruneInput<E>,
): Effect.Effect<
  PinnedRuntimePruneResult,
  PlatformError.PlatformError | PinnedRuntimePruneError | E
> =>
  input.dryRun
    ? prunePinnedRuntimesUnlocked(input)
    : Effect.gen(function* () {
        const versionsDir = input.path.join(input.baseDir, PINNED_RUNTIME_DIR, "versions");
        if (!(yield* input.fs.exists(versionsDir))) {
          return yield* prunePinnedRuntimesUnlocked(input);
        }
        const lockPath = input.path.join(input.baseDir, PINNED_RUNTIME_DIR, ".prune-lock");
        yield* input.fs.makeDirectory(lockPath).pipe(
          Effect.mapError(
            (cause) =>
              new PinnedRuntimePruneError({
                stage: "acquiring prune lock",
                path: lockPath,
                removedVersions: [],
                cause,
              }),
          ),
        );
        const result = yield* prunePinnedRuntimesUnlocked(input).pipe(
          Effect.ensuring(
            input.fs.remove(lockPath, { force: true, recursive: true }).pipe(Effect.ignore),
          ),
        );
        const lockRemains = yield* input.fs.exists(lockPath).pipe(
          Effect.mapError(
            (cause) =>
              new PinnedRuntimePruneError({
                stage: "releasing prune lock",
                path: lockPath,
                removedVersions: result.versions,
                cause,
              }),
          ),
        );
        if (lockRemains) {
          return yield* new PinnedRuntimePruneError({
            stage: "releasing prune lock",
            path: lockPath,
            removedVersions: result.versions,
          });
        }
        return result;
      });
