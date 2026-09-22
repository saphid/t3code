import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ExtensionOperationError,
  ProjectId,
  ThreadId,
  extensionWorkspaceRevision,
} from "@t3tools/contracts";
import { BROWSER_FRAMES, BROWSER_SESSIONS } from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { HostApiInvocationMetadata, HostApiProvider } from "@t3tools/extension-runtime";
import { describe, expect, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  BrowserFrameLeases,
  layer as BrowserFrameLeasesLayer,
  type BrowserFrameAuthority,
} from "../../browserFrames/BrowserFrameLeases.ts";
import { createBrowserFramesApiProvider } from "./v1.ts";

const isOperationError = Schema.is(ExtensionOperationError);
const signal = new AbortController().signal;
const ENV_ID = "env";
const PROJECT_ID = "project";
const THREAD_ID = "thread";
const WORKSPACE = "/repo/workspace";
const CLAIM_EXPIRES = 4_102_444_800_000;

class InvokeRejection extends Data.TaggedError("InvokeRejection")<{
  readonly cause: unknown;
}> {}

const context = (): ViewContext => ({
  resource: {
    namespace: "test.extension",
    id: "view",
    environmentId: ENV_ID,
    projectId: PROJECT_ID,
    threadId: THREAD_ID,
  },
  client: "test",
  workspaceRevision: extensionWorkspaceRevision(WORKSPACE, null),
});

const meta = (
  provider: HostApiProvider,
  options: { readonly callerId?: string } = {},
): HostApiInvocationMetadata => ({
  callId: "call",
  rootCallerId: "root",
  callerId: options.callerId ?? "caller",
  providerId: provider.providerId,
  providerGeneration: 1,
  callerGenerations: [],
  principal: {
    kind: "environment-session" as const,
    id: "session",
    environmentId: ENV_ID,
    scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
  },
  assertAuthority: async () => {},
});

/** The authority the provider builds from `meta` + the resolved context. */
const providerAuthority = (callerId = "caller"): BrowserFrameAuthority => ({
  kind: "extension",
  principalKind: "environment-session",
  principalId: "session",
  rootCallerId: "root",
  callerId,
  callerGenerations: [],
  // `resolve` normalizes in place — with projectId/workspaceRevision already
  // correct, this object is the resolved scope context verbatim.
  context: context(),
  grants: [BROWSER_SESSIONS, BROWSER_FRAMES],
});

const makeDeps = (
  leases: BrowserFrameLeases["Service"],
  overrides: {
    readonly hubs?: ReadonlyArray<{
      readonly clientId: string;
      readonly connectionId: string;
      readonly environmentId: string;
      readonly origin: string;
      readonly secret: string;
    }>;
    readonly verifySurfaceClaims?: (
      token: string,
      expected: {
        readonly environmentId: string;
        readonly threadId: string;
        readonly tabId: string;
        readonly serverEpoch: string;
      },
    ) => Effect.Effect<{ readonly expiresAt: number } | null>;
  } = {},
): Parameters<typeof createBrowserFramesApiProvider>[0] => ({
  environmentId: ENV_ID,
  projects: {
    getById: () =>
      Effect.succeedSome({
        projectId: ProjectId.make(PROJECT_ID),
        workspaceRoot: WORKSPACE,
        deletedAt: null,
      }),
  },
  threads: {
    getById: () =>
      Effect.succeedSome({
        projectId: ProjectId.make(PROJECT_ID),
        worktreePath: null,
        deletedAt: null,
      }),
  },
  preview: {
    listDetails: () =>
      Effect.succeed({
        serverEpoch: "epoch-1",
        sessions: [{ snapshot: { tabId: "tab-1" } }],
      }),
  } as never,
  leases,
  broker: {
    frameHubs: Effect.succeed(
      overrides.hubs ?? [
        {
          clientId: "h",
          connectionId: "hc",
          environmentId: ENV_ID,
          origin: "http://127.0.0.1:49152",
          secret: "s",
        },
      ],
    ),
  } as never,
  verifySurfaceClaims:
    overrides.verifySurfaceClaims ?? (() => Effect.succeed({ expiresAt: CLAIM_EXPIRES })),
});

const LeasesLive = BrowserFrameLeasesLayer.pipe(Layer.provideMerge(NodeServices.layer));

const harness = Effect.gen(function* () {
  const leases = yield* BrowserFrameLeases;
  return { leases };
}).pipe(Effect.provide(LeasesLive));

const invoke = (
  provider: HostApiProvider,
  method: string,
  input: unknown,
  metadata?: HostApiInvocationMetadata,
) =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(
        provider.invoke(method, input as never, context(), signal, metadata ?? meta(provider)),
      ),
    catch: (cause) => new InvokeRejection({ cause }),
  });

const invokeError = (...args: Parameters<typeof invoke>) =>
  invoke(...args).pipe(
    Effect.flip,
    Effect.map((rejection) => {
      if (!isOperationError(rejection.cause)) throw rejection.cause;
      return rejection.cause;
    }),
  );

const openStreamInput = (surfaceLease = "tok-1") => ({
  tabId: "tab-1",
  serverEpoch: "epoch-1",
  surfaceLease,
});

describe("browser frames adapter", () => {
  it.effect("openStream denies a signed token that was never held", () =>
    Effect.gen(function* () {
      const { leases } = yield* harness;
      const provider = createBrowserFramesApiProvider(makeDeps(leases));
      const error = yield* invokeError(provider, "openStream", openStreamInput(), meta(provider));
      expect(error.detail).toContain("BrowserSurfaceClaimDenied");
    }),
  );

  it.effect("openStream denies a claim held by a different caller authority", () =>
    Effect.gen(function* () {
      const { leases } = yield* harness;
      const provider = createBrowserFramesApiProvider(makeDeps(leases));
      yield* leases.recordHeldSurfaceClaim({
        token: "tok-1",
        authority: providerAuthority("other-caller"),
        session: {
          environmentId: "env" as never,
          threadId: "thread" as never,
          serverEpoch: "epoch-1",
          tabId: "tab-1" as never,
        },
        allowedCommands: ["attach", "present", "release"],
        expiresAt: CLAIM_EXPIRES,
      });
      const error = yield* invokeError(provider, "openStream", openStreamInput(), meta(provider));
      expect(error.detail).toContain("BrowserSurfaceClaimDenied");
    }),
  );

  it.effect(
    "openStream mints a ticket bound to the sole canonical hub once the claim is held",
    () =>
      Effect.gen(function* () {
        const { leases } = yield* harness;
        const provider = createBrowserFramesApiProvider(makeDeps(leases));
        yield* leases.recordHeldSurfaceClaim({
          token: "tok-1",
          authority: providerAuthority(),
          session: {
            environmentId: "env" as never,
            threadId: "thread" as never,
            serverEpoch: "epoch-1",
            tabId: "tab-1" as never,
          },
          allowedCommands: ["attach", "present", "release"],
          expiresAt: CLAIM_EXPIRES,
        });
        const result = (yield* invoke(
          provider,
          "openStream",
          openStreamInput(),
          meta(provider),
        )) as {
          readonly ticket: string;
          readonly hostId: string;
          readonly expiresAt: number;
          readonly paths: { readonly stream: string };
        };
        expect(result.hostId).toBe("h");
        expect(result.ticket.startsWith("bfv1.st.")).toBe(true);
        // The minted credential never outlives the held claim.
        expect(result.expiresAt).toBeLessThanOrEqual(CLAIM_EXPIRES);
        expect(Option.isSome(yield* leases.verify(result.ticket))).toBe(true);
      }),
  );

  it.effect("openStream denies a held claim that lacks the present command", () =>
    Effect.gen(function* () {
      const { leases } = yield* harness;
      const provider = createBrowserFramesApiProvider(makeDeps(leases));
      yield* leases.recordHeldSurfaceClaim({
        token: "tok-1",
        authority: providerAuthority(),
        session: {
          environmentId: "env" as never,
          threadId: "thread" as never,
          serverEpoch: "epoch-1",
          tabId: "tab-1" as never,
        },
        allowedCommands: ["attach"],
        expiresAt: CLAIM_EXPIRES,
      });
      const error = yield* invokeError(provider, "openStream", openStreamInput(), meta(provider));
      expect(error.detail).toContain("BrowserSurfaceClaimDenied");
    }),
  );

  it.effect("capabilities stay honest when the engine host is ambiguous or unreachable", () =>
    Effect.gen(function* () {
      const { leases } = yield* harness;
      const ambiguous = createBrowserFramesApiProvider(
        makeDeps(leases, {
          hubs: [
            {
              clientId: "h1",
              connectionId: "c1",
              environmentId: ENV_ID,
              origin: "http://127.0.0.1:1",
              secret: "s",
            },
            {
              clientId: "h2",
              connectionId: "c2",
              environmentId: ENV_ID,
              origin: "http://127.0.0.1:2",
              secret: "s",
            },
          ],
        }),
      );
      const capabilities = (yield* invoke(ambiguous, "getCapabilities", {})) as {
        readonly stream: { readonly supported: boolean; readonly reason?: string };
        readonly input: { readonly supported: boolean };
      };
      expect(capabilities.stream).toEqual({ supported: false, reason: "engine-unavailable" });
      expect(capabilities.input.supported).toBe(false);

      // A non-canonical advertised origin never counts toward capability.
      const unreachable = createBrowserFramesApiProvider(
        makeDeps(leases, {
          hubs: [
            {
              clientId: "h",
              connectionId: "hc",
              environmentId: ENV_ID,
              origin: "http://127.0.0.1:1/private",
              secret: "s",
            },
          ],
        }),
      );
      const filtered = (yield* invoke(unreachable, "getCapabilities", {})) as {
        readonly stream: { readonly supported: boolean };
        readonly input: { readonly supported: boolean };
      };
      expect(filtered.stream.supported).toBe(false);
      expect(filtered.input.supported).toBe(false);
    }),
  );
});
