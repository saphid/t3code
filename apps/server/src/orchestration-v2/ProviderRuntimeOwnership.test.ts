import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { withServerRuntimeLock } from "../serverRuntimeLock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderRuntimeRecovery from "./ProviderRuntimeRecoveryService.ts";

it.effect("does not cancel delegated work owned by a live runtime during a second startup", () => {
  const threadId = ThreadId.make("thread:delegated-task:live-owner");
  const providerInstanceId = ProviderInstanceId.make("claudeAgent");
  const projection = {
    thread: { id: threadId, providerInstanceId },
    runs: [{ id: RunId.make("live-child"), status: "running", providerInstanceId }],
    attempts: [],
    nodes: [],
    subagents: [],
    messages: [],
    turnItems: [],
    runtimeRequests: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
  } as unknown as OrchestrationV2ThreadProjection;
  let status = "running";
  const recoveryLayer = ProviderRuntimeRecovery.layer.pipe(
    Layer.provide(ServerSettings.layerTest()),
    Layer.provide(
      Layer.mergeAll(
        IdAllocator.layer,
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getRecoveryThreadIds: () => Effect.succeed([threadId]),
          getRuntimeRecoveryProjection: () => Effect.succeed(projection),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          commitCommand: (input) =>
            Effect.sync(() => {
              for (const event of input.events) {
                if (event.type === "run.updated") status = event.payload.status;
              }
              return { committed: true, cancelledEffectCount: 0 } as never;
            }),
        }),
        Layer.mock(EffectOutbox.EffectOutboxV2)({
          reconcileAfterProcessLoss: Effect.succeed({ requeued: 0, cancelled: 0 }),
        }),
      ),
    ),
  );
  const recover = Effect.gen(function* () {
    return yield* (yield* ProviderRuntimeRecovery.ProviderRuntimeRecoveryService).recover;
  }).pipe(Effect.provide(recoveryLayer));

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-delegated-owner-" });
    yield* withServerRuntimeLock(
      stateDir,
      Effect.gen(function* () {
        const contender = yield* withServerRuntimeLock(stateDir, recover).pipe(Effect.exit);
        assert.equal(status, "running");
        assert.isTrue(Exit.isFailure(contender));
      }),
    );
    // Recovery is still allowed when the previous runtime has released ownership.
    const result = yield* withServerRuntimeLock(stateDir, recover);
    assert.equal(result.terminalizedRuns, 1);
    assert.equal(status, "cancelled");
  }).pipe(Effect.provide(NodeServices.layer));
});
