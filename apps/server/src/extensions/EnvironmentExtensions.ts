import {
  ExtensionInstallation,
  ExtensionOperationError,
  type ExtensionInstallInput,
  type ExtensionManageInput,
  type ExtensionInvokeInput,
} from "@t3tools/contracts";
import { createExtensionRuntime } from "@t3tools/extension-runtime";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ToolDescriptor } from "@t3tools/extension-sdk/environment";
import {
  WORKSPACE_READ_TEXT,
  validateWorkspaceReadTextInput,
} from "@t3tools/extension-sdk/workspace";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { WorkspaceFileSystem } from "../workspace/WorkspaceFileSystem.ts";
import { makeExtensionScopeResolver } from "./scope.ts";
import { boundedWorkspaceText } from "./workspaceText.ts";

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

type Runtime = Awaited<ReturnType<typeof createExtensionRuntime>>;
export interface InstalledTool {
  readonly installationId: string;
  readonly contentHash: string;
  readonly descriptor: ToolDescriptor;
}
const operationError = (operation: string, cause: unknown) =>
  new ExtensionOperationError({
    operation,
    detail: (cause instanceof Error ? cause.message : "Extension operation failed.").slice(0, 512),
  });
const installation = Schema.decodeUnknownSync(ExtensionInstallation);

export const make = Effect.fn("EnvironmentExtensions.make")(function* (
  factory: typeof createExtensionRuntime = createExtensionRuntime,
) {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const projects = yield* ProjectionProjectRepository;
  const threads = yield* ProjectionThreadRepository;
  const workspace = yield* WorkspaceFileSystem;
  const resolve = makeExtensionScopeResolver({ environmentId, projects, threads });
  const read = Effect.fn("EnvironmentExtensions.readWorkspace")(function* (
    input: unknown,
    context: ViewContext,
  ) {
    const safe = yield* Effect.try({
      try: () => validateWorkspaceReadTextInput(input),
      catch: (cause) => operationError("workspace.read", cause),
    });
    const scope = yield* resolve(context);
    const result = yield* workspace
      .readFile({ cwd: scope.cwd, relativePath: safe.relativePath })
      .pipe(
        Effect.mapError(() =>
          operationError(
            "workspace.read",
            new Error("Workspace file cannot be read within the granted project."),
          ),
        ),
      );
    yield* resolve(scope.context);
    return yield* Effect.try({
      try: () => boundedWorkspaceText(result),
      catch: (cause) => operationError("workspace.read", cause),
    });
  });
  let initializationError: ExtensionOperationError | undefined;
  const runtime = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        factory({
          rootDir: path.join(config.stateDir, "extensions"),
          environmentId,
          ...(import.meta.url.endsWith(".mjs")
            ? { workerUrl: new URL("./extension-worker.mjs", import.meta.url) }
            : {}),
          services: [
            {
              capability: WORKSPACE_READ_TEXT,
              invoke: (input, context, signal) =>
                Effect.runPromise(read(input, context), { signal }),
            },
          ],
          authorize: async (entry, capability, context) => {
            if (
              capability !== WORKSPACE_READ_TEXT ||
              !entry.enabled ||
              !entry.grants.capabilities.includes(capability) ||
              !context.resource.projectId ||
              !entry.grants.projectIds.includes(context.resource.projectId)
            )
              return false;
            return Effect.runPromise(
              resolve(context).pipe(
                Effect.as(true),
                Effect.catch(() => Effect.succeed(false)),
              ),
            );
          },
          timeoutMs: 15000,
        }),
      catch: (cause) => operationError("initialize", cause),
    }),
    (runtime) =>
      Effect.tryPromise({
        try: () => runtime.dispose(),
        catch: (cause) => operationError("dispose", cause),
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Extension runtime cleanup failed", { detail: error.detail }),
        ),
      ),
  ).pipe(
    Effect.catch((error) => {
      initializationError = error;
      return Effect.logWarning("Extension runtime unavailable; core server remains active", {
        detail: error.detail,
      }).pipe(Effect.as(undefined));
    }),
  );
  if (!runtime) {
    const unavailable = Effect.fail(
      initializationError ??
        operationError("initialize", new Error("Extension runtime unavailable.")),
    );
    return {
      list: unavailable,
      install: (_input: ExtensionInstallInput) => unavailable,
      manage: (_input: ExtensionManageInput) => unavailable,
      client: (_id: string, _hash: string) => unavailable,
      invoke: (_input: ExtensionInvokeInput) => unavailable,
      contextForThread: (_threadId: string, _environmentId: string) => unavailable,
      tools: (_context: ViewContext) => unavailable,
    };
  }
  const promise = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (cause) => operationError(operation, cause) });
  const list = Effect.try({
    try: () => runtime.list().map((entry) => installation(entry)),
    catch: (cause) => operationError("list", cause),
  });
  const verifyClient = (id: string, expectedContentHash: string) => {
    const entry = runtime.list().find((item) => item.id === id);
    if (!entry?.enabled || entry.contentHash !== expectedContentHash)
      throw new Error("Extension client is unavailable or its installed content changed.");
  };
  return {
    list,
    install: (input: ExtensionInstallInput) =>
      promise("install", async () => {
        if (input.trusted !== true) throw new Error("Trusted-code confirmation is required.");
        return installation(
          await runtime.install(input.sourceDir, {
            capabilities: input.capabilities,
            projectIds: input.projectIds,
          }),
        );
      }),
    manage: (input: ExtensionManageInput) =>
      promise("manage", async () => {
        if (input.action === "remove") {
          await runtime.remove(input.id);
          return null;
        }
        if (input.action === "update") {
          if (input.trusted !== true || !input.sourceDir)
            throw new Error("Update requires a source directory and trusted-code confirmation.");
          return installation(await runtime.update(input.id, input.sourceDir));
        }
        return installation(await runtime[input.action](input.id));
      }),
    client: (id: string, expectedContentHash: string) =>
      promise("client", async () => {
        verifyClient(id, expectedContentHash);
        const result = await runtime.readClient(id);
        verifyClient(id, expectedContentHash);
        if (result.contentHash !== expectedContentHash)
          throw new Error("Extension client content changed.");
        return result;
      }),
    invoke: Effect.fn("EnvironmentExtensions.invoke")(function* (input: ExtensionInvokeInput) {
      const scope = yield* resolve(input.context);
      const result = yield* promise("invoke", (signal) =>
        runtime.invoke(input.toolId, input.input, scope.context, signal, input.expectedContentHash),
      );
      yield* resolve(scope.context);
      return yield* decodeJson(result).pipe(
        Effect.mapError((cause) => operationError("invoke", cause)),
      );
    }),
    contextForThread: Effect.fn("EnvironmentExtensions.contextForThread")(function* (
      threadId: string,
      invokedEnvironmentId: string,
    ) {
      return (yield* resolve(
        {
          resource: {
            namespace: "t3.extensions",
            id: threadId,
            environmentId: invokedEnvironmentId,
            threadId,
          },
          client: "mcp",
        },
        true,
      )).context;
    }),
    tools: Effect.fn("EnvironmentExtensions.tools")(function* (context: ViewContext) {
      const scope = yield* resolve(context);
      const projectId = scope.context.resource.projectId;
      return yield* Effect.try({
        try: () =>
          runtime
            .list()
            .filter(
              (entry) =>
                entry.enabled &&
                projectId !== undefined &&
                entry.grants.projectIds.includes(projectId),
            )
            .flatMap((entry) =>
              entry.package.tools
                .filter(
                  (tool) =>
                    tool.readOnly &&
                    tool.capabilities.every(
                      (capability) =>
                        capability === WORKSPACE_READ_TEXT &&
                        entry.grants.capabilities.includes(capability),
                    ),
                )
                .map((descriptor) => ({
                  installationId: entry.id,
                  contentHash: entry.contentHash,
                  descriptor,
                })),
            ),
        catch: (cause) => operationError("tools", cause),
      });
    }),
  };
});

export class EnvironmentExtensions extends Context.Service<
  EnvironmentExtensions,
  Effect.Success<ReturnType<typeof make>>
>()("t3/extensions/EnvironmentExtensions") {}
export const layer = Layer.effect(EnvironmentExtensions, make());
export type ExtensionRuntime = Runtime;
