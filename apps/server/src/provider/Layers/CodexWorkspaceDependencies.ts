import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

export const WORKSPACE_DEPENDENCY_TOOL_NAMESPACE = "codex_app";
export const WORKSPACE_DEPENDENCY_TOOL_NAME = "load_workspace_dependencies";

const SupportedPlatform = Schema.Literals(["darwin", "linux", "win32"]);
const isSupportedPlatform = Schema.is(SupportedPlatform);
const WorkspaceDependencyRuntimeManifest = Schema.Struct({
  artifactToolVersion: TrimmedNonEmptyString,
  bundleFormatVersion: Schema.Literal(2),
  bundleVersion: TrimmedNonEmptyString,
  targetArch: TrimmedNonEmptyString,
  targetPlatform: SupportedPlatform,
});
const ArtifactToolPackageManifest = Schema.Struct({
  name: Schema.Literal("@oai/artifact-tool"),
  version: TrimmedNonEmptyString,
});
const decodeRuntimeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WorkspaceDependencyRuntimeManifest),
);
const decodeArtifactToolManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ArtifactToolPackageManifest),
);

export const WorkspaceDependencyRuntimeFailureReason = Schema.Literals([
  "unsupported-platform",
  "missing-runtime",
  "invalid-manifest",
  "incompatible-runtime",
  "missing-artifact-package",
  "invalid-runtime-layout",
  "path-escape",
]);
export type WorkspaceDependencyRuntimeFailureReason =
  typeof WorkspaceDependencyRuntimeFailureReason.Type;

export class WorkspaceDependencyRuntimeError extends Schema.TaggedErrorClass<WorkspaceDependencyRuntimeError>()(
  "WorkspaceDependencyRuntimeError",
  { reason: WorkspaceDependencyRuntimeFailureReason },
) {}

export interface WorkspaceDependencyRuntime {
  readonly artifactToolPackage: string;
  readonly artifactToolVersion: string;
  readonly bundleVersion: string;
  readonly fallbackBinaries: string;
  readonly gitExecutable?: string;
  readonly nodeExecutable: string;
  readonly nodePackages: string;
  readonly overrideBinaries: string;
  readonly pnpmExecutable?: string;
  readonly pythonExecutable: string;
  readonly pythonPackages: string;
}

export const workspaceDependencyDynamicTools: NonNullable<
  EffectCodexSchema.V2ThreadStartParams["dynamicTools"]
> = [
  {
    type: "namespace",
    name: WORKSPACE_DEPENDENCY_TOOL_NAMESPACE,
    description: "Read-only tools supplied by the local T3 Code host.",
    tools: [
      {
        type: "function",
        name: WORKSPACE_DEPENDENCY_TOOL_NAME,
        description:
          "Load the verified bundled workspace runtime paths for artifact creation in this T3 Code environment.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  },
];

function runtimeFailure(
  reason: WorkspaceDependencyRuntimeFailureReason,
): WorkspaceDependencyRuntimeError {
  return new WorkspaceDependencyRuntimeError({ reason });
}

function isWithin(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function executableCandidates(
  path: Path.Path,
  directory: string,
  name: string,
  platform: NodeJS.Platform,
): ReadonlyArray<string> {
  return platform === "win32"
    ? [path.join(directory, `${name}.exe`), path.join(directory, `${name}.cmd`)]
    : [path.join(directory, name)];
}

export const resolveWorkspaceDependencyRuntime = Effect.fn(
  "CodexWorkspaceDependencies.resolveWorkspaceDependencyRuntime",
)(function* (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): Effect.fn.Return<
  WorkspaceDependencyRuntime,
  WorkspaceDependencyRuntimeError,
  FileSystem.FileSystem | Path.Path
> {
  if (!isSupportedPlatform(platform)) {
    return yield* runtimeFailure("unsupported-platform");
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configuredRoot = environment.CODEX_RUNTIME_DEPENDENCIES?.trim();
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim();
  const dependencyRoot = configuredRoot
    ? configuredRoot
    : home
      ? path.join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies")
      : undefined;
  if (!dependencyRoot || !path.isAbsolute(dependencyRoot)) {
    return yield* runtimeFailure("missing-runtime");
  }

  const lexicalRoot = path.resolve(dependencyRoot);
  const lexicalRuntimeRoot = path.dirname(lexicalRoot);
  const canonicalRuntimeRoot = yield* fileSystem
    .realPath(lexicalRuntimeRoot)
    .pipe(Effect.mapError(() => runtimeFailure("missing-runtime")));
  const canonicalRoot = yield* fileSystem
    .realPath(lexicalRoot)
    .pipe(Effect.mapError(() => runtimeFailure("missing-runtime")));
  if (!isWithin(path, canonicalRuntimeRoot, canonicalRoot)) {
    return yield* runtimeFailure("path-escape");
  }

  const requireCanonical = Effect.fn("CodexWorkspaceDependencies.requireCanonical")(function* (
    candidate: string,
    type: "File" | "Directory",
    missingReason: WorkspaceDependencyRuntimeFailureReason,
  ) {
    const canonical = yield* fileSystem
      .realPath(candidate)
      .pipe(Effect.mapError(() => runtimeFailure(missingReason)));
    if (!isWithin(path, canonicalRoot, canonical)) {
      return yield* runtimeFailure("path-escape");
    }
    const info = yield* fileSystem
      .stat(canonical)
      .pipe(Effect.mapError(() => runtimeFailure(missingReason)));
    if (info.type !== type) {
      return yield* runtimeFailure(missingReason);
    }
    return canonical;
  });
  const firstCanonicalFile = Effect.fn("CodexWorkspaceDependencies.firstCanonicalFile")(function* (
    candidates: ReadonlyArray<string>,
    missingReason: WorkspaceDependencyRuntimeFailureReason,
  ) {
    for (const candidate of candidates) {
      const info = yield* fileSystem.stat(candidate).pipe(Effect.option);
      if (info._tag === "None") continue;
      return yield* requireCanonical(candidate, "File", missingReason);
    }
    return yield* runtimeFailure(missingReason);
  });

  const runtimeManifestPath = yield* fileSystem
    .realPath(path.join(canonicalRuntimeRoot, "runtime.json"))
    .pipe(Effect.mapError(() => runtimeFailure("missing-runtime")));
  if (!isWithin(path, canonicalRuntimeRoot, runtimeManifestPath)) {
    return yield* runtimeFailure("path-escape");
  }
  const manifest = yield* fileSystem.readFileString(runtimeManifestPath).pipe(
    Effect.mapError(() => runtimeFailure("invalid-manifest")),
    Effect.flatMap(decodeRuntimeManifest),
    Effect.mapError(() => runtimeFailure("invalid-manifest")),
  );
  if (manifest.targetPlatform !== platform || manifest.targetArch !== architecture) {
    return yield* runtimeFailure("incompatible-runtime");
  }

  const nodeRoot = path.join(canonicalRoot, "node");
  const nodePackages = yield* requireCanonical(
    path.join(nodeRoot, "node_modules"),
    "Directory",
    "invalid-runtime-layout",
  );
  const nodeExecutable = yield* firstCanonicalFile(
    [
      ...executableCandidates(path, path.join(nodeRoot, "bin"), "node", platform),
      ...executableCandidates(path, nodeRoot, "node", platform),
    ],
    "invalid-runtime-layout",
  );
  const artifactToolManifestPath = yield* requireCanonical(
    path.join(nodePackages, "@oai", "artifact-tool", "package.json"),
    "File",
    "missing-artifact-package",
  );
  const artifactToolManifest = yield* fileSystem.readFileString(artifactToolManifestPath).pipe(
    Effect.mapError(() => runtimeFailure("missing-artifact-package")),
    Effect.flatMap(decodeArtifactToolManifest),
    Effect.mapError(() => runtimeFailure("missing-artifact-package")),
  );
  if (artifactToolManifest.version !== manifest.artifactToolVersion) {
    return yield* runtimeFailure("missing-artifact-package");
  }
  const artifactToolPackage = yield* requireCanonical(
    path.dirname(artifactToolManifestPath),
    "Directory",
    "missing-artifact-package",
  );

  const pythonRoot = path.join(canonicalRoot, "python");
  const pythonExecutable = yield* firstCanonicalFile(
    [
      ...executableCandidates(path, path.join(pythonRoot, "bin"), "python3", platform),
      ...executableCandidates(path, path.join(pythonRoot, "bin"), "python", platform),
      ...executableCandidates(path, pythonRoot, "python", platform),
    ],
    "invalid-runtime-layout",
  );
  const pythonLibRoot = yield* requireCanonical(
    path.join(pythonRoot, "lib"),
    "Directory",
    "invalid-runtime-layout",
  );
  const pythonLibEntries = yield* fileSystem
    .readDirectory(pythonLibRoot)
    .pipe(Effect.mapError(() => runtimeFailure("invalid-runtime-layout")));
  let pythonPackages: string | undefined;
  for (const entry of pythonLibEntries.toSorted()) {
    if (!entry.startsWith("python")) continue;
    const candidate = path.join(pythonLibRoot, entry, "site-packages");
    const info = yield* fileSystem.stat(candidate).pipe(Effect.option);
    if (info._tag === "None") continue;
    pythonPackages = yield* requireCanonical(candidate, "Directory", "invalid-runtime-layout");
    break;
  }
  if (!pythonPackages) {
    return yield* runtimeFailure("invalid-runtime-layout");
  }

  const overrideBinaries = yield* requireCanonical(
    path.join(canonicalRoot, "bin", "override"),
    "Directory",
    "invalid-runtime-layout",
  );
  const fallbackBinaries = yield* requireCanonical(
    path.join(canonicalRoot, "bin", "fallback"),
    "Directory",
    "invalid-runtime-layout",
  );
  const optionalExecutable = Effect.fn("CodexWorkspaceDependencies.optionalExecutable")(function* (
    name: string,
  ) {
    const candidates = executableCandidates(path, fallbackBinaries, name, platform);
    for (const candidate of candidates) {
      const info = yield* fileSystem.stat(candidate).pipe(Effect.option);
      if (info._tag === "None") continue;
      return yield* requireCanonical(candidate, "File", "invalid-runtime-layout");
    }
    return undefined;
  });
  const gitExecutable = yield* optionalExecutable("git");
  const pnpmExecutable = yield* optionalExecutable("pnpm");

  return {
    artifactToolPackage,
    artifactToolVersion: manifest.artifactToolVersion,
    bundleVersion: manifest.bundleVersion,
    fallbackBinaries,
    ...(gitExecutable ? { gitExecutable } : {}),
    nodeExecutable,
    nodePackages,
    overrideBinaries,
    ...(pnpmExecutable ? { pnpmExecutable } : {}),
    pythonExecutable,
    pythonPackages,
  };
});

function textResponse(success: boolean, text: string): EffectCodexSchema.DynamicToolCallResponse {
  return { success, contentItems: [{ type: "inputText", text }] };
}

function failureResponse(code: string, message: string) {
  return textResponse(false, JSON.stringify({ code, message }));
}

function hasNoArguments(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function resolutionFailureResponse(reason: WorkspaceDependencyRuntimeFailureReason) {
  switch (reason) {
    case "unsupported-platform":
      return failureResponse(
        "unsupported_platform",
        "The bundled Codex workspace runtime is not supported on this host platform.",
      );
    case "missing-runtime":
      return failureResponse(
        "runtime_missing",
        "The bundled Codex workspace runtime is missing. Repair the Codex runtime and restart T3 Code.",
      );
    case "incompatible-runtime":
      return failureResponse(
        "runtime_incompatible",
        "The bundled Codex workspace runtime does not match this host. Repair the runtime and restart T3 Code.",
      );
    case "missing-artifact-package":
      return failureResponse(
        "artifact_package_missing",
        "The bundled artifact package is missing or does not match its manifest. Repair the Codex runtime and restart T3 Code.",
      );
    case "path-escape":
      return failureResponse(
        "runtime_path_rejected",
        "The bundled Codex workspace runtime failed path verification. Repair the runtime and restart T3 Code.",
      );
    case "invalid-manifest":
    case "invalid-runtime-layout":
      return failureResponse(
        "runtime_invalid",
        "The bundled Codex workspace runtime is invalid. Repair the runtime and restart T3 Code.",
      );
  }
}

export const handleWorkspaceDependencyToolCall = Effect.fn(
  "CodexWorkspaceDependencies.handleWorkspaceDependencyToolCall",
)(function* (
  payload: EffectCodexSchema.DynamicToolCallParams,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): Effect.fn.Return<
  EffectCodexSchema.DynamicToolCallResponse,
  never,
  FileSystem.FileSystem | Path.Path
> {
  if (
    payload.namespace !== WORKSPACE_DEPENDENCY_TOOL_NAMESPACE ||
    payload.tool !== WORKSPACE_DEPENDENCY_TOOL_NAME
  ) {
    return failureResponse("unsupported_tool", "T3 Code does not provide the requested host tool.");
  }
  if (!hasNoArguments(payload.arguments)) {
    return failureResponse(
      "invalid_arguments",
      `${WORKSPACE_DEPENDENCY_TOOL_NAME} does not accept arguments.`,
    );
  }

  const runtime = yield* resolveWorkspaceDependencyRuntime(
    environment,
    platform,
    architecture,
  ).pipe(
    Effect.match({
      onFailure: (error) => ({ _tag: "Left" as const, error }),
      onSuccess: (value) => ({ _tag: "Right" as const, value }),
    }),
  );
  if (runtime._tag === "Left") {
    return resolutionFailureResponse(runtime.error.reason);
  }

  const paths = runtime.value;
  const lines = [
    "Verified Codex workspace dependency runtime loaded.",
    `Bundle version: ${paths.bundleVersion}`,
    `Artifact tool version: ${paths.artifactToolVersion}`,
    `Artifact tool package: ${paths.artifactToolPackage}`,
    `Node.js executable: ${paths.nodeExecutable}`,
    `Node.js packages: ${paths.nodePackages}`,
    `Python executable: ${paths.pythonExecutable}`,
    `Python packages: ${paths.pythonPackages}`,
    `Override binaries: ${paths.overrideBinaries}`,
    `Fallback binaries: ${paths.fallbackBinaries}`,
    ...(paths.gitExecutable ? [`Git executable: ${paths.gitExecutable}`] : []),
    ...(paths.pnpmExecutable ? [`pnpm executable: ${paths.pnpmExecutable}`] : []),
  ];
  return textResponse(true, lines.join("\n"));
});
