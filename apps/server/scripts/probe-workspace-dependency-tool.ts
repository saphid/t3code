import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { buildCodexInitializeParams } from "../src/provider/Layers/CodexProvider.ts";
import {
  handleWorkspaceDependencyToolCall,
  workspaceDependencyDynamicTools,
} from "../src/provider/Layers/CodexWorkspaceDependencies.ts";

class WorkspaceDependencyProbeError extends Schema.TaggedErrorClass<WorkspaceDependencyProbeError>()(
  "WorkspaceDependencyProbeError",
  { phase: Schema.String },
) {}

const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcessEnvironment;
  const platform = yield* HostProcessPlatform;
  const architecture = yield* HostProcessArchitecture;
  const cwd = yield* HostProcessWorkingDirectory;
  const outputDirectory = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3-codex-workspace-probe-",
  });
  const workbookPath = path.join(outputDirectory, "workspace-dependency-probe.xlsx");
  const calls = yield* Queue.unbounded<EffectCodexSchema.DynamicToolCallResponse>();
  const completedTurns = yield* Queue.unbounded<EffectCodexSchema.V2TurnCompletedNotification>();
  const handle = yield* spawner.spawn(
    ChildProcess.make(environment.CODEX_BIN ?? "codex", ["app-server"], {
      cwd,
      shell: false,
    }),
  );

  yield* Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    yield* client.handleServerRequest("item/tool/call", (payload) =>
      handleWorkspaceDependencyToolCall(payload, environment, platform, architecture).pipe(
        Effect.tap((response) => Queue.offer(calls, response)),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
    );
    yield* client.handleServerNotification("turn/completed", (payload) =>
      Queue.offer(completedTurns, payload).pipe(Effect.asVoid),
    );

    yield* client.request("initialize", buildCodexInitializeParams());
    yield* client.notify("initialized", undefined);
    const started = yield* client.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      dynamicTools: workspaceDependencyDynamicTools,
    });
    const threadId = started.thread.id;

    const startTurn = (text: string) =>
      client.request("turn/start", {
        threadId,
        input: [{ type: "text", text }],
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
    const verifyLoaderCall = Effect.fn("verifyLoaderCall")(function* (phase: string) {
      const response = yield* Queue.take(calls);
      const completed = yield* Queue.take(completedTurns);
      if (!response.success || completed.turn.status !== "completed") {
        return yield* new WorkspaceDependencyProbeError({ phase });
      }
    });

    yield* startTurn(
      "Call codex_app.load_workspace_dependencies exactly once, then reply with only its bundle version.",
    );
    yield* verifyLoaderCall("fresh-loader-call");

    yield* client.request("thread/resume", {
      threadId,
      cwd,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
    });
    yield* startTurn(
      "After this resume, call codex_app.load_workspace_dependencies exactly once, then reply with only its bundle version.",
    );
    yield* verifyLoaderCall("resumed-loader-call");

    yield* startTurn(
      `Use the installed spreadsheet skill and the bundled artifact runtime to create ${workbookPath}. The workbook must contain a sheet named Probe with the exact text T3_WORKSPACE_DEPENDENCY_PROBE in cell A1. Do not use a fallback workbook library.`,
    );
    const artifactCall = yield* Queue.take(calls);
    const artifactTurn = yield* Queue.take(completedTurns);
    const workbook = yield* fileSystem
      .readFile(workbookPath)
      .pipe(
        Effect.mapError(() => new WorkspaceDependencyProbeError({ phase: "workbook-missing" })),
      );
    if (
      !artifactCall.success ||
      artifactTurn.turn.status !== "completed" ||
      workbook[0] !== 0x50 ||
      workbook[1] !== 0x4b
    ) {
      return yield* new WorkspaceDependencyProbeError({ phase: "spreadsheet-artifact" });
    }

    yield* Console.log("LIVE_WORKSPACE_DEPENDENCY_PROBE_OK", {
      freshCallSuccess: true,
      resumedCallSuccess: true,
      spreadsheetArtifact: true,
      threadId,
    });
  }).pipe(Effect.provide(CodexClient.layerChildProcess(handle)));
}).pipe(Effect.timeout("8 minutes"));

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
