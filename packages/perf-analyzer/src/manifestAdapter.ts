// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalProcess:off globalDate:off - Standalone container contract adapter.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { NETWORK_PROFILES, type NetworkProfileName, type Surface } from "./launch.ts";
import { runScenario } from "./runner.ts";
import { scenarios } from "./scenarios.ts";
import { FIXTURE_SIZES, type FixtureSize } from "./seed.ts";

export interface ManifestCell {
  readonly scenario_id: string;
  readonly surface: Surface;
  readonly size: FixtureSize;
  readonly network_profile: NetworkProfileName;
}

interface ManifestInput {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly manifestSchemaVersion: 1;
  readonly cellPartitionHash: string;
  readonly contractId: string;
  readonly suiteRevision: string;
  readonly fixtureRevision: string;
  readonly harnessGitSha: string;
  readonly contractFingerprint: string;
  readonly browserEngine: string;
  readonly browserVersion: string;
  readonly surface: Surface;
  readonly rendererBackend: string;
  readonly schedulerGitSha: string;
  readonly tier: "required" | "optional";
  readonly cells: ReadonlyArray<ManifestCell>;
  readonly samplePolicy: {
    readonly version: "five-after-warmup-v1";
    readonly warmups: 1;
    readonly measured_repetitions: 5;
  };
  readonly controlPolicy: "none-v1";
  readonly prngAlgorithm: "none-v1";
  readonly seedMaterialFields: readonly [];
  readonly expectedProvenance: Record<string, string>;
}

interface AdapterDependencies {
  readonly now: () => string;
  readonly runCell: (
    cell: ManifestCell,
    policy: { readonly warmups: 1; readonly measuredRepetitions: 5 },
  ) => Promise<ReadonlyArray<unknown>>;
}

const ENVELOPE_KEYS = [
  "browserEngine",
  "browserVersion",
  "cellPartitionHash",
  "cells",
  "contractId",
  "controlPolicy",
  "fixtureRevision",
  "harnessGitSha",
  "contractFingerprint",
  "manifestHash",
  "manifestId",
  "manifestSchemaVersion",
  "prngAlgorithm",
  "rendererBackend",
  "samplePolicy",
  "schedulerGitSha",
  "seedMaterialFields",
  "suiteRevision",
  "surface",
  "tier",
] as const;

const PROVENANCE_KEYS = [
  "browser_engine",
  "browser_version",
  "contract_id",
  "fixture_revision",
  "harness_git_sha",
  "contract_fingerprint",
  "manifest_hash",
  "renderer_backend",
  "scheduler_git_sha",
  "suite_revision",
  "surface",
] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
  name: string,
) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${name} has unsupported fields`);
  }
}

function validate(input: unknown): ManifestInput {
  const document = requireRecord(input, "manifest");
  requireExactKeys(document, [...ENVELOPE_KEYS, "expectedProvenance"], "manifest");
  const envelope = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, document[key]]));
  const declaredHash = document["manifestHash"];
  delete envelope["manifestHash"];
  if (typeof declaredHash !== "string" || hash(envelope) !== declaredHash) {
    throw new Error("manifestHash does not match the canonical envelope");
  }
  if (document["manifestSchemaVersion"] !== 1) throw new Error("unsupported manifestSchemaVersion");
  const nonEmptyStrings = [
    "manifestId",
    "cellPartitionHash",
    "contractId",
    "suiteRevision",
    "fixtureRevision",
    "browserEngine",
    "browserVersion",
    "rendererBackend",
    "schedulerGitSha",
  ];
  if (nonEmptyStrings.some((key) => typeof document[key] !== "string" || document[key] === "")) {
    throw new Error("manifest identity fields must be non-empty strings");
  }
  if (document["manifestId"] !== document["suiteRevision"]) {
    throw new Error("manifestId must equal suiteRevision");
  }
  if (!/^[0-9a-f]{64}$/.test(String(document["cellPartitionHash"]))) {
    throw new Error("cellPartitionHash must be a sha256 hash");
  }
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(String(document["harnessGitSha"]))) {
    throw new Error("harnessGitSha must be a Git content hash");
  }
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(String(document["schedulerGitSha"]))) {
    throw new Error("schedulerGitSha must be a Git content hash");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(String(document["contractFingerprint"]))) {
    throw new Error("contractFingerprint must be a sha256 fingerprint");
  }
  if (document["surface"] !== "web" && document["surface"] !== "desktop") {
    throw new Error("manifest image supports only web and desktop");
  }
  if (
    (document["surface"] === "web" && document["browserEngine"] !== "chromium") ||
    (document["surface"] === "desktop" && document["browserEngine"] !== "electron")
  ) {
    throw new Error("manifest browser engine does not match its surface");
  }
  if (document["tier"] !== "required" && document["tier"] !== "optional") {
    throw new Error("unsupported manifest tier");
  }
  const sample = requireRecord(document["samplePolicy"], "samplePolicy");
  requireExactKeys(sample, ["measured_repetitions", "version", "warmups"], "samplePolicy");
  if (
    sample["version"] !== "five-after-warmup-v1" ||
    sample["warmups"] !== 1 ||
    sample["measured_repetitions"] !== 5
  )
    throw new Error("unsupported samplePolicy");
  if (
    document["controlPolicy"] !== "none-v1" ||
    document["prngAlgorithm"] !== "none-v1" ||
    !Array.isArray(document["seedMaterialFields"]) ||
    document["seedMaterialFields"].length !== 0
  )
    throw new Error("manifest-v1 adapter only supports an unpaired ordered manifest");
  if (!Array.isArray(document["cells"]) || document["cells"].length === 0) {
    throw new Error("manifest cells must be a non-empty array");
  }
  const knownScenarios = new Map(scenarios.map((scenario) => [scenario.name, scenario]));
  const identities = new Set<string>();
  for (const rawCell of document["cells"]) {
    const cell = requireRecord(rawCell, "cell");
    requireExactKeys(cell, ["network_profile", "scenario_id", "size", "surface"], "cell");
    const scenario =
      typeof cell["scenario_id"] === "string" ? knownScenarios.get(cell["scenario_id"]) : undefined;
    if (
      scenario === undefined ||
      typeof cell["surface"] !== "string" ||
      !scenario.surfaces.includes(cell["surface"] as Surface) ||
      typeof cell["size"] !== "string" ||
      !(cell["size"] in FIXTURE_SIZES) ||
      !scenario.sizes.includes(cell["size"] as FixtureSize) ||
      typeof cell["network_profile"] !== "string" ||
      !(cell["network_profile"] in NETWORK_PROFILES) ||
      (cell["surface"] === "desktop" && cell["network_profile"] !== "good")
    )
      throw new Error("manifest contains an unsupported cell");
    if (cell["surface"] !== document["surface"]) {
      throw new Error("cell surface does not match manifest surface");
    }
    const identity = canonical(cell);
    if (identities.has(identity)) throw new Error("manifest contains duplicate cells");
    identities.add(identity);
  }
  const provenance = requireRecord(document["expectedProvenance"], "expectedProvenance");
  requireExactKeys(provenance, PROVENANCE_KEYS, "expectedProvenance");
  const bindings: ReadonlyArray<readonly [string, string]> = [
    ["contract_id", "contractId"],
    ["fixture_revision", "fixtureRevision"],
    ["harness_git_sha", "harnessGitSha"],
    ["contract_fingerprint", "contractFingerprint"],
    ["browser_engine", "browserEngine"],
    ["browser_version", "browserVersion"],
    ["surface", "surface"],
    ["renderer_backend", "rendererBackend"],
    ["manifest_hash", "manifestHash"],
    ["suite_revision", "suiteRevision"],
    ["scheduler_git_sha", "schedulerGitSha"],
  ];
  if (
    Object.values(provenance).some((value) => typeof value !== "string" || value === "") ||
    !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(String(provenance["scheduler_git_sha"])) ||
    bindings.some(
      ([provenanceKey, manifestKey]) => provenance[provenanceKey] !== document[manifestKey],
    )
  )
    throw new Error("expectedProvenance does not bind the manifest envelope");
  return document as unknown as ManifestInput;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EBADF" && code !== "EISDIR")
      throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const directory = NodePath.dirname(path);
  const temporary = NodePath.join(
    directory,
    `.${NodePath.basename(path)}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`,
  );
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(temporary, "wx", 0o644);
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.chmod(0o644);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await NodeFSP.rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    const openHandle = handle;
    handle = undefined;
    await openHandle?.close().catch(() => undefined);
    await NodeFSP.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isFiniteJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFiniteJson);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isFiniteJson);
}

function validSamples(samples: ReadonlyArray<unknown>): boolean {
  return (
    samples.length === 5 &&
    samples.every(
      (sample) =>
        sample !== null &&
        typeof sample === "object" &&
        !Array.isArray(sample) &&
        isFiniteJson(sample),
    )
  );
}

function defaultDependencies(): AdapterDependencies {
  return {
    now: () => new Date().toISOString(),
    runCell: async (cell, policy) => {
      const scenario = scenarios.find((candidate) => candidate.name === cell.scenario_id);
      if (scenario === undefined) throw new Error(`unknown scenario: ${cell.scenario_id}`);
      const result = await runScenario(
        scenario,
        cell.surface,
        cell.size,
        {
          runs: policy.measuredRepetitions,
          warmupRuns: policy.warmups,
          headless: true,
          outDir: "/results",
          label: process.env["T3_VERSION"],
          build: process.env["T3_VERSION"],
          network: cell.network_profile,
          runId: process.env["RUN_ID"],
        },
        (line) => console.log(line),
      );
      const artifactSha512 = process.env["T3_PERF_DESKTOP_SHA512"];
      return result.runs.map((sample) => ({
        ...sample,
        ...(cell.surface === "desktop" && artifactSha512 !== undefined
          ? { desktopArtifactSha512: artifactSha512 }
          : {}),
      }));
    },
  };
}

export async function runManifest(
  rawInput: unknown,
  outputDirectory: string,
  dependencies: AdapterDependencies = defaultDependencies(),
): Promise<number> {
  await NodeFSP.mkdir(outputDirectory, { recursive: true });
  const entries = await NodeFSP.readdir(outputDirectory);
  await Promise.all([
    NodeFSP.rm(NodePath.join(outputDirectory, "progress.json"), { force: true }),
    NodeFSP.rm(NodePath.join(outputDirectory, "result.json"), { force: true }),
    ...entries
      .filter(
        (name) =>
          (name.startsWith(".progress.json.") || name.startsWith(".result.json.")) &&
          name.endsWith(".tmp"),
      )
      .map((name) => NodeFSP.rm(NodePath.join(outputDirectory, name), { force: true })),
  ]);
  await syncDirectory(outputDirectory);
  const input = validate(rawInput);
  const startedAt = dependencies.now();
  const rows: Array<{
    cell: ManifestCell;
    status: "success" | "failed";
    samples: ReadonlyArray<unknown>;
  }> = [];
  let failed = false;
  for (const cell of input.cells) {
    try {
      const samples = await dependencies.runCell(cell, { warmups: 1, measuredRepetitions: 5 });
      if (!validSamples(samples))
        throw new Error("cell did not produce five finite JSON object samples");
      rows.push({ cell, status: "success", samples });
    } catch (error) {
      failed = true;
      console.error(
        `FAILED ${cell.scenario_id}/${cell.surface}/${cell.size}/${cell.network_profile}:`,
        error,
      );
      rows.push({ cell, status: "failed", samples: [] });
    }
    await atomicJson(NodePath.join(outputDirectory, "progress.json"), {
      completedCellCount: rows.length,
    });
  }
  await atomicJson(NodePath.join(outputDirectory, "result.json"), {
    run_started_at: startedAt,
    test_completed_at: dependencies.now(),
    provenance: input.expectedProvenance,
    cells: rows,
  });
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const { values } = NodeUtil.parseArgs({
    options: { manifest: { type: "string" }, out: { type: "string", default: "/results" } },
    strict: true,
  });
  if (values.manifest === undefined) throw new Error("--manifest is required");
  const input = JSON.parse(await NodeFSP.readFile(values.manifest, "utf8")) as unknown;
  return await runManifest(input, values.out);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href
) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 2;
    },
  );
}
