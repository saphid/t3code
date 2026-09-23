import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "./config.ts";
import { runServer } from "./server.ts";
import { withServerRuntimeLock } from "./serverRuntimeLock.ts";

it.effect("rejects duplicate server startup before building its runtime layers", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    yield* withServerRuntimeLock(
      config.stateDir,
      Effect.gen(function* () {
        const error = yield* Effect.flip(runServer);
        assert.equal(error._tag, "ServerRuntimeLockError");
      }),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-server-ownership-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
