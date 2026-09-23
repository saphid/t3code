import * as NodeSqlite from "node:sqlite";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ServerRuntimeLockError extends Schema.TaggedError<ServerRuntimeLockError>()(
  "ServerRuntimeLockError",
  { stateDir: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Cannot own server state at ${this.stateDir}. Another T3 server may already be using it. Connect to that server or use a different home directory.`;
  }
}

/**
 * Hold ownership before constructing the runtime, through its shutdown finalizers.
 * A separate SQLite database supplies an OS-released lock without blocking state
 * reads/writes or leaving a stale PID/heartbeat lease after a process crash.
 * Never unlink this file: contenders must lock the same inode.
 */
export const withServerRuntimeLock = <A, E, R>(stateDir: string, runtime: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs
      .makeDirectory(stateDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new ServerRuntimeLockError({ stateDir, cause })));
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const database = new NodeSqlite.DatabaseSync(path.join(stateDir, "server-owner.sqlite"));
          try {
            database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
            return database;
          } catch (cause) {
            database.close();
            throw cause;
          }
        },
        catch: (cause) => new ServerRuntimeLockError({ stateDir, cause }),
      }),
      (database) => Effect.sync(() => database.close()),
    );
    return yield* runtime;
  }).pipe(Effect.scoped);
