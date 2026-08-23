import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_summary_timeline_entries (
      entry_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      from_turn INTEGER NOT NULL,
      to_turn INTEGER NOT NULL,
      from_completed_at TEXT NOT NULL,
      to_completed_at TEXT NOT NULL,
      summary TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      UNIQUE(thread_id, to_turn, prompt_version)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_summary_timeline_thread_range
    ON thread_summary_timeline_entries(thread_id, from_turn, to_turn)
  `;
});
