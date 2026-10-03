// @effect-diagnostics nodeBuiltinImport:off
/**
 * Installs trusted plugins from an npm registry into directories the server
 * owns, then hands each one to the catalogue like any added directory.
 *
 * Installing runs nothing. One exact version is resolved, its tarball must
 * match the registry's sha512 integrity, and the archive is checked whole
 * before a byte is written (see `npmTarball.ts`). Package scripts never run
 * and dependencies are never installed: a package must bundle what it needs,
 * so a package that declares a dependency it does not ship, or an install
 * script, is refused. The catalogue then requires consent to the unpacked
 * digest before the plugin can be enabled.
 *
 * Layout under `<state>/plugins/npm/<key>/`:
 * - `package/` the installed version: the catalogue installation's directory.
 * - `npm.json` where it came from, and an update swap in progress, if any.
 * - `.staging-*` a version being unpacked or a staged update; never survives a restart.
 * - `.previous` the replaced version, only while an update is being applied.
 *
 * An update unpacks next to `package/` and leaves it running. Applying it
 * disables the installation, swaps the directories, and records consent to
 * the staged digest; that consent is the commit point. A failure before it
 * puts the old directory back. At startup a swap marker is finished when
 * the catalogue holds consent to the new digest and rolled back otherwise.
 *
 * Removing the installation from the catalogue deletes its `<key>` directory.
 */
import * as NodeCrypto from "node:crypto";

import {
  PluginCatalogError,
  PluginNpmIntegrity,
  PluginNpmSource,
  PluginNpmVersion,
  PluginSourceDigest,
  type PluginInstallation,
  type PluginInstallationId,
  type PluginInstallationInput,
  type PluginInstallationManifest,
  type PluginManifest,
  type PluginNpmAddInput,
  type PluginNpmApplyUpdateInput,
  type PluginNpmInstallationResult,
  type PluginNpmListResult,
  type PluginNpmPackage,
  type PluginNpmPackageResult,
  type PluginNpmStagedUpdate,
  type PluginNpmStageUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import { PluginCatalog } from "./PluginCatalog.ts";
import { loadPluginDirectory } from "./PluginManifestLoader.ts";
import { digestPluginSource } from "./pluginSource.ts";
import {
  defaultNpmTarballLimits,
  readNpmTarball,
  type NpmTarballFile,
  type NpmTarballLimits,
} from "./npmTarball.ts";

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";

/** `PluginCatalogError.reason` values this module adds. */
export type PluginNpmFailure =
  | "npm-invalid-request"
  | "npm-not-found"
  | "npm-registry-unavailable"
  | "npm-registry-invalid"
  | "npm-integrity-missing"
  | "npm-integrity-mismatch"
  | "npm-too-large"
  | "npm-archive-unsafe"
  | "npm-package-mismatch"
  | "npm-install-scripts"
  | "npm-dependencies"
  | "npm-plugin-id-changed"
  | "npm-no-update";

const npmError = (
  reason: PluginNpmFailure | "not-found" | "already-added" | "source-changed" | "storage",
  message: string,
  installationId?: PluginInstallationId,
) =>
  new PluginCatalogError({
    reason,
    message,
    ...(installationId === undefined ? {} : { installationId }),
  });

const storageError = (cause: unknown) =>
  Effect.logWarning("Plugin npm storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(npmError("storage", "Could not write the plugin's files."))),
  );

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

const NpmVersionMetadata = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dist: Schema.Struct({ tarball: Schema.String, integrity: Schema.optionalKey(Schema.String) }),
});
const decodeMetadata = Schema.decodeUnknownEffect(Schema.fromJsonString(NpmVersionMetadata));

const DependencyMap = Schema.Record(Schema.String, Schema.Unknown);
const BundledDependencies = Schema.Union([Schema.Array(Schema.String), Schema.Boolean]);
const NpmPackageJson = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  scripts: Schema.optionalKey(DependencyMap),
  dependencies: Schema.optionalKey(DependencyMap),
  optionalDependencies: Schema.optionalKey(DependencyMap),
  peerDependencies: Schema.optionalKey(DependencyMap),
  bundleDependencies: Schema.optionalKey(BundledDependencies),
  bundledDependencies: Schema.optionalKey(BundledDependencies),
});
const decodePackageJson = Schema.decodeUnknownEffect(Schema.fromJsonString(NpmPackageJson));

/** `npm.json`: the installed version and, while an update is applied, the one replacing it. */
const NpmRecord = Schema.Struct({
  source: PluginNpmSource,
  swap: Schema.optionalKey(Schema.Struct({ source: PluginNpmSource, digest: PluginSourceDigest })),
});
type NpmRecord = typeof NpmRecord.Type;
const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(NpmRecord));
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(NpmRecord));
const isExactVersion = Schema.is(PluginNpmVersion);
const isIntegrity = Schema.is(PluginNpmIntegrity);

const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

interface Resolved {
  readonly version: PluginNpmVersion;
  readonly integrity: PluginNpmIntegrity;
  readonly tarball: string;
}

interface Installed {
  /** `<root>/<key>`. */
  readonly home: string;
  /** `<home>/package`, the catalogue installation's directory. */
  readonly directory: string;
  readonly installationId: PluginInstallationId;
  source: PluginNpmSource;
  staged: { readonly update: PluginNpmStagedUpdate; readonly directory: string } | undefined;
}

const summarize = (manifest: PluginManifest): PluginInstallationManifest => ({
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  ...(manifest.description === undefined ? {} : { description: manifest.description }),
  capabilities: manifest.capabilities,
  proposedApi: manifest.proposedApi,
});

const toPackage = (entry: Installed): PluginNpmPackage => ({
  installationId: entry.installationId,
  source: entry.source,
  stagedUpdate: entry.staged?.update ?? null,
});

/** Registry base URL without a trailing slash; credentials, queries, and fragments are refused. */
export const normalizeRegistry = (input: string) => {
  const url = URL.parse(input);
  if (
    url === null ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    return Effect.fail(
      npmError(
        "npm-invalid-request",
        "Enter the registry as an http or https URL without credentials, query, or fragment.",
      ),
    );
  return Effect.succeed(url.href.replace(/\/+$/, ""));
};

/** Refuses a package that would need a script or an install step T3 never runs. */
const checkPackage = Effect.fnUntraced(function* (
  files: ReadonlyArray<NpmTarballFile>,
  name: string,
  version: string,
) {
  const manifest = files.find((file) => file.path === "package.json");
  if (manifest === undefined || manifest.data.length > MAX_PACKAGE_JSON_BYTES)
    return yield* npmError("npm-package-mismatch", "The package has no readable package.json.");
  const packageJson = yield* decodePackageJson(new TextDecoder().decode(manifest.data)).pipe(
    Effect.mapError(() =>
      npmError("npm-package-mismatch", "The package's package.json is invalid."),
    ),
  );
  if (packageJson.name !== name || packageJson.version !== version)
    return yield* npmError(
      "npm-package-mismatch",
      `The tarball contains ${packageJson.name ?? "an unnamed package"}@${packageJson.version ?? "?"}, not ${name}@${version}.`,
    );
  const scripts = INSTALL_SCRIPTS.filter((script) => packageJson.scripts?.[script] !== undefined);
  if (files.some((file) => file.path === "binding.gyp"))
    scripts.push("a native build (binding.gyp)");
  if (scripts.length > 0)
    return yield* npmError(
      "npm-install-scripts",
      `The package needs ${scripts.join(", ")} to run at install, and T3 never runs package scripts.`,
    );
  const bundled = packageJson.bundleDependencies ?? packageJson.bundledDependencies ?? [];
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
  const shipped = new Set(files.map((file) => file.path));
  const missing = [...declared].filter(
    (dependency) =>
      !(bundled === true || (Array.isArray(bundled) && bundled.includes(dependency))) ||
      !shipped.has(`node_modules/${dependency}/package.json`),
  );
  if (missing.length > 0)
    return yield* npmError(
      "npm-dependencies",
      `The package depends on ${missing.join(", ")} without bundling it. T3 installs no dependencies; bundle the plugin into its package.`,
    );
});

export class PluginNpm extends Context.Service<
  PluginNpm,
  {
    readonly list: Effect.Effect<PluginNpmListResult>;
    /** Downloads, verifies, and unpacks one exact version, then adds it to the catalogue. Runs nothing. */
    readonly add: (
      input: PluginNpmAddInput,
    ) => Effect.Effect<PluginNpmInstallationResult, PluginCatalogError>;
    /** Unpacks a version next to the installed one, replacing any earlier staged update. */
    readonly stageUpdate: (
      input: PluginNpmStageUpdateInput,
    ) => Effect.Effect<PluginNpmPackageResult, PluginCatalogError>;
    /** Consents to the staged digest and swaps it in; the old version comes back on failure. */
    readonly applyUpdate: (
      input: PluginNpmApplyUpdateInput,
    ) => Effect.Effect<PluginNpmInstallationResult, PluginCatalogError>;
    readonly discardUpdate: (
      input: PluginInstallationInput,
    ) => Effect.Effect<PluginNpmPackageResult, PluginCatalogError>;
  }
>()("t3/plugins/PluginNpm") {}

export interface PluginNpmOptions {
  /** Directory that holds the installed packages. */
  readonly root: string;
  readonly registry?: string;
  readonly limits?: NpmTarballLimits;
  readonly metadataTimeout?: `${number} seconds`;
  readonly tarballTimeout?: `${number} seconds`;
}

export const make = Effect.fn("PluginNpm.make")(function* (options: PluginNpmOptions) {
  const catalog = yield* PluginCatalog;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  const scope = yield* Effect.scope;
  const limits = options.limits ?? defaultNpmTarballLimits;
  const defaultRegistry = options.registry ?? DEFAULT_NPM_REGISTRY;

  yield* fs.makeDirectory(options.root, { recursive: true }).pipe(Effect.orDie);
  // The catalogue records real paths, so ours must be real too.
  const root = yield* fs.realPath(options.root).pipe(Effect.orDie);

  const installed = new Map<PluginInstallationId, Installed>();
  const lock = yield* Semaphore.make(1);
  const recovered = yield* Deferred.make<void>();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const removeTree = (target: string) =>
    fs.remove(target, { recursive: true, force: true }).pipe(Effect.ignore);

  const writeRecord = (home: string, record: NpmRecord) =>
    encodeRecord(record).pipe(
      Effect.flatMap((json) => {
        // Write then rename, so `npm.json` is always one whole record.
        const temporary = path.join(home, ".npm.json.tmp");
        return fs
          .writeFileString(temporary, json)
          .pipe(Effect.andThen(fs.rename(temporary, path.join(home, "npm.json"))));
      }),
      Effect.catch(storageError),
    );

  const readRecord = (home: string) =>
    fs
      .readFileString(path.join(home, "npm.json"))
      .pipe(Effect.flatMap(decodeRecord), Effect.option);

  /** GETs `url` into memory, at most `maxBytes`. */
  const fetchBytes = (url: string, maxBytes: number, timeout: `${number} seconds`, what: string) =>
    Effect.gen(function* () {
      const response = yield* http.execute(HttpClientRequest.get(url));
      if (response.status === 404)
        return yield* npmError("npm-not-found", `The registry has no ${what}.`);
      if (response.status < 200 || response.status >= 300)
        return yield* npmError(
          "npm-registry-unavailable",
          `The registry answered ${response.status} for the ${what}.`,
        );
      const chunks: Array<Uint8Array> = [];
      let total = 0;
      yield* response.stream.pipe(
        Stream.runForEach((chunk) => {
          total += chunk.byteLength;
          if (total > maxBytes)
            return Effect.fail(
              npmError("npm-too-large", `The ${what} is larger than ${maxBytes} bytes.`),
            );
          chunks.push(chunk);
          return Effect.void;
        }),
      );
      return Buffer.concat(chunks);
    }).pipe(
      Effect.scoped,
      Effect.timeout(timeout),
      Effect.catchTags({
        HttpClientError: () =>
          Effect.fail(npmError("npm-registry-unavailable", `Could not download the ${what}.`)),
        TimeoutError: () =>
          Effect.fail(
            npmError("npm-registry-unavailable", `The registry did not send the ${what} in time.`),
          ),
      }),
    );

  /** Asks the registry which exact version `request` names, and its tarball's integrity. */
  const resolve = Effect.fnUntraced(function* (registry: string, name: string, request: string) {
    const encodedName = name.startsWith("@") ? name.replace("/", "%2f") : name;
    const what = `${name}@${request}`;
    const body = yield* fetchBytes(
      `${registry}/${encodedName}/${encodeURIComponent(request)}`,
      MAX_METADATA_BYTES,
      options.metadataTimeout ?? "30 seconds",
      `package ${what}`,
    );
    const metadata = yield* decodeMetadata(new TextDecoder().decode(body)).pipe(
      Effect.mapError(() =>
        npmError("npm-registry-invalid", `The registry's description of ${what} is invalid.`),
      ),
    );
    if (
      metadata.name !== name ||
      !isExactVersion(metadata.version) ||
      (isExactVersion(request) && metadata.version !== request)
    )
      return yield* npmError(
        "npm-registry-invalid",
        `The registry answered ${what} with ${metadata.name}@${metadata.version}.`,
      );
    const integrity = (metadata.dist.integrity ?? "").split(/\s+/).find(isIntegrity);
    if (integrity === undefined)
      return yield* npmError(
        "npm-integrity-missing",
        `The registry publishes no sha512 integrity for ${name}@${metadata.version}.`,
      );
    const tarball = URL.parse(metadata.dist.tarball);
    if (tarball === null || (tarball.protocol !== "https:" && tarball.protocol !== "http:"))
      return yield* npmError(
        "npm-registry-invalid",
        `The registry's tarball address for ${name}@${metadata.version} is not http or https.`,
      );
    return { version: metadata.version, integrity, tarball: tarball.href } satisfies Resolved;
  });

  /** Downloads and checks a resolved version, then writes it into a new staging directory under `home`. */
  const stage = Effect.fnUntraced(function* (home: string, name: string, resolved: Resolved) {
    const tarball = yield* fetchBytes(
      resolved.tarball,
      limits.maxTarballBytes,
      options.tarballTimeout ?? "120 seconds",
      `tarball for ${name}@${resolved.version}`,
    );
    const actual = `sha512-${NodeCrypto.createHash("sha512").update(tarball).digest("base64")}`;
    if (actual !== resolved.integrity)
      return yield* npmError(
        "npm-integrity-mismatch",
        `The tarball for ${name}@${resolved.version} does not match the registry's integrity. Nothing was installed.`,
      );
    const files = yield* readNpmTarball(tarball, limits).pipe(
      Effect.mapError((error) => npmError(error.reason, error.message)),
    );
    yield* checkPackage(files, name, resolved.version);
    const staging = yield* fs
      .makeTempDirectory({ directory: home, prefix: ".staging-" })
      .pipe(Effect.catch(storageError));
    yield* Effect.forEach(
      files,
      (file) => {
        const target = path.join(staging, ...file.path.split("/"));
        return fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(
          // `wx` never follows or replaces something already there.
          Effect.andThen(
            fs.writeFile(target, file.data, { flag: "wx", mode: file.executable ? 0o755 : 0o644 }),
          ),
        );
      },
      { discard: true },
    ).pipe(
      Effect.catch(storageError),
      Effect.onError(() => removeTree(staging)),
    );
    return staging;
  });

  const findInstalled = (installationId: PluginInstallationId) =>
    Effect.suspend(() => {
      const entry = installed.get(installationId);
      return entry
        ? Effect.succeed(entry)
        : Effect.fail(
            npmError("not-found", "That plugin was not installed from npm here.", installationId),
          );
    });

  const catalogRow = (installationId: PluginInstallationId) =>
    catalog.list.pipe(
      Effect.flatMap((snapshot) => {
        const row = snapshot.installations.find((item) => item.installationId === installationId);
        return row
          ? Effect.succeed(row)
          : Effect.fail(
              npmError("not-found", "That plugin is not installed here.", installationId),
            );
      }),
    );

  /** Forgets every installation the catalogue no longer has and deletes its files. */
  const collect = Effect.gen(function* () {
    const snapshot = yield* catalog.list;
    const present = new Set(snapshot.installations.map((row) => row.installationId));
    for (const entry of installed.values()) {
      if (present.has(entry.installationId)) continue;
      installed.delete(entry.installationId);
      yield* removeTree(entry.home);
    }
  });

  /** Never waits for an install in progress; a package the catalogue no longer has is left out. */
  const list = Deferred.await(recovered).pipe(
    Effect.andThen(catalog.list),
    Effect.map((snapshot) => {
      const present = new Set(snapshot.installations.map((row) => row.installationId));
      return {
        // Stable across updates; clients join these to catalogue rows by installation id.
        packages: [...installed.values()]
          .filter((entry) => present.has(entry.installationId))
          .sort((a, b) => a.installationId.localeCompare(b.installationId))
          .map(toPackage),
      };
    }),
  );

  const add = Effect.fn("PluginNpm.add")(function* (input: PluginNpmAddInput) {
    const registry = yield* normalizeRegistry(input.registry ?? defaultRegistry);
    yield* collect;
    const existing = [...installed.values()].find(
      (entry) => entry.source.registry === registry && entry.source.name === input.name,
    );
    if (existing)
      return yield* npmError(
        "already-added",
        `${input.name} is already installed from this registry. Update it instead.`,
        existing.installationId,
      );
    const resolved = yield* resolve(registry, input.name, input.version);
    const home = yield* fs
      .makeTempDirectory({ directory: root, prefix: "pkg-" })
      .pipe(Effect.catch(storageError));
    return yield* Effect.gen(function* () {
      const staging = yield* stage(home, input.name, resolved);
      const source: PluginNpmSource = {
        registry,
        name: input.name,
        version: resolved.version,
        integrity: resolved.integrity,
        installedAt: yield* now,
      };
      const directory = path.join(home, "package");
      return yield* Effect.gen(function* () {
        yield* writeRecord(home, { source });
        yield* fs.rename(staging, directory).pipe(Effect.catch(storageError));
        // The catalogue reads the manifest and digests the files; nothing runs.
        const { installation } = yield* catalog.add({ directory });
        const entry: Installed = {
          home,
          directory,
          installationId: installation.installationId,
          source,
          staged: undefined,
        };
        installed.set(entry.installationId, entry);
        return { installation, package: toPackage(entry) };
      }).pipe(Effect.uninterruptible);
    }).pipe(Effect.onError(() => removeTree(home)));
  });

  const discardStaged = (entry: Installed) =>
    Effect.suspend(() => {
      const staged = entry.staged;
      entry.staged = undefined;
      return staged === undefined ? Effect.void : removeTree(staged.directory);
    });

  const stageUpdate = Effect.fn("PluginNpm.stageUpdate")(function* (
    input: PluginNpmStageUpdateInput,
  ) {
    const entry = yield* findInstalled(input.installationId);
    const row = yield* catalogRow(input.installationId);
    const resolved = yield* resolve(entry.source.registry, entry.source.name, input.version);
    const staging = yield* stage(entry.home, entry.source.name, resolved);
    const update = yield* Effect.gen(function* () {
      const registration = yield* loadPluginDirectory(staging).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError((error) => npmError("npm-package-mismatch", error.message)),
      );
      if (row.manifest !== null && registration.manifest.id !== row.manifest.id)
        return yield* npmError(
          "npm-plugin-id-changed",
          `The new version is the plugin ${registration.manifest.id}, not ${row.manifest.id}. Install it separately.`,
          input.installationId,
        );
      const source = yield* digestPluginSource(staging, limits).pipe(
        Effect.mapError((error) => npmError("npm-archive-unsafe", error.message)),
      );
      return {
        version: resolved.version,
        integrity: resolved.integrity,
        manifest: summarize(registration.manifest),
        source,
        stagedAt: yield* now,
      } satisfies PluginNpmStagedUpdate;
    }).pipe(Effect.onError(() => removeTree(staging)));
    yield* discardStaged(entry);
    entry.staged = { update, directory: staging };
    return { package: toPackage(entry) };
  });

  /** Puts `.previous` back as the installed directory and lets the catalogue see it again. */
  const rollBack = Effect.fnUntraced(function* (entry: Installed, wasEnabled: boolean) {
    const previous = path.join(entry.home, ".previous");
    yield* removeTree(entry.directory);
    yield* fs.rename(previous, entry.directory).pipe(Effect.catch(storageError));
    yield* writeRecord(entry.home, { source: entry.source });
    yield* catalog.refresh({ installationId: entry.installationId });
    // The old consent was never replaced, so the old bytes may run again as before.
    if (wasEnabled) yield* catalog.enable({ installationId: entry.installationId });
  });

  const applyUpdate = Effect.fn("PluginNpm.applyUpdate")(function* (
    input: PluginNpmApplyUpdateInput,
  ) {
    const entry = yield* findInstalled(input.installationId);
    const staged = entry.staged;
    if (staged === undefined)
      return yield* npmError(
        "npm-no-update",
        "There is no downloaded update to apply. Download it again.",
        input.installationId,
      );
    if (staged.update.source.digest !== input.digest)
      return yield* npmError(
        "source-changed",
        "The downloaded update is not the one you reviewed. Review the current one.",
        input.installationId,
      );
    const onDisk = yield* digestPluginSource(staged.directory, limits).pipe(Effect.option);
    if (Option.isNone(onDisk) || onDisk.value.digest !== input.digest) {
      yield* discardStaged(entry);
      return yield* npmError(
        "source-changed",
        "The downloaded update changed on disk after it was checked, so it was discarded.",
        input.installationId,
      );
    }
    const wasEnabled = (yield* catalogRow(input.installationId)).enabled;
    const source: PluginNpmSource = {
      ...entry.source,
      version: staged.update.version,
      integrity: staged.update.integrity,
      installedAt: yield* now,
    };
    const previous = path.join(entry.home, ".previous");

    if (wasEnabled) yield* catalog.disable({ installationId: input.installationId });
    yield* removeTree(previous);
    yield* writeRecord(entry.home, {
      source: entry.source,
      swap: { source, digest: input.digest },
    });
    yield* fs.rename(entry.directory, previous).pipe(
      Effect.catch(storageError),
      // Nothing moved: only the marker and the disable need undoing.
      Effect.tapError(() =>
        writeRecord(entry.home, { source: entry.source }).pipe(
          Effect.andThen(
            wasEnabled ? catalog.enable({ installationId: input.installationId }) : Effect.void,
          ),
          Effect.ignore,
        ),
      ),
    );
    entry.staged = undefined;
    const swapped = yield* fs.rename(staged.directory, entry.directory).pipe(
      Effect.catch(storageError),
      // Consent to the staged digest is the commit point: before it, any failure restores the old version.
      Effect.andThen(
        catalog.consent({ installationId: input.installationId, digest: input.digest }),
      ),
      Effect.tapError(() =>
        rollBack(entry, wasEnabled).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not restore a plugin after a failed update", {
              installationId: entry.installationId,
              detail: error.message,
            }),
          ),
        ),
      ),
      Effect.onError(() => removeTree(staged.directory)),
    );
    entry.source = source;
    // A failed write leaves the swap marker, which startup finishes because the consent matches.
    yield* writeRecord(entry.home, { source }).pipe(Effect.ignore);
    yield* removeTree(previous);
    const installation: PluginInstallation = wasEnabled
      ? (yield* catalog.enable({ installationId: input.installationId })).installation
      : swapped.installation;
    return { installation, package: toPackage(entry) };
  });

  const discardUpdate = Effect.fn("PluginNpm.discardUpdate")(function* (
    input: PluginInstallationInput,
  ) {
    const entry = yield* findInstalled(input.installationId);
    yield* discardStaged(entry);
    return { package: toPackage(entry) };
  });

  /**
   * Reads what was installed before this start: staging directories are
   * deleted, an interrupted update swap is finished or rolled back, and a
   * directory the catalogue no longer has is deleted.
   */
  const recover = Effect.gen(function* () {
    const snapshot = yield* catalog.list;
    const byDirectory = new Map(snapshot.installations.map((row) => [row.directory, row]));
    const refreshed: Array<PluginInstallationId> = [];
    const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
    for (const name of names) {
      const home = path.join(root, name);
      const directory = path.join(home, "package");
      const inside = yield* fs.readDirectory(home).pipe(Effect.orElseSucceed(() => []));
      for (const child of inside)
        if (child.startsWith(".staging-") || child.startsWith(".npm.json.tmp"))
          yield* removeTree(path.join(home, child));
      const record = yield* readRecord(home);
      const row = byDirectory.get(directory);
      if (row === undefined) {
        // Removed from the catalogue, or interrupted before it was added.
        yield* removeTree(home);
        continue;
      }
      if (Option.isNone(record)) {
        yield* Effect.logWarning("Leaving an npm plugin directory whose npm.json is unreadable", {
          directory,
        });
        continue;
      }
      let source = record.value.source;
      const swap = record.value.swap;
      if (swap !== undefined) {
        const previous = path.join(home, ".previous");
        if (
          row.consent?.digest === swap.digest &&
          (yield* fs.exists(directory).pipe(Effect.orElseSucceed(() => false)))
        ) {
          source = swap.source;
        } else if (yield* fs.exists(previous).pipe(Effect.orElseSucceed(() => false))) {
          yield* removeTree(directory);
          yield* fs.rename(previous, directory).pipe(Effect.ignore);
          refreshed.push(row.installationId);
        }
        yield* writeRecord(home, { source }).pipe(Effect.ignore);
        yield* removeTree(previous);
      }
      installed.set(row.installationId, {
        home,
        directory,
        installationId: row.installationId,
        source,
        staged: undefined,
      });
    }
    for (const installationId of refreshed)
      yield* catalog.refresh({ installationId }).pipe(Effect.ignore);
  });

  // Taken before any request can be, so requests wait for recovery.
  yield* lock
    .withPermit(recover.pipe(Effect.ensuring(Deferred.succeed(recovered, undefined))))
    .pipe(Effect.forkIn(scope, { startImmediately: true }));
  // A removal through `plugins.remove` deletes the package's files.
  yield* catalog.subscribe.pipe(
    Stream.runForEach(() => lock.withPermit(collect)),
    Effect.forkIn(scope, { startImmediately: true }),
  );

  const managed = <A, E>(effect: Effect.Effect<A, E>) => lock.withPermit(effect);

  return PluginNpm.of({
    list,
    add: (input) => managed(add(input)),
    stageUpdate: (input) => managed(stageUpdate(input)),
    applyUpdate: (input) => managed(applyUpdate(input).pipe(Effect.uninterruptible)),
    discardUpdate: (input) => managed(discardUpdate(input)),
  });
});

export const layer = Layer.effect(
  PluginNpm,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* make({ root: path.join(config.stateDir, "plugins", "npm") });
  }),
);
