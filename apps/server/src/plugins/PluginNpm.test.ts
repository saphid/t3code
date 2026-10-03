import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { pluginInstallationStatus, type PluginInstallationId } from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { HttpClient } from "effect/unstable/http";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import * as PluginNpm from "./PluginNpm.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";
import {
  integrityOf,
  makeRegistry,
  makeTarball,
  REGISTRY,
  type TarEntry,
} from "./npmTarball.testkit.ts";

// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const fromJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

type Catalog = PluginCatalog.PluginCatalog["Service"];
type Npm = PluginNpm.PluginNpm["Service"];
type Registry = ReturnType<typeof makeRegistry>;

const startCatalog = Effect.fn("startCatalog")(function* (scope: Scope.Scope) {
  const supervisor = yield* PluginSupervisor.make({
    heapLimitMb: 64,
    activationTimeout: "10 seconds",
    stopGrace: "1 second",
  }).pipe(
    Effect.provideService(HostProcessArguments, [process.execPath, BIN_PATH]),
    Effect.provideService(Scope.Scope, scope),
  );
  return yield* PluginCatalog.make().pipe(
    Effect.provideService(PluginSupervisor.PluginSupervisor, supervisor),
    Effect.provideService(Scope.Scope, scope),
  );
});

const startNpm = Effect.fn("startNpm")(function* (
  scope: Scope.Scope,
  catalog: Catalog,
  registry: Registry,
  root: string,
  fileSystem?: FileSystem.FileSystem,
) {
  return yield* PluginNpm.make({ root, registry: REGISTRY }).pipe(
    Effect.provideService(PluginCatalog.PluginCatalog, catalog),
    Effect.provideService(HttpClient.HttpClient, registry.client),
    Effect.provideService(FileSystem.FileSystem, fileSystem ?? (yield* FileSystem.FileSystem)),
    Effect.provideService(Scope.Scope, scope),
  );
});

interface Fixture {
  readonly catalog: Catalog;
  readonly npm: Npm;
  readonly registry: Registry;
  readonly root: string;
  /** Activation writes the version here, outside the plugin's own directory. */
  readonly marker: string;
  /** Any package script that ran would write here. */
  readonly scriptMarker: string;
  readonly plugin: (
    name: string,
    version: string,
    options?: {
      readonly pluginId?: string;
      readonly packageJson?: Record<string, unknown>;
      readonly extra?: ReadonlyArray<TarEntry>;
      readonly manifest?: boolean;
    },
  ) => Uint8Array;
}

const setup = Effect.fn("setup")(function* (fileSystem?: FileSystem.FileSystem) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scope = yield* Scope.Scope;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-npm-" });
  const root = path.join(base, "npm");
  const marker = path.join(base, "activated");
  const scriptMarker = path.join(base, "script-ran");
  const registry = makeRegistry();
  const catalog = yield* startCatalog(scope);
  const npm = yield* startNpm(scope, catalog, registry, root, fileSystem);
  const plugin: Fixture["plugin"] = (name, version, options = {}) =>
    makeTarball([
      {
        path: "package/package.json",
        data: toJson({
          name,
          version,
          // Never run: T3 does not run package scripts.
          scripts: {
            prepare: `node -e "require('fs').writeFileSync(${toJson(scriptMarker)}, 'prepare')"`,
          },
          ...options.packageJson,
        }),
      },
      ...(options.manifest === false
        ? []
        : [
            {
              path: "package/t3-plugin.json",
              data: toJson({
                id: options.pluginId ?? "test.npm",
                name,
                version,
                apiVersion: 1,
                entry: "dist/main.mjs",
                proposedApi: true,
              }),
            },
          ]),
      {
        path: "package/dist/main.mjs",
        data: [
          `import * as NodeFS from "node:fs";`,
          `export function activate(context) {`,
          `  NodeFS.writeFileSync(${toJson(marker)}, ${toJson(version)});`,
          `  context.proposed.handle("version", () => ({ version: ${toJson(version)}, pid: process.pid }));`,
          `}`,
          ``,
        ].join("\n"),
      },
      ...(options.extra ?? []),
    ]);
  return { catalog, npm, registry, root, marker, scriptMarker, plugin } satisfies Fixture;
});

const callVersion = (catalog: Catalog, installationId: PluginInstallationId) =>
  catalog
    .invoke(installationId, "version", null)
    .pipe(Effect.map((value) => value as { readonly version: string; readonly pid: number }));

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Names in `directory`, or none when it is gone. */
const entries = (directory: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readDirectory(directory)),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
    Effect.map((names) => [...names].sort()),
  );

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqlitePersistenceMemory));

it.layer(NodeServices.layer)("PluginNpm", (it) => {
  describe("install", () => {
    it.effect("installs one exact version and runs nothing until its digest is approved", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const { catalog, npm, registry, root, marker, scriptMarker, plugin } = yield* setup();
          const tarball = plugin("t3-plugin-hello", "1.0.0");
          registry.publish("t3-plugin-hello", "1.0.0", { tarball });
          registry.tag("t3-plugin-hello", "latest", "1.0.0");

          const added = yield* npm.add({ name: "t3-plugin-hello", version: "latest" });
          // The tag is resolved once; only the exact version and its integrity are kept.
          expect(added.package.source).toMatchObject({
            registry: REGISTRY,
            name: "t3-plugin-hello",
            version: "1.0.0",
            integrity: integrityOf(tarball),
          });
          expect(added.package.stagedUpdate).toBeNull();
          const installationId = added.installation.installationId;
          expect(pluginInstallationStatus(added.installation)).toBe("needs-consent");
          expect(path.dirname(path.dirname(added.installation.directory))).toBe(
            yield* fs.realPath(root),
          );
          expect(yield* entries(path.dirname(added.installation.directory))).toEqual([
            "npm.json",
            "package",
          ]);
          expect((yield* npm.list).packages.map((item) => item.installationId)).toEqual([
            installationId,
          ]);

          const unapproved = yield* catalog.enable({ installationId }).pipe(Effect.flip);
          expect(unapproved.reason).toBe("consent-required");
          yield* catalog.consent({ installationId, digest: added.installation.source!.digest });
          yield* catalog.enable({ installationId });
          expect(yield* fs.exists(marker)).toBe(false);
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.0.0");
          expect(yield* fs.readFileString(marker)).toBe("1.0.0");
          expect(yield* fs.exists(scriptMarker)).toBe(false);

          const again = yield* npm
            .add({ name: "t3-plugin-hello", version: "1.0.0" })
            .pipe(Effect.flip);
          expect(again.reason).toBe("already-added");
        }),
      ),
    );

    it.effect("refuses tampered, unsafe, or uninstallable packages and leaves nothing behind", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const { catalog, npm, registry, root, scriptMarker, plugin } = yield* setup();
          const good = plugin("good", "1.0.0");
          const cases: ReadonlyArray<{
            readonly name: string;
            readonly reason: string;
            readonly publish?: () => void;
            readonly version?: string;
            readonly registry?: string;
            readonly offline?: boolean;
          }> = [
            {
              name: "tampered",
              reason: "npm-integrity-mismatch",
              publish: () =>
                registry.publish("tampered", "1.0.0", {
                  tarball: plugin("tampered", "1.0.0"),
                  served: plugin("tampered", "1.0.0", {
                    extra: [{ path: "package/evil.js", data: "x" }],
                  }),
                }),
            },
            {
              name: "no-integrity",
              reason: "npm-integrity-missing",
              publish: () =>
                registry.publish("no-integrity", "1.0.0", {
                  tarball: plugin("no-integrity", "1.0.0"),
                  integrity: undefined,
                }),
            },
            {
              name: "wrong-version",
              reason: "npm-registry-invalid",
              publish: () =>
                registry.publish("wrong-version", "1.0.0", {
                  tarball: plugin("wrong-version", "1.0.0"),
                  claimedVersion: "1.0.1",
                }),
            },
            {
              name: "symlink",
              reason: "npm-archive-unsafe",
              publish: () =>
                registry.publish("symlink", "1.0.0", {
                  tarball: plugin("symlink", "1.0.0", {
                    extra: [{ path: "package/dist/link.mjs", type: "2", linkname: "/etc/hosts" }],
                  }),
                }),
            },
            {
              name: "escape",
              reason: "npm-archive-unsafe",
              publish: () =>
                registry.publish("escape", "1.0.0", {
                  tarball: plugin("escape", "1.0.0", {
                    extra: [{ path: "package/../../escaped.js", data: "x" }],
                  }),
                }),
            },
            {
              name: "install-script",
              reason: "npm-install-scripts",
              publish: () =>
                registry.publish("install-script", "1.0.0", {
                  tarball: plugin("install-script", "1.0.0", {
                    packageJson: { scripts: { postinstall: "node -e 1" } },
                  }),
                }),
            },
            {
              name: "dependency",
              reason: "npm-dependencies",
              publish: () =>
                registry.publish("dependency", "1.0.0", {
                  tarball: plugin("dependency", "1.0.0", {
                    packageJson: { dependencies: { "left-pad": "^1.0.0" } },
                  }),
                }),
            },
            {
              name: "renamed",
              reason: "npm-package-mismatch",
              publish: () =>
                registry.publish("renamed", "1.0.0", { tarball: plugin("other-name", "1.0.0") }),
            },
            {
              name: "no-manifest",
              reason: "invalid-directory",
              publish: () =>
                registry.publish("no-manifest", "1.0.0", {
                  tarball: plugin("no-manifest", "1.0.0", { manifest: false }),
                }),
            },
            { name: "unpublished", reason: "npm-not-found" },
            {
              name: "good",
              reason: "npm-not-found",
              version: "2.0.0",
              publish: () => registry.publish("good", "1.0.0", { tarball: good }),
            },
            { name: "good", reason: "npm-registry-unavailable", offline: true },
            {
              name: "good",
              reason: "npm-invalid-request",
              registry: "https://user:pw@registry.test",
            },
          ];
          for (const testCase of cases) {
            testCase.publish?.();
            registry.state.offline = testCase.offline ?? false;
            const error = yield* npm
              .add({
                name: testCase.name,
                version: testCase.version ?? "1.0.0",
                ...(testCase.registry === undefined ? {} : { registry: testCase.registry }),
              })
              .pipe(Effect.flip);
            expect(error.reason, testCase.name).toBe(testCase.reason);
            expect(yield* entries(root), testCase.name).toEqual([]);
          }
          expect((yield* catalog.list).installations).toEqual([]);
          expect((yield* npm.list).packages).toEqual([]);
          expect(yield* fs.exists(scriptMarker)).toBe(false);

          // A dependency shipped inside the package is fine.
          registry.state.offline = false;
          registry.publish("bundled", "1.0.0", {
            tarball: plugin("bundled", "1.0.0", {
              packageJson: { dependencies: { tiny: "1.0.0" }, bundleDependencies: ["tiny"] },
              extra: [{ path: "package/node_modules/tiny/package.json", data: "{}" }],
            }),
          });
          const bundled = yield* npm.add({ name: "bundled", version: "1.0.0" });
          expect(bundled.package.source.version).toBe("1.0.0");
        }),
      ),
    );

    it.effect("deletes a package's files when it is removed from the catalogue", () =>
      withDatabase(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const { catalog, npm, registry, root, plugin } = yield* setup();
          registry.publish("removed", "1.0.0", { tarball: plugin("removed", "1.0.0") });
          const added = yield* npm.add({ name: "removed", version: "1.0.0" });
          const installationId = added.installation.installationId;
          yield* npm.stageUpdate({ installationId, version: "1.0.0" });
          expect(yield* entries(root)).toEqual([
            path.basename(path.dirname(added.installation.directory)),
          ]);

          yield* catalog.remove({ installationId });
          expect((yield* npm.list).packages).toEqual([]);
          // Installing it again first collects what the catalogue dropped.
          const again = yield* npm.add({ name: "removed", version: "1.0.0" });
          expect(again.installation.installationId).not.toBe(installationId);
          expect(yield* entries(root)).toEqual([
            path.basename(path.dirname(again.installation.directory)),
          ]);
        }),
      ),
    );
  });

  describe("update", () => {
    it.effect("stages a version beside the running one and swaps it in with new consent", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const { catalog, npm, registry, plugin } = yield* setup();
          registry.publish("updated", "1.0.0", { tarball: plugin("updated", "1.0.0") });
          registry.publish("updated", "1.1.0", { tarball: plugin("updated", "1.1.0") });
          registry.publish("updated", "1.2.0", { tarball: plugin("updated", "1.2.0") });
          registry.publish("updated", "2.0.0", {
            tarball: plugin("updated", "2.0.0", { pluginId: "test.other" }),
          });
          const added = yield* npm.add({ name: "updated", version: "1.0.0" });
          const installationId = added.installation.installationId;
          const home = path.dirname(added.installation.directory);
          const oldDigest = added.installation.source!.digest;
          yield* catalog.consent({ installationId, digest: oldDigest });
          yield* catalog.enable({ installationId });
          const before = yield* callVersion(catalog, installationId);
          expect(before.version).toBe("1.0.0");

          const missing = yield* npm
            .applyUpdate({ installationId, digest: oldDigest })
            .pipe(Effect.flip);
          expect(missing.reason).toBe("npm-no-update");

          const { package: staged } = yield* npm.stageUpdate({ installationId, version: "1.1.0" });
          const update = staged.stagedUpdate!;
          expect(update).toMatchObject({ version: "1.1.0", manifest: { id: "test.npm" } });
          expect(update.source.digest).not.toBe(oldDigest);
          // Staging changes nothing about what is installed or running.
          expect(staged.source.version).toBe("1.0.0");
          const stillRunning = yield* callVersion(catalog, installationId);
          expect(stillRunning).toEqual(before);
          const row = (yield* catalog.list).installations[0]!;
          expect(row).toMatchObject({ enabled: true, source: { digest: oldDigest } });

          const notReviewed = yield* npm
            .applyUpdate({ installationId, digest: oldDigest })
            .pipe(Effect.flip);
          expect(notReviewed.reason).toBe("source-changed");
          expect(isProcessAlive(before.pid)).toBe(true);

          const applied = yield* npm.applyUpdate({ installationId, digest: update.source.digest });
          expect(applied.package).toMatchObject({
            source: { version: "1.1.0", integrity: update.integrity },
            stagedUpdate: null,
          });
          expect(applied.installation).toMatchObject({
            enabled: true,
            source: { digest: update.source.digest },
            consent: { digest: update.source.digest },
          });
          expect(isProcessAlive(before.pid)).toBe(false);
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.1.0");
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          const record = fromJson(yield* fs.readFileString(path.join(home, "npm.json")));
          expect(record).toEqual({ source: expect.objectContaining({ version: "1.1.0" }) });

          // A staged update can be dropped, and one for another plugin id is refused.
          yield* npm.stageUpdate({ installationId, version: "1.2.0" });
          const discarded = yield* npm.discardUpdate({ installationId });
          expect(discarded.package.stagedUpdate).toBeNull();
          const otherId = yield* npm
            .stageUpdate({ installationId, version: "2.0.0" })
            .pipe(Effect.flip);
          expect(otherId.reason).toBe("npm-plugin-id-changed");
          const unpublished = yield* npm
            .stageUpdate({ installationId, version: "9.9.9" })
            .pipe(Effect.flip);
          expect(unpublished.reason).toBe("npm-not-found");
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
        }),
      ),
    );

    it.effect("discards a staged update whose files changed after it was checked", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const { catalog, npm, registry, plugin } = yield* setup();
          registry.publish("staged", "1.0.0", { tarball: plugin("staged", "1.0.0") });
          registry.publish("staged", "1.1.0", { tarball: plugin("staged", "1.1.0") });
          const added = yield* npm.add({ name: "staged", version: "1.0.0" });
          const installationId = added.installation.installationId;
          const home = path.dirname(added.installation.directory);
          yield* catalog.consent({ installationId, digest: added.installation.source!.digest });
          yield* catalog.enable({ installationId });
          const before = yield* callVersion(catalog, installationId);

          const { package: staged } = yield* npm.stageUpdate({ installationId, version: "1.1.0" });
          const stagingName = (yield* entries(home)).find((name) => name.startsWith(".staging-"))!;
          yield* fs.writeFileString(path.join(home, stagingName, "dist", "extra.mjs"), "x");

          const error = yield* npm
            .applyUpdate({ installationId, digest: staged.stagedUpdate!.source.digest })
            .pipe(Effect.flip);
          expect(error.reason).toBe("source-changed");
          expect((yield* npm.list).packages[0]!.stagedUpdate).toBeNull();
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          // The installed version never stopped.
          expect(yield* callVersion(catalog, installationId)).toEqual(before);
        }),
      ),
    );

    it.effect("puts the old version back when the update fails after the swap", () =>
      withDatabase(
        Effect.gen(function* () {
          const realFs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          // Models the new files changing between the swap and the consent.
          const fileSystem: FileSystem.FileSystem = {
            ...realFs,
            rename: (from, to) =>
              realFs
                .rename(from, to)
                .pipe(
                  Effect.andThen(
                    path.basename(from).startsWith(".staging-") && path.basename(to) === "package"
                      ? realFs.writeFileString(path.join(to, "late.mjs"), "x")
                      : Effect.void,
                  ),
                ),
          };
          const { catalog, npm, registry, plugin } = yield* setup(fileSystem);
          registry.publish("rollback", "1.0.0", { tarball: plugin("rollback", "1.0.0") });
          registry.publish("rollback", "1.1.0", { tarball: plugin("rollback", "1.1.0") });
          const added = yield* npm.add({ name: "rollback", version: "1.0.0" });
          const installationId = added.installation.installationId;
          const home = path.dirname(added.installation.directory);
          const oldDigest = added.installation.source!.digest;
          yield* catalog.consent({ installationId, digest: oldDigest });
          yield* catalog.enable({ installationId });
          const before = yield* callVersion(catalog, installationId);

          const { package: staged } = yield* npm.stageUpdate({ installationId, version: "1.1.0" });
          const error = yield* npm
            .applyUpdate({ installationId, digest: staged.stagedUpdate!.source.digest })
            .pipe(Effect.flip);
          expect(error.reason).toBe("source-changed");

          const row = (yield* catalog.list).installations[0]!;
          expect(row).toMatchObject({
            enabled: true,
            source: { digest: oldDigest },
            consent: { digest: oldDigest },
          });
          expect((yield* npm.list).packages[0]).toMatchObject({
            source: { version: "1.0.0" },
            stagedUpdate: null,
          });
          expect(isProcessAlive(before.pid)).toBe(false);
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.0.0");
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          const record = fromJson(yield* realFs.readFileString(path.join(home, "npm.json")));
          expect(record).toEqual({ source: added.package.source });
        }),
      ),
    );

    it.effect("finishes or rolls back an update a restart interrupted, and deletes leftovers", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const scope = yield* Scope.Scope;
          const registry = makeRegistry();
          const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-npm-restart-" });
          const root = path.join(base, "npm");
          const catalog = yield* startCatalog(scope);
          const firstScope = yield* Scope.make();
          const first = yield* startNpm(firstScope, catalog, registry, root);
          const tarballFor = (name: string, version: string) =>
            makeTarball([
              { path: "package/package.json", data: toJson({ name, version }) },
              {
                path: "package/t3-plugin.json",
                data: toJson({
                  id: `test.${name}`,
                  name,
                  version,
                  apiVersion: 1,
                  entry: "main.mjs",
                }),
              },
              { path: "package/main.mjs", data: `export function activate() {} // ${version}` },
            ]);
          for (const name of ["rolled", "finished"])
            for (const version of ["1.0.0", "1.1.0"])
              registry.publish(name, version, { tarball: tarballFor(name, version) });

          /** Leaves the state an update had when the server stopped after the swap. */
          const interrupt = Effect.fn("interrupt")(function* (name: string, consented: boolean) {
            const added = yield* first.add({ name, version: "1.0.0" });
            const installationId = added.installation.installationId;
            const home = path.dirname(added.installation.directory);
            yield* catalog.consent({ installationId, digest: added.installation.source!.digest });
            const { package: staged } = yield* first.stageUpdate({
              installationId,
              version: "1.1.0",
            });
            const update = staged.stagedUpdate!;
            const stagingName = (yield* entries(home)).find((entry) =>
              entry.startsWith(".staging-"),
            )!;
            yield* fs.writeFileString(
              path.join(home, "npm.json"),
              toJson({
                source: added.package.source,
                swap: {
                  source: {
                    ...added.package.source,
                    version: "1.1.0",
                    integrity: update.integrity,
                  },
                  digest: update.source.digest,
                },
              }),
            );
            yield* fs.rename(added.installation.directory, path.join(home, ".previous"));
            yield* fs.rename(path.join(home, stagingName), added.installation.directory);
            if (consented) yield* catalog.consent({ installationId, digest: update.source.digest });
            return { installationId, home, oldDigest: added.installation.source!.digest, update };
          });
          const rolled = yield* interrupt("rolled", false);
          const finished = yield* interrupt("finished", true);
          yield* fs.makeDirectory(path.join(rolled.home, ".staging-left"));
          yield* fs.makeDirectory(path.join(root, "pkg-orphan", "package"), { recursive: true });
          yield* Scope.close(firstScope, Exit.void);

          const second = yield* startNpm(scope, catalog, registry, root);
          const packages = (yield* second.list).packages;
          expect(packages.map((item) => [item.installationId, item.source.version])).toEqual(
            [
              [rolled.installationId, "1.0.0"],
              [finished.installationId, "1.1.0"],
            ].sort(([a], [b]) => a!.localeCompare(b!)),
          );
          expect(yield* entries(rolled.home)).toEqual(["npm.json", "package"]);
          expect(yield* entries(finished.home)).toEqual(["npm.json", "package"]);
          expect((yield* entries(root)).length).toBe(2);
          const rows = (yield* catalog.list).installations;
          const rolledRow = rows.find((row) => row.installationId === rolled.installationId)!;
          const finishedRow = rows.find((row) => row.installationId === finished.installationId)!;
          // Rolled back: the old bytes and their consent again. Finished: the consented new bytes.
          expect(rolledRow.source?.digest).toBe(rolled.oldDigest);
          expect(pluginInstallationStatus(rolledRow)).toBe("disabled");
          expect(finishedRow.source?.digest).toBe(finished.update.source.digest);
          expect(pluginInstallationStatus(finishedRow)).toBe("disabled");
          const record = fromJson(yield* fs.readFileString(path.join(finished.home, "npm.json")));
          expect(record).toEqual({
            source: expect.objectContaining({
              version: "1.1.0",
              integrity: finished.update.integrity,
            }),
          });
        }),
      ),
    );
  });
});
