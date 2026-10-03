/**
 * The part of plugin event delivery that the plugin catalogue calls into. It
 * lets the catalogue start a plugin's event cursor without depending on the
 * event feed, which itself depends on the catalogue.
 */
import { PLUGIN_EVENTS_CAPABILITY, type PluginInstallationId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type * as SqlError from "effect/unstable/sql/SqlError";

export class PluginEventDelivery extends Context.Service<
  PluginEventDelivery,
  {
    /**
     * Gives an installation that declares `events` its starting cursor, the
     * current end of the event log, unless it already has one. The catalogue
     * runs this in the transaction that saves the installation as enabled, so
     * every event committed after the enable is delivered and none from
     * before it. Re-enables and restarts keep the stored cursor.
     */
    readonly begin: (
      installationId: PluginInstallationId,
      capabilities: ReadonlyArray<string>,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("t3/plugins/PluginEventDelivery") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return PluginEventDelivery.of({
    begin: (installationId, capabilities) =>
      capabilities.includes(PLUGIN_EVENTS_CAPABILITY)
        ? Effect.gen(function* () {
            // One statement, so the end it reads is the end when the row is written.
            yield* sql`
              INSERT INTO plugin_event_cursors (installation_id, acknowledged_sequence, updated_at)
              SELECT ${installationId}, COALESCE(MAX(sequence), 0), ${DateTime.formatIso(yield* DateTime.now)}
              FROM orchestration_events
              WHERE application_event_version = 2
                AND aggregate_kind = 'thread'
              ON CONFLICT (installation_id) DO NOTHING
            `;
          })
        : Effect.void,
  });
});

export const layer = Layer.effect(PluginEventDelivery, make);
