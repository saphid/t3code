/**
 * The environment's trusted local plugins: which directories were added, what
 * their exact bytes were, who consented to which bytes, and which are enabled.
 *
 * Nothing in a plugin directory runs until its current digest has consent and
 * the installation is enabled. Enabling registers it with the supervisor,
 * which still starts no process until the first invoke. The bytes are checked
 * again whenever they are about to matter: on add, refresh, consent, enable,
 * server start, and before an invoke that would start a fresh process. A
 * change found at any of those points disables the installation and leaves it
 * needing consent; it is never re-enabled automatically.
 *
 * Plugins are trusted OS-user code. The digest pins what the user agreed to
 * run, not what the directory's owner can do between checks.
 */
import {
  PluginCatalogError,
  PluginInstallation,
  pluginInstallationStatus,
  type PluginAddInput,
  type PluginCatalogSnapshot,
  type PluginConsentInput,
  type PluginId,
  type PluginInstallationInput,
  type PluginInstallationManifest,
  type PluginInstallationResult,
  type PluginManifest,
  type PluginRefreshInput,
  type PluginRemoveResult,
  type PluginSource,
  PluginInstallationId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { loadPluginDirectory, type PluginRegistration } from "./PluginManifestLoader.ts";
import {
  defaultPluginSourceLimits,
  digestPluginSource,
  type PluginSourceLimits,
} from "./pluginSource.ts";
import { PluginSupervisor, type PluginInvokeError } from "./PluginSupervisor.ts";

/** What is persisted: the wire record without the live process state. */
const PluginInstallationRecord = PluginInstallation.mapFields(
  ({ hostState: _hostState, ...fields }) => fields,
);
type PluginInstallationRecord = typeof PluginInstallationRecord.Type;

const decodeRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(PluginInstallationRecord));
const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(PluginInstallationRecord));

interface Installation {
  record: PluginInstallationRecord;
  /** The id this installation runs under in the supervisor, while enabled. */
  registeredAs: PluginId | undefined;
}

type Inspection =
  | {
      readonly _tag: "ok";
      readonly registration: PluginRegistration;
      readonly source: PluginSource;
    }
  | { readonly _tag: "failed"; readonly reason: string };

const summarize = (manifest: PluginManifest): PluginInstallationManifest => ({
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  ...(manifest.description === undefined ? {} : { description: manifest.description }),
  capabilities: manifest.capabilities,
  proposedApi: manifest.proposedApi,
});

const catalogError = (
  reason: string,
  message: string,
  installationId?: PluginInstallationId,
): PluginCatalogError =>
  new PluginCatalogError({
    reason,
    message,
    ...(installationId === undefined ? {} : { installationId }),
  });

const storageError = (cause: unknown) =>
  Effect.logWarning("Plugin catalogue storage failed", { cause }).pipe(
    Effect.andThen(Effect.fail(catalogError("storage", "Could not save the plugin catalogue."))),
  );

export class PluginCatalog extends Context.Service<
  PluginCatalog,
  {
    readonly list: Effect.Effect<PluginCatalogSnapshot>;
    /** One snapshot now, then a fresh one after every catalogue or plugin state change. */
    readonly subscribe: Stream.Stream<PluginCatalogSnapshot>;
    readonly add: (
      input: PluginAddInput,
    ) => Effect.Effect<PluginInstallationResult, PluginCatalogError>;
    readonly refresh: (
      input: PluginRefreshInput,
    ) => Effect.Effect<PluginCatalogSnapshot, PluginCatalogError>;
    readonly consent: (
      input: PluginConsentInput,
    ) => Effect.Effect<PluginInstallationResult, PluginCatalogError>;
    readonly enable: (
      input: PluginInstallationInput,
    ) => Effect.Effect<PluginInstallationResult, PluginCatalogError>;
    readonly disable: (
      input: PluginInstallationInput,
    ) => Effect.Effect<PluginInstallationResult, PluginCatalogError>;
    readonly remove: (
      input: PluginInstallationInput,
    ) => Effect.Effect<PluginRemoveResult, PluginCatalogError>;
    readonly resume: (
      input: PluginInstallationInput,
    ) => Effect.Effect<PluginInstallationResult, PluginCatalogError>;
    /**
     * Calls a handler of an enabled installation. A call that would start a
     * fresh process first checks the bytes still match the consent.
     */
    readonly invoke: (
      installationId: PluginInstallationId,
      handler: string,
      input: Schema.Json,
      options?: { readonly timeout?: Duration.Input },
    ) => Effect.Effect<Schema.Json, PluginCatalogError | PluginInvokeError>;
  }
>()("t3/plugins/PluginCatalog") {}

export const make = Effect.fn("PluginCatalog.make")(function* (
  sourceLimits: PluginSourceLimits = defaultPluginSourceLimits,
) {
  const sql = yield* SqlClient.SqlClient;
  const supervisor = yield* PluginSupervisor;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;

  const installations = new Map<PluginInstallationId, Installation>();
  // Management is rare and each step may wait for a process to exit; one at a time keeps the
  // catalogue, the table, and the supervisor in step.
  const lock = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<void>(1);
  const notify = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const save = (record: PluginInstallationRecord) =>
    encodeRecord(record).pipe(
      Effect.flatMap(
        (json) => sql`
          INSERT INTO plugin_installations (installation_id, directory, record_json)
          VALUES (${record.installationId}, ${record.directory}, ${json})
          ON CONFLICT (installation_id) DO UPDATE SET
            directory = excluded.directory,
            record_json = excluded.record_json
        `,
      ),
      Effect.asVoid,
      Effect.catch(storageError),
    );

  const inspect = (directory: string): Effect.Effect<Inspection> =>
    loadPluginDirectory(directory).pipe(
      Effect.flatMap((registration) =>
        digestPluginSource(registration.directory, sourceLimits).pipe(
          Effect.map((source) => ({ _tag: "ok" as const, registration, source })),
        ),
      ),
      Effect.catch((error) => Effect.succeed({ _tag: "failed" as const, reason: error.reason })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const isReady = (record: PluginInstallationRecord) =>
    pluginInstallationStatus({ ...record, enabled: true }) === "enabled";

  /** Stops the plugin's process and forgets its registration. */
  const unregister = Effect.fnUntraced(function* (installation: Installation) {
    const pluginId = installation.registeredAs;
    installation.registeredAs = undefined;
    if (pluginId !== undefined) yield* supervisor.disable(pluginId);
  });

  /**
   * Inspects the directory again and records the result. An enabled
   * installation whose bytes no longer match its consent is stopped and
   * disabled.
   */
  const reinspect = Effect.fnUntraced(function* (installation: Installation) {
    const inspection = yield* inspect(installation.record.directory);
    const inspectedAt = yield* now;
    let record: PluginInstallationRecord =
      inspection._tag === "ok"
        ? {
            ...installation.record,
            manifest: summarize(inspection.registration.manifest),
            source: inspection.source,
            problem: null,
            inspectedAt,
          }
        : { ...installation.record, source: null, problem: inspection.reason, inspectedAt };
    if (record.enabled && !isReady(record)) {
      yield* Effect.logWarning("Plugin source changed; disabling until consent is renewed", {
        installationId: record.installationId,
        directory: record.directory,
      });
      yield* unregister(installation);
      record = { ...record, enabled: false };
    }
    installation.record = record;
    yield* save(record);
    return inspection;
  });

  /** Registers a ready installation with the supervisor under a new generation. */
  const register = Effect.fnUntraced(function* (
    installation: Installation,
    registration: PluginRegistration,
  ) {
    const pluginId = registration.manifest.id;
    const holder = [...installations.values()].find(
      (other) => other !== installation && other.registeredAs === pluginId,
    );
    if (holder)
      return yield* catalogError(
        "plugin-id-conflict",
        `Another enabled plugin already uses the id ${pluginId} (${holder.record.directory}). Disable it first.`,
        installation.record.installationId,
      );
    yield* supervisor
      .enable(registration)
      .pipe(
        Effect.mapError(() =>
          catalogError(
            "plugin-id-conflict",
            `A plugin with the id ${pluginId} is already running.`,
            installation.record.installationId,
          ),
        ),
      );
    installation.registeredAs = pluginId;
    const record = {
      ...installation.record,
      enabled: true,
      generation: installation.record.generation + 1,
    };
    yield* save(record).pipe(Effect.tapError(() => unregister(installation)));
    installation.record = record;
  });

  const find = (installationId: PluginInstallationId) =>
    Effect.suspend(() => {
      const installation = installations.get(installationId);
      return installation
        ? Effect.succeed(installation)
        : Effect.fail(
            catalogError("not-found", "That plugin is not installed here.", installationId),
          );
    });

  const toWire = Effect.fnUntraced(function* (installation: Installation) {
    const state =
      installation.registeredAs === undefined
        ? Option.none()
        : yield* supervisor.state(installation.registeredAs);
    return Option.match(state, {
      onNone: (): PluginInstallation => installation.record,
      onSome: (hostState): PluginInstallation => ({ ...installation.record, hostState }),
    });
  });

  const list = Effect.suspend(() =>
    Effect.forEach(
      [...installations.values()].sort(
        (a, b) =>
          a.record.addedAt.localeCompare(b.record.addedAt) ||
          a.record.installationId.localeCompare(b.record.installationId),
      ),
      toWire,
    ),
  ).pipe(Effect.map((installations) => ({ installations })));

  const result = (installation: Installation) =>
    toWire(installation).pipe(Effect.map((wire) => ({ installation: wire })));

  /** Runs a management step under the lock and tells subscribers afterwards, even on failure. */
  const managed = <A, E>(effect: Effect.Effect<A, E>) =>
    lock.withPermit(effect).pipe(Effect.ensuring(notify));

  const add = Effect.fn("PluginCatalog.add")(function* (input: PluginAddInput) {
    if (!path.isAbsolute(input.directory))
      return yield* catalogError(
        "invalid-directory",
        "Enter the plugin directory's absolute path on the server's machine.",
      );
    const inspection = yield* inspect(input.directory);
    if (inspection._tag === "failed")
      return yield* catalogError("invalid-directory", inspection.reason);
    const directory = inspection.registration.directory;
    const existing = [...installations.values()].find(
      (installation) => installation.record.directory === directory,
    );
    if (existing)
      return yield* catalogError(
        "already-added",
        `${directory} is already installed.`,
        existing.record.installationId,
      );
    const installationId = PluginInstallationId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const at = yield* now;
    const record: PluginInstallationRecord = {
      installationId,
      generation: 0,
      directory,
      manifest: summarize(inspection.registration.manifest),
      source: inspection.source,
      problem: null,
      inspectedAt: at,
      consent: null,
      enabled: false,
      addedAt: at,
    };
    yield* save(record);
    const installation: Installation = { record, registeredAs: undefined };
    installations.set(installationId, installation);
    return yield* result(installation);
  });

  const refresh = Effect.fn("PluginCatalog.refresh")(function* (input: PluginRefreshInput) {
    const targets =
      input.installationId === undefined
        ? [...installations.values()]
        : [yield* find(input.installationId)];
    yield* Effect.forEach(targets, reinspect, { discard: true });
    return yield* list;
  });

  const consent = Effect.fn("PluginCatalog.consent")(function* (input: PluginConsentInput) {
    const installation = yield* find(input.installationId);
    const inspection = yield* reinspect(installation);
    if (inspection._tag === "failed")
      return yield* catalogError("unavailable", inspection.reason, input.installationId);
    if (inspection.source.digest !== input.digest)
      return yield* catalogError(
        "source-changed",
        "The plugin's files changed after they were reviewed. Review the current version.",
        input.installationId,
      );
    const record = {
      ...installation.record,
      consent: {
        digest: inspection.source.digest,
        capabilities: inspection.registration.manifest.capabilities,
        grantedAt: yield* now,
      },
    };
    yield* save(record);
    installation.record = record;
    return yield* result(installation);
  });

  const enable = Effect.fn("PluginCatalog.enable")(function* (input: PluginInstallationInput) {
    const installation = yield* find(input.installationId);
    if (installation.registeredAs !== undefined) return yield* result(installation);
    const inspection = yield* reinspect(installation);
    if (inspection._tag === "failed")
      return yield* catalogError("unavailable", inspection.reason, input.installationId);
    if (!isReady(installation.record))
      return yield* catalogError(
        "consent-required",
        installation.record.consent === null
          ? "Review and approve the plugin before enabling it."
          : "The plugin's files changed since they were approved. Review the current version.",
        input.installationId,
      );
    yield* register(installation, inspection.registration);
    return yield* result(installation);
  });

  const disableInstallation = Effect.fnUntraced(function* (installation: Installation) {
    yield* unregister(installation);
    if (!installation.record.enabled) return;
    const record = { ...installation.record, enabled: false };
    installation.record = record;
    yield* save(record);
  });

  const disable = Effect.fn("PluginCatalog.disable")(function* (input: PluginInstallationInput) {
    const installation = yield* find(input.installationId);
    yield* disableInstallation(installation);
    return yield* result(installation);
  });

  const remove = Effect.fn("PluginCatalog.remove")(function* (input: PluginInstallationInput) {
    const installation = yield* find(input.installationId);
    yield* unregister(installation);
    yield* sql`DELETE FROM plugin_installations WHERE installation_id = ${input.installationId}`.pipe(
      Effect.catch(storageError),
    );
    installations.delete(input.installationId);
    return { installationId: input.installationId };
  });

  const resume = Effect.fn("PluginCatalog.resume")(function* (input: PluginInstallationInput) {
    const installation = yield* find(input.installationId);
    if (installation.registeredAs === undefined)
      return yield* catalogError("unavailable", "The plugin is not enabled.", input.installationId);
    yield* supervisor.resume(installation.registeredAs).pipe(Effect.ignore);
    return yield* result(installation);
  });

  const invoke: PluginCatalog["Service"]["invoke"] = Effect.fn("PluginCatalog.invoke")(
    function* (installationId, handler, input, options) {
      const installation = yield* find(installationId);
      const pluginId = installation.registeredAs;
      const consented = installation.record.consent?.digest;
      if (pluginId === undefined || consented === undefined)
        return yield* catalogError("unavailable", "The plugin is not enabled.", installationId);
      const state = yield* supervisor.state(pluginId);
      if (Option.isSome(state) && state.value._tag === "idle") {
        const current = yield* digestPluginSource(installation.record.directory, sourceLimits).pipe(
          Effect.option,
        );
        if (Option.isNone(current) || current.value.digest !== consented) {
          // Skip the record if it was removed meanwhile, so it is not written back.
          yield* managed(
            Effect.suspend(() =>
              installations.get(installationId) === installation
                ? reinspect(installation)
                : Effect.void,
            ),
          );
          return yield* catalogError(
            "source-changed",
            "The plugin's files changed since they were approved, so it was disabled.",
            installationId,
          );
        }
      }
      return yield* supervisor.invoke(pluginId, handler, input, options);
    },
  );

  // Load what was installed before this start.
  const rows = yield* sql<{ readonly record_json: string }>`
    SELECT record_json FROM plugin_installations
  `.pipe(Effect.orDie);
  for (const row of rows) {
    const decoded = yield* decodeRecord(row.record_json).pipe(Effect.option);
    if (Option.isNone(decoded)) {
      yield* Effect.logWarning("Skipping an unreadable plugin installation row");
      continue;
    }
    installations.set(decoded.value.installationId, {
      record: decoded.value,
      registeredAs: undefined,
    });
  }

  // Plugin state changes reach subscribers as fresh snapshots.
  const supervisorEvents = yield* supervisor.subscribe;
  yield* Stream.fromSubscription(supervisorEvents).pipe(
    Stream.filter((event) => event._tag === "StateChanged"),
    Stream.runForEach(() => notify),
    Effect.forkScoped,
  );

  // Re-register what was enabled, off the startup path. Changed bytes are disabled here;
  // nothing starts a process until it is used.
  yield* managed(
    Effect.forEach(
      [...installations.values()].filter((installation) => installation.record.enabled),
      (installation) =>
        reinspect(installation).pipe(
          Effect.flatMap((inspection) =>
            inspection._tag === "ok" && installation.record.enabled
              ? register(installation, inspection.registration)
              : Effect.void,
          ),
          Effect.catch((error) =>
            Effect.logWarning("Could not re-enable a plugin at startup", {
              installationId: installation.record.installationId,
              detail: error.message,
            }).pipe(
              Effect.andThen(
                disableInstallation(installation).pipe(Effect.catch(() => Effect.void)),
              ),
            ),
          ),
        ),
      { discard: true },
    ),
  ).pipe(Effect.forkScoped);

  return PluginCatalog.of({
    list,
    subscribe: Stream.unwrap(
      // Subscribe before the first snapshot so a change in between is not lost.
      PubSub.subscribe(changes).pipe(
        Effect.map((subscription) =>
          Stream.concat(
            Stream.fromEffect(list),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list)),
          ),
        ),
      ),
    ),
    add: (input) => managed(add(input)),
    refresh: (input) => managed(refresh(input)),
    consent: (input) => managed(consent(input)),
    enable: (input) => managed(enable(input)),
    disable: (input) => managed(disable(input)),
    remove: (input) => managed(remove(input)),
    resume: (input) => managed(resume(input)),
    invoke,
  });
});

export const layer = (sourceLimits?: PluginSourceLimits) =>
  Layer.effect(PluginCatalog, make(sourceLimits));
