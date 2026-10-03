/**
 * Saved settings, secrets, and private storage of plugin installations.
 *
 * Users save values for the fields an installation's manifest declares
 * (`plugins.settings.*`); the plugin reads them, and keeps its own small
 * key-value storage, through host methods its child process calls. Values
 * belong to the installation, so they outlive disable, re-enable, restarts
 * and source changes, and are deleted when the installation is removed.
 *
 * A secret's value lives in the server secret store and is only ever read by
 * the plugin; clients learn whether one is saved and nothing else. Every
 * write and the removal cleanup run one at a time, and a write first checks
 * that the installation still exists, so nothing is saved for an
 * installation after its cleanup.
 */
import {
  PLUGIN_SETTINGS_CAPABILITY,
  PluginCatalogError,
  PluginSettingValue,
  pluginSettingValueProblem,
  resolvePluginSettingValue,
  type PluginInstallationId,
  type PluginSettingsUpdateInput,
  type PluginSettingsValues,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import type { PluginRegistration } from "./PluginManifestLoader.ts";
import { PluginCatalog } from "./PluginCatalog.ts";
import {
  PluginHostCallError,
  PluginSupervisor,
  type PluginHostMethod,
} from "./PluginSupervisor.ts";

type HostCall = Parameters<PluginHostMethod>[0];

/** Bounds of one installation's private storage. */
export interface PluginStorageLimits {
  readonly maxKeyLength: number;
  readonly maxValueBytes: number;
  readonly maxKeys: number;
  readonly maxTotalBytes: number;
}

const defaultPluginStorageLimits: PluginStorageLimits = {
  maxKeyLength: 128,
  maxValueBytes: 64 * 1024,
  maxKeys: 256,
  maxTotalBytes: 1024 * 1024,
};

const encodeName = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const secretName = (installationId: PluginInstallationId, key: string) =>
  `plugin-setting-${encodeName(installationId)}-${encodeName(key)}`;

const SavedValueJson = Schema.fromJsonString(PluginSettingValue);
const decodeSavedValue = Schema.decodeUnknownOption(SavedValueJson);
const encodeSavedValue = Schema.encodeSync(SavedValueJson);
const StoredJson = Schema.fromJsonString(Schema.Json);
const decodeStoredJson = Schema.decodeUnknownOption(StoredJson);
const encodeStoredJson = Schema.encodeSync(StoredJson);

const decodeKeyInput = Schema.decodeUnknownEffect(Schema.Struct({ key: Schema.String }));
const decodeSetInput = Schema.decodeUnknownEffect(
  Schema.Struct({ key: Schema.String, value: Schema.Json }),
);

const hasControlCharacter = (text: string) => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const catalogError = (reason: string, message: string, installationId: PluginInstallationId) =>
  new PluginCatalogError({ reason, message, installationId });

const hostError = (message: string) => new PluginHostCallError({ message });

interface SettingsEvent {
  readonly installationId: PluginInstallationId;
  readonly removed: boolean;
}

export class PluginSettings extends Context.Service<
  PluginSettings,
  {
    /** The saved values now, then after every change; fails `not-found` once the installation is removed. */
    readonly subscribe: (
      installationId: PluginInstallationId,
    ) => Stream.Stream<PluginSettingsValues, PluginCatalogError>;
    /** Checks every change against the declared fields, then saves them. Never returns a secret. */
    readonly update: (
      input: PluginSettingsUpdateInput,
    ) => Effect.Effect<PluginSettingsValues, PluginCatalogError>;
  }
>()("t3/plugins/PluginSettings") {}

export const make = Effect.fn("PluginSettings.make")(function* (
  limits: PluginStorageLimits = defaultPluginStorageLimits,
) {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore;
  const catalog = yield* PluginCatalog;
  const supervisor = yield* PluginSupervisor;

  // Writes and removal cleanup run one at a time, so a cleanup never races a write.
  const lock = yield* Semaphore.make(1);
  const events = yield* PubSub.sliding<SettingsEvent>(256);

  const findInstallation = (installationId: PluginInstallationId) =>
    catalog.list.pipe(
      Effect.map((snapshot) =>
        snapshot.installations.find(
          (installation) => installation.installationId === installationId,
        ),
      ),
    );

  const notFound = (installationId: PluginInstallationId) =>
    catalogError("not-found", "That plugin is not installed here.", installationId);

  const storageFailed = (installationId: PluginInstallationId) => (cause: unknown) =>
    Effect.logWarning("Plugin settings storage failed", { installationId, cause }).pipe(
      Effect.andThen(
        Effect.fail(
          catalogError("storage", "Could not save the plugin's settings.", installationId),
        ),
      ),
    );

  const savedRows = (installationId: PluginInstallationId) =>
    sql<{ readonly key: string; readonly value_json: string | null }>`
      SELECT key, value_json FROM plugin_settings
      WHERE installation_id = ${installationId}
      ORDER BY key
    `;

  const readValues = (installationId: PluginInstallationId) =>
    savedRows(installationId).pipe(
      Effect.map((rows): PluginSettingsValues => {
        const values: Array<{ key: string; value: PluginSettingValue }> = [];
        const secretKeys: Array<string> = [];
        for (const row of rows) {
          if (row.value_json === null) {
            secretKeys.push(row.key);
            continue;
          }
          const value = decodeSavedValue(row.value_json);
          if (Option.isSome(value)) values.push({ key: row.key, value: value.value });
        }
        return { installationId, values, secrets: secretKeys };
      }),
      Effect.catch(storageFailed(installationId)),
    );

  const current = Effect.fnUntraced(function* (installationId: PluginInstallationId) {
    if ((yield* findInstallation(installationId)) === undefined)
      return yield* notFound(installationId);
    return yield* readValues(installationId);
  });

  const update = Effect.fn("PluginSettings.update")(function* (input: PluginSettingsUpdateInput) {
    const { installationId } = input;
    const installation = yield* findInstallation(installationId);
    if (installation === undefined) return yield* notFound(installationId);
    const fields = installation.manifest?.settings ?? [];
    const invalid = (message: string) => catalogError("invalid-setting", message, installationId);
    const seen = new Set<string>();
    const plan = [];
    for (const change of input.changes) {
      const field = fields.find((candidate) => candidate.key === change.key);
      if (field === undefined) return yield* invalid(`This plugin has no setting "${change.key}".`);
      if (seen.has(change.key)) return yield* invalid(`"${change.key}" is changed twice.`);
      seen.add(change.key);
      if (change.value !== null) {
        const problem = pluginSettingValueProblem(field, change.value);
        if (problem !== undefined) return yield* invalid(problem);
      }
      plan.push({ key: change.key, secret: field.type === "secret", value: change.value });
    }
    const failed = storageFailed(installationId);
    for (const step of plan) {
      if (step.secret && step.value !== null) {
        yield* secrets
          .set(secretName(installationId, step.key), textEncoder.encode(String(step.value)))
          .pipe(Effect.catch(failed));
        yield* sql`
          INSERT INTO plugin_settings (installation_id, key, value_json)
          VALUES (${installationId}, ${step.key}, NULL)
          ON CONFLICT (installation_id, key) DO UPDATE SET value_json = NULL
        `.pipe(Effect.catch(failed));
      } else if (step.secret) {
        yield* sql`
          DELETE FROM plugin_settings WHERE installation_id = ${installationId} AND key = ${step.key}
        `.pipe(Effect.catch(failed));
        yield* secrets.remove(secretName(installationId, step.key)).pipe(Effect.catch(failed));
      } else if (step.value !== null) {
        const json = encodeSavedValue(step.value);
        yield* sql`
          INSERT INTO plugin_settings (installation_id, key, value_json)
          VALUES (${installationId}, ${step.key}, ${json})
          ON CONFLICT (installation_id, key) DO UPDATE SET value_json = excluded.value_json
        `.pipe(Effect.catch(failed));
      } else {
        yield* sql`
          DELETE FROM plugin_settings WHERE installation_id = ${installationId} AND key = ${step.key}
        `.pipe(Effect.catch(failed));
      }
    }
    return yield* readValues(installationId);
  });

  /** Deletes everything saved for an installation that no longer exists. */
  const purge = Effect.fnUntraced(function* (installationId: PluginInstallationId) {
    const rows = yield* savedRows(installationId);
    yield* sql`
      DELETE FROM plugin_settings
      WHERE installation_id = ${installationId} AND value_json IS NOT NULL
    `;
    for (const row of rows) {
      if (row.value_json !== null) continue;
      // A secret's row goes only with its value, so a failed removal is retried at the next start.
      const removed = yield* secrets.remove(secretName(installationId, row.key)).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("Could not delete a removed plugin's secret", {
            installationId,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );
      if (removed)
        yield* sql`
          DELETE FROM plugin_settings WHERE installation_id = ${installationId} AND key = ${row.key}
        `;
    }
    yield* sql`DELETE FROM plugin_storage WHERE installation_id = ${installationId}`;
  });

  const purgeRemoved = (installationIds: Iterable<PluginInstallationId>) =>
    lock.withPermit(
      Effect.forEach(
        installationIds,
        (installationId) =>
          purge(installationId).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not delete a removed plugin's settings", {
                installationId,
                cause,
              }),
            ),
            Effect.andThen(PubSub.publish(events, { installationId, removed: true })),
          ),
        { discard: true },
      ),
    );

  // ---- Host methods: what the plugin's own process may read and write ----

  const owner = (registration: PluginRegistration) =>
    registration.installationId !== undefined &&
    registration.manifest.capabilities.includes(PLUGIN_SETTINGS_CAPABILITY)
      ? Effect.succeed(registration.installationId)
      : Effect.fail(hostError(`The plugin did not declare the "settings" capability.`));

  const malformed = () => hostError("The request is malformed.");

  const checkStorageKey = (key: string) =>
    key.length > 0 && key.length <= limits.maxKeyLength && !hasControlCharacter(key)
      ? Effect.void
      : Effect.fail(
          hostError(
            `Storage keys must be 1 to ${limits.maxKeyLength} characters without control characters.`,
          ),
        );

  const hostFailed = (cause: unknown) =>
    Effect.logWarning("Plugin storage failed", { cause }).pipe(
      Effect.andThen(Effect.fail(hostError("The server could not read or save the value."))),
    );

  const settingsGet = Effect.fnUntraced(function* ({ registration, input }: HostCall) {
    const installationId = yield* owner(registration);
    const { key } = yield* decodeKeyInput(input).pipe(Effect.mapError(malformed));
    const field = registration.manifest.settings?.find((candidate) => candidate.key === key);
    if (field === undefined) return yield* hostError(`"${key}" is not a declared setting.`);
    const rows = yield* sql<{ readonly value_json: string | null }>`
      SELECT value_json FROM plugin_settings
      WHERE installation_id = ${installationId} AND key = ${key}
    `.pipe(Effect.catch(hostFailed));
    const row = rows[0];
    if (field.type === "secret") {
      if (row === undefined || row.value_json !== null) return { value: null };
      const secret = yield* secrets
        .get(secretName(installationId, key))
        .pipe(Effect.catch(hostFailed));
      return { value: Option.isSome(secret) ? textDecoder.decode(secret.value) : null };
    }
    const saved =
      row?.value_json == null ? undefined : Option.getOrUndefined(decodeSavedValue(row.value_json));
    return { value: resolvePluginSettingValue(field, saved) ?? null };
  });

  const storageGet = Effect.fnUntraced(function* ({ registration, input }: HostCall) {
    const installationId = yield* owner(registration);
    const { key } = yield* decodeKeyInput(input).pipe(Effect.mapError(malformed));
    yield* checkStorageKey(key);
    const rows = yield* sql<{ readonly value_json: string }>`
      SELECT value_json FROM plugin_storage
      WHERE installation_id = ${installationId} AND key = ${key}
    `.pipe(Effect.catch(hostFailed));
    const value = rows[0] === undefined ? Option.none() : decodeStoredJson(rows[0].value_json);
    return Option.match(value, {
      onNone: () => ({ found: false, value: null }),
      onSome: (json) => ({ found: true, value: json }),
    });
  });

  const storageSet = Effect.fnUntraced(function* ({ registration, input, admitted }: HostCall) {
    const installationId = yield* owner(registration);
    const { key, value } = yield* decodeSetInput(input).pipe(Effect.mapError(malformed));
    yield* checkStorageKey(key);
    const json = encodeStoredJson(value);
    const bytes = Buffer.byteLength(json);
    if (bytes > limits.maxValueBytes)
      return yield* hostError(`The value is ${bytes} bytes; the limit is ${limits.maxValueBytes}.`);
    return yield* lock.withPermit(
      Effect.gen(function* () {
        // Checked under the lock: a removed installation's cleanup may already have run.
        if ((yield* findInstallation(installationId)) === undefined)
          return yield* hostError("The plugin was removed.");
        const usage = yield* sql<{ readonly keys: number; readonly bytes: number | null }>`
          SELECT COUNT(*) AS keys, SUM(bytes) AS bytes FROM plugin_storage
          WHERE installation_id = ${installationId} AND key != ${key}
        `.pipe(Effect.catch(hostFailed));
        const others = usage[0] ?? { keys: 0, bytes: 0 };
        if (others.keys + 1 > limits.maxKeys)
          return yield* hostError(`The plugin already stores ${limits.maxKeys} keys.`);
        if ((others.bytes ?? 0) + bytes > limits.maxTotalBytes)
          return yield* hostError(
            `Saving this would store more than ${limits.maxTotalBytes} bytes for the plugin.`,
          );
        // A revoked generation's write that waited for the lock is dropped here.
        yield* admitted;
        yield* sql`
          INSERT INTO plugin_storage (installation_id, key, value_json, bytes)
          VALUES (${installationId}, ${key}, ${json}, ${bytes})
          ON CONFLICT (installation_id, key) DO UPDATE SET
            value_json = excluded.value_json,
            bytes = excluded.bytes
        `.pipe(Effect.catch(hostFailed));
        return null;
      }),
    );
  });

  const storageDelete = Effect.fnUntraced(function* ({ registration, input, admitted }: HostCall) {
    const installationId = yield* owner(registration);
    const { key } = yield* decodeKeyInput(input).pipe(Effect.mapError(malformed));
    yield* checkStorageKey(key);
    return yield* lock.withPermit(
      Effect.gen(function* () {
        yield* admitted;
        yield* sql`
          DELETE FROM plugin_storage WHERE installation_id = ${installationId} AND key = ${key}
        `.pipe(Effect.catch(hostFailed));
        return null;
      }),
    );
  });

  const storageKeys = Effect.fnUntraced(function* ({ registration }: HostCall) {
    const installationId = yield* owner(registration);
    const rows = yield* sql<{ readonly key: string }>`
      SELECT key FROM plugin_storage WHERE installation_id = ${installationId} ORDER BY key
    `.pipe(Effect.catch(hostFailed));
    return { keys: rows.map((row) => row.key) };
  });

  yield* supervisor.serveHostMethod("settings.get", settingsGet);
  yield* supervisor.serveHostMethod("storage.get", storageGet);
  yield* supervisor.serveHostMethod("storage.set", storageSet);
  yield* supervisor.serveHostMethod("storage.delete", storageDelete);
  yield* supervisor.serveHostMethod("storage.keys", storageKeys);

  // Delete what earlier runs saved for installations that are gone, then follow removals.
  const listed = new Set(
    (yield* catalog.list).installations.map((installation) => installation.installationId),
  );
  const stored = yield* sql<{ readonly installation_id: PluginInstallationId }>`
    SELECT installation_id FROM plugin_settings
    UNION
    SELECT installation_id FROM plugin_storage
  `.pipe(Effect.orDie);
  yield* purgeRemoved(
    stored
      .map((row) => row.installation_id)
      .filter((installationId) => !listed.has(installationId)),
  );
  let known: ReadonlySet<PluginInstallationId> = listed;
  yield* catalog.subscribe.pipe(
    Stream.runForEach((snapshot) => {
      const ids = new Set(
        snapshot.installations.map((installation) => installation.installationId),
      );
      const removed = [...known].filter((installationId) => !ids.has(installationId));
      known = ids;
      return removed.length === 0 ? Effect.void : purgeRemoved(removed);
    }),
    Effect.forkScoped,
  );

  return PluginSettings.of({
    subscribe: (installationId) =>
      Stream.unwrap(
        // Subscribe before the first read so a change in between is not lost.
        PubSub.subscribe(events).pipe(
          Effect.map((subscription) =>
            Stream.concat(
              Stream.fromEffect(current(installationId)),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((event) => event.installationId === installationId),
                Stream.mapEffect((event) =>
                  event.removed ? Effect.fail(notFound(installationId)) : current(installationId),
                ),
              ),
            ).pipe(Stream.changes),
          ),
        ),
      ),
    update: (input) =>
      lock
        .withPermit(update(input))
        .pipe(
          Effect.ensuring(
            PubSub.publish(events, { installationId: input.installationId, removed: false }),
          ),
        ),
  });
});

export const layer = (limits?: PluginStorageLimits) => Layer.effect(PluginSettings, make(limits));
