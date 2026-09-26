import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ExtensionOperationError,
  ProjectId,
  ProviderInstanceId,
  type AgentSessionImportSource,
  type AgentSessionScanError,
  type ThreadId,
} from "@t3tools/contracts";
import {
  AGENT_SESSION_TITLE_MAX_LENGTH,
  AGENT_SESSIONS_SCAN_CAP,
  agentSessionsApi,
  type AgentSessionImportReceipt,
  type AgentSessionSummary,
  type AgentSessionsScanResult,
} from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiInvocationMetadata, HostApiProvider } from "@t3tools/extension-runtime";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../persistence/Services/ProjectionProjects.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../persistence/Services/ProjectionThreads.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import {
  importAgentSessionThread,
  importedAgentSessionThreadId,
} from "../project/AgentSessionImporter.ts";
import {
  AgentSessionScanner,
  type AgentSessionRecentThread,
} from "../project/AgentSessionScanner.ts";
import { makeExtensionScopeResolver } from "./scope.ts";

const fail = (detail: string) =>
  new ExtensionOperationError({ operation: "agent-sessions", detail });
const isOperationError = Schema.is(ExtensionOperationError);
const decodeScan = Schema.decodeUnknownSync(Schema.Struct({}), { onExcessProperty: "error" });
/** Mirrors the contract's key schema; ids outside it are never listed, so never importable. */
const SessionKey = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  providerSessionId: Schema.String.check(
    Schema.isMaxLength(128),
    Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  ),
});
const decodeKey = Schema.decodeUnknownSync(SessionKey, { onExcessProperty: "error" });
const isListableKey = Schema.is(SessionKey);

type ScopeDependencies = Parameters<typeof makeExtensionScopeResolver>[0];
type Dependencies = Omit<ScopeDependencies, "threads"> & {
  readonly threads: {
    getById(input: {
      threadId: ThreadId;
    }): Effect.Effect<
      Option.Option<
        Pick<ProjectionThread, "projectId" | "worktreePath" | "deletedAt" | "title" | "updatedAt">
      >,
      ProjectionRepositoryError
    >;
  };
  readonly recentThreads: (
    workspaceRoot: string,
    projectId: ProjectId,
  ) => Stream.Stream<AgentSessionRecentThread, AgentSessionScanError | ProjectionRepositoryError>;
  readonly importThread: (
    input: Parameters<typeof importAgentSessionThread>[0],
  ) => Effect.Effect<
    { readonly sequence: number | null },
    Effect.Error<ReturnType<typeof importAgentSessionThread>>
  >;
};

const sameKey = (source: AgentSessionImportSource, key: typeof SessionKey.Type) =>
  source.providerInstanceId === key.providerInstanceId &&
  source.providerSessionId === key.providerSessionId;

const rejected = (
  error: Extract<AgentSessionImportReceipt, { status: "rejected" }>["error"],
  threadId: string | null = null,
): AgentSessionImportReceipt => ({
  status: "rejected",
  threadId,
  sequence: null,
  messageCount: 0,
  error,
});

export function createAgentSessionsApiProvider(deps: Dependencies): HostApiProvider {
  const resolve = makeExtensionScopeResolver(deps);
  // One import at a time: a double-click must see the first thread, not race a second create.
  const importLock = Semaphore.makeUnsafe(1);

  const guard = async (
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
    scope: typeof AuthOrchestrationReadScope | typeof AuthOrchestrationOperateScope,
  ) => {
    signal.throwIfAborted();
    if (
      metadata.principal?.environmentId !== deps.environmentId ||
      !metadata.principal.scopes.includes(scope)
    )
      throw fail(`AgentSessionsAuthorityDenied: ${scope}`);
    await metadata.assertAuthority?.();
  };

  /** The caller's project and its root, derived only from the view context. */
  const project = Effect.fn("AgentSessionsApi.project")(function* (context: ViewContext) {
    const scope = yield* resolve(context);
    const projectId = ProjectId.make(scope.context.resource.projectId!);
    const found = yield* deps.projects
      .getById({ projectId })
      .pipe(Effect.mapError(() => fail("Cannot resolve extension project.")));
    if (Option.isNone(found) || found.value.deletedAt !== null)
      return yield* fail("Extension project is unavailable.");
    return { projectId, workspaceRoot: found.value.workspaceRoot };
  });

  const summarize = Effect.fn("AgentSessionsApi.summarize")(function* (
    projectId: ProjectId,
    outcome: AgentSessionRecentThread,
  ) {
    if (outcome._tag === "Skipped") return "skipped" as const;
    if (outcome._tag === "Duplicate" || !isListableKey(outcome.source)) {
      return outcome._tag === "Duplicate" ? null : ("skipped" as const);
    }
    const threadId = importedAgentSessionThreadId(
      outcome.source.providerInstanceId,
      outcome.source.providerSessionId,
    );
    const existing = yield* deps.threads
      .getById({ threadId })
      .pipe(Effect.mapError(() => fail("Cannot resolve imported threads.")));
    // Same rules import applies: another project's session is not this caller's to list.
    if (Option.isSome(existing) && existing.value.projectId !== projectId) return null;
    const imported = Option.isSome(existing);
    if (outcome._tag === "AlreadyImported" && !imported) return null;
    const title =
      outcome._tag === "Importable" ? outcome.thread.title : Option.getOrThrow(existing).title;
    const lastActiveAt =
      outcome._tag === "Importable"
        ? outcome.thread.updatedAt
        : outcome.source.mtimeMs === null
          ? Option.getOrThrow(existing).updatedAt
          : DateTime.formatIso(DateTime.makeUnsafe(outcome.source.mtimeMs));
    const summary: AgentSessionSummary = {
      providerInstanceId: outcome.source.providerInstanceId,
      providerSessionId: outcome.source.providerSessionId,
      source: outcome.source.provider,
      title: title.trim().slice(0, AGENT_SESSION_TITLE_MAX_LENGTH) || "Untitled session",
      lastActiveAt,
      status: imported ? "imported" : "importable",
      threadId: imported ? threadId : null,
    };
    return summary;
  });

  const scan = Effect.fn("AgentSessionsApi.scan")(function* (context: ViewContext) {
    const { projectId, workspaceRoot } = yield* project(context);
    let skipped = 0;
    const listed = yield* deps.recentThreads(workspaceRoot, projectId).pipe(
      Stream.mapError(() => fail("AgentSessionScanUnavailable")),
      Stream.mapEffect((outcome) => summarize(projectId, outcome)),
      Stream.filter((entry): entry is AgentSessionSummary => {
        if (entry === "skipped") skipped += 1;
        return typeof entry === "object" && entry !== null;
      }),
      Stream.take(AGENT_SESSIONS_SCAN_CAP + 1),
      Stream.runCollect,
    );
    return {
      scope: "project",
      sessions: listed.slice(0, AGENT_SESSIONS_SCAN_CAP),
      truncated: listed.length > AGENT_SESSIONS_SCAN_CAP,
      skipped,
      scannedAt: DateTime.formatIso(yield* DateTime.now),
    } satisfies AgentSessionsScanResult;
  });

  const importSession = Effect.fn("AgentSessionsApi.import")(function* (
    key: typeof SessionKey.Type,
    context: ViewContext,
    recheck: () => Promise<void>,
  ) {
    const { projectId, workspaceRoot } = yield* project(context);
    const threadId = importedAgentSessionThreadId(key.providerInstanceId, key.providerSessionId);
    const existing = yield* deps.threads
      .getById({ threadId })
      .pipe(Effect.mapError(() => fail("Cannot resolve imported threads.")));
    if (Option.isSome(existing)) {
      // Another project's thread id is not disclosed to this caller.
      return existing.value.projectId === projectId
        ? rejected("AgentSessionAlreadyImported", threadId)
        : rejected("AgentSessionProjectConflict");
    }
    // The pack's key is only a name: the host re-discovers it inside this project's root.
    const found = yield* deps.recentThreads(workspaceRoot, projectId).pipe(
      Stream.mapError(() => fail("AgentSessionScanUnavailable")),
      Stream.filter(
        (outcome) =>
          outcome._tag !== "Skipped" &&
          outcome._tag !== "Duplicate" &&
          sameKey(outcome.source, key),
      ),
      Stream.runHead,
    );
    if (Option.isNone(found)) return rejected("AgentSessionOutOfScope");
    const outcome = found.value;
    if (outcome._tag !== "Importable") return rejected("AgentSessionAlreadyImported", threadId);
    yield* Effect.tryPromise({
      try: recheck,
      catch: (cause) => (isOperationError(cause) ? cause : fail("AgentSessionsAuthorityDenied")),
    });
    const result = yield* deps
      .importThread({ projectId, workspaceRoot, thread: outcome.thread, source: outcome.source })
      .pipe(Effect.exit);
    if (Exit.isFailure(result)) return rejected("AgentSessionImportRejected");
    if (result.value.sequence === null) return rejected("AgentSessionAlreadyImported", threadId);
    return {
      status: "imported",
      threadId,
      sequence: result.value.sequence,
      messageCount: outcome.thread.messages.length,
      error: null,
    } satisfies AgentSessionImportReceipt;
  });

  return {
    providerId: "host.agent-sessions",
    definition: agentSessionsApi.definition,
    requiresRootAuthority: true,
    async invoke(method, input, context, signal, metadata) {
      if (method === "scan") {
        await guard(context, signal, metadata, AuthOrchestrationReadScope);
        try {
          decodeScan(input);
        } catch {
          throw fail("AgentSessionMalformedSource");
        }
        return await Effect.runPromise(scan(context), { signal });
      }
      if (method === "import") {
        await guard(context, signal, metadata, AuthOrchestrationOperateScope);
        let key: typeof SessionKey.Type;
        try {
          key = decodeKey(input);
        } catch {
          throw fail("AgentSessionMalformedSource");
        }
        const recheck = () => guard(context, signal, metadata, AuthOrchestrationOperateScope);
        return await Effect.runPromise(
          importLock.withPermits(1)(importSession(key, context, recheck)),
          { signal },
        );
      }
      throw fail(`AgentSessionsUnsupported: ${method}`);
    },
  };
}

export const makeAgentSessionsApiProvider = Effect.fn("AgentSessionsApi.make")(function* () {
  const environment = yield* ServerEnvironment;
  const scanner = yield* AgentSessionScanner;
  const snapshots = yield* ProjectionSnapshotQuery;
  const importServices = yield* Effect.context<
    OrchestrationEngineService | ProjectionSnapshotQuery | ProviderSessionDirectory | Crypto.Crypto
  >();
  return createAgentSessionsApiProvider({
    environmentId: yield* environment.getEnvironmentId,
    projects: yield* ProjectionProjectRepository,
    threads: yield* ProjectionThreadRepository,
    recentThreads: (workspaceRoot, projectId) =>
      Stream.unwrap(
        snapshots.getImportedAgentSessionSources(projectId).pipe(
          Effect.map((completed) =>
            scanner.recentThreads(
              workspaceRoot,
              completed.map((entry) => entry.source),
            ),
          ),
        ),
      ),
    importThread: (input) =>
      importAgentSessionThread(input).pipe(Effect.provideContext(importServices)),
  });
});
