import { sha256 } from "@noble/hashes/sha2";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { HostProcessArchitecture, HostProcessPlatform } from "./hostProcess.ts";

import {
  RelayClientInstallError,
  CLOUDFLARED_VERSION,
  makeCloudflaredRelayClient,
  parseCloudflaredVersion,
} from "./relayClient.ts";

const hostRuntimeLayer = (
  env: Record<string, string> = {},
  platform: NodeJS.Platform = "linux",
  arch: NodeJS.Architecture = "x64",
) =>
  Layer.mergeAll(
    Layer.succeed(HostProcessPlatform, platform),
    Layer.succeed(HostProcessArchitecture, arch),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
  );

interface CommandResponse {
  readonly exitCode?: number;
  readonly exitCodeEffect?: Effect.Effect<ChildProcessSpawner.ExitCode>;
  readonly stdout?: string;
  readonly stderr?: string;
}

interface SpawnedCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

function makeHandle(response: CommandResponse = {}) {
  const encode = (value: string | undefined) =>
    value === undefined || value === ""
      ? Stream.empty
      : Stream.make(new TextEncoder().encode(value));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(100),
    exitCode:
      response.exitCodeEffect ??
      Effect.succeed(ChildProcessSpawner.ExitCode(response.exitCode ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: encode(response.stdout),
    stderr: encode(response.stderr),
    all: encode(`${response.stdout ?? ""}${response.stderr ?? ""}`),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const makeHttpClientLayer = (bytes: Uint8Array) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(bytes.buffer as ArrayBuffer)),
      ),
    ),
  );

const defaultCommandResponse = (command: SpawnedCommand): CommandResponse => {
  if (command.command === "powershell.exe") return { stdout: "Valid\n" };
  if (command.args[0] === "version" || command.args[0] === "--version") {
    return { stdout: `cloudflared version ${CLOUDFLARED_VERSION} (built test)\n` };
  }
  return {};
};

const makeSpawnerLayer = (
  commands: Array<SpawnedCommand>,
  respond: (command: SpawnedCommand) => CommandResponse = defaultCommandResponse,
) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const spawned = ChildProcess.isStandardCommand(command)
          ? {
              command: command.command,
              args: command.args,
            }
          : { command: "piped-command", args: [] };
        commands.push(spawned);
        return makeHandle(respond(spawned));
      }),
    ),
  );

describe("RelayClient", () => {
  it("parses only canonical cloudflared version output", () => {
    expect(
      parseCloudflaredVersion("cloudflared version 2026.5.2 (built 2026-05-27T10:15 UTC)"),
    ).toBe("2026.5.2");
    expect(parseCloudflaredVersion("cloudflared version 2025.1.0")).toBe("2025.1.0");
    expect(parseCloudflaredVersion("cloudflared 2026.5.2")).toBeNull();
    expect(parseCloudflaredVersion("ok\ncloudflared version 2026.5.2")).toBeNull();
  });

  it.effect("resolves explicit overrides before managed and PATH executables", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-test-",
      });
      const overridePath = `${baseDir}/override-cloudflared`;
      yield* fileSystem.writeFileString(overridePath, "override");
      yield* fileSystem.chmod(overridePath, 0o755);
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
      });

      expect(
        yield* manager.resolve.pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnv({
              env: { PATH: "", T3CODE_CLOUDFLARED_PATH: overridePath },
            }),
          ),
        ),
      ).toEqual({
        status: "available",
        executablePath: overridePath,
        source: "override",
        version: CLOUDFLARED_VERSION,
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(new Uint8Array()),
          makeSpawnerLayer([]),
          hostRuntimeLayer(),
        ),
      ),
    ),
  );

  it.effect("downloads, verifies, validates, and atomically installs the managed executable", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-test-",
      });
      const bytes = new TextEncoder().encode("test-cloudflared-binary");
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const progress: Array<string> = [];
      const installed = yield* manager.installWithProgress((event) =>
        Effect.sync(() => {
          if (event.type === "progress") {
            progress.push(event.stage);
          }
        }),
      );
      const managedPath = `${baseDir}/tools/cloudflared/${CLOUDFLARED_VERSION}/linux-x64/cloudflared`;
      expect(installed).toEqual({
        status: "available",
        executablePath: managedPath,
        source: "managed",
        version: CLOUDFLARED_VERSION,
      });
      expect(new TextDecoder().decode(yield* fileSystem.readFile(managedPath))).toBe(
        "test-cloudflared-binary",
      );
      expect(progress).toEqual([
        "checking",
        "waiting_for_lock",
        "downloading",
        "verifying",
        "installing",
        "validating",
        "activating",
      ]);
      expect(yield* manager.resolve).toEqual(installed);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(new TextEncoder().encode("test-cloudflared-binary")),
          makeSpawnerLayer([]),
          hostRuntimeLayer(),
        ),
      ),
    ),
  );

  it.effect("rejects downloads whose checksum does not match the pinned manifest", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(new TextEncoder().encode("expected"))),
          archive: "binary",
        },
      });

      const error = yield* manager.install.pipe(Effect.flip);
      expect(error).toBeInstanceOf(RelayClientInstallError);
      expect(error.reason).toBe("invalid_checksum");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(new TextEncoder().encode("tampered")),
          makeSpawnerLayer([]),
          hostRuntimeLayer(),
        ),
      ),
    ),
  );

  it.effect("serializes concurrent installs within one runtime", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("test-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const [first, second] = yield* Effect.all([manager.install, manager.install], {
        concurrency: "unbounded",
      });
      expect(second).toEqual(first);
      expect(commands).toHaveLength(1);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect("observes PATH changes after the manager has been constructed", () => {
    const env = { PATH: "" };
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-test-",
      });
      const binDir = `${baseDir}/bin`;
      const executablePath = `${binDir}/cloudflared`;
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
      });

      expect(yield* manager.resolve).toEqual({
        status: "missing",
        version: CLOUDFLARED_VERSION,
      });

      yield* fileSystem.makeDirectory(binDir);
      yield* fileSystem.writeFileString(executablePath, "cloudflared");
      yield* fileSystem.chmod(executablePath, 0o755);
      env.PATH = binDir;

      expect(yield* manager.resolve).toEqual({
        status: "available",
        executablePath,
        source: "path",
        version: CLOUDFLARED_VERSION,
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(new Uint8Array()),
          makeSpawnerLayer([]),
          hostRuntimeLayer(env),
        ),
      ),
    );
  });

  it.effect("validates the signed Windows binary with the supported version command", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("windows-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-windows-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared.exe",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const installed = yield* manager.install;
      expect(installed.executablePath).toBe(
        `${baseDir}/tools/cloudflared/${CLOUDFLARED_VERSION}/win32-x64/cloudflared.exe`,
      );
      expect(commands.map(({ command, args }) => [command, ...args])).toEqual([
        [
          "powershell.exe",
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          expect.stringContaining("Get-AuthenticodeSignature"),
        ],
        [expect.stringContaining("cloudflared.exe"), "version"],
      ]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands),
          hostRuntimeLayer({}, "win32", "x64"),
        ),
      ),
    );
  });

  it.effect("falls back to legacy --version only after the version command is rejected", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("legacy-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-legacy-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      yield* manager.install;
      expect(commands.map(({ args }) => args)).toEqual([["version"], ["--version"]]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands, (command) =>
            command.args[0] === "version"
              ? { exitCode: 1, stderr: "unsupported flag\n" }
              : defaultCommandResponse(command),
          ),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect("does not accept the wrong reported version or try a trust-expanding fallback", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("wrong-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-malformed-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const error = yield* manager.install.pipe(Effect.flip);
      expect(error.reason).toBe("validation_failed");
      expect(error.message).toContain(`did not report version ${CLOUDFLARED_VERSION}`);
      expect(commands.map(({ args }) => args)).toEqual([["version"]]);
      const managedDirectory = `${baseDir}/tools/cloudflared/${CLOUDFLARED_VERSION}/linux-x64`;
      expect(
        (yield* fileSystem.readDirectory(managedDirectory)).filter((entry) =>
          entry.startsWith(".install-"),
        ),
      ).toEqual([]);
      expect(yield* manager.resolve).toEqual({
        status: "missing",
        version: CLOUDFLARED_VERSION,
      });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands, () => ({
            stdout: "cloudflared version 2026.5.1 (built test)\n",
          })),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect(
    "rejects an invalid Windows signature before executing the binary and cleans staging",
    () => {
      const commands: Array<SpawnedCommand> = [];
      const bytes = new TextEncoder().encode("unsigned-cloudflared-binary");
      return Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-cloudflared-signature-test-",
        });
        const manager = yield* makeCloudflaredRelayClient({
          baseDir,
          releaseAsset: {
            url: "https://example.test/cloudflared.exe",
            sha256: Encoding.encodeHex(sha256(bytes)),
            archive: "binary",
          },
        });

        const error = yield* manager.install.pipe(Effect.flip);
        expect(error.reason).toBe("validation_failed");
        expect(error.message).toContain("signature was not valid");
        expect(commands.map(({ command }) => command)).toEqual(["powershell.exe"]);
        const managedDirectory = `${baseDir}/tools/cloudflared/${CLOUDFLARED_VERSION}/win32-x64`;
        expect(
          (yield* fileSystem.readDirectory(managedDirectory)).filter((entry) =>
            entry.startsWith(".install-"),
          ),
        ).toEqual([]);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            makeHttpClientLayer(bytes),
            makeSpawnerLayer(commands, () => ({ exitCode: 1, stderr: "NotSigned\n" })),
            hostRuntimeLayer({}, "win32", "x64"),
          ),
        ),
      );
    },
  );

  it.effect("does not fall back after the preferred version probe crashes", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("crashing-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-crash-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const error = yield* manager.install.pipe(Effect.flip);
      expect(error.reason).toBe("validation_failed");
      expect(error.message).toContain("did not run successfully");
      expect(commands.map(({ args }) => args)).toEqual([["version"]]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands, () => ({ exitCode: 139 })),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect("times out a version probe and cleans its staging directory", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("hanging-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-timeout-test-",
      });
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const errorFiber = yield* manager.install.pipe(Effect.flip, Effect.forkScoped);
      while (commands.length === 0) yield* Effect.yieldNow;
      yield* TestClock.adjust("10 seconds");
      const error = yield* Fiber.join(errorFiber);
      expect(error.reason).toBe("validation_failed");
      expect(error.message).toBe("Timed out while validating the downloaded relay client version.");
      expect(commands.map(({ args }) => args)).toEqual([["version"]]);
      const managedDirectory = `${baseDir}/tools/cloudflared/${CLOUDFLARED_VERSION}/linux-x64`;
      expect(
        (yield* fileSystem.readDirectory(managedDirectory)).filter((entry) =>
          entry.startsWith(".install-"),
        ),
      ).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          TestClock.layer(),
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands, () => ({ exitCodeEffect: Effect.never })),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect("rejects a managed tool directory that escapes through a symlink", () => {
    const commands: Array<SpawnedCommand> = [];
    const bytes = new TextEncoder().encode("escaped-cloudflared-binary");
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-path-base-test-",
      });
      const outsideDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-path-outside-test-",
      });
      yield* fileSystem.symlink(outsideDirectory, `${baseDir}/tools`);
      const manager = yield* makeCloudflaredRelayClient({
        baseDir,
        releaseAsset: {
          url: "https://example.test/cloudflared",
          sha256: Encoding.encodeHex(sha256(bytes)),
          archive: "binary",
        },
      });

      const error = yield* manager.install.pipe(Effect.flip);
      expect(error.reason).toBe("validation_failed");
      expect(commands).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(bytes),
          makeSpawnerLayer(commands),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect("cleans interrupted staging on retry without downloading over a working relay", () => {
    const commands: Array<SpawnedCommand> = [];
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-cloudflared-retry-test-",
      });
      const managedDirectory = `${baseDir}/tools/cloudflared/${CLOUDFLARED_VERSION}/linux-x64`;
      const managedPath = `${managedDirectory}/cloudflared`;
      const abandonedDirectory = `${managedDirectory}/.install-interrupted`;
      yield* fileSystem.makeDirectory(abandonedDirectory, { recursive: true });
      yield* fileSystem.writeFileString(`${abandonedDirectory}/cloudflared`, "partial");
      yield* fileSystem.writeFileString(managedPath, "working");
      yield* fileSystem.chmod(managedPath, 0o755);
      const manager = yield* makeCloudflaredRelayClient({ baseDir });

      expect(yield* manager.install).toEqual({
        status: "available",
        executablePath: managedPath,
        source: "managed",
        version: CLOUDFLARED_VERSION,
      });
      expect(yield* fileSystem.exists(abandonedDirectory)).toBe(false);
      expect(yield* fileSystem.readFileString(managedPath)).toBe("working");
      expect(commands).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          makeHttpClientLayer(new Uint8Array()),
          makeSpawnerLayer(commands),
          hostRuntimeLayer(),
        ),
      ),
    );
  });

  it.effect(
    "reports Windows ARM64 as unsupported when the pinned release has no native asset",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-cloudflared-windows-arm64-test-",
        });
        const manager = yield* makeCloudflaredRelayClient({ baseDir });

        expect(yield* manager.resolve).toEqual({
          status: "unsupported",
          platform: "win32",
          arch: "arm64",
          version: CLOUDFLARED_VERSION,
        });
        const error = yield* manager.install.pipe(Effect.flip);
        expect(error.reason).toBe("unsupported_platform");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            makeHttpClientLayer(new Uint8Array()),
            makeSpawnerLayer([]),
            hostRuntimeLayer({}, "win32", "arm64"),
          ),
        ),
      ),
  );
});
