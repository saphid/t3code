import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  handleWorkspaceDependencyToolCall,
  resolveWorkspaceDependencyRuntime,
} from "./CodexWorkspaceDependencies.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeFailureJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String, message: Schema.String })),
);

const makeRuntimeFixture = Effect.fn("makeRuntimeFixture")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-workspace-deps-" });
  const dependencies = path.join(runtimeRoot, "dependencies");
  const paths = {
    artifactManifest: path.join(
      dependencies,
      "node",
      "node_modules",
      "@oai",
      "artifact-tool",
      "package.json",
    ),
    fallbackBinaries: path.join(dependencies, "bin", "fallback"),
    nodeExecutable: path.join(dependencies, "node", "bin", "node"),
    overrideBinaries: path.join(dependencies, "bin", "override"),
    pythonExecutable: path.join(dependencies, "python", "bin", "python3"),
    pythonPackages: path.join(dependencies, "python", "lib", "python3.12", "site-packages"),
    runtimeManifest: path.join(runtimeRoot, "runtime.json"),
  };

  for (const directory of [
    path.dirname(paths.artifactManifest),
    paths.fallbackBinaries,
    path.dirname(paths.nodeExecutable),
    paths.overrideBinaries,
    path.dirname(paths.pythonExecutable),
    paths.pythonPackages,
  ]) {
    yield* fileSystem.makeDirectory(directory, { recursive: true });
  }
  yield* fileSystem.writeFileString(
    paths.runtimeManifest,
    encodeUnknownJson({
      artifactToolVersion: "2.8.52",
      bundleFormatVersion: 2,
      bundleVersion: "test-bundle",
      targetArch: "arm64",
      targetPlatform: "darwin",
    }),
  );
  yield* fileSystem.writeFileString(
    paths.artifactManifest,
    encodeUnknownJson({ name: "@oai/artifact-tool", version: "2.8.52" }),
  );
  for (const file of [
    paths.nodeExecutable,
    paths.pythonExecutable,
    path.join(paths.fallbackBinaries, "git"),
    path.join(paths.fallbackBinaries, "pnpm"),
  ]) {
    yield* fileSystem.writeFileString(file, "fixture");
  }
  return { dependencies, runtimeRoot, paths };
});

function makeToolPayload(argumentsValue: unknown = {}) {
  return {
    arguments: argumentsValue,
    callId: "call-1",
    namespace: "codex_app",
    threadId: "thread-1",
    tool: "load_workspace_dependencies",
    turnId: "turn-1",
  } as const;
}

function responseText(response: {
  readonly contentItems: ReadonlyArray<{ readonly type: string }>;
}) {
  const textItem = response.contentItems.find(
    (item): item is { readonly type: "inputText"; readonly text: string } =>
      item.type === "inputText" && "text" in item,
  );
  assert.isDefined(textItem);
  return textItem.text;
}

it.layer(NodeServices.layer)("Codex workspace dependencies", (it) => {
  it.effect("returns only a complete manifest-matched runtime", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRuntimeFixture();
      const runtime = yield* resolveWorkspaceDependencyRuntime(
        { CODEX_RUNTIME_DEPENDENCIES: fixture.dependencies },
        "darwin",
        "arm64",
      );

      assert.equal(runtime.bundleVersion, "test-bundle");
      assert.equal(runtime.artifactToolVersion, "2.8.52");
      assert.isTrue(runtime.artifactToolPackage.endsWith("@oai/artifact-tool"));
      assert.isTrue(runtime.nodePackages.endsWith("node/node_modules"));
      assert.isTrue(runtime.pythonPackages.endsWith("python3.12/site-packages"));
      assert.isTrue(runtime.gitExecutable?.endsWith("bin/fallback/git"));
      assert.isTrue(runtime.pnpmExecutable?.endsWith("bin/fallback/pnpm"));
    }),
  );

  it.effect("rejects unsupported hosts before inspecting a runtime path", () =>
    Effect.gen(function* () {
      const error = yield* resolveWorkspaceDependencyRuntime(
        { CODEX_RUNTIME_DEPENDENCIES: "/private/should-not-be-read" },
        "freebsd",
        "x64",
      ).pipe(Effect.flip);

      assert.equal(error.reason, "unsupported-platform");
    }),
  );

  it.effect("distinguishes invalid and incompatible manifests", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fixture = yield* makeRuntimeFixture();
      yield* fileSystem.writeFileString(fixture.paths.runtimeManifest, "not json");
      const invalid = yield* resolveWorkspaceDependencyRuntime(
        { CODEX_RUNTIME_DEPENDENCIES: fixture.dependencies },
        "darwin",
        "arm64",
      ).pipe(Effect.flip);
      assert.equal(invalid.reason, "invalid-manifest");

      yield* fileSystem.writeFileString(
        fixture.paths.runtimeManifest,
        encodeUnknownJson({
          artifactToolVersion: "2.8.52",
          bundleFormatVersion: 2,
          bundleVersion: "test-bundle",
          targetArch: "x64",
          targetPlatform: "darwin",
        }),
      );
      const incompatible = yield* resolveWorkspaceDependencyRuntime(
        { CODEX_RUNTIME_DEPENDENCIES: fixture.dependencies },
        "darwin",
        "arm64",
      ).pipe(Effect.flip);
      assert.equal(incompatible.reason, "incompatible-runtime");
    }),
  );

  it.effect("rejects a missing or manifest-mismatched artifact package", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fixture = yield* makeRuntimeFixture();
      yield* fileSystem.writeFileString(
        fixture.paths.artifactManifest,
        encodeUnknownJson({ name: "@oai/artifact-tool", version: "0.0.0" }),
      );

      const error = yield* resolveWorkspaceDependencyRuntime(
        { CODEX_RUNTIME_DEPENDENCIES: fixture.dependencies },
        "darwin",
        "arm64",
      ).pipe(Effect.flip);
      assert.equal(error.reason, "missing-artifact-package");
    }),
  );

  it.effect("rejects symlinks that escape the verified dependency root", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeRuntimeFixture();
      const outsideManifest = path.join(fixture.runtimeRoot, "outside-package.json");
      yield* fileSystem.writeFileString(
        outsideManifest,
        encodeUnknownJson({ name: "@oai/artifact-tool", version: "2.8.52" }),
      );
      yield* fileSystem.remove(fixture.paths.artifactManifest);
      yield* fileSystem.symlink(outsideManifest, fixture.paths.artifactManifest);

      const error = yield* resolveWorkspaceDependencyRuntime(
        { CODEX_RUNTIME_DEPENDENCIES: fixture.dependencies },
        "darwin",
        "arm64",
      ).pipe(Effect.flip);
      assert.equal(error.reason, "path-escape");
    }),
  );

  it.effect("returns typed actionable failures without rejected paths", () =>
    Effect.gen(function* () {
      const rejectedPath = "/private/rejected-runtime-sentinel";
      const invalidArguments = yield* handleWorkspaceDependencyToolCall(
        makeToolPayload({ path: rejectedPath }),
        { CODEX_RUNTIME_DEPENDENCIES: rejectedPath },
        "darwin",
        "arm64",
      );
      assert.isFalse(invalidArguments.success);
      assert.deepEqual(decodeFailureJson(responseText(invalidArguments)), {
        code: "invalid_arguments",
        message: "load_workspace_dependencies does not accept arguments.",
      });

      const missingRuntime = yield* handleWorkspaceDependencyToolCall(
        makeToolPayload(),
        { CODEX_RUNTIME_DEPENDENCIES: rejectedPath },
        "darwin",
        "arm64",
      );
      const missingText = responseText(missingRuntime);
      assert.isFalse(missingRuntime.success);
      assert.equal(decodeFailureJson(missingText).code, "runtime_missing");
      assert.notInclude(missingText, rejectedPath);
    }),
  );

  it.effect("returns verified paths from the registered host tool", () =>
    Effect.gen(function* () {
      const fixture = yield* makeRuntimeFixture();
      const response = yield* handleWorkspaceDependencyToolCall(
        makeToolPayload(),
        { CODEX_RUNTIME_DEPENDENCIES: fixture.dependencies },
        "darwin",
        "arm64",
      );

      assert.isTrue(response.success);
      const text = responseText(response);
      assert.include(text, "Verified Codex workspace dependency runtime loaded.");
      assert.include(text, "Artifact tool version: 2.8.52");
      assert.include(text, "Node.js executable:");
    }),
  );
});
