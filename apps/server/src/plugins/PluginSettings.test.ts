import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { PluginInstallationId, PluginSettingsValues } from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import { loadPluginDirectory } from "./PluginManifestLoader.ts";
import * as PluginSettings from "./PluginSettings.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";

const FIXTURE_DIR = `${import.meta.dirname}/testFixtures/settingsPlugin`;
// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;
const SECRET = "s3cret-token-value";

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const parseManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/** A secret store in memory, so a test can see exactly what was saved and deleted. */
const makeSecretStore = () => {
  const entries = new Map<string, Uint8Array>();
  const service = ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(entries.get(name))),
    set: (name, value) => Effect.sync(() => void entries.set(name, value)),
    create: (name, value) => Effect.sync(() => void entries.set(name, value)),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const value = entries.get(name) ?? new Uint8Array(bytes);
        entries.set(name, value);
        return value;
      }),
    remove: (name) => Effect.sync(() => void entries.delete(name)),
  });
  return { entries, service };
};

/** Starts a supervisor, catalogue and settings in `scope`, as one server start would. */
const startPlugins = Effect.fn("startPlugins")(function* (
  scope: Scope.Scope,
  secretStore: ServerSecretStore["Service"],
  limits?: PluginSettings.PluginStorageLimits,
) {
  const supervisor = yield* PluginSupervisor.make({
    heapLimitMb: 64,
    activationTimeout: "10 seconds",
    stopGrace: "1 second",
  }).pipe(
    Effect.provideService(HostProcessArguments, [process.execPath, BIN_PATH]),
    Effect.provideService(Scope.Scope, scope),
  );
  const catalog = yield* PluginCatalog.make().pipe(
    Effect.provideService(PluginSupervisor.PluginSupervisor, supervisor),
    Effect.provideService(Scope.Scope, scope),
  );
  const settings = yield* PluginSettings.make(limits).pipe(
    Effect.provideService(PluginSupervisor.PluginSupervisor, supervisor),
    Effect.provideService(PluginCatalog.PluginCatalog, catalog),
    Effect.provideService(ServerSecretStore, secretStore),
    Effect.provideService(Scope.Scope, scope),
  );
  return { supervisor, catalog, settings };
});

/** Copies the fixture into a scoped temp directory, optionally under a changed manifest. */
const preparePlugin = Effect.fn("preparePlugin")(function* (
  manifest: Record<string, unknown> = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-settings-" });
  yield* fs.copyFile(path.join(FIXTURE_DIR, "main.mjs"), path.join(directory, "main.mjs"));
  const fixture = parseManifest(yield* fs.readFileString(path.join(FIXTURE_DIR, "t3-plugin.json")));
  yield* fs.writeFileString(
    path.join(directory, "t3-plugin.json"),
    toJson({ ...fixture, ...manifest }),
  );
  return directory;
});

/** Adds, approves and enables the plugin in `directory`. */
const install = Effect.fn("install")(function* (
  catalog: PluginCatalog.PluginCatalog["Service"],
  directory: string,
) {
  const { installation } = yield* catalog.add({ directory });
  const installationId = installation.installationId;
  yield* catalog.consent({ installationId, digest: installation.source!.digest });
  yield* catalog.enable({ installationId });
  return installationId;
});

/** Waits, through the subscription, for values that satisfy `predicate`. */
const awaitValues = (
  settings: PluginSettings.PluginSettings["Service"],
  installationId: PluginInstallationId,
  predicate: (values: PluginSettingsValues) => boolean,
) =>
  settings
    .subscribe(installationId)
    .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));

const valueOf = (values: PluginSettingsValues, key: string) =>
  values.values.find((entry) => entry.key === key)?.value;

const countRows = Effect.fn("countRows")(function* (installationId: PluginInstallationId) {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count FROM plugin_settings WHERE installation_id = ${installationId}
  `;
  const storage = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count FROM plugin_storage WHERE installation_id = ${installationId}
  `;
  return { settings: settings[0]!.count, storage: storage[0]!.count };
});

// Each test gets its own database.
const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqlitePersistenceMemory));

it.layer(NodeServices.layer)("PluginSettings", (it) => {
  describe("values", () => {
    it.effect("saves what the plugin reads and never sends a secret back", () =>
      withDatabase(
        Effect.gen(function* () {
          const secrets = makeSecretStore();
          const { catalog, settings } = yield* startPlugins(yield* Scope.Scope, secrets.service);
          const installationId = yield* install(catalog, yield* preparePlugin());

          // The catalogue carries the declared fields for clients to render.
          const listed = (yield* catalog.list).installations[0]!;
          expect(listed.manifest?.settings?.map((field) => field.key)).toEqual([
            "apiUrl",
            "token",
            "verbose",
            "retries",
            "mode",
          ]);

          const initial = yield* awaitValues(settings, installationId, () => true);
          expect(initial).toEqual({ installationId, values: [], secrets: [] });
          // Unsaved fields read as their defaults; a secret without a value reads as unset.
          expect(yield* catalog.invoke(installationId, "activationMode", null)).toBe("safe");
          expect(yield* catalog.invoke(installationId, "read", { key: "retries" })).toEqual({
            value: 2,
          });
          expect(yield* catalog.invoke(installationId, "read", { key: "token" })).toEqual({
            unset: true,
          });

          const watching = yield* awaitValues(
            settings,
            installationId,
            (values) => values.secrets.length > 0,
          ).pipe(Effect.forkChild({ startImmediately: true }));
          const saved = yield* settings.update({
            installationId,
            changes: [
              { key: "apiUrl", value: "https://other.example.com" },
              { key: "token", value: SECRET },
              { key: "verbose", value: true },
              { key: "retries", value: 4 },
              { key: "mode", value: "fast" },
            ],
          });
          expect(saved.secrets).toEqual(["token"]);
          expect(valueOf(saved, "retries")).toBe(4);
          expect(valueOf(saved, "token")).toBeUndefined();
          expect(toJson(saved)).not.toContain(SECRET);
          // Every subscriber hears about the change, still without the secret.
          const heard = yield* Fiber.join(watching);
          expect(heard).toEqual(saved);

          for (const [key, value] of [
            ["apiUrl", "https://other.example.com"],
            ["token", SECRET],
            ["verbose", true],
            ["retries", 4],
            ["mode", "fast"],
          ] as const)
            expect(yield* catalog.invoke(installationId, "read", { key })).toEqual({ value });
          const undeclared = yield* catalog.invoke(installationId, "attempt", {
            method: "get",
            key: "missing",
          });
          expect(undeclared).toEqual({
            ok: false,
            message: '"missing" is not a declared setting.',
          });

          // Clearing returns a field to its default and deletes a secret.
          const cleared = yield* settings.update({
            installationId,
            changes: [
              { key: "token", value: null },
              { key: "retries", value: null },
            ],
          });
          expect(cleared.secrets).toEqual([]);
          expect(valueOf(cleared, "retries")).toBeUndefined();
          expect(secrets.entries.size).toBe(0);
          expect(yield* catalog.invoke(installationId, "read", { key: "token" })).toEqual({
            unset: true,
          });
          expect(yield* catalog.invoke(installationId, "read", { key: "retries" })).toEqual({
            value: 2,
          });
        }),
      ),
    );

    it.effect("checks every change before saving any, without repeating the value", () =>
      withDatabase(
        Effect.gen(function* () {
          const secrets = makeSecretStore();
          const { catalog, settings } = yield* startPlugins(yield* Scope.Scope, secrets.service);
          const installationId = yield* install(catalog, yield* preparePlugin());
          const reject = (changes: Parameters<typeof settings.update>[0]["changes"]) =>
            settings.update({ installationId, changes }).pipe(Effect.flip);

          for (const [changes, message] of [
            [[{ key: "nope", value: "x" }], 'This plugin has no setting "nope".'],
            [[{ key: "verbose", value: "yes" }], "Verbose logging must be on or off."],
            [[{ key: "retries", value: 9 }], "Retries must be at most 5."],
            [[{ key: "retries", value: 1.5 }], "Retries must be a whole number."],
            [[{ key: "mode", value: "turbo" }], "Mode must be one of its options."],
            [[{ key: "token", value: "" }], "API token must be non-empty text."],
            [
              [
                { key: "mode", value: "fast" },
                { key: "mode", value: "safe" },
              ],
              '"mode" is changed twice.',
            ],
            // A valid change next to an invalid one is not saved either.
            [
              [
                { key: "token", value: SECRET },
                { key: "retries", value: -1 },
              ],
              "Retries must be at least 0.",
            ],
          ] as const) {
            const error = yield* reject(changes);
            expect(error).toMatchObject({ reason: "invalid-setting", message });
          }
          const tooLong = yield* reject([{ key: "token", value: SECRET.repeat(1000) }]);
          expect(tooLong.message).not.toContain(SECRET);
          expect(yield* countRows(installationId)).toEqual({ settings: 0, storage: 0 });
          expect(secrets.entries.size).toBe(0);

          const unknown = yield* settings
            .update({
              installationId: "missing" as PluginInstallationId,
              changes: [{ key: "mode", value: "fast" }],
            })
            .pipe(Effect.flip);
          expect(unknown.reason).toBe("not-found");
        }),
      ),
    );

    it.effect("refuses manifests whose settings it cannot honor", () =>
      withDatabase(
        Effect.gen(function* () {
          const { catalog } = yield* startPlugins(yield* Scope.Scope, makeSecretStore().service);
          const field = { type: "text", key: "a", label: "A" };
          for (const [manifest, problem] of [
            [{ capabilities: [] }, 'declares settings without the "settings" capability'],
            [{ proposedApi: false }, 'needs "proposedApi": true'],
            [{ settings: [field, field] }, "settings: keys repeat."],
            [
              {
                settings: [
                  { ...field, type: "select", options: [{ value: "x", label: "X" }], default: "y" },
                ],
              },
              "a: the default is invalid.",
            ],
            [{ settings: [{ ...field, type: "number", min: 2, max: 1 }] }, "min is greater"],
          ] as const) {
            const error = yield* catalog
              .add({ directory: yield* preparePlugin(manifest) })
              .pipe(Effect.flip);
            expect(error.reason).toBe("invalid-directory");
            expect(error.message).toContain(problem);
          }
        }),
      ),
    );
  });

  describe("storage", () => {
    it.effect("keeps a bounded private store per installation", () =>
      withDatabase(
        Effect.gen(function* () {
          const { catalog } = yield* startPlugins(yield* Scope.Scope, makeSecretStore().service, {
            maxKeyLength: 8,
            maxValueBytes: 100,
            maxKeys: 2,
            maxTotalBytes: 150,
          });
          const first = yield* install(catalog, yield* preparePlugin());
          const second = yield* install(
            catalog,
            yield* preparePlugin({ id: "test.settings-other" }),
          );
          const attempt = (installationId: PluginInstallationId, key: string, value: unknown) =>
            catalog.invoke(installationId, "attempt", {
              method: "set",
              key,
              value: value as Schema.Json,
            });

          expect(yield* attempt(first, "a", { n: 1 })).toEqual({ ok: true, result: null });
          expect(yield* catalog.invoke(first, "load", { key: "a" })).toEqual({
            value: { n: 1 },
          });
          // Another installation sees nothing of it.
          expect(yield* catalog.invoke(second, "load", { key: "a" })).toEqual({ missing: true });

          expect(yield* attempt(first, "big", "x".repeat(200))).toMatchObject({
            ok: false,
            message: "The value is 202 bytes; the limit is 100.",
          });
          expect(yield* attempt(first, "much-too-long", 1)).toMatchObject({ ok: false });
          expect(yield* attempt(first, "bad\nkey", 1)).toMatchObject({ ok: false });
          expect(yield* attempt(first, "b", "y".repeat(60))).toEqual({ ok: true, result: null });
          expect(yield* attempt(first, "c", 1)).toEqual({
            ok: false,
            message: "The plugin already stores 2 keys.",
          });
          // Replacing a key counts its new size, not both.
          expect(yield* attempt(first, "a", "z".repeat(90))).toMatchObject({
            ok: false,
            message: "Saving this would store more than 150 bytes for the plugin.",
          });
          expect(yield* attempt(first, "a", "z".repeat(40))).toEqual({ ok: true, result: null });
          expect(yield* catalog.invoke(first, "keys", null)).toEqual(["a", "b"]);

          yield* catalog.invoke(first, "drop", { key: "a" });
          expect(yield* catalog.invoke(first, "load", { key: "a" })).toEqual({ missing: true });
          expect(yield* catalog.invoke(first, "keys", null)).toEqual(["b"]);
        }),
      ),
    );

    it.effect("answers at most 16 host calls of one plugin at a time", () =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const supervisor = yield* PluginSupervisor.make({ heapLimitMb: 64 }).pipe(
          Effect.provideService(HostProcessArguments, [process.execPath, BIN_PATH]),
          Effect.provideService(Scope.Scope, scope),
        );
        const release = yield* Deferred.make<void>();
        let inFlight = 0;
        yield* supervisor
          .serveHostMethod("storage.get", () =>
            Effect.sync(() => inFlight++).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ found: false, value: null }),
            ),
          )
          .pipe(Effect.provideService(Scope.Scope, scope));
        yield* supervisor
          .serveHostMethod("settings.get", () => Effect.succeed({ value: null }))
          .pipe(Effect.provideService(Scope.Scope, scope));
        const registration = yield* loadPluginDirectory(yield* preparePlugin());
        yield* supervisor.enable(registration);
        const refused = yield* supervisor.subscribe.pipe(
          Effect.map((subscription) =>
            Stream.fromSubscription(subscription).pipe(
              Stream.filter(
                (event) => event._tag === "Log" && event.message === "host-call-refused",
              ),
              Stream.runHead,
            ),
          ),
        );
        const waitingForRefusal = yield* refused.pipe(Effect.forkChild({ startImmediately: true }));

        const burst = yield* supervisor
          .invoke(registration.manifest.id, "burst", { count: 17 })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Fiber.join(waitingForRefusal);
        yield* Deferred.succeed(release, undefined);
        const results = (yield* Fiber.join(burst)) as ReadonlyArray<string>;
        expect(results.filter((result) => result === "ok")).toHaveLength(16);
        expect(results.filter((result) => result !== "ok")).toEqual([
          "16 calls to the server are already in flight.",
        ]);
        expect(inFlight).toBe(16);
      }),
    );
  });

  describe("lifetime", () => {
    it.effect("keeps values across disable and re-enable, and deletes them on remove", () =>
      withDatabase(
        Effect.gen(function* () {
          const secrets = makeSecretStore();
          const { catalog, settings } = yield* startPlugins(yield* Scope.Scope, secrets.service);
          const installationId = yield* install(catalog, yield* preparePlugin());
          yield* settings.update({
            installationId,
            changes: [
              { key: "token", value: SECRET },
              { key: "mode", value: "fast" },
            ],
          });
          yield* catalog.invoke(installationId, "store", { key: "cursor", value: 42 });

          yield* catalog.disable({ installationId });
          // Disabled plugins keep their values and can still be configured.
          yield* settings.update({ installationId, changes: [{ key: "verbose", value: true }] });
          yield* catalog.enable({ installationId });
          expect(yield* catalog.invoke(installationId, "read", { key: "token" })).toEqual({
            value: SECRET,
          });
          expect(yield* catalog.invoke(installationId, "load", { key: "cursor" })).toEqual({
            value: 42,
          });
          expect(yield* countRows(installationId)).toEqual({ settings: 3, storage: 1 });
          expect(secrets.entries.size).toBe(1);

          // The settings stream ends once the cleanup after the removal has run.
          const ended = yield* settings
            .subscribe(installationId)
            .pipe(Stream.runDrain, Effect.flip, Effect.forkChild({ startImmediately: true }));
          yield* catalog.remove({ installationId });
          expect((yield* Fiber.join(ended)).reason).toBe("not-found");
          expect(yield* countRows(installationId)).toEqual({ settings: 0, storage: 0 });
          expect(secrets.entries.size).toBe(0);
          const late = yield* settings
            .update({ installationId, changes: [{ key: "mode", value: "safe" }] })
            .pipe(Effect.flip);
          expect(late.reason).toBe("not-found");
          expect(yield* countRows(installationId)).toEqual({ settings: 0, storage: 0 });
        }),
      ),
    );

    it.effect("deletes what an earlier run left for removed installations at start", () =>
      withDatabase(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const secrets = makeSecretStore();
          const gone = "gone-installation" as PluginInstallationId;
          yield* sql`
            INSERT INTO plugin_settings (installation_id, key, value_json)
            VALUES (${gone}, 'mode', '"fast"'), (${gone}, 'token', NULL)
          `;
          yield* sql`
            INSERT INTO plugin_storage (installation_id, key, value_json, bytes)
            VALUES (${gone}, 'cursor', '1', 1)
          `;
          const secretName = `plugin-setting-${Buffer.from(gone).toString("base64url")}-${Buffer.from("token").toString("base64url")}`;
          secrets.entries.set(secretName, new TextEncoder().encode(SECRET));

          yield* startPlugins(yield* Scope.Scope, secrets.service);
          expect(yield* countRows(gone)).toEqual({ settings: 0, storage: 0 });
          expect(secrets.entries.size).toBe(0);
        }),
      ),
    );

    it.effect("refuses settings and storage to a registration without the capability", () =>
      Effect.gen(function* () {
        const methods = new Map<string, PluginSupervisor.PluginHostMethod>();
        const supervisor = PluginSupervisor.PluginSupervisor.of({
          enable: () => Effect.void,
          disable: () => Effect.void,
          resume: () => Effect.void,
          invoke: () => Effect.succeed(null),
          state: () => Effect.succeedNone,
          subscribe: Effect.die("unused"),
          serveHostMethod: (method, handler) =>
            Effect.sync(() => void methods.set(method, handler)),
        });
        const catalog = PluginCatalog.PluginCatalog.of({
          list: Effect.succeed({ installations: [] }),
          subscribe: Stream.empty,
          add: () => Effect.die("unused"),
          refresh: () => Effect.die("unused"),
          consent: () => Effect.die("unused"),
          enable: () => Effect.die("unused"),
          disable: () => Effect.die("unused"),
          remove: () => Effect.die("unused"),
          resume: () => Effect.die("unused"),
          invoke: () => Effect.die("unused"),
        });
        yield* PluginSettings.make().pipe(
          Effect.provideService(PluginSupervisor.PluginSupervisor, supervisor),
          Effect.provideService(PluginCatalog.PluginCatalog, catalog),
          Effect.provideService(ServerSecretStore, makeSecretStore().service),
          Effect.provide(SqlitePersistenceMemory),
        );
        const registration = yield* loadPluginDirectory(
          yield* preparePlugin({ capabilities: [], settings: undefined }),
        );
        for (const method of ["settings.get", "storage.get", "storage.set", "storage.keys"]) {
          const error = yield* methods.get(method)!({
            registration: { ...registration, installationId: "x" as PluginInstallationId },
            input: { key: "a", value: 1 },
          }).pipe(Effect.flip);
          expect(error.message).toBe('The plugin did not declare the "settings" capability.');
        }
      }),
    );
  });
});
