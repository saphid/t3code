import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  PluginInstallationId,
  pluginInstallationStatus,
  type PluginInstallation,
} from "@t3tools/contracts";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PluginCatalog from "./PluginCatalog.ts";
import * as PluginSupervisor from "./PluginSupervisor.ts";

// Children run the real CLI entry, which routes `__plugin-host` to the child runtime.
const BIN_PATH = `${import.meta.dirname}/../bin.ts`;

type Catalog = PluginCatalog.PluginCatalog["Service"];

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Starts a catalogue and its supervisor in `scope`, as one server start would. */
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

/**
 * Writes a plugin whose activation leaves a marker outside its own directory:
 * a plugin writing into its directory changes its own digest.
 */
const preparePlugin = Effect.fn("preparePlugin")(function* (id: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-plugin-catalog-" });
  const directory = path.join(root, "plugin");
  yield* fs.makeDirectory(directory);
  const marker = path.join(root, "activated");
  const entry = path.join(directory, "main.mjs");
  yield* fs.writeFileString(
    entry,
    [
      `import * as NodeFS from "node:fs";`,
      `export function activate(context) {`,
      `  NodeFS.writeFileSync(${toJson(marker)}, String(process.pid));`,
      `  context.proposed.handle("ping", (input) => ({ pid: process.pid, input }));`,
      `}`,
      ``,
    ].join("\n"),
  );
  yield* fs.writeFileString(
    path.join(directory, "t3-plugin.json"),
    toJson({
      id,
      name: id,
      version: "1.0.0",
      apiVersion: 1,
      entry: "main.mjs",
      proposedApi: true,
    }),
  );
  const edit = (line: string) =>
    fs
      .readFileString(entry)
      .pipe(Effect.flatMap((content) => fs.writeFileString(entry, `${content}// ${line}\n`)));
  return { directory, marker, edit };
});

/** Waits, through the subscription, for a snapshot that satisfies `predicate`. */
const awaitSnapshot = (
  catalog: Catalog,
  predicate: (installations: ReadonlyArray<PluginInstallation>) => boolean,
) =>
  catalog.subscribe.pipe(
    Stream.filter((snapshot) => predicate(snapshot.installations)),
    Stream.runHead,
    Effect.map((snapshot) => Option.getOrThrow(snapshot).installations),
  );

const pidOf = (value: unknown) => (value as { readonly pid: number }).pid;

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Each test gets its own database; the restart test shares one between two starts.
const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SqlitePersistenceMemory));

it.layer(NodeServices.layer)("PluginCatalog", (it) => {
  describe("consent", () => {
    it.effect("runs nothing until the exact bytes are approved, then starts on first use", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const sql = yield* SqlClient.SqlClient;
          const catalog = yield* startCatalog(yield* Scope.Scope);
          const plugin = yield* preparePlugin("test.lazy");

          const relative = yield* catalog.add({ directory: "plugins/lazy" }).pipe(Effect.flip);
          expect(relative.reason).toBe("invalid-directory");

          const { installation: added } = yield* catalog.add({ directory: plugin.directory });
          const installationId = added.installationId;
          expect(pluginInstallationStatus(added)).toBe("needs-consent");
          expect(added).toMatchObject({ enabled: false, consent: null, generation: 0 });
          expect(added.manifest?.id).toBe("test.lazy");
          expect(added.hostState).toBeUndefined();
          const again = yield* catalog.add({ directory: plugin.directory }).pipe(Effect.flip);
          expect(again.reason).toBe("already-added");

          const unapproved = yield* catalog.enable({ installationId }).pipe(Effect.flip);
          expect(unapproved.reason).toBe("consent-required");
          const wrongDigest = yield* catalog
            .consent({ installationId, digest: `sha256:${"0".repeat(64)}` })
            .pipe(Effect.flip);
          expect(wrongDigest.reason).toBe("source-changed");

          const digest = added.source!.digest;
          const { installation: approved } = yield* catalog.consent({ installationId, digest });
          expect(pluginInstallationStatus(approved)).toBe("disabled");
          expect(approved.consent).toMatchObject({ digest, capabilities: [] });

          const { installation: enabled } = yield* catalog.enable({ installationId });
          expect(pluginInstallationStatus(enabled)).toBe("enabled");
          expect(enabled).toMatchObject({ generation: 1, hostState: { _tag: "idle" } });
          expect(yield* fs.exists(plugin.marker)).toBe(false);

          const pid = pidOf(yield* catalog.invoke(installationId, "ping", null));
          expect(isProcessAlive(pid)).toBe(true);
          yield* awaitSnapshot(catalog, ([row]) => row?.hostState?._tag === "running");

          const { installation: disabled } = yield* catalog.disable({ installationId });
          expect(isProcessAlive(pid)).toBe(false);
          expect(pluginInstallationStatus(disabled)).toBe("disabled");
          expect(disabled.hostState).toBeUndefined();
          const stopped = yield* catalog.invoke(installationId, "ping", null).pipe(Effect.flip);
          expect(stopped._tag).toBe("PluginCatalogError");

          expect((yield* catalog.enable({ installationId })).installation.generation).toBe(2);
          expect(yield* catalog.remove({ installationId })).toEqual({ installationId });
          expect((yield* catalog.list).installations).toEqual([]);
          expect(yield* sql`SELECT installation_id FROM plugin_installations`).toEqual([]);
        }),
      ),
    );

    it.effect("stops a plugin and asks again when its bytes change", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const catalog = yield* startCatalog(yield* Scope.Scope);
          const plugin = yield* preparePlugin("test.changed");
          const { installation } = yield* catalog.add({ directory: plugin.directory });
          const installationId = installation.installationId;
          const firstDigest = installation.source!.digest;
          yield* catalog.consent({ installationId, digest: firstDigest });
          yield* catalog.enable({ installationId });
          const pid = pidOf(yield* catalog.invoke(installationId, "ping", null));

          yield* plugin.edit("changed while running");
          const [refreshed] = (yield* catalog.refresh({ installationId })).installations;
          expect(pluginInstallationStatus(refreshed!)).toBe("needs-consent");
          expect(refreshed!.enabled).toBe(false);
          expect(isProcessAlive(pid)).toBe(false);
          const changed = yield* catalog.enable({ installationId }).pipe(Effect.flip);
          expect(changed.reason).toBe("consent-required");
          const stale = yield* catalog
            .consent({ installationId, digest: firstDigest })
            .pipe(Effect.flip);
          expect(stale.reason).toBe("source-changed");

          yield* catalog.consent({ installationId, digest: refreshed!.source!.digest });
          yield* catalog.enable({ installationId });
          // Changed again with no refresh: the check before a fresh process catches it.
          yield* plugin.edit("changed before first use");
          yield* fs.remove(plugin.marker);
          const beforeStart = yield* catalog.invoke(installationId, "ping", null).pipe(Effect.flip);
          expect(beforeStart).toMatchObject({ reason: "source-changed" });
          expect(yield* fs.exists(plugin.marker)).toBe(false);
          const [revoked] = (yield* catalog.list).installations;
          expect(pluginInstallationStatus(revoked!)).toBe("needs-consent");
        }),
      ),
    );

    it.effect("runs one directory per plugin id at a time", () =>
      withDatabase(
        Effect.gen(function* () {
          const catalog = yield* startCatalog(yield* Scope.Scope);
          const approve = Effect.fn(function* (directory: string) {
            const { installation } = yield* catalog.add({ directory });
            const installationId = installation.installationId;
            yield* catalog.consent({ installationId, digest: installation.source!.digest });
            return installationId;
          });
          const first = yield* approve((yield* preparePlugin("test.same")).directory);
          const second = yield* approve((yield* preparePlugin("test.same")).directory);

          yield* catalog.enable({ installationId: first });
          const conflict = yield* catalog.enable({ installationId: second }).pipe(Effect.flip);
          expect(conflict.reason).toBe("plugin-id-conflict");
          yield* catalog.disable({ installationId: first });
          const { installation } = yield* catalog.enable({ installationId: second });
          expect(installation.enabled).toBe(true);
        }),
      ),
    );

    it.effect("keeps disable and remove available when the directory is gone", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const catalog = yield* startCatalog(yield* Scope.Scope);
          const plugin = yield* preparePlugin("test.gone");
          const { installation } = yield* catalog.add({ directory: plugin.directory });
          const installationId = installation.installationId;
          yield* catalog.consent({ installationId, digest: installation.source!.digest });
          yield* catalog.enable({ installationId });

          yield* fs.remove(plugin.directory, { recursive: true });
          const [missing] = (yield* catalog.refresh({})).installations;
          expect(pluginInstallationStatus(missing!)).toBe("unavailable");
          expect(missing).toMatchObject({ enabled: false, source: null });
          expect(missing!.problem).toContain("does not exist");
          expect(missing!.manifest?.id).toBe("test.gone");
          expect((yield* catalog.enable({ installationId }).pipe(Effect.flip)).reason).toBe(
            "unavailable",
          );
          expect((yield* catalog.disable({ installationId })).installation.enabled).toBe(false);
          yield* catalog.remove({ installationId });
          const unknown = yield* catalog
            .disable({ installationId: PluginInstallationId.make("missing") })
            .pipe(Effect.flip);
          expect(unknown.reason).toBe("not-found");
        }),
      ),
    );
  });

  describe("server restart", () => {
    it.effect("re-enables approved plugins without starting them and drops changed ones", () =>
      withDatabase(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const kept = yield* preparePlugin("test.kept");
          const changed = yield* preparePlugin("test.restart-changed");

          const before = yield* Scope.make();
          const first = yield* startCatalog(before);
          const ids = yield* Effect.forEach([kept, changed], (plugin) =>
            Effect.gen(function* () {
              const { installation } = yield* first.add({ directory: plugin.directory });
              const installationId = installation.installationId;
              yield* first.consent({ installationId, digest: installation.source!.digest });
              yield* first.enable({ installationId });
              return installationId;
            }),
          );
          const pid = pidOf(yield* first.invoke(ids[0]!, "ping", null));
          yield* Scope.close(before, Exit.void);
          expect(isProcessAlive(pid)).toBe(false);

          yield* fs.remove(kept.marker);
          yield* changed.edit("changed while the server was down");
          const after = yield* startCatalog(yield* Scope.Scope);
          const restarted = yield* awaitSnapshot(after, (rows) =>
            rows.every((row) => row.hostState?._tag === "idle" || !row.enabled),
          );
          const keptRow = restarted.find((row) => row.installationId === ids[0]);
          const changedRow = restarted.find((row) => row.installationId === ids[1]);
          expect(keptRow).toMatchObject({ enabled: true, generation: 2 });
          expect(pluginInstallationStatus(changedRow!)).toBe("needs-consent");
          expect(changedRow!.enabled).toBe(false);
          expect(yield* fs.exists(kept.marker)).toBe(false);

          const restartedPid = pidOf(yield* after.invoke(ids[0]!, "ping", null));
          expect(restartedPid).not.toBe(pid);
          expect(yield* fs.exists(kept.marker)).toBe(true);
        }),
      ),
    );
  });
});
