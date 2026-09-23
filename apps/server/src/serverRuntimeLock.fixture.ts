import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { withServerRuntimeLock } from "./serverRuntimeLock.ts";

const stateDir = process.argv[2];
if (!stateDir) throw new Error("Expected an isolated state directory");
// Keep the fixture alive until the test kills its captured child process.
process.on("message", () => {});
await Effect.runPromise(
  withServerRuntimeLock(
    stateDir,
    Effect.gen(function* () {
      process.send?.("locked");
      return yield* Effect.never;
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
