import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per plugin installation that receives events: the event log sequence it has
  // acknowledged through. Removing the installation removes its row.
  //
  // Self-contained and safe to run again: it only creates its own table, with no reference to
  // other tables, so it can move to whatever id is free when it merges beside other migrations.
  // The runner records ids, not names, so a database that already recorded this id for a
  // different migration needs a fresh seed rather than this file.
  yield* sql`
    CREATE TABLE IF NOT EXISTS plugin_event_cursors (
      installation_id TEXT PRIMARY KEY,
      acknowledged_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
