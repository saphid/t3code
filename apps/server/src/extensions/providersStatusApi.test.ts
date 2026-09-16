import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { HostApiInvocationMetadata } from "@t3tools/extension-runtime";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { createProvidersStatusApiProvider, projectProviderStatuses } from "./providersStatusApi.ts";

const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "1.2.3",
  status: "ready",
  auth: {
    status: "authenticated",
    type: "subscription",
    label: "private-account",
    email: "user@example.test",
  },
  checkedAt: "2026-01-01T00:00:00.000Z",
  message: "private diagnostic text",
  supportsTextGeneration: true,
  supportsConversationRollback: true,
  reportsContextWindow: true,
  models: [{ slug: "gpt-5.6", name: "GPT 5.6", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
  workspaceSnapshots: [
    { cwd: "/private/workspace", checkedAt: "x", slashCommands: [], skills: [] },
  ],
  ...overrides,
});

function fixture(updates: Queue.Queue<ReadonlyArray<ServerProvider>>, initial: ServerProvider[]) {
  let cwd = "/workspace";
  let allowed = true;
  let reads = 0;
  let detached = false;
  const projectId = ProjectId.make("project-a");
  const api = createProvidersStatusApiProvider({
    environmentId: "env-a",
    projects: {
      getById: () =>
        Effect.sync(() => Option.some({ projectId, workspaceRoot: cwd, deletedAt: null })),
    },
    threads: { getById: () => Effect.succeedNone },
    providers: {
      getProviders: Effect.sync(() => {
        reads++;
        return initial;
      }),
      streamChanges: Stream.fromQueue(updates).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            detached = true;
          }),
        ),
      ),
    },
  });
  const context: ViewContext = {
    client: "web",
    workspaceRevision: JSON.stringify(["/workspace", null]),
    resource: {
      namespace: "example.providers-status",
      id: "view",
      environmentId: "env-a",
      projectId,
    },
  };
  const metadata: HostApiInvocationMetadata = {
    callId: "call",
    callerId: "consumer",
    rootCallerId: "consumer",
    providerId: api.providerId,
    providerGeneration: 1,
    callerGenerations: [],
    principal: {
      kind: "environment-session",
      id: "session",
      environmentId: "env-a",
      scopes: ["orchestration:read"],
    },
    assertAuthority: async () => {
      if (!allowed) throw new Error("revoked");
    },
  };
  const controller = new AbortController();
  return {
    api,
    context,
    metadata,
    controller,
    stream: () =>
      api.subscribe!("subscribe", {}, context, controller.signal, metadata)[Symbol.asyncIterator](),
    emit: (providers: ReadonlyArray<ServerProvider>) => Queue.offer(updates, providers),
    reads: () => reads,
    detached: () => detached,
    revoke: () => {
      allowed = false;
    },
    move: () => {
      cwd = "/other";
    },
  };
}

const makeFixture = (initial: ServerProvider[] = [provider()]) =>
  Effect.gen(function* () {
    const updates = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();
    return fixture(updates, initial);
  });

it("projects identity, lifecycle and capability flags without credential-bearing fields", () => {
  const event = projectProviderStatuses([provider()]);
  expect(event).toEqual({
    kind: "snapshot",
    scope: "environment",
    providers: [
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        availability: "available",
        checkedAt: "2026-01-01T00:00:00.000Z",
        supportsConversationRollback: true,
        supportsTextGeneration: true,
        reportsContextWindow: true,
      },
    ],
  });
  expect(JSON.stringify(event)).not.toMatch(/private|user@example|workspace|version|subscription/);
  const unavailable = projectProviderStatuses([
    provider({ availability: "unavailable", enabled: false, installed: false }),
  ]);
  expect(unavailable.providers[0]?.availability).toBe("unavailable");
  expect(projectProviderStatuses([]).providers).toEqual([]);
});

it.effect("streams the initial snapshot then registry updates, and detaches on return", () =>
  Effect.gen(function* () {
    const f = yield* makeFixture();
    const stream = f.stream();
    expect((yield* Effect.promise(() => stream.next())).value?.value).toEqual(
      projectProviderStatuses([provider()]),
    );
    yield* f.emit([provider({ status: "error" })]);
    expect((yield* Effect.promise(() => stream.next())).value?.value).toEqual(
      projectProviderStatuses([provider({ status: "error" })]),
    );
    yield* Effect.promise(() => stream.return!());
    yield* Effect.yieldNow;
    expect(f.detached()).toBe(true);
  }),
);

it.effect("does not resend when only fields outside the projection change", () =>
  Effect.gen(function* () {
    const f = yield* makeFixture();
    const stream = f.stream();
    yield* Effect.promise(() => stream.next());
    // A usage-meter tick changes the registry payload but not the projection:
    // the duplicate is deduplicated and the following real change is what lands.
    yield* f.emit([provider({ message: "different private text" })]);
    yield* f.emit([provider({ status: "warning" })]);
    expect((yield* Effect.promise(() => stream.next())).value?.value).toEqual(
      projectProviderStatuses([provider({ status: "warning" })]),
    );
    yield* Effect.promise(() => stream.return!());
  }),
);

for (const action of ["revoke", "move"] as const) {
  it.effect("rechecks " + action + " before delivery and detaches the registry stream", () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      const stream = f.stream();
      yield* Effect.promise(() => stream.next());
      f[action]();
      yield* f.emit([provider({ status: "error" })]);
      yield* Effect.promise(() => expect(stream.next()).rejects.toThrow());
      yield* Effect.yieldNow;
      expect(f.detached()).toBe(true);
    }),
  );
}

it.effect("aborts while waiting for a registry update and detaches", () =>
  Effect.gen(function* () {
    const f = yield* makeFixture();
    const stream = f.stream();
    yield* Effect.promise(() => stream.next());
    const pending = stream.next();
    f.controller.abort();
    yield* Effect.promise(() => expect(pending).rejects.toThrow());
    yield* Effect.yieldNow;
    expect(f.detached()).toBe(true);
  }),
);

it.effect(
  "rejects probing inputs, cursors, foreign principals and stale scope before reading the registry",
  () =>
    Effect.gen(function* () {
      const f = yield* makeFixture();
      const { assertAuthority: _assertAuthority, ...withoutAuthority } = f.metadata;
      expect(() =>
        f.api.subscribe!(
          "subscribe",
          { refresh: true },
          f.context,
          f.controller.signal,
          f.metadata,
        ),
      ).toThrow("Invalid");
      expect(() =>
        f.api.subscribe!("subscribe", {}, f.context, f.controller.signal, f.metadata, "cursor"),
      ).toThrow("resume");
      expect(() =>
        f.api.subscribe!("subscribe", {}, f.context, f.controller.signal, {
          ...f.metadata,
          principal: { ...f.metadata.principal!, environmentId: "foreign" },
        }),
      ).toThrow("authority");
      expect(() =>
        f.api.subscribe!("subscribe", {}, f.context, f.controller.signal, withoutAuthority),
      ).toThrow("authority");
      f.move();
      yield* Effect.promise(() => expect(f.stream().next()).rejects.toThrow());
      expect(f.reads()).toBe(0);
    }),
);

it.effect("revoked authority and pre-aborted streams never read the registry", () =>
  Effect.gen(function* () {
    const f = yield* makeFixture();
    f.revoke();
    yield* Effect.promise(() => expect(f.stream().next()).rejects.toThrow("revoked"));
    const updates = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();
    const aborted = fixture(updates, [provider()]);
    aborted.controller.abort();
    yield* Effect.promise(() => expect(aborted.stream().next()).rejects.toThrow());
    expect(f.reads() + aborted.reads()).toBe(0);
  }),
);
