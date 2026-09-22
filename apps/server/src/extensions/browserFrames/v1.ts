/**
 * `t3.browser/frames@1.0.0` — remote pixel transport capability.
 *
 * This adapter mints lease-bound tickets only; frames and input packets move
 * over `/api/browser-frames/*` (BrowserFrameProxy), never through the invoke
 * channel. Session existence is checked against PreviewManager; the owning
 * engine host is resolved through the broker's advertised frame hubs. Actions
 * stay on `t3.browser/sessions` — nothing here dispatches browser commands.
 */
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
  ExtensionOperationError,
  PreviewTabId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import {
  browserFramesApi,
  type BrowserFrameInputLease,
  type BrowserFramesCapabilities,
  type BrowserFrameStreamDescriptor,
} from "@t3tools/extension-sdk/catalogue";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  HostApiInvocationMetadata,
  HostApiPrincipal,
  HostApiProvider,
} from "@t3tools/extension-runtime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../../persistence/Services/ProjectionThreads.ts";
import * as PreviewManager from "../../preview/Manager.ts";
import { PreviewAutomationBroker } from "../../mcp/PreviewAutomationBroker.ts";
import { BrowserFrameLeases } from "../../browserFrames/BrowserFrameLeases.ts";
import { BROWSER_FRAMES_ROUTE_PREFIX } from "../../browserFrames/BrowserFrameProxy.ts";
import { makeExtensionScopeResolver } from "../scope.ts";

const OPERATION = "browser.frames";
const INPUT_PATHS = { input: "input" } as const;

const failure = (operation: string, detail: string) =>
  new ExtensionOperationError({ operation, detail });
const named = (operation: string, name: string, detail: string) =>
  failure(operation, `${name}: ${detail}`);
const isOperationError = Schema.is(ExtensionOperationError);
const operationError = (operation: string) => (cause: unknown) => {
  if (isOperationError(cause)) return cause;
  const message = cause instanceof Error ? cause.message : "Browser frames operation failed.";
  return failure(operation, message.slice(0, 512));
};

const EmptyInput = Schema.Record(Schema.String, Schema.Never);
const decodeReadInput = Schema.decodeUnknownEffect(EmptyInput, { onExcessProperty: "error" });
const decodeTargetInput = Schema.decodeUnknownEffect(
  Schema.Struct({
    tabId: PreviewTabId,
    serverEpoch: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    expectedEngineGeneration: Schema.optional(
      Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
    ),
  }),
  { onExcessProperty: "error" },
);
const decodeLeaseInput = Schema.decodeUnknownEffect(
  Schema.Struct({ leaseId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)) }),
  { onExcessProperty: "error" },
);

const sessionPath = (tabId: string, leaf: string) =>
  `${BROWSER_FRAMES_ROUTE_PREFIX}/sessions/${encodeURIComponent(tabId)}/${leaf}`;

export function createBrowserFramesApiProvider(
  dependencies: Parameters<typeof makeExtensionScopeResolver>[0] & {
    readonly preview: Pick<PreviewManager.PreviewManager["Service"], "listDetails">;
    readonly leases: BrowserFrameLeases["Service"];
    readonly broker: Pick<PreviewAutomationBroker["Service"], "frameHubs">;
  },
): HostApiProvider {
  const resolve = makeExtensionScopeResolver(dependencies);

  const authorized = (principal: HostApiPrincipal | undefined, write: boolean) =>
    principal !== undefined &&
    principal.environmentId === dependencies.environmentId &&
    principal.scopes.includes(AuthOrchestrationReadScope) &&
    (!write || principal.scopes.includes(AuthOrchestrationOperateScope));

  const invoke = (
    method: string,
    input: unknown,
    context: ViewContext,
    signal: AbortSignal,
    metadata: HostApiInvocationMetadata,
  ): Effect.Effect<Json, ExtensionOperationError> =>
    Effect.gen(function* () {
      signal.throwIfAborted();
      const operation = `${OPERATION}.${method}`;
      const principal = metadata.principal;
      const write = method === "openInput" || method === "closeInput";
      if (!authorized(principal, write) || !metadata.assertAuthority || principal === undefined) {
        return yield* failure(operation, "Browser frames authority is unavailable.");
      }
      yield* Effect.tryPromise({
        try: () => metadata.assertAuthority?.() ?? Promise.resolve(),
        catch: () => failure(operation, "Browser frames authority was revoked."),
      });
      const scope = yield* resolve(context);
      const threadIdRaw = scope.context.resource.threadId;
      if (!threadIdRaw) {
        return yield* failure(operation, "Browser frames require a thread-scoped context.");
      }
      const threadId = ThreadId.make(threadIdRaw);

      if (method === "getCapabilities") {
        yield* decodeReadInput(input).pipe(
          Effect.mapError(() =>
            named(
              operation,
              "BrowserFramesInputError",
              "getCapabilities input fails the declared schema.",
            ),
          ),
        );
        const hubs = (yield* dependencies.broker.frameHubs.pipe(
          Effect.mapError(operationError(operation)),
        )).filter((hub) => hub.environmentId === dependencies.environmentId);
        return {
          metadata: { supported: true },
          stream:
            hubs.length > 0
              ? { supported: true }
              : { supported: false, reason: "engine-unavailable" },
          input: { supported: hubs.length > 0 },
        } satisfies BrowserFramesCapabilities;
      }

      const requireSession = Effect.fn("BrowserFrames.requireSession")(function* (target: {
        readonly tabId: string;
        readonly serverEpoch: string;
      }) {
        const listed = yield* dependencies.preview
          .listDetails({ threadId })
          .pipe(Effect.mapError(operationError(operation)));
        if (target.serverEpoch !== listed.serverEpoch) {
          return yield* named(
            operation,
            "BrowserStaleServerEpoch",
            "the request epoch does not match the live session epoch.",
          );
        }
        const detail = listed.sessions.find((entry) => entry.snapshot.tabId === target.tabId);
        if (!detail) {
          return yield* named(
            operation,
            "BrowserSessionNotFound",
            "no live browser session matches tabId.",
          );
        }
        const hubs = (yield* dependencies.broker.frameHubs.pipe(
          Effect.mapError(operationError(operation)),
        )).filter((hub) => hub.environmentId === dependencies.environmentId);
        if (hubs.length === 0) {
          return yield* named(
            operation,
            "BrowserEngineUnavailable",
            "no connected engine host serves browser frames.",
          );
        }
        return { hostClientId: hubs.length === 1 ? (hubs[0]?.clientId ?? null) : null };
      });

      if (method === "openStream") {
        const target = yield* decodeTargetInput(input).pipe(
          Effect.mapError(() =>
            named(
              operation,
              "BrowserFramesInputError",
              "openStream input fails the declared schema.",
            ),
          ),
        );
        const { hostClientId } = yield* requireSession(target);
        const issued = yield* dependencies.leases.issueStreamTicket({
          principal: principal.id,
          scopes: principal.scopes,
          session: {
            environmentId: EnvironmentId.make(dependencies.environmentId),
            threadId,
            serverEpoch: target.serverEpoch,
            tabId: target.tabId,
          },
          engineGeneration: target.expectedEngineGeneration ?? null,
          hostClientId,
        });
        return {
          session: {
            environmentId: dependencies.environmentId,
            threadId,
            serverEpoch: target.serverEpoch,
            tabId: target.tabId,
            engineGeneration: target.expectedEngineGeneration ?? null,
          },
          hostId: hostClientId,
          paths: {
            stream: sessionPath(target.tabId, "stream.mjpeg"),
            snapshot: sessionPath(target.tabId, "snapshot"),
            config: sessionPath(target.tabId, "config"),
          },
          ticket: issued.ticket,
          expiresAt: issued.expiresAt,
        } satisfies BrowserFrameStreamDescriptor;
      }

      if (method === "openInput") {
        const target = yield* decodeTargetInput(input).pipe(
          Effect.mapError(() =>
            named(
              operation,
              "BrowserFramesInputError",
              "openInput input fails the declared schema.",
            ),
          ),
        );
        const { hostClientId } = yield* requireSession(target);
        const issued = yield* dependencies.leases.issueInputLease({
          principal: principal.id,
          scopes: principal.scopes,
          session: {
            environmentId: EnvironmentId.make(dependencies.environmentId),
            threadId,
            serverEpoch: target.serverEpoch,
            tabId: target.tabId,
          },
          engineGeneration: target.expectedEngineGeneration ?? null,
          hostClientId,
        });
        return {
          leaseId: issued.leaseId,
          inputTicket: issued.inputTicket,
          expiresAt: issued.expiresAt,
          paths: { input: sessionPath(target.tabId, INPUT_PATHS.input) },
        } satisfies BrowserFrameInputLease;
      }

      if (method === "closeInput") {
        const decoded = yield* decodeLeaseInput(input).pipe(
          Effect.mapError(() =>
            named(
              operation,
              "BrowserFramesInputError",
              "closeInput input fails the declared schema.",
            ),
          ),
        );
        const lease = yield* dependencies.leases.resolveLease(decoded.leaseId);
        if (Option.isSome(lease) && lease.value.principal === principal.id) {
          yield* dependencies.leases.revokeLease(decoded.leaseId);
          return { closed: true };
        }
        return { closed: false };
      }

      return yield* named(operation, "BrowserFramesUnknownMethod", `unknown method '${method}'.`);
    }).pipe(Effect.mapError(operationError(`${OPERATION}.${method}`)));

  return {
    providerId: "t3.host-browser-frames",
    definition: browserFramesApi.definition,
    requiresRootAuthority: true,
    invoke: (method, input, context, signal, metadata) =>
      Effect.runPromise(invoke(method, input, context, signal, metadata), { signal }),
  };
}

export const makeBrowserFramesApiProvider = Effect.fn("BrowserFramesApi.make")(function* () {
  const environment = yield* ServerEnvironment;
  return createBrowserFramesApiProvider({
    environmentId: yield* environment.getEnvironmentId,
    projects: yield* ProjectionProjectRepository,
    threads: yield* ProjectionThreadRepository,
    preview: yield* PreviewManager.PreviewManager,
    leases: yield* BrowserFrameLeases,
    broker: yield* PreviewAutomationBroker,
  });
});
