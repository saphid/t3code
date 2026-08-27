// @effect-diagnostics nodeBuiltinImport:off - Black-box filesystem contract tests for a standalone container adapter.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { runManifest, type ManifestCell } from "./manifestAdapter.ts";

const provenance = {
  contract_id: "contract-v2",
  fixture_revision: "fixtures-v1",
  harness_git_sha: "a".repeat(40),
  contract_fingerprint: `sha256:${"b".repeat(64)}`,
  browser_engine: "chromium",
  browser_version: "1.60.0",
  surface: "web",
  renderer_backend: "chromium_swiftshader",
  scheduler_git_sha: "c".repeat(40),
  manifest_hash: "placeholder",
  suite_revision: "core-web-v1",
};

function canonicalHash(value: object): string {
  const sorted = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sorted);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => [key, sorted(item)]),
      );
    }
    return entry;
  };
  return NodeCrypto.createHash("sha256")
    .update(JSON.stringify(sorted(value)))
    .digest("hex");
}

function manifest(cells: ReadonlyArray<ManifestCell>) {
  const envelope = {
    manifestId: "core-web-v1",
    manifestSchemaVersion: 1,
    cellPartitionHash: "d".repeat(64),
    contractId: provenance.contract_id,
    suiteRevision: provenance.suite_revision,
    fixtureRevision: provenance.fixture_revision,
    harnessGitSha: provenance.harness_git_sha,
    contractFingerprint: provenance.contract_fingerprint,
    browserEngine: provenance.browser_engine,
    browserVersion: provenance.browser_version,
    surface: provenance.surface,
    rendererBackend: provenance.renderer_backend,
    schedulerGitSha: provenance.scheduler_git_sha,
    tier: "required",
    cells,
    samplePolicy: { version: "five-after-warmup-v1", warmups: 1, measured_repetitions: 5 },
    controlPolicy: "none-v1",
    prngAlgorithm: "none-v1",
    seedMaterialFields: [],
  };
  const manifestHash = canonicalHash(envelope);
  return {
    ...envelope,
    manifestHash,
    expectedProvenance: { ...provenance, manifest_hash: manifestHash },
  };
}

function desktopManifest(cells: ReadonlyArray<ManifestCell>) {
  const input = manifest(cells);
  const envelope = {
    ...input,
    manifestId: "core-desktop-v1",
    suiteRevision: "core-desktop-v1",
    browserEngine: "electron",
    browserVersion: "packaged-nightly",
    surface: "desktop",
    rendererBackend: "chromium_swiftshader",
  };
  const expectedProvenance = {
    ...input.expectedProvenance,
    browser_engine: envelope.browserEngine,
    browser_version: envelope.browserVersion,
    surface: envelope.surface,
    suite_revision: envelope.suiteRevision,
  };
  const manifestEnvelope = Object.fromEntries(
    Object.entries(envelope).filter(
      ([key]) => key !== "manifestHash" && key !== "expectedProvenance",
    ),
  );
  const manifestHash = canonicalHash(manifestEnvelope);
  return {
    ...envelope,
    manifestHash,
    expectedProvenance: { ...expectedProvenance, manifest_hash: manifestHash },
  };
}

describe("manifest-v1 adapter", () => {
  it("runs a packaged Electron cell as a distinct desktop surface", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-desktop-"));
    const cells = [
      {
        scenario_id: "preview-pip-frames",
        surface: "desktop",
        size: "small",
        network_profile: "good",
      },
    ] as const;
    const input = desktopManifest(cells);
    const seen: Array<ManifestCell> = [];
    const exitCode = await runManifest(input, output, {
      now: () => "2026-08-27T00:00:00.000Z",
      runCell: (cell) => {
        seen.push(cell);
        return Promise.resolve([
          { wallMs: 1 },
          { wallMs: 2 },
          { wallMs: 3 },
          { wallMs: 4 },
          { wallMs: 5 },
        ]);
      },
    });

    expect(exitCode).toBe(0);
    expect(seen).toEqual(cells);
    const result = JSON.parse(await NodeFSP.readFile(NodePath.join(output, "result.json"), "utf8"));
    expect(result.provenance).toEqual(input.expectedProvenance);
    expect(result.cells[0].cell.surface).toBe("desktop");
  });

  it("rejects network shaping for Electron cells", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-desktop-net-"));
    const input = desktopManifest([
      {
        scenario_id: "startup",
        surface: "desktop",
        size: "small",
        network_profile: "flaky",
      },
    ]);
    await expect(runManifest(input, output)).rejects.toThrow("unsupported cell");
  });

  it("runs cells in order, preserves their identity, and atomically publishes progress and results", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-v1-"));
    await NodeFSP.writeFile(NodePath.join(output, "progress.json"), "stale progress");
    await NodeFSP.writeFile(NodePath.join(output, "result.json"), "stale result");
    const cells = [
      { scenario_id: "startup", surface: "web", size: "small", network_profile: "good" },
      { scenario_id: "open-large-diff", surface: "web", size: "large", network_profile: "flaky" },
    ] as const;
    const seen: Array<ManifestCell> = [];
    const exitCode = await runManifest(manifest(cells), output, {
      now: (() => {
        const stamps = ["2026-08-25T00:00:00.000Z", "2026-08-25T00:01:00.000Z"];
        return () => stamps.shift() ?? "2026-08-25T00:01:00.000Z";
      })(),
      runCell: (cell, policy) => {
        seen.push(cell);
        expect(policy).toEqual({ warmups: 1, measuredRepetitions: 5 });
        if (seen.length === 1) {
          return Promise.all([
            NodeFSP.access(NodePath.join(output, "progress.json")).then(
              () => true,
              () => false,
            ),
            NodeFSP.access(NodePath.join(output, "result.json")).then(
              () => true,
              () => false,
            ),
          ]).then((exists) => {
            expect(exists).toEqual([false, false]);
            return [{ wallMs: 1 }, { wallMs: 2 }, { wallMs: 3 }, { wallMs: 4 }, { wallMs: 5 }];
          });
        }
        return Promise.resolve([
          { wallMs: 1 },
          { wallMs: 2 },
          { wallMs: 3 },
          { wallMs: 4 },
          { wallMs: 5 },
        ]);
      },
    });

    expect(exitCode).toBe(0);
    expect(seen).toEqual(cells);
    expect(
      JSON.parse(await NodeFSP.readFile(NodePath.join(output, "progress.json"), "utf8")),
    ).toEqual({
      completedCellCount: 2,
    });
    const result = JSON.parse(await NodeFSP.readFile(NodePath.join(output, "result.json"), "utf8"));
    expect(result).toEqual({
      run_started_at: "2026-08-25T00:00:00.000Z",
      test_completed_at: "2026-08-25T00:01:00.000Z",
      provenance: manifest(cells).expectedProvenance,
      cells: cells.map((cell) => ({
        cell,
        status: "success",
        samples: [{ wallMs: 1 }, { wallMs: 2 }, { wallMs: 3 }, { wallMs: 4 }, { wallMs: 5 }],
      })),
    });
    expect((await NodeFSP.readdir(output)).filter((name) => name.includes(".tmp"))).toEqual([]);
    expect((await NodeFSP.stat(NodePath.join(output, "progress.json"))).mode & 0o777).toBe(0o644);
    expect((await NodeFSP.stat(NodePath.join(output, "result.json"))).mode & 0o777).toBe(0o644);
  });

  it("records a terminal failed cell, continues the manifest, and exits one", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-v1-failure-"));
    const cells = [
      { scenario_id: "startup", surface: "web", size: "small", network_profile: "good" },
      { scenario_id: "open-large-diff", surface: "web", size: "large", network_profile: "good" },
    ] as const;
    let calls = 0;
    const exitCode = await runManifest(manifest(cells), output, {
      now: () => "2026-08-25T00:00:00.000Z",
      runCell: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("browser crashed"));
        return Promise.resolve([
          { wallMs: 1 },
          { wallMs: 2 },
          { wallMs: 3 },
          { wallMs: 4 },
          { wallMs: 5 },
        ]);
      },
    });
    const result = JSON.parse(await NodeFSP.readFile(NodePath.join(output, "result.json"), "utf8"));
    expect(exitCode).toBe(1);
    expect(calls).toBe(2);
    expect(
      result.cells.map((row: { status: string; samples: Array<unknown> }) => [
        row.status,
        row.samples.length,
      ]),
    ).toEqual([
      ["failed", 0],
      ["success", 5],
    ]);
  });

  it("rejects a changed envelope before running a cell or writing a result", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-v1-invalid-"));
    await NodeFSP.writeFile(NodePath.join(output, "progress.json"), "stale");
    await NodeFSP.writeFile(NodePath.join(output, "result.json"), "stale");
    await NodeFSP.writeFile(NodePath.join(output, ".result.json.1.abandoned.tmp"), "stale");
    const input = manifest([
      { scenario_id: "startup", surface: "web", size: "small", network_profile: "good" },
    ]);
    const invalid = {
      ...input,
      cells: [{ ...input.cells[0]!, scenario_id: "changed" }],
    };
    let ran = false;
    await expect(
      runManifest(invalid, output, {
        now: () => "2026-08-25T00:00:00.000Z",
        runCell: () => {
          ran = true;
          return Promise.resolve([]);
        },
      }),
    ).rejects.toThrow("manifestHash");
    expect(ran).toBe(false);
    await expect(NodeFSP.access(NodePath.join(output, "progress.json"))).rejects.toThrow();
    await expect(NodeFSP.access(NodePath.join(output, "result.json"))).rejects.toThrow();
    expect(await NodeFSP.readdir(output)).toEqual([]);
  });

  it("marks a cell failed when a sample is non-finite or not an object", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-v1-samples-"));
    const input = manifest([
      { scenario_id: "startup", surface: "web", size: "small", network_profile: "good" },
    ]);
    const exitCode = await runManifest(input, output, {
      now: () => "2026-08-25T00:00:00.000Z",
      runCell: () =>
        Promise.resolve([{ wallMs: 1 }, { wallMs: 2 }, { wallMs: Number.NaN }, { wallMs: 4 }, 5]),
    });
    const result = JSON.parse(await NodeFSP.readFile(NodePath.join(output, "result.json"), "utf8"));
    expect(exitCode).toBe(1);
    expect(result.cells[0]).toEqual({ cell: input.cells[0], status: "failed", samples: [] });
  });

  it("rejects the retired image-digest wire shape and malformed contract fingerprints", async () => {
    const output = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "manifest-v1-identity-"));
    const input = manifest([
      { scenario_id: "startup", surface: "web", size: "small", network_profile: "good" },
    ]);
    const legacy: Record<string, unknown> = { ...input, imageDigest: input.contractFingerprint };
    delete legacy["contractFingerprint"];
    legacy["expectedProvenance"] = {
      ...input.expectedProvenance,
      image_digest: input.expectedProvenance.contract_fingerprint,
    };
    delete (legacy["expectedProvenance"] as Record<string, unknown>)["contract_fingerprint"];
    const legacyEnvelope = Object.fromEntries(
      Object.entries(legacy).filter(
        ([key]) => key !== "manifestHash" && key !== "expectedProvenance",
      ),
    );
    legacy["manifestHash"] = canonicalHash(legacyEnvelope);
    let ran = false;
    const dependencies = {
      now: () => "2026-08-25T00:00:00.000Z",
      runCell: () => {
        ran = true;
        return Promise.resolve([]);
      },
    };
    await expect(runManifest(legacy, output, dependencies)).rejects.toThrow(
      "manifest has unsupported fields",
    );

    const legacyProvenance: Record<string, unknown> = {
      ...input,
      expectedProvenance: {
        ...input.expectedProvenance,
        image_digest: input.expectedProvenance.contract_fingerprint,
      },
    };
    delete (legacyProvenance["expectedProvenance"] as Record<string, unknown>)[
      "contract_fingerprint"
    ];
    await expect(runManifest(legacyProvenance, output, dependencies)).rejects.toThrow(
      "expectedProvenance has unsupported fields",
    );

    const malformed = {
      ...input,
      contractFingerprint: `sha256:${"z".repeat(64)}`,
      expectedProvenance: {
        ...input.expectedProvenance,
        contract_fingerprint: `sha256:${"z".repeat(64)}`,
      },
    };
    const malformedEnvelope = Object.fromEntries(
      Object.entries(malformed).filter(
        ([key]) => key !== "manifestHash" && key !== "expectedProvenance",
      ),
    );
    malformed.manifestHash = canonicalHash(malformedEnvelope);
    malformed.expectedProvenance = {
      ...malformed.expectedProvenance,
      manifest_hash: malformed.manifestHash,
    };
    await expect(runManifest(malformed, output, dependencies)).rejects.toThrow(
      "sha256 fingerprint",
    );
    expect(ran).toBe(false);
  });

  it("rejects a scheduler SHA that no longer matches expected provenance", async () => {
    const output = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "manifest-v1-scheduler-sha-"),
    );
    const input = manifest([
      { scenario_id: "startup", surface: "web", size: "small", network_profile: "good" },
    ]);
    const changed = { ...input, schedulerGitSha: "e".repeat(40) };
    const envelope = Object.fromEntries(
      Object.entries(changed).filter(
        ([key]) => key !== "manifestHash" && key !== "expectedProvenance",
      ),
    );
    changed.manifestHash = canonicalHash(envelope);
    changed.expectedProvenance = {
      ...changed.expectedProvenance,
      manifest_hash: changed.manifestHash,
    };
    await expect(
      runManifest(changed, output, {
        now: () => "2026-08-25T00:00:00.000Z",
        runCell: () => Promise.resolve([]),
      }),
    ).rejects.toThrow("expectedProvenance");
  });
});
