import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ThreadSummaryTimeline", (it) => {
  it.effect("creates a sidecar table outside the visible conversation projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 42 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `;
      assert.isTrue(tables.some((table) => table.name === "thread_summary_timeline_entries"));

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(thread_summary_timeline_entries)
      `;
      assert.deepStrictEqual(
        columns.map((column) => column.name),
        [
          "entry_id",
          "thread_id",
          "from_turn",
          "to_turn",
          "from_completed_at",
          "to_completed_at",
          "summary",
          "prompt_version",
          "model",
          "generated_at",
        ],
      );
    }),
  );
});
