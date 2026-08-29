import * as Clock from "effect/Clock";
import type {
  RelayClientInstallProgressEvent,
  RelayClientInstallProgressStage,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { HostProcessArchitecture, HostProcessPlatform } from "./hostProcess.ts";

export const CLOUDFLARED_VERSION = "2026.5.2";
export const CLOUDFLARED_PATH_ENV_NAME = "T3CODE_CLOUDFLARED_PATH";

export type RelayClientExecutableSource = "override" | "managed" | "path";

export type RelayClientStatus =
  | {
      readonly status: "available";
      readonly executablePath: string;
      readonly source: RelayClientExecutableSource;
      readonly version: string;
    }
  | {
      readonly status: "missing";
      readonly version: string;
    }
  | {
      readonly status: "unsupported";
      readonly platform: NodeJS.Platform;
      readonly arch: string;
      readonly version: string;
    };

export type AvailableRelayClient = Extract<RelayClientStatus, { readonly status: "available" }>;

export class RelayClientInstallError extends Data.TaggedError("RelayClientInstallError")<{
  readonly reason:
    | "download_failed"
    | "invalid_checksum"
    | "install_locked"
    | "override_missing"
    | "unsupported_platform"
    | "validation_failed"
    | "write_failed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

class CloudflaredCommandError extends Data.TaggedError("CloudflaredCommandError")<{
  readonly command: string;
  readonly failure: "exit" | "invalid_output" | "timeout";
  readonly exitCode?: number;
}> {}

export interface CloudflaredReleaseAsset {
  readonly url: string;
  readonly sha256: string;
  readonly archive: "binary" | "tgz";
}

const CLOUDFLARED_RELEASE_ASSETS: Readonly<
  Partial<Record<`${NodeJS.Platform}-${string}`, CloudflaredReleaseAsset>>
> = {
  "darwin-arm64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-darwin-arm64.tgz",
    sha256: "ba94054c9fd4297645093d59d51442e5e546d07bb0516120e694a13d5b216d38",
    archive: "tgz",
  },
  "darwin-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-darwin-amd64.tgz",
    sha256: "7240f709506bc2c1eb9da4d89cf2555499c60280ecb854b7d80e8f17d4b7903d",
    archive: "tgz",
  },
  "linux-arm64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-linux-arm64",
    sha256: "5a4e8ce2701105271412059f44b6a0bf1ae4542b4d98ff3180c0c019443a5815",
    archive: "binary",
  },
  "linux-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-linux-amd64",
    sha256: "5286698547f03df745adb2355f04c12dde52ef425491e81f433642d695521886",
    archive: "binary",
  },
  "win32-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-windows-amd64.exe",
    sha256: "20b9638f685333d623798e733effbad2487093f15ba592f6c7752360ff3b7ab7",
    archive: "binary",
  },
};

const INSTALL_LOCK_RETRY_COUNT = 100;
const INSTALL_LOCK_RETRY_DELAY = "100 millis";
const INSTALL_LOCK_STALE_MS = 5 * 60 * 1_000;
const RELAY_CLIENT_VALIDATION_TIMEOUT = "10 seconds";
const WINDOWS_SIGNATURE_PATH_ENV_NAME = "T3CODE_CLOUDFLARED_SIGNATURE_PATH";
const WINDOWS_SIGNATURE_SCRIPT = [
  `$signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:${WINDOWS_SIGNATURE_PATH_ENV_NAME}`,
  "if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { exit 1 }",
  "Write-Output 'Valid'",
].join("; ");

interface CloudflaredCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const trimmedString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Config.map(
      Option.flatMap((value) => {
        const trimmed = value.trim();
        return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
      }),
    ),
  );

const CloudflaredConfig = Config.all({
  executableOverride: trimmedString(CLOUDFLARED_PATH_ENV_NAME),
  path: trimmedString("PATH"),
});

export interface CloudflaredRelayClientOptions {
  readonly baseDir: string;
  readonly releaseAsset?: CloudflaredReleaseAsset;
}

export interface RelayClientShape {
  readonly resolve: Effect.Effect<RelayClientStatus>;
  readonly install: Effect.Effect<AvailableRelayClient, RelayClientInstallError>;
  readonly installWithProgress: (
    report: (event: RelayClientInstallProgressEvent) => Effect.Effect<void>,
  ) => Effect.Effect<AvailableRelayClient, RelayClientInstallError>;
}

export class RelayClient extends Context.Service<RelayClient, RelayClientShape>()(
  "@t3tools/shared/relayClient",
) {}

function executableFileName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

function resolveReleaseAsset(
  platform: NodeJS.Platform,
  arch: string,
): CloudflaredReleaseAsset | null {
  return CLOUDFLARED_RELEASE_ASSETS[`${platform}-${arch}`] ?? null;
}

function isAlreadyExists(error: PlatformError.PlatformError): boolean {
  return error.reason._tag === "AlreadyExists";
}

export function parseCloudflaredVersion(output: string): string | null {
  const match = /^cloudflared version (\d+\.\d+\.\d+)(?: \(built [^()\r\n]+\))?$/u.exec(
    output.trim(),
  );
  return match?.[1] ?? null;
}

const wrapInstallFailure =
  (
    reason: RelayClientInstallError["reason"],
    message: string,
  ): (<E, R>(
    effect: Effect.Effect<void, E, R>,
  ) => Effect.Effect<void, RelayClientInstallError, R>) =>
  (effect) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new RelayClientInstallError({
            reason,
            message,
            cause,
          }),
      ),
    );

export const makeCloudflaredRelayClient = Effect.fn("cloudflared.make")(function* (
  options: CloudflaredRelayClientOptions,
): Effect.fn.Return<
  RelayClientShape,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
> {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const installSemaphore = yield* Semaphore.make(1);
  const platform = yield* HostProcessPlatform;
  const arch = yield* HostProcessArchitecture;
  const releaseAsset = options.releaseAsset ?? resolveReleaseAsset(platform, arch);
  const loadCloudflaredConfig = Effect.suspend(() => CloudflaredConfig).pipe(Effect.orDie);
  const managedPath = path.join(
    options.baseDir,
    "tools",
    "cloudflared",
    CLOUDFLARED_VERSION,
    `${platform}-${arch}`,
    executableFileName(platform),
  );

  const isExecutableFile = Effect.fn("cloudflared.isExecutableFile")(function* (
    executablePath: string,
  ) {
    const info = yield* fileSystem.stat(executablePath).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "File") return false;
    return platform === "win32" || (info.value.mode & 0o111) !== 0;
  });

  const resolvePathExecutable = Effect.gen(function* () {
    const config = yield* loadCloudflaredConfig;
    const pathValue = Option.getOrUndefined(config.path);
    if (!pathValue) return null;
    const delimiter = platform === "win32" ? ";" : ":";
    for (const directory of pathValue.split(delimiter)) {
      const trimmed = directory.trim().replace(/^"|"$/gu, "");
      if (trimmed.length === 0) continue;
      const candidate = path.join(trimmed, executableFileName(platform));
      if (yield* isExecutableFile(candidate)) return candidate;
    }
    return null;
  });

  const resolve: RelayClientShape["resolve"] = Effect.gen(function* () {
    const config = yield* loadCloudflaredConfig;
    if (Option.isSome(config.executableOverride)) {
      return (yield* isExecutableFile(config.executableOverride.value))
        ? {
            status: "available",
            executablePath: config.executableOverride.value,
            source: "override",
            version: CLOUDFLARED_VERSION,
          }
        : { status: "missing", version: CLOUDFLARED_VERSION };
    }
    if (yield* isExecutableFile(managedPath)) {
      return {
        status: "available",
        executablePath: managedPath,
        source: "managed",
        version: CLOUDFLARED_VERSION,
      };
    }
    const pathExecutable = yield* resolvePathExecutable;
    if (pathExecutable) {
      return {
        status: "available",
        executablePath: pathExecutable,
        source: "path",
        version: CLOUDFLARED_VERSION,
      };
    }
    return releaseAsset
      ? { status: "missing", version: CLOUDFLARED_VERSION }
      : {
          status: "unsupported",
          platform,
          arch,
          version: CLOUDFLARED_VERSION,
        };
  });

  const runCommand = Effect.fn("cloudflared.runCommand")(function* (
    command: string,
    args: ReadonlyArray<string>,
    env?: Readonly<Record<string, string>>,
  ) {
    return yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          ...(env ? { env, extendEnv: true } : {}),
          shell: false,
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          child.stdout.pipe(
            Stream.decodeText(),
            Stream.runFold(
              () => "",
              (output, chunk) => `${output}${chunk}`,
            ),
          ),
          child.stderr.pipe(
            Stream.decodeText(),
            Stream.runFold(
              () => "",
              (output, chunk) => `${output}${chunk}`,
            ),
          ),
          child.exitCode.pipe(Effect.map(Number)),
        ],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode } satisfies CloudflaredCommandResult;
    }).pipe(Effect.scoped);
  });

  const runSuccessfulCommand = Effect.fn("cloudflared.runSuccessfulCommand")(function* (
    command: string,
    args: ReadonlyArray<string>,
    env?: Readonly<Record<string, string>>,
  ) {
    const result = yield* runCommand(command, args, env);
    if (result.exitCode !== 0) {
      return yield* new CloudflaredCommandError({
        command,
        failure: "exit",
        exitCode: result.exitCode,
      });
    }
    return result;
  });

  const runBoundedCommand = (
    command: string,
    args: ReadonlyArray<string>,
    env?: Readonly<Record<string, string>>,
  ) =>
    runCommand(command, args, env).pipe(
      Effect.timeoutOption(RELAY_CLIENT_VALIDATION_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new CloudflaredCommandError({ command, failure: "timeout" })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const validateVersionOutput = (result: CloudflaredCommandResult) => {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    return parseCloudflaredVersion(output) === CLOUDFLARED_VERSION;
  };

  const validateCloudflaredVersion = Effect.fn("cloudflared.validateVersion")(function* (
    executablePath: string,
  ) {
    const preferred = yield* runBoundedCommand(executablePath, ["version"]);
    if (preferred.exitCode === 0) {
      if (validateVersionOutput(preferred)) return;
      return yield* new CloudflaredCommandError({
        command: executablePath,
        failure: "invalid_output",
        exitCode: preferred.exitCode,
      });
    }
    if (preferred.exitCode !== 1) {
      return yield* new CloudflaredCommandError({
        command: executablePath,
        failure: "exit",
        exitCode: preferred.exitCode,
      });
    }

    const legacy = yield* runBoundedCommand(executablePath, ["--version"]);
    if (legacy.exitCode !== 0 || !validateVersionOutput(legacy)) {
      return yield* new CloudflaredCommandError({
        command: executablePath,
        failure: legacy.exitCode === 0 ? "invalid_output" : "exit",
        exitCode: legacy.exitCode,
      });
    }
  });

  const validateWindowsSignature = Effect.fn("cloudflared.validateWindowsSignature")(function* (
    executablePath: string,
  ) {
    if (platform !== "win32") return;
    const result = yield* runBoundedCommand(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SIGNATURE_SCRIPT],
      { [WINDOWS_SIGNATURE_PATH_ENV_NAME]: executablePath },
    );
    if (result.exitCode !== 0 || result.stdout.trim() !== "Valid" || result.stderr.trim() !== "") {
      return yield* new CloudflaredCommandError({
        command: "powershell.exe",
        failure: result.exitCode === 0 ? "invalid_output" : "exit",
        exitCode: result.exitCode,
      });
    }
  });

  const realPathContainedBy = Effect.fn("cloudflared.realPathContainedBy")(function* (
    root: string,
    candidate: string,
  ) {
    const [realRoot, realCandidate] = yield* Effect.all([
      fileSystem.realPath(root),
      fileSystem.realPath(candidate),
    ]);
    const relative = path.relative(realRoot, realCandidate);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  });

  const downloadAsset = Effect.fn("cloudflared.downloadAsset")(function* (
    asset: CloudflaredReleaseAsset,
    report: (stage: RelayClientInstallProgressStage) => Effect.Effect<void>,
  ) {
    yield* report("downloading");
    const response = yield* httpClient.execute(HttpClientRequest.get(asset.url)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError(
        (cause) =>
          new RelayClientInstallError({
            reason: "download_failed",
            message: "Could not download the relay client.",
            cause,
          }),
      ),
    );
    const bytes = new Uint8Array(
      yield* response.arrayBuffer.pipe(
        Effect.mapError(
          (cause) =>
            new RelayClientInstallError({
              reason: "download_failed",
              message: "Could not read the downloaded relay client binary.",
              cause,
            }),
        ),
      ),
    );
    yield* report("verifying");
    const checksum = yield* crypto.digest("SHA-256", bytes).pipe(
      Effect.mapError(
        (cause) =>
          new RelayClientInstallError({
            reason: "validation_failed",
            message: "Could not verify the downloaded relay client checksum.",
            cause,
          }),
      ),
    );
    if (Encoding.encodeHex(checksum) !== asset.sha256) {
      return yield* new RelayClientInstallError({
        reason: "invalid_checksum",
        message: "Downloaded relay client checksum did not match the pinned release.",
      });
    }
    return bytes;
  });

  const acquireInstallLock = Effect.fn("cloudflared.acquireInstallLock")(function* (
    lockPath: string,
  ) {
    for (let attempt = 0; attempt < INSTALL_LOCK_RETRY_COUNT; attempt += 1) {
      const acquired = yield* fileSystem.writeFileString(lockPath, "", { flag: "wx" }).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          isAlreadyExists(error) ? Effect.succeed(false) : Effect.fail(error),
        ),
      );
      if (acquired) return;

      const now = yield* Clock.currentTimeMillis;
      const lockInfo = yield* fileSystem.stat(lockPath).pipe(Effect.option);
      const mtime = Option.flatMap(lockInfo, (info) => info.mtime);
      if (Option.isSome(mtime) && now - mtime.value.getTime() > INSTALL_LOCK_STALE_MS) {
        yield* fileSystem.remove(lockPath, { force: true });
        continue;
      }
      yield* Effect.sleep(INSTALL_LOCK_RETRY_DELAY);
    }
    return yield* new RelayClientInstallError({
      reason: "install_locked",
      message: "Another relay client installation is still in progress.",
    });
  });

  const installUnlocked = Effect.fn("cloudflared.installUnlocked")(function* (
    report: (stage: RelayClientInstallProgressStage) => Effect.Effect<void>,
  ) {
    yield* report("checking");
    const existing = yield* resolve;
    if (existing.status === "available" && existing.source !== "managed") return existing;
    const config = yield* loadCloudflaredConfig;
    if (Option.isSome(config.executableOverride)) {
      return yield* new RelayClientInstallError({
        reason: "override_missing",
        message: `${CLOUDFLARED_PATH_ENV_NAME} does not point to an executable file.`,
      });
    }
    if (!releaseAsset && !(existing.status === "available" && existing.source === "managed")) {
      return yield* new RelayClientInstallError({
        reason: "unsupported_platform",
        message: `T3 Code does not provide a managed relay client binary for ${platform}-${arch}.`,
      });
    }

    const managedDirectory = path.dirname(managedPath);
    const lockPath = `${managedPath}.lock`;
    yield* fileSystem
      .makeDirectory(managedDirectory, { recursive: true })
      .pipe(
        wrapInstallFailure("write_failed", "Could not create the relay client tool directory."),
      );
    const managedDirectoryIsContained = yield* realPathContainedBy(
      options.baseDir,
      managedDirectory,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RelayClientInstallError({
            reason: "validation_failed",
            message: "Could not validate the managed relay client directory.",
            cause,
          }),
      ),
    );
    if (!managedDirectoryIsContained) {
      return yield* new RelayClientInstallError({
        reason: "validation_failed",
        message: "The managed relay client directory escaped the T3 Code home directory.",
      });
    }
    yield* report("waiting_for_lock");
    yield* acquireInstallLock(lockPath).pipe(
      Effect.catchTag("PlatformError", (cause) =>
        Effect.fail(
          new RelayClientInstallError({
            reason: "write_failed",
            message: "Could not acquire the relay client installation lock.",
            cause,
          }),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      const afterLock = yield* resolve;
      if (afterLock.status === "available") return afterLock;
      if (!releaseAsset) {
        return yield* new RelayClientInstallError({
          reason: "unsupported_platform",
          message: `T3 Code does not provide a managed relay client binary for ${platform}-${arch}.`,
        });
      }

      const tempDirectory = yield* fileSystem.makeTempDirectory({
        directory: managedDirectory,
        prefix: ".install-",
      });
      if (!(yield* realPathContainedBy(managedDirectory, tempDirectory))) {
        return yield* new RelayClientInstallError({
          reason: "validation_failed",
          message: "The relay client staging directory escaped the managed tool directory.",
        });
      }
      const archivePath = path.join(
        tempDirectory,
        releaseAsset.archive === "tgz" ? "cloudflared.tgz" : executableFileName(platform),
      );
      const download = yield* downloadAsset(releaseAsset, report);
      yield* report("installing");
      yield* fileSystem
        .writeFile(archivePath, download)
        .pipe(wrapInstallFailure("write_failed", "Could not write the relay client download."));

      const executablePath = path.join(tempDirectory, executableFileName(platform));
      if (releaseAsset.archive === "tgz") {
        yield* runSuccessfulCommand("tar", ["-xzf", archivePath, "-C", tempDirectory]).pipe(
          wrapInstallFailure("write_failed", "Could not extract the relay client."),
        );
      }
      if (platform !== "win32") {
        yield* fileSystem
          .chmod(executablePath, 0o755)
          .pipe(wrapInstallFailure("write_failed", "Could not make the relay client executable."));
      }
      yield* report("validating");
      if (!(yield* realPathContainedBy(tempDirectory, executablePath))) {
        return yield* new RelayClientInstallError({
          reason: "validation_failed",
          message: "The downloaded relay client executable escaped its staging directory.",
        });
      }
      yield* validateWindowsSignature(executablePath).pipe(
        Effect.mapError(
          (cause) =>
            new RelayClientInstallError({
              reason: "validation_failed",
              message:
                cause instanceof CloudflaredCommandError && cause.failure === "timeout"
                  ? "Timed out while validating the downloaded relay client signature."
                  : "The downloaded relay client signature was not valid.",
              cause,
            }),
        ),
      );
      yield* validateCloudflaredVersion(executablePath).pipe(
        Effect.mapError(
          (cause) =>
            new RelayClientInstallError({
              reason: "validation_failed",
              message:
                cause instanceof CloudflaredCommandError && cause.failure === "timeout"
                  ? "Timed out while validating the downloaded relay client version."
                  : cause instanceof CloudflaredCommandError && cause.failure === "invalid_output"
                    ? `The downloaded relay client did not report version ${CLOUDFLARED_VERSION}.`
                    : "The downloaded relay client binary did not run successfully.",
              cause,
            }),
        ),
      );

      const stagedPath = `${managedPath}.${yield* crypto.randomUUIDv4}.tmp`;
      yield* report("activating");
      yield* Effect.gen(function* () {
        yield* fileSystem
          .rename(executablePath, stagedPath)
          .pipe(wrapInstallFailure("write_failed", "Could not stage the relay client."));
        yield* fileSystem
          .rename(stagedPath, managedPath)
          .pipe(wrapInstallFailure("write_failed", "Could not activate the relay client."));
      }).pipe(
        Effect.onExit(() =>
          fileSystem
            .remove(stagedPath, { force: true })
            .pipe(
              wrapInstallFailure(
                "write_failed",
                "Could not remove the relay client activation staging file.",
              ),
            ),
        ),
      );
      return {
        status: "available",
        executablePath: managedPath,
        source: "managed",
        version: CLOUDFLARED_VERSION,
      } satisfies AvailableRelayClient;
    }).pipe(
      Effect.onExit(() =>
        fileSystem.readDirectory(managedDirectory).pipe(
          Effect.flatMap((entries) =>
            Effect.forEach(
              entries.filter((entry) => entry.startsWith(".install-")),
              (entry) =>
                fileSystem.remove(path.join(managedDirectory, entry), {
                  recursive: true,
                  force: true,
                }),
              { concurrency: 1, discard: true },
            ),
          ),
          wrapInstallFailure(
            "write_failed",
            "Could not remove relay client installation staging directories.",
          ),
        ),
      ),
      Effect.onExit(() =>
        fileSystem
          .remove(lockPath, { force: true })
          .pipe(
            wrapInstallFailure(
              "write_failed",
              "Could not release the relay client installation lock.",
            ),
          ),
      ),
      Effect.catch((cause) =>
        cause instanceof RelayClientInstallError
          ? Effect.fail(cause)
          : Effect.fail(
              new RelayClientInstallError({
                reason: "write_failed",
                message: "Could not install the relay client.",
                cause,
              }),
            ),
      ),
    );
  });
  const installWithProgress: RelayClientShape["installWithProgress"] = (report) =>
    installSemaphore.withPermit(
      installUnlocked((stage) =>
        report({
          type: "progress",
          stage,
        }),
      ),
    );
  const install = installWithProgress(() => Effect.void);

  return RelayClient.of({ resolve, install, installWithProgress });
});

export const layerCloudflared = (options: CloudflaredRelayClientOptions) =>
  Layer.effect(RelayClient, makeCloudflaredRelayClient(options));
