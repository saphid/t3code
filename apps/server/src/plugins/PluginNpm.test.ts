import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { pluginInstallationStatus, type PluginInstallationId } from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
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

type Faulted = "rename" | "writeFileString" | "remove" | "exists";

/** The real file system, with failures and a hold that a test arms per call. */
const makeFaults = (realFs: FileSystem.FileSystem) => {
  const armed: {
    /** Fails every call it returns true for; `detail` is a rename's target or the data written. */
    fail: ((method: Faulted, target: string, detail?: string) => boolean) | undefined;
    /** Pauses the next matching call until `release`. */
    hold:
      | {
          readonly matches: (method: Faulted, target: string, to?: string) => boolean;
          readonly entered: Deferred.Deferred<void>;
          readonly release: Deferred.Deferred<void>;
        }
      | undefined;
  } = { fail: undefined, hold: undefined };
  const failure = (method: Faulted, target: string) =>
    Effect.fail(
      PlatformError.systemError({
        _tag: "PermissionDenied",
        module: "FileSystem",
        method,
        pathOrDescriptor: target,
        description: "Injected failure.",
      }),
    );
  const held = <A, E>(
    method: Faulted,
    target: string,
    to: string | undefined,
    run: Effect.Effect<A, E>,
  ) =>
    Effect.suspend(() => {
      const hold = armed.hold;
      if (hold === undefined || !hold.matches(method, target, to)) return run;
      armed.hold = undefined;
      return Deferred.succeed(hold.entered, undefined).pipe(
        Effect.andThen(Deferred.await(hold.release)),
        Effect.andThen(run),
      );
    });
  const fileSystem: FileSystem.FileSystem = {
    ...realFs,
    rename: (from, to) =>
      Effect.suspend(() =>
        armed.fail?.("rename", from, to)
          ? failure("rename", from)
          : held("rename", from, to, realFs.rename(from, to)),
      ),
    writeFileString: (target, data, options) =>
      Effect.suspend(() =>
        armed.fail?.("writeFileString", target, data)
          ? failure("writeFileString", target)
          : realFs.writeFileString(target, data, options),
      ),
    remove: (target, options) =>
      Effect.suspend(() =>
        armed.fail?.("remove", target)
          ? failure("remove", target)
          : held("remove", target, undefined, realFs.remove(target, options)),
      ),
    exists: (target) => held("exists", target, undefined, realFs.exists(target)),
  };
  return { fileSystem, armed };
};

/** A plugin whose `files` handler reports the version it loaded and the one now in its directory. */
const filesTarball = (name: string, version: string) =>
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
        proposedApi: true,
      }),
    },
    { path: "package/version.txt", data: version },
    {
      path: "package/main.mjs",
      data: [
        `import * as NodeFS from "node:fs";`,
        `export function activate(context) {`,
        `  context.proposed.handle("files", () => ({`,
        `    loaded: ${toJson(version)},`,
        `    disk: NodeFS.readFileSync(new URL("./version.txt", import.meta.url), "utf8"),`,
        `    pid: process.pid,`,
        `  }));`,
        `}`,
        ``,
      ].join("\n"),
    },
  ]);

const callFiles = (catalog: Catalog, installationId: PluginInstallationId) =>
  catalog
    .invoke(installationId, "files", null)
    .pipe(
      Effect.map(
        (value) =>
          value as { readonly loaded: string; readonly disk: string; readonly pid: number },
      ),
    );

/**
 * Leaves what a server that stopped applying an update to 1.1.0 after both
 * renames, before the consent, leaves behind: the journal, the 1.0.0 files in
 * `.previous`, and the 1.1.0 files in `package/`. The journal names
 * `journaled`, which a test may set to a version other than the files.
 */
const crashBeforeConsent = Effect.fn("crashBeforeConsent")(function* (
  scope: Scope.Scope,
  name: string,
  journaled = "1.1.0",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const registry = makeRegistry();
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-npm-crash-" });
  const root = path.join(base, "npm");
  const catalog = yield* startCatalog(scope);
  const firstScope = yield* Scope.make();
  const first = yield* startNpm(firstScope, catalog, registry, root);
  for (const version of ["1.0.0", "1.1.0", "1.2.0"])
    registry.publish(name, version, { tarball: filesTarball(name, version) });
  const added = yield* first.add({ name, version: "1.0.0" });
  const installationId = added.installation.installationId;
  const home = path.dirname(added.installation.directory);
  const oldDigest = added.installation.source!.digest;
  yield* catalog.consent({ installationId, digest: oldDigest });
  const journal = (yield* first.stageUpdate({ installationId, version: journaled })).package
    .stagedUpdate!;
  const files =
    journaled === "1.1.0"
      ? journal
      : (yield* first.stageUpdate({ installationId, version: "1.1.0" })).package.stagedUpdate!;
  const next = { ...added.package.source, version: journaled, integrity: journal.integrity };
  const stagingName = (yield* entries(home)).find((entry) => entry.startsWith(".staging-"))!;
  yield* fs.writeFileString(
    path.join(home, "npm.json"),
    toJson({ source: added.package.source, swap: { source: next, digest: journal.source.digest } }),
  );
  yield* fs.rename(added.installation.directory, path.join(home, ".previous"));
  yield* fs.rename(path.join(home, stagingName), added.installation.directory);
  yield* Scope.close(firstScope, Exit.void);
  return {
    catalog,
    registry,
    root,
    installationId,
    home,
    oldDigest,
    next,
    journalDigest: journal.source.digest,
    filesDigest: files.source.digest,
  };
});

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
              // Bundled, but what the bundled package needs in turn is not shipped.
              name: "missing-transitive",
              reason: "npm-dependencies",
              publish: () =>
                registry.publish("missing-transitive", "1.0.0", {
                  tarball: plugin("missing-transitive", "1.0.0", {
                    packageJson: { dependencies: { tiny: "1.0.0" }, bundleDependencies: ["tiny"] },
                    extra: [
                      {
                        path: "package/node_modules/tiny/package.json",
                        data: toJson({ name: "tiny", dependencies: { "not-shipped": "1.0.0" } }),
                      },
                    ],
                  }),
                }),
            },
            {
              // Shipped, but only where Node would not look for it from `tiny`.
              name: "unreachable-transitive",
              reason: "npm-dependencies",
              publish: () =>
                registry.publish("unreachable-transitive", "1.0.0", {
                  tarball: plugin("unreachable-transitive", "1.0.0", {
                    packageJson: {
                      dependencies: { tiny: "1.0.0", other: "1.0.0" },
                      bundleDependencies: true,
                    },
                    extra: [
                      {
                        path: "package/node_modules/tiny/package.json",
                        data: toJson({ name: "tiny", peerDependencies: { hidden: "1.0.0" } }),
                      },
                      { path: "package/node_modules/other/package.json", data: "{}" },
                      {
                        path: "package/node_modules/other/node_modules/hidden/package.json",
                        data: "{}",
                      },
                    ],
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

          // Dependencies shipped inside the package are fine, hoisted or nested, and so is a
          // missing peer its dependent marks optional.
          registry.state.offline = false;
          registry.publish("bundled", "1.0.0", {
            tarball: plugin("bundled", "1.0.0", {
              packageJson: { dependencies: { tiny: "1.0.0" }, bundleDependencies: ["tiny"] },
              extra: [
                {
                  path: "package/node_modules/tiny/package.json",
                  data: toJson({
                    name: "tiny",
                    dependencies: { hoisted: "1.0.0", "@scope/nested": "1.0.0" },
                  }),
                },
                {
                  path: "package/node_modules/hoisted/package.json",
                  data: toJson({
                    name: "hoisted",
                    peerDependencies: { tiny: "1.0.0", absent: "1.0.0" },
                    peerDependenciesMeta: { absent: { optional: true } },
                  }),
                },
                {
                  path: "package/node_modules/tiny/node_modules/@scope/nested/package.json",
                  data: toJson({ name: "@scope/nested", dependencies: { hoisted: "1.0.0" } }),
                },
              ],
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

  describe("remove", () => {
    it.effect("retries deleting a removed package's files until it works", () =>
      withDatabase(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const faults = makeFaults(yield* FileSystem.FileSystem);
          const { catalog, npm, registry, root, plugin } = yield* setup(faults.fileSystem);
          registry.publish("kept", "1.0.0", { tarball: plugin("kept", "1.0.0") });
          registry.publish("gone", "1.0.0", { tarball: plugin("gone", "1.0.0") });
          const kept = yield* npm.add({ name: "kept", version: "1.0.0" });
          const gone = yield* npm.add({ name: "gone", version: "1.0.0" });
          const keptHome = path.basename(path.dirname(kept.installation.directory));
          const goneHome = path.dirname(gone.installation.directory);
          faults.armed.fail = (method, target) => method === "remove" && target === goneHome;

          yield* catalog.remove({ installationId: gone.installation.installationId });
          yield* npm.discardUpdate({ installationId: kept.installation.installationId });
          expect((yield* npm.list).packages.map((item) => item.source.name)).toEqual(["kept"]);
          expect(yield* entries(root)).toEqual([keptHome, path.basename(goneHome)].sort());

          faults.armed.fail = undefined;
          yield* npm.discardUpdate({ installationId: kept.installation.installationId });
          expect(yield* entries(root)).toEqual([keptHome]);
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

    it.effect("applies an update as one catalogue step that other management waits behind", () =>
      withDatabase(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const faults = makeFaults(yield* FileSystem.FileSystem);
          const { catalog, npm, registry, plugin } = yield* setup(faults.fileSystem);
          const versions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"];
          for (const version of versions)
            registry.publish("raced", version, { tarball: plugin("raced", version) });
          const added = yield* npm.add({ name: "raced", version: "1.0.0" });
          const installationId = added.installation.installationId;
          yield* catalog.consent({ installationId, digest: added.installation.source!.digest });
          yield* catalog.enable({ installationId });
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.0.0");
          const row = Effect.map(catalog.list, (snapshot) =>
            snapshot.installations.find((item) => item.installationId === installationId)!,
          );

          /** Applies `version` while another client runs `other` during the directory swap. */
          const applyWhile = Effect.fnUntraced(function* <A, E>(
            version: string,
            other: Effect.Effect<A, E>,
          ) {
            const { package: staged } = yield* npm.stageUpdate({ installationId, version });
            const digest = staged.stagedUpdate!.source.digest;
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            faults.armed.hold = {
              matches: (method, from, to) =>
                method === "rename" &&
                path.basename(from).startsWith(".staging-") &&
                to !== undefined &&
                path.basename(to) === "package",
              entered,
              release,
            };
            const applying = yield* npm
              .applyUpdate({ installationId, digest })
              .pipe(Effect.forkChild({ startImmediately: true }));
            yield* Deferred.await(entered);
            // The old registration is revoked for the whole step: no call reaches either version.
            const call = yield* callVersion(catalog, installationId).pipe(Effect.flip);
            expect(call).toMatchObject({ reason: "unavailable" });
            const racing = yield* other.pipe(
              Effect.exit,
              Effect.forkChild({ startImmediately: true }),
            );
            yield* Deferred.succeed(release, undefined);
            const applied = yield* Fiber.join(applying);
            return { applied, other: yield* Fiber.join(racing), digest };
          });

          // A disable from another client lands after the update and stays.
          const disabled = yield* applyWhile("1.1.0", catalog.disable({ installationId }));
          expect(disabled.applied.installation.enabled).toBe(true);
          expect(Exit.isSuccess(disabled.other)).toBe(true);
          expect(yield* row).toMatchObject({
            enabled: false,
            consent: { digest: disabled.digest },
          });

          // An enable waits for the new consent, then runs the new version.
          const enabled = yield* applyWhile("1.2.0", catalog.enable({ installationId }));
          expect(enabled.applied.installation.enabled).toBe(false);
          expect(Exit.isSuccess(enabled.other)).toBe(true);
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.2.0");

          // Consent to the replaced bytes is refused once the new ones are in place.
          const consented = yield* applyWhile(
            "1.3.0",
            catalog.consent({ installationId, digest: enabled.digest }),
          );
          expect(Exit.isFailure(consented.other)).toBe(true);
          expect(yield* row).toMatchObject({
            enabled: true,
            consent: { digest: consented.digest },
          });
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.3.0");

          const refreshed = yield* applyWhile("1.4.0", catalog.refresh({ installationId }));
          expect(Exit.isSuccess(refreshed.other)).toBe(true);
          expect(yield* row).toMatchObject({
            enabled: true,
            source: { digest: refreshed.digest },
            consent: { digest: refreshed.digest },
          });

          const removed = yield* applyWhile("1.5.0", catalog.remove({ installationId }));
          expect(Exit.isSuccess(removed.other)).toBe(true);
          expect((yield* catalog.list).installations).toEqual([]);
          expect((yield* npm.list).packages).toEqual([]);
        }),
      ),
    );

    it.effect("keeps the installed version running when the update cannot be journaled", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const faults = makeFaults(fs);
          const { catalog, npm, registry, plugin } = yield* setup(faults.fileSystem);
          registry.publish("journal", "1.0.0", { tarball: plugin("journal", "1.0.0") });
          registry.publish("journal", "1.1.0", { tarball: plugin("journal", "1.1.0") });
          const added = yield* npm.add({ name: "journal", version: "1.0.0" });
          const installationId = added.installation.installationId;
          const home = path.dirname(added.installation.directory);
          const oldDigest = added.installation.source!.digest;
          yield* catalog.consent({ installationId, digest: oldDigest });
          yield* catalog.enable({ installationId });
          const before = yield* callVersion(catalog, installationId);
          const { package: staged } = yield* npm.stageUpdate({ installationId, version: "1.1.0" });
          const digest = staged.stagedUpdate!.source.digest;

          const failures: ReadonlyArray<
            readonly [string, (method: Faulted, target: string, to?: string) => boolean]
          > = [
            [
              "journal write",
              (method, target) =>
                method === "writeFileString" && path.basename(target) === ".npm.json.tmp",
            ],
            [
              "journal rename",
              (method, _target, to) =>
                method === "rename" && to !== undefined && path.basename(to) === "npm.json",
            ],
            [
              "old .previous cleanup",
              (method, target) => method === "remove" && path.basename(target) === ".previous",
            ],
          ];
          for (const [what, matches] of failures) {
            faults.armed.fail = (method, target, to) => {
              if (!matches(method, target, to)) return false;
              faults.armed.fail = undefined;
              return true;
            };
            const error = yield* npm.applyUpdate({ installationId, digest }).pipe(Effect.flip);
            expect(error.reason, what).toBe("storage");
            expect(faults.armed.fail, what).toBeUndefined();
            // Never stopped: the same process answers, and the update can be applied again.
            expect(yield* callVersion(catalog, installationId), what).toEqual(before);
            expect((yield* catalog.list).installations[0], what).toMatchObject({
              enabled: true,
              consent: { digest: oldDigest },
            });
            expect((yield* npm.list).packages[0]!.stagedUpdate?.source.digest, what).toBe(digest);
            const record = fromJson(yield* fs.readFileString(path.join(home, "npm.json")));
            expect(record, what).toEqual({ source: added.package.source });
          }

          const applied = yield* npm.applyUpdate({ installationId, digest });
          expect(applied.package.source.version).toBe("1.1.0");
          expect((yield* callVersion(catalog, installationId)).version).toBe("1.1.0");
        }),
      ),
    );

    it.effect("keeps an interrupted update it cannot undo yet, and undoes it on a later try", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const scope = yield* Scope.Scope;
          const registry = makeRegistry();
          const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-npm-retry-" });
          const root = path.join(base, "npm");
          const catalog = yield* startCatalog(scope);
          const firstScope = yield* Scope.make();
          const first = yield* startNpm(firstScope, catalog, registry, root);
          for (const version of ["1.0.0", "1.1.0"])
            registry.publish("retried", version, {
              tarball: makeTarball([
                { path: "package/package.json", data: toJson({ name: "retried", version }) },
                {
                  path: "package/t3-plugin.json",
                  data: toJson({
                    id: "test.retried",
                    name: "retried",
                    version,
                    apiVersion: 1,
                    entry: "main.mjs",
                  }),
                },
                { path: "package/main.mjs", data: `export function activate() {} // ${version}` },
              ]),
            });
          const added = yield* first.add({ name: "retried", version: "1.0.0" });
          const installationId = added.installation.installationId;
          const home = path.dirname(added.installation.directory);
          const oldDigest = added.installation.source!.digest;
          yield* catalog.consent({ installationId, digest: oldDigest });
          const { package: staged } = yield* first.stageUpdate({
            installationId,
            version: "1.1.0",
          });
          const stagingName = (yield* entries(home)).find((name) => name.startsWith(".staging-"))!;
          const journal = toJson({
            source: added.package.source,
            swap: {
              source: { ...added.package.source, version: "1.1.0" },
              digest: staged.stagedUpdate!.source.digest,
            },
          });
          // The server stopped after the swap, before the consent.
          yield* fs.writeFileString(path.join(home, "npm.json"), journal);
          yield* fs.rename(added.installation.directory, path.join(home, ".previous"));
          yield* fs.rename(path.join(home, stagingName), added.installation.directory);
          yield* Scope.close(firstScope, Exit.void);

          const faults = makeFaults(fs);
          faults.armed.fail = (method, target) =>
            method === "rename" && path.basename(target) === ".previous";
          const second = yield* startNpm(scope, catalog, registry, root, faults.fileSystem);
          yield* second.list;
          // Putting the old files back failed: the journal and the only old copy are kept.
          expect(yield* entries(home)).toEqual([".previous", "npm.json"]);
          expect(yield* fs.readFileString(path.join(home, "npm.json"))).toBe(journal);
          const blocked = yield* second
            .stageUpdate({ installationId, version: "1.1.0" })
            .pipe(Effect.flip);
          expect(blocked.reason).toBe("storage");

          // The next try moves the files back, but cannot write the record: still retried.
          faults.armed.fail = (method, target) =>
            method === "writeFileString" && path.basename(target) === ".npm.json.tmp";
          const stillBlocked = yield* second.discardUpdate({ installationId }).pipe(Effect.flip);
          expect(stillBlocked.reason).toBe("storage");
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          expect(yield* fs.readFileString(path.join(home, "npm.json"))).toBe(journal);

          faults.armed.fail = undefined;
          yield* second.discardUpdate({ installationId });
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          const record = fromJson(yield* fs.readFileString(path.join(home, "npm.json")));
          expect(record).toEqual({ source: added.package.source });
          expect((yield* second.list).packages[0]!.source.version).toBe("1.0.0");
          const row = (yield* catalog.list).installations[0]!;
          expect(row.source?.digest).toBe(oldDigest);
          expect(pluginInstallationStatus(row)).toBe("disabled");
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
          // Every point an apply can stop at, in order: each step includes the ones before it.
          const stages = [
            "journaled",
            "stopped",
            "moved-old",
            "moved-new",
            "consented",
            "recorded",
          ] as const;
          for (const name of stages)
            for (const version of ["1.0.0", "1.1.0"])
              registry.publish(name, version, { tarball: tarballFor(name, version) });

          /** Leaves the state an enabled installation's update had when the server stopped. */
          const interrupt = Effect.fn("interrupt")(function* (stage: (typeof stages)[number]) {
            const reached = (step: (typeof stages)[number]) =>
              stages.indexOf(stage) >= stages.indexOf(step);
            const added = yield* first.add({ name: stage, version: "1.0.0" });
            const installationId = added.installation.installationId;
            const home = path.dirname(added.installation.directory);
            yield* catalog.consent({ installationId, digest: added.installation.source!.digest });
            yield* catalog.enable({ installationId });
            const { package: staged } = yield* first.stageUpdate({
              installationId,
              version: "1.1.0",
            });
            const update = staged.stagedUpdate!;
            const stagingName = (yield* entries(home)).find((entry) =>
              entry.startsWith(".staging-"),
            )!;
            const next = { ...added.package.source, version: "1.1.0", integrity: update.integrity };
            yield* fs.writeFileString(
              path.join(home, "npm.json"),
              toJson({
                source: added.package.source,
                swap: { source: next, digest: update.source.digest },
              }),
            );
            if (reached("stopped")) yield* catalog.disable({ installationId });
            if (reached("moved-old"))
              yield* fs.rename(added.installation.directory, path.join(home, ".previous"));
            if (reached("moved-new"))
              yield* fs.rename(path.join(home, stagingName), added.installation.directory);
            if (reached("consented"))
              yield* catalog.consent({ installationId, digest: update.source.digest });
            if (reached("recorded"))
              yield* fs.writeFileString(path.join(home, "npm.json"), toJson({ source: next }));
            return {
              stage,
              installationId,
              home,
              oldDigest: added.installation.source!.digest,
              update,
            };
          });
          const interrupted = yield* Effect.forEach(stages, interrupt);
          yield* fs.makeDirectory(path.join(interrupted[3]!.home, ".staging-left"));
          yield* fs.makeDirectory(path.join(root, "pkg-orphan", "package"), { recursive: true });
          yield* Scope.close(firstScope, Exit.void);

          const second = yield* startNpm(scope, catalog, registry, root);
          const packages = (yield* second.list).packages;
          const rows = (yield* catalog.list).installations;
          expect((yield* entries(root)).length).toBe(stages.length);
          for (const { stage, installationId, home, oldDigest, update } of interrupted) {
            // Rolled back before the consent: the old bytes, under the consent they kept.
            // Finished after it: the consented new bytes. Only a swap that never stopped the
            // plugin leaves it enabled.
            const finished = stage === "consented" || stage === "recorded";
            const version = finished ? "1.1.0" : "1.0.0";
            const row = rows.find((item) => item.installationId === installationId)!;
            expect(yield* entries(home), stage).toEqual(["npm.json", "package"]);
            expect(
              packages.find((item) => item.installationId === installationId)?.source,
              stage,
            ).toMatchObject({ version, ...(finished ? { integrity: update.integrity } : {}) });
            const record = fromJson(yield* fs.readFileString(path.join(home, "npm.json")));
            expect(record, stage).toEqual({ source: expect.objectContaining({ version }) });
            expect(row.source?.digest, stage).toBe(finished ? update.source.digest : oldDigest);
            expect(pluginInstallationStatus(row), stage).toBe(
              stage === "journaled" ? "enabled" : "disabled",
            );
          }
        }),
      ),
    );
  });

  describe("recovery", () => {
    it.effect("keeps an update whose consent another client finished before recovery decided", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const scope = yield* Scope.Scope;
          const crashed = yield* crashBeforeConsent(scope, "kept");
          const { catalog, installationId, home, next, journalDigest } = crashed;
          const faults = makeFaults(fs);
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          // Recovery has read its journal; the consent it settles by is not read yet.
          faults.armed.hold = {
            matches: (method, target) =>
              method === "exists" && path.basename(target) === ".previous",
            entered,
            release,
          };
          const npm = yield* startNpm(
            scope,
            catalog,
            crashed.registry,
            crashed.root,
            faults.fileSystem,
          );
          // A failed assertion must not leave recovery parked on the hold.
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
          yield* Deferred.await(entered);
          // Another client approves the files now in place and runs them.
          yield* catalog.consent({ installationId, digest: journalDigest });
          yield* catalog.enable({ installationId });
          const running = yield* callFiles(catalog, installationId);
          expect(running).toMatchObject({ loaded: "1.1.0", disk: "1.1.0" });
          yield* Deferred.succeed(release, undefined);

          expect((yield* npm.list).packages[0]!.source).toEqual(next);
          // The same process still finds its own files: recovery finished the update.
          expect(yield* callFiles(catalog, installationId)).toEqual(running);
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          expect(fromJson(yield* fs.readFileString(path.join(home, "npm.json")))).toEqual({
            source: next,
          });
          expect((yield* catalog.list).installations[0]).toMatchObject({
            enabled: true,
            consent: { digest: journalDigest },
          });
        }),
      ),
    );

    it.effect("stops a running plugin before putting old files back, and other steps wait", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const scope = yield* Scope.Scope;
          // The journal expects 1.2.0, so the 1.1.0 files in place are rolled back even
          // though they have consent and run.
          const crashed = yield* crashBeforeConsent(scope, "stopped", "1.2.0");
          const { catalog, installationId, home, oldDigest, filesDigest } = crashed;
          yield* catalog.consent({ installationId, digest: filesDigest });
          yield* catalog.enable({ installationId });
          const running = yield* callFiles(catalog, installationId);
          expect(running).toMatchObject({ loaded: "1.1.0", disk: "1.1.0" });

          const faults = makeFaults(fs);
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const directory = path.join(home, "package");
          faults.armed.hold = {
            matches: (method, target) => method === "remove" && target === directory,
            entered,
            release,
          };
          const npm = yield* startNpm(
            scope,
            catalog,
            crashed.registry,
            crashed.root,
            faults.fileSystem,
          );
          // A failed assertion must not leave recovery parked on the hold.
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
          yield* Deferred.await(entered);
          // About to remove the files: the registration is revoked and its process has exited.
          const call = yield* callFiles(catalog, installationId).pipe(Effect.flip);
          expect(call).toMatchObject({ reason: "unavailable" });
          expect(isProcessAlive(running.pid)).toBe(false);
          const racing = yield* catalog
            .consent({ installationId, digest: filesDigest })
            .pipe(
              Effect.andThen(catalog.enable({ installationId })),
              Effect.flip,
              Effect.forkChild({ startImmediately: true }),
            );
          yield* Deferred.succeed(release, undefined);

          expect((yield* npm.list).packages[0]!.source.version).toBe("1.0.0");
          // Queued behind recovery, the consent finds the old files instead.
          expect((yield* Fiber.join(racing)).reason).toBe("source-changed");
          expect(yield* entries(home)).toEqual(["npm.json", "package"]);
          const row = (yield* catalog.list).installations[0]!;
          // Disabled, and the consent it had is to the files that are gone.
          expect(row).toMatchObject({
            enabled: false,
            source: { digest: oldDigest },
            consent: { digest: filesDigest },
          });
          expect(pluginInstallationStatus(row)).toBe("needs-consent");
        }),
      ),
    );
  });
});
