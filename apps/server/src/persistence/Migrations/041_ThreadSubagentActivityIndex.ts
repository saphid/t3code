import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_subagent_activities
    ON projection_thread_activities(thread_id, sequence)
    WHERE kind IN ('task.started', 'task.progress', 'task.updated', 'task.completed')
  `;
});
