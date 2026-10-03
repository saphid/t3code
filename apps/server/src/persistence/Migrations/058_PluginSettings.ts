import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Saved plugin setting values per installation. A secret's row has a NULL value: the value
  // itself lives in the server secret store, and the row says that one is saved.
  yield* sql`
    CREATE TABLE IF NOT EXISTS plugin_settings (
      installation_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT,
      PRIMARY KEY (installation_id, key)
    )
  `;
  // Each installation's private key-value storage; `bytes` is the value's encoded size for quotas.
  yield* sql`
    CREATE TABLE IF NOT EXISTS plugin_storage (
      installation_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (installation_id, key)
    )
  `;
});
