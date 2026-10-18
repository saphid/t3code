// @effect-diagnostics globalDate:off globalConsole:off - Bench times the upload legs on the wall clock with fixed ISO command timestamps, and prints the RSS delta beside the recorder's own summary lines.
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  defaultInstanceIdForDriver,
  EventId,
  MessageId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProviderDriverKind,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { afterAll, assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import type { TurnProcessingQuiescedReceipt } from "../src/orchestration/Services/RuntimeReceiptBus.ts";

import { ASSET_ROUTE_PREFIX, issueAssetUrl, resolveAsset } from "../src/assets/AssetAccess.ts";
import * as ServerSecretStore from "../src/auth/ServerSecretStore.ts";
import * as ServerConfig from "../src/config.ts";
import { normalizeDispatchCommand } from "../src/orchestration/Normalizer.ts";
import * as ProjectFaviconResolver from "../src/project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../src/project/T3ProjectFileLoader.ts";
import * as WorkspacePaths from "../src/workspace/WorkspacePaths.ts";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import { makePerfBenchRecorder } from "./perfBench.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";

/**
 * PLANS.md item 14: attachment-upload. One thread.turn.start carries a 10 MiB
 * base64 image inline (PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, the contract's
 * ceiling; its data URL stays under the 14 M char single-frame cap). Each
 * measured turn samples three legs:
 *
 * - attachment-upload-store-write: normalizeDispatchCommand, which decodes
 *   the data URL and persists the bytes through attachmentStore paths.
 * - attachment-upload: engine dispatch to the terminal receipt
 *   (turn.processing.quiesced), the same window turn-dispatch-latency times.
 * - attachment-upload-read-back: the in-process GET /api/assets/* equivalent,
 *   issueAssetUrl -> resolveAsset -> read the resolved file.
 *
 * The peak RSS delta across the measured window is logged (process.memoryUsage
 * before/after each leg); the results JSON has no per-run delta field.
 */

const PROJECT_ID = ProjectId.make("perf-attachment-project");
const THREAD_ID = ThreadId.make("perf-attachment-thread");
const FIXTURE_TURN_ID = "fixture-turn";
const CODEX_PROVIDER = ProviderDriverKind.make("codex");

/** 10 MiB, the largest image one turn.start may carry. */
const ATTACHMENT_BYTE_LENGTH = PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;
const WARMUP_TURNS = 2;
const MEASURED_TURNS = 8;

function nowIso() {
  return "2026-05-01T00:00:00.000Z";
}

/** Deterministic pseudo-random bytes (LCG) so every run uploads identical content. */
function makeAttachmentDataUrl(): string {
  const bytes = Buffer.allocUnsafe(ATTACHMENT_BYTE_LENGTH);
  let state = 0x9e3779b9;
  for (let index = 0; index < ATTACHMENT_BYTE_LENGTH; index++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = state & 0xff;
  }
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

const recorder = makePerfBenchRecorder();

/** Peak process RSS growth across the measured window, logged after the run. */
let peakRssDeltaBytes = 0;

afterAll(async () => {
  console.log(
    `[perf-bench] attachment-upload peak RSS delta ${(peakRssDeltaBytes / (1024 * 1024)).toFixed(1)} MiB over the measured window`,
  );
  await recorder.flush();
});

function withHarness<A, E>(use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: CODEX_PROVIDER }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

/** Minimal replay fixture for one turn: started, one delta, completed. */
function makeTurnResponse(tag: string): TestTurnResponse {
  const base = (suffix: string) => ({
    eventId: EventId.make(`evt-${tag}-${suffix}`),
    provider: CODEX_PROVIDER,
    createdAt: nowIso(),
    threadId: THREAD_ID,
    turnId: FIXTURE_TURN_ID,
  });
  return {
    events: [
      { type: "turn.started", ...base("started") },
      { type: "message.delta", ...base("delta"), delta: `Reply ${tag}.\n` },
      { type: "turn.completed", ...base("completed"), status: "completed" },
    ],
  };
}

function makeUploadCommand(input: {
  readonly tag: string;
  readonly dataUrl: string;
}): ClientOrchestrationCommand {
  return {
    type: "thread.turn.start",
    commandId: CommandId.make(`cmd-turn-${input.tag}`),
    threadId: THREAD_ID,
    message: {
      messageId: MessageId.make(`msg-${input.tag}`),
      role: "user",
      text: `Turn ${input.tag}`,
      attachments: [
        {
          type: "image",
          name: "perf-upload.png",
          mimeType: "image/png",
          sizeBytes: ATTACHMENT_BYTE_LENGTH,
          dataUrl: input.dataUrl,
        },
      ],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: nowIso(),
  };
}

it.live(
  "measures a 10 MiB image upload turn: store write, dispatch-to-receipt, signed-URL read-back",
  () =>
    withHarness((harness) => {
      // The same (cwd, baseDir) pair the harness derives its paths from, so
      // normalize and asset access see the harness's attachmentsDir/secretsDir.
      const configLayer = ServerConfig.layerTest(harness.workspaceDir, harness.rootDir);
      const supportLayer = Layer.mergeAll(
        configLayer,
        WorkspacePaths.layer,
        ProjectFaviconResolver.layer.pipe(
          Layer.provide(WorkspacePaths.layer),
          Layer.provide(T3ProjectFileLoader.layer),
        ),
        ServerSecretStore.layer.pipe(Layer.provide(configLayer)),
      ).pipe(Layer.provideMerge(NodeServices.layer));

      return Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const defaultModel = DEFAULT_MODEL_BY_PROVIDER[CODEX_PROVIDER] ?? DEFAULT_MODEL;
        yield* harness.engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-perf-attachment-project"),
          projectId: PROJECT_ID,
          title: "Attachment Bench Project",
          workspaceRoot: harness.workspaceDir,
          defaultModelSelection: {
            instanceId: defaultInstanceIdForDriver(CODEX_PROVIDER),
            model: defaultModel,
          },
          createdAt: nowIso(),
        });
        yield* harness.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-create-perf-attachment-thread"),
          threadId: THREAD_ID,
          projectId: PROJECT_ID,
          title: "Attachment bench thread",
          modelSelection: {
            instanceId: defaultInstanceIdForDriver(CODEX_PROVIDER),
            model: defaultModel,
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: harness.workspaceDir,
          createdAt: nowIso(),
        });

        const dataUrl = makeAttachmentDataUrl();
        const storeWriteSamples: Array<number> = [];
        const dispatchSamples: Array<number> = [];
        const readBackSamples: Array<number> = [];
        const rssBefore = process.memoryUsage().rss;
        const sampleRss = () => {
          peakRssDeltaBytes = Math.max(peakRssDeltaBytes, process.memoryUsage().rss - rssBefore);
        };

        for (let turn = 1; turn <= WARMUP_TURNS + MEASURED_TURNS; turn++) {
          const tag = `att-${turn}`;
          const response = makeTurnResponse(tag);
          yield* turn === 1
            ? harness.adapterHarness!.queueTurnResponseForNextSession(response)
            : harness.adapterHarness!.queueTurnResponse(THREAD_ID, response);

          // Leg 1: data URL decode plus attachment store write.
          const storeWriteStart = performance.now();
          const normalized = yield* normalizeDispatchCommand(
            makeUploadCommand({ tag, dataUrl }),
          );
          const storeWriteMs = performance.now() - storeWriteStart;
          sampleRss();
          if (normalized.type !== "thread.turn.start") {
            return yield* Effect.die(new Error("Normalization changed the command type."));
          }
          const attachment = normalized.message.attachments[0];
          if (!attachment) {
            return yield* Effect.die(new Error("Normalization dropped the attachment."));
          }
          assert.equal(attachment.sizeBytes, ATTACHMENT_BYTE_LENGTH);

          // Leg 2: command dispatch to the terminal turn receipt.
          const dispatchStart = performance.now();
          yield* harness.engine.dispatch(normalized);
          yield* harness.waitForReceipt(
            (receipt): receipt is TurnProcessingQuiescedReceipt =>
              receipt.type === "turn.processing.quiesced" &&
              receipt.threadId === THREAD_ID &&
              receipt.checkpointTurnCount === turn,
          );
          const dispatchMs = performance.now() - dispatchStart;
          sampleRss();

          // Leg 3: signed-URL read-back, the in-process GET /api/assets/* path.
          const readBackStart = performance.now();
          const issued = yield* issueAssetUrl({
            resource: { _tag: "attachment", attachmentId: attachment.id },
          });
          const suffix = issued.relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
          const token = suffix.slice(0, suffix.indexOf("/"));
          const fileName = decodeURIComponent(suffix.slice(suffix.indexOf("/") + 1));
          const resolved = yield* resolveAsset(token, fileName);
          if (!resolved) {
            return yield* Effect.die(new Error("Signed asset URL did not resolve."));
          }
          const readBytes = yield* fileSystem.readFile(resolved.path);
          const readBackMs = performance.now() - readBackStart;
          sampleRss();
          assert.equal(readBytes.byteLength, ATTACHMENT_BYTE_LENGTH);

          if (turn > WARMUP_TURNS) {
            storeWriteSamples.push(storeWriteMs);
            dispatchSamples.push(dispatchMs);
            readBackSamples.push(readBackMs);
          }
        }

        assert.equal(dispatchSamples.length, MEASURED_TURNS);
        recorder.record({
          scenario: "attachment-upload",
          size: "small",
          samplesMs: dispatchSamples,
        });
        recorder.record({
          scenario: "attachment-upload-store-write",
          size: "small",
          samplesMs: storeWriteSamples,
        });
        recorder.record({
          scenario: "attachment-upload-read-back",
          size: "small",
          samplesMs: readBackSamples,
        });
      }).pipe(Effect.provide(supportLayer));
    }),
  240_000,
);
