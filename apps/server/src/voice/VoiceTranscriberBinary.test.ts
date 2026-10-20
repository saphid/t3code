import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveVoiceTranscriberBinary } from "./VoiceDictationService.ts";

it.layer(NodeServices.layer)("voice transcriber binary", (it) => {
  for (const architecture of ["arm64", "x64"] as const) {
    it.effect(`selects only the ${architecture} helper from an npm installation`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-voice-binary-" });
        const directory = path.join(root, "node_modules/t3/dist");
        for (const arch of ["arm64", "x64"]) {
          const parent = path.join(directory, "voice-transcriber", `darwin-${arch}`);
          yield* fs.makeDirectory(parent, { recursive: true });
          yield* fs.writeFileString(path.join(parent, "t3-voice-transcriber"), arch);
        }
        const expected = path.join(
          directory,
          "voice-transcriber",
          `darwin-${architecture}`,
          "t3-voice-transcriber",
        );
        const binary = yield* resolveVoiceTranscriberBinary(directory).pipe(
          Effect.provideService(HostProcessArchitecture, architecture),
        );
        assert.equal(binary, expected);
        yield* fs.remove(expected);
        assert.isNull(
          yield* resolveVoiceTranscriberBinary(directory).pipe(
            Effect.provideService(HostProcessArchitecture, architecture),
          ),
        );
      }).pipe(
        Effect.provideService(HostProcessPlatform, "darwin"),
        Effect.provideService(HostProcessEnvironment, {}),
      ),
    );
  }

  it.effect("resolves a desktop extraResource outside the server ASAR", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-voice-desktop-" });
      const resources = path.join(root, "T3 Code.app/Contents/Resources");
      const directory = path.join(resources, "app.asar/apps/server/dist");
      const helperDirectory = path.join(resources, "voice-transcriber");
      yield* fs.makeDirectory(helperDirectory, { recursive: true });
      const binary = path.join(helperDirectory, "t3-voice-transcriber");
      yield* fs.writeFileString(binary, "helper");
      assert.equal(yield* resolveVoiceTranscriberBinary(directory), binary);
    }).pipe(
      Effect.provideService(HostProcessPlatform, "darwin"),
      Effect.provideService(HostProcessEnvironment, {}),
    ),
  );

  for (const layout of ["src/voice", "dist"]) {
    it.effect(`resolves SwiftPM's release link from ${layout}`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-voice-dev-" });
        const helperDirectory = path.join(
          root,
          "apps/server/native/voice-transcriber/.build/release",
        );
        yield* fs.makeDirectory(helperDirectory, { recursive: true });
        const binary = path.join(helperDirectory, "t3-voice-transcriber");
        yield* fs.writeFileString(binary, "helper");
        assert.equal(
          yield* resolveVoiceTranscriberBinary(path.join(root, "apps/server", layout)),
          binary,
        );
      }).pipe(
        Effect.provideService(HostProcessPlatform, "darwin"),
        Effect.provideService(HostProcessEnvironment, {}),
      ),
    );
  }

  it.effect("preserves the explicit override and rejects Apple helpers on Linux", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* resolveVoiceTranscriberBinary("/missing").pipe(
          Effect.provideService(HostProcessPlatform, "darwin"),
        ),
        process.execPath,
      );
      assert.isNull(
        yield* resolveVoiceTranscriberBinary("/missing").pipe(
          Effect.provideService(HostProcessPlatform, "linux"),
        ),
      );
    }).pipe(
      Effect.provideService(HostProcessEnvironment, {
        T3_VOICE_TRANSCRIBER_PATH: process.execPath,
      }),
    ),
  );
});
