import { AuthTerminalOperateScope, ExtensionOperationError } from "@t3tools/contracts";
import { TERMINAL_SESSIONS_API } from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiProvider } from "@t3tools/extension-runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { makeExtensionScopeResolver } from "./scope.ts";

const inspectInput = Schema.decodeUnknownSync(
  Schema.Struct({
    terminalId: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  }),
  { onExcessProperty: "error" },
);
const failure = (detail: string) =>
  new ExtensionOperationError({ operation: "terminal.api", detail });

export function createTerminalApiProvider(
  dependencies: Parameters<typeof makeExtensionScopeResolver>[0] & {
    readonly terminal: Pick<TerminalManager["Service"], "inspect">;
  },
): HostApiProvider {
  const resolve = makeExtensionScopeResolver(dependencies);
  const invoke = Effect.fn("TerminalApi.invoke")(function* (
    method: string,
    input: unknown,
    context: ViewContext,
    signal: AbortSignal,
    principal: { readonly environmentId: string; readonly scopes: readonly string[] } | undefined,
  ) {
    signal.throwIfAborted();
    if (method !== "inspect") return yield* failure("Terminal API method is unavailable.");
    if (
      !principal ||
      principal.environmentId !== dependencies.environmentId ||
      !principal.scopes.includes(AuthTerminalOperateScope)
    )
      return yield* failure("Terminal authority is unavailable.");
    if (!context.resource.threadId) return yield* failure("Terminal API requires a thread scope.");
    const safe = yield* Effect.try({
      try: () => inspectInput(input),
      catch: () => failure("Invalid terminal inspection request."),
    });
    const scope = yield* resolve(context);
    const metadata = yield* dependencies.terminal
      .inspect({
        threadId: context.resource.threadId,
        terminalId: safe.terminalId,
      })
      .pipe(Effect.catchCause(() => failure("Terminal session cannot be inspected.")));
    signal.throwIfAborted();
    const result =
      metadata === null
        ? null
        : metadata.threadId !== context.resource.threadId ||
            metadata.terminalId !== safe.terminalId ||
            metadata.cwd !== scope.cwd ||
            metadata.worktreePath !== scope.worktreePath
          ? yield* failure("Terminal session is unavailable in the requested workspace.")
          : metadata.label.length > 128 || metadata.updatedAt.length > 64
            ? yield* failure("Terminal metadata exceeds the public bounds.")
            : {
                terminalId: metadata.terminalId,
                status: metadata.status,
                label: metadata.label,
                hasRunningSubprocess: metadata.hasRunningSubprocess,
                exitCode: metadata.exitCode,
                exitSignal: metadata.exitSignal,
                updatedAt: metadata.updatedAt,
              };
    yield* resolve(scope.context);
    signal.throwIfAborted();
    return result;
  });
  return {
    providerId: "t3.host-terminal",
    definition: TERMINAL_SESSIONS_API,
    requiresRootAuthority: true,
    invoke: (method, input, context, signal, metadata) =>
      Effect.runPromise(invoke(method, input, context, signal, metadata.principal), { signal }),
  };
}

export const makeTerminalApiProvider = Effect.fn("TerminalApi.make")(function* () {
  const environment = yield* ServerEnvironment;
  return createTerminalApiProvider({
    environmentId: yield* environment.getEnvironmentId,
    projects: yield* ProjectionProjectRepository,
    threads: yield* ProjectionThreadRepository,
    terminal: yield* TerminalManager,
  });
});
