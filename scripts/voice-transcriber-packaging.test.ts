import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { createBuildConfig, stageVoiceTranscriber } from "./build-desktop-artifact.ts";

const makeFixture = Effect.fn("makeVoicePackagingFixture")(function* (input?: {
  readonly fail?: "build" | "bin-path" | "architecture" | "sign" | "verify-signature";
  readonly missingOutput?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-voice-package-test-" });
  const stageResourcesDir = path.join(repoRoot, "stage");
  const commands: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const spawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const child = command as unknown as { command: string; args: ReadonlyArray<string> };
        commands.push({ command: child.command, args: child.args });
        const archIndex = child.args.indexOf("--arch");
        const swiftArch = child.args[archIndex + 1];
        const binDirectory = path.join(repoRoot, "swift-output", swiftArch ?? "unused");
        const showBinPath = child.args.includes("--show-bin-path");
        const operation =
          child.command === "swift"
            ? showBinPath
              ? "bin-path"
              : "build"
            : child.command === "lipo"
              ? "architecture"
              : child.args.includes("--verify")
                ? "verify-signature"
                : "sign";
        const exitCode = input?.fail === operation ? 1 : 0;
        if (child.command === "swift" && !showBinPath && !input?.missingOutput) {
          yield* fs.makeDirectory(binDirectory, { recursive: true });
          yield* fs.writeFileString(path.join(binDirectory, "t3-voice-transcriber"), swiftArch!);
        }
        if (child.command === "lipo" && child.args.includes("-create")) {
          yield* fs.writeFileString(child.args.at(-1)!, "universal");
        }
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: showBinPath
            ? Stream.make(new TextEncoder().encode(`${binDirectory}\n`))
            : Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
    ),
  );
  return { repoRoot, stageResourcesDir, commands, spawner };
});

it.layer(NodeServices.layer)("voice transcriber packaging", (it) => {
  for (const arch of ["arm64", "x64", "universal"] as const) {
    it.effect(`stages a ${arch} desktop helper and signed thin CLI artifacts`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixture = yield* makeFixture();
        yield* stageVoiceTranscriber({ ...fixture, platform: "mac", arch, verbose: false }).pipe(
          Effect.provide(fixture.spawner),
        );
        const expected = arch === "universal" ? ["arm64", "x64"] : [arch];
        const builds = fixture.commands.filter(
          (c) => c.command === "swift" && !c.args.includes("--show-bin-path"),
        );
        assert.deepStrictEqual(
          builds.map((c) => c.args.at(-1)),
          expected.map((a) => (a === "x64" ? "x86_64" : a)),
        );
        for (const architecture of expected) {
          const binary = path.join(
            fixture.repoRoot,
            "apps/server/native/voice-transcriber/.build/artifacts",
            `darwin-${architecture}`,
            "t3-voice-transcriber",
          );
          assert.equal(
            yield* fs.readFileString(binary),
            architecture === "x64" ? "x86_64" : architecture,
          );
          assert.isTrue(
            fixture.commands.some(
              (c) =>
                c.command === "codesign" && c.args.includes("--sign") && c.args.at(-1) === binary,
            ),
          );
          assert.isTrue(
            fixture.commands.some(
              (c) =>
                c.command === "codesign" && c.args.includes("--verify") && c.args.at(-1) === binary,
            ),
          );
        }
        const resource = path.join(
          fixture.stageResourcesDir,
          "voice-transcriber/t3-voice-transcriber",
        );
        assert.equal(
          yield* fs.readFileString(resource),
          arch === "universal" ? "universal" : arch === "x64" ? "x86_64" : arch,
        );
        assert.equal((yield* fs.stat(resource)).mode! & 0o777, 0o755);
      }),
    );
  }

  for (const fail of ["build", "bin-path", "architecture", "sign", "verify-signature"] as const) {
    it.effect(`fails packaging when ${fail} fails`, () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ fail });
        const error = yield* stageVoiceTranscriber({
          ...fixture,
          platform: "mac",
          arch: "arm64",
          verbose: false,
        }).pipe(Effect.provide(fixture.spawner), Effect.flip);
        assert.equal(error._tag, "BuildCommandFailedError");
        const fs = yield* FileSystem.FileSystem;
        assert.isFalse(
          yield* fs.exists(`${fixture.stageResourcesDir}/voice-transcriber/t3-voice-transcriber`),
        );
      }),
    );
  }

  it.effect("fails packaging when Swift reports a missing executable", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ missingOutput: true });
      const error = yield* stageVoiceTranscriber({
        ...fixture,
        platform: "mac",
        arch: "arm64",
        verbose: false,
      }).pipe(Effect.provide(fixture.spawner), Effect.flip);
      assert.equal(error._tag, "VoiceTranscriberBuildOutputMissingError");
    }),
  );

  for (const platform of ["linux", "win"] as const) {
    it.effect(`does not invoke Apple tooling for ${platform}`, () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        yield* stageVoiceTranscriber({ ...fixture, platform, arch: "x64", verbose: false }).pipe(
          Effect.provide(fixture.spawner),
        );
        assert.deepStrictEqual(fixture.commands, []);
      }),
    );
  }

  it.effect("includes the real macOS resource in signing for signed and ad hoc builds", () =>
    Effect.gen(function* () {
      for (const signed of [true, false]) {
        const config = yield* createBuildConfig(
          "mac",
          "dmg",
          "1.2.3",
          signed,
          false,
          undefined,
          undefined,
        );
        assert.includeDeepMembers(config.extraResources as unknown[], [
          { from: "apps/desktop/prod-resources/voice-transcriber", to: "voice-transcriber" },
        ]);
        const mac = config.mac as Record<string, unknown>;
        assert.deepStrictEqual(mac.binaries, [
          "Contents/Resources/voice-transcriber/t3-voice-transcriber",
        ]);
        if (!signed) assert.equal(mac.identity, "-");
      }
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))),
  );
});
