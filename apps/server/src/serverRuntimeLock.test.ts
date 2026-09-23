// @effect-diagnostics nodeBuiltinImport:off - tests use native IPC and directory junctions unavailable through Effect.
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Exit from "effect/Exit";

import { withServerRuntimeLock } from "./serverRuntimeLock.ts";

it.effect("rejects a second runtime before it can reconcile another server's live runs", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-runtime-owner-" });
    let status = "running";
    yield* withServerRuntimeLock(
      stateDir,
      Effect.gen(function* () {
        const contender = yield* withServerRuntimeLock(
          stateDir,
          Effect.sync(() => {
            status = "cancelled";
          }),
        ).pipe(Effect.exit);
        assert.equal(status, "running");
        assert.isTrue(Exit.isFailure(contender));
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("releases ownership after normal completion and failed startup", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-runtime-release-" });
    yield* withServerRuntimeLock(stateDir, Effect.void);
    yield* withServerRuntimeLock(stateDir, Effect.fail("startup failed")).pipe(Effect.exit);
    assert.equal(yield* withServerRuntimeLock(stateDir, Effect.succeed("recovered")), "recovered");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps ownership until runtime shutdown finalizers finish", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-runtime-shutdown-" });
    let contenderExit;
    yield* withServerRuntimeLock(
      stateDir,
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          withServerRuntimeLock(stateDir, Effect.void).pipe(
            Effect.exit,
            Effect.tap((exit) =>
              Effect.sync(() => {
                contenderExit = exit;
              }),
            ),
          ),
        );
      }).pipe(Effect.scoped),
    );
    assert.isTrue(contenderExit !== undefined && Exit.isFailure(contenderExit));
    yield* withServerRuntimeLock(stateDir, Effect.void);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("allows separate state directories but rejects a symlink to the same state", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-runtime-alias-" });
    const stateDir = `${root}/state`;
    yield* withServerRuntimeLock(
      stateDir,
      Effect.gen(function* () {
        yield* withServerRuntimeLock(`${root}/other`, Effect.void);
        yield* Effect.promise(() => NodeFSP.symlink(stateDir, `${root}/alias`, "junction"));
        assert.isTrue(
          Exit.isFailure(
            yield* withServerRuntimeLock(`${root}/alias`, Effect.void).pipe(Effect.exit),
          ),
        );
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("excludes another process and releases ownership when that process dies", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-runtime-process-" });
    const { child, exited, ready } = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const child = NodeChildProcess.fork(
          new URL("./serverRuntimeLock.fixture.ts", import.meta.url),
          [stateDir],
          {
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            execArgv: [],
          },
        );
        const exited = new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", () => resolve());
        });
        const ready = Promise.race([
          new Promise<unknown>((resolve) => child.once("message", resolve)),
          exited.then(() => {
            throw new Error("Lock owner exited before readiness");
          }),
        ]);
        return { child, exited, ready };
      }),
      ({ child, exited }) =>
        Effect.promise(async () => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await exited;
          }
        }),
    );
    assert.equal(yield* Effect.promise(() => ready), "locked");
    const contender = yield* withServerRuntimeLock(stateDir, Effect.void).pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(contender));
    child.kill("SIGKILL");
    yield* Effect.promise(() => exited);
    assert.equal(yield* withServerRuntimeLock(stateDir, Effect.succeed("recovered")), "recovered");
  }).pipe(Effect.provide(NodeServices.layer)),
);
