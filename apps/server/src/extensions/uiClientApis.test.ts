import { ClientProvidersError } from "@t3tools/contracts";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  HostApiInvocationMetadata,
  HostApiPrincipal,
  HostApiProvider,
} from "@t3tools/extension-runtime";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import type { ClientApiProviders, CorrelationEntry } from "./ClientApiProviders.ts";
import { createUiClientApiProviders } from "./uiClientApis.ts";

const ENV = "env-a";
const signal = new AbortController().signal;

const context = {
  resource: {
    namespace: "t3.extensions",
    id: "ext.a",
    environmentId: ENV,
    projectId: "project-a",
    threadId: "thread-a",
  },
  client: "web",
} as ViewContext;

interface RecordedInvoke {
  readonly connectionId: string;
  readonly apiId: string;
  readonly method: string;
  readonly input: Json;
}

function fakeBridge(options?: {
  resolveFailure?: ClientProvidersError;
  targets?: readonly unknown[];
  sessionConnections?: Record<string, readonly string[]>;
}) {
  const correlations = new Map<string, CorrelationEntry>();
  const invoked: RecordedInvoke[] = [];
  const subscribed: { apiId: string; name: string; input: Json; coalesce?: boolean }[] = [];
  const service: ClientApiProviders["Service"] = {
    connect: () => Effect.die("unused"),
    respond: () => Effect.void,
    emit: () => Effect.void,
    invoke: (request) => {
      invoked.push({
        connectionId: request.connectionId,
        apiId: request.apiId,
        method: request.method,
        input: request.input,
      });
      if (request.method === "dismiss") return Effect.succeed({ dismissed: true });
      if (request.method === "open")
        return Effect.succeed({
          status: "opened",
          url: (request.input as { url: string }).url,
          opener: "desktop-shell",
        });
      if (request.method === "openThread")
        return Effect.succeed({
          status: "opened",
          threadId: (request.input as { threadId: string }).threadId,
        });
      if (request.method === "registerCommands") {
        const commands = (request.input as { commands: { id: string }[] }).commands;
        return Effect.succeed({
          commandSetToken: "cmdset-1",
          results: commands.map((command) => ({ commandId: command.id, status: "registered" })),
        });
      }
      return Effect.succeed({ applied: true });
    },
    openSubscription: (request) => {
      subscribed.push({
        apiId: request.apiId,
        name: request.name,
        input: request.input,
        ...(request.coalesce !== undefined ? { coalesce: request.coalesce } : {}),
      });
      return Effect.succeed({
        events: (async function* () {
          yield { type: "snapshot" as const, value: { wordWrap: true } };
        })(),
        close: () => Effect.void,
      });
    },
    registerCorrelation: (correlationId, entry) => {
      correlations.set(correlationId, entry);
      return Effect.void;
    },
    unregisterCorrelation: (correlationId) => {
      correlations.delete(correlationId);
      return Effect.void;
    },
    listTargets: () =>
      Effect.succeed(
        (options?.targets ?? []) as readonly import("@t3tools/contracts").ClientTargetInfo[],
      ),
    resolveTarget: (_environmentId, _principal, hint) =>
      options?.resolveFailure
        ? Effect.fail(options.resolveFailure)
        : Effect.succeed(hint ?? "conn-1"),
    hasProvider: () => Effect.succeed(true),
    connectionForSession: (sessionId, connectionId) =>
      Effect.succeed(options?.sessionConnections?.[sessionId]?.includes(connectionId) ?? true),
  };
  return { service, correlations, invoked, subscribed };
}

const hostPrincipal: HostApiPrincipal = {
  kind: "host",
  id: "host",
  environmentId: ENV,
  scopes: [],
};

const metadata = (
  installationId = "ext.a",
  principal: HostApiPrincipal | undefined = hostPrincipal,
): HostApiInvocationMetadata => ({
  callId: "call-1",
  rootCallerId: installationId,
  callerId: installationId,
  providerId: "host.ui.test",
  providerGeneration: 1,
  callerGenerations: [{ pluginId: installationId, contentHash: "hash", installationGeneration: 1 }],
  ...(principal ? { principal } : {}),
});

const THREAD_PROJECTS: Record<string, string> = {
  "thread-a": "project-a",
  "thread-b": "project-a",
  "thread-other": "project-b",
};

function makeProviders(
  bridge: ReturnType<typeof fakeBridge>,
  authorizeGrant?: () => Promise<boolean>,
) {
  const providers = createUiClientApiProviders({
    environmentId: ENV,
    clientApiProviders: bridge.service,
    authorizeGrant: authorizeGrant ?? (() => Promise.resolve(true)),
    resolveThreadProject: (threadId) => Promise.resolve(THREAD_PROJECTS[threadId] ?? null),
  });
  const byId = (providerId: string): HostApiProvider =>
    providers.find((provider) => provider.providerId === providerId)!;
  return {
    theme: byId("host.ui.theme"),
    keybindings: byId("host.ui.keybindings"),
    notifications: byId("host.ui.notifications"),
    panels: byId("host.ui.panels"),
    preferences: byId("host.ui.preferences"),
    external: byId("host.ui.external"),
    navigation: byId("host.ui.navigation"),
  };
}

describe("preferences adapter", () => {
  it("forwards writes as the broker-verified writer's patch", async () => {
    const bridge = fakeBridge();
    const { preferences } = makeProviders(bridge);
    await preferences.invoke(
      "setPreferences",
      { wordWrap: false } as Json,
      context,
      signal,
      metadata(),
    );
    const forwarded = bridge.invoked[0]!;
    expect(forwarded.apiId).toBe("t3.client/preferences");
    expect(forwarded.method).toBe("applyPreferences");
    expect(forwarded.input).toEqual({
      target: { kind: "connection", connectionId: "conn-1" },
      writer: "ext.a",
      patch: { wordWrap: false },
    });
  });

  it("streams the client's coalesced watch feed", async () => {
    const bridge = fakeBridge();
    const { preferences } = makeProviders(bridge);
    const events = [];
    for await (const event of preferences.subscribe!(
      "subscribePreferences",
      {},
      context,
      signal,
      metadata(),
    ))
      events.push(event);
    expect(bridge.subscribed).toEqual([
      {
        apiId: "t3.client/preferences",
        name: "watchPreferences",
        input: { target: { kind: "connection", connectionId: "conn-1" } },
        coalesce: true,
      },
    ]);
    expect(events).toEqual([{ type: "snapshot", value: { wordWrap: true } }]);
  });
});

describe("theme adapter", () => {
  it("stamps the broker-verified caller as the preference writer", async () => {
    const bridge = fakeBridge();
    const { theme } = makeProviders(bridge);
    await theme.invoke(
      "setPreference",
      { mode: "session", theme: "ocean" } as unknown as Json,
      context,
      signal,
      metadata(),
    );
    const forwarded = bridge.invoked[0]!;
    expect(forwarded.apiId).toBe("t3.client/theme");
    expect(forwarded.method).toBe("applyPreference");
    expect(forwarded.input).toMatchObject({
      writer: "ext.a",
      preference: { mode: "session", theme: "ocean" },
      target: { kind: "connection", connectionId: "conn-1" },
    });
  });

  it("propagates target resolution failures instead of forwarding", async () => {
    const bridge = fakeBridge({
      resolveFailure: new ClientProvidersError({
        code: "client-target-denied",
        detail: "Provider sessions cannot target clients.",
      }),
    });
    const { theme } = makeProviders(bridge);
    await expect(theme.invoke("getState", {}, context, signal, metadata())).rejects.toMatchObject({
      code: "client-target-denied",
    });
    expect(bridge.invoked).toHaveLength(0);
  });
});

describe("external adapter", () => {
  it("refuses bad URLs and non-allowlisted schemes without reaching a client", async () => {
    const bridge = fakeBridge();
    const { external } = makeProviders(bridge);
    const open = (url: string) => external.invoke("open", { url }, context, signal, metadata());
    await expect(open("not a url")).resolves.toEqual({ status: "refused", reason: "invalid-url" });
    await expect(open("//example.com/relative")).resolves.toEqual({
      status: "refused",
      reason: "invalid-url",
    });
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c", "vscode://x"])
      await expect(open(url)).resolves.toEqual({
        status: "refused",
        reason: "scheme-not-allowed",
      });
    expect(bridge.invoked).toHaveLength(0);
  });

  it("forwards the normalized URL to the caller's own client", async () => {
    const bridge = fakeBridge();
    const { external } = makeProviders(bridge);
    await expect(
      external.invoke("open", { url: "HTTPS://Example.com" }, context, signal, metadata()),
    ).resolves.toEqual({
      status: "opened",
      url: "https://example.com/",
      opener: "desktop-shell",
    });
    expect(bridge.invoked).toEqual([
      {
        connectionId: "conn-1",
        apiId: "t3.client/external",
        method: "open",
        input: {
          target: { kind: "connection", connectionId: "conn-1" },
          url: "https://example.com/",
        },
      },
    ]);
  });
});

describe("navigation adapter", () => {
  it("refuses unknown and cross-project threads without reaching a client", async () => {
    const bridge = fakeBridge();
    const { navigation } = makeProviders(bridge);
    const open = (threadId: string) =>
      navigation.invoke("openThread", { threadId }, context, signal, metadata());
    await expect(open("thread-gone")).resolves.toEqual({
      status: "refused",
      reason: "unknown-thread",
    });
    await expect(open("thread-other")).resolves.toEqual({
      status: "refused",
      reason: "out-of-scope",
    });
    // A context without a project scope has no thread it may steer to.
    const unscoped = {
      ...context,
      resource: { namespace: "t3.extensions", id: "ext.a", environmentId: ENV },
    } as ViewContext;
    await expect(
      navigation.invoke("openThread", { threadId: "thread-b" }, unscoped, signal, metadata()),
    ).resolves.toEqual({ status: "refused", reason: "out-of-scope" });
    expect(bridge.invoked).toHaveLength(0);
  });

  it("forwards a same-project thread and surface to the caller's own client", async () => {
    const bridge = fakeBridge();
    const { navigation } = makeProviders(bridge);
    await expect(
      navigation.invoke(
        "openThread",
        { threadId: "thread-b", surfaceId: "ext.a/view" },
        context,
        signal,
        metadata(),
      ),
    ).resolves.toEqual({ status: "opened", threadId: "thread-b" });
    expect(bridge.invoked).toEqual([
      {
        connectionId: "conn-1",
        apiId: "t3.client/navigation",
        method: "openThread",
        input: {
          target: { kind: "connection", connectionId: "conn-1" },
          threadId: "thread-b",
          surfaceId: "ext.a/view",
        },
      },
    ]);
  });

  it("reports openThread availability through getCapabilities", async () => {
    const { navigation } = makeProviders(fakeBridge());
    await expect(
      navigation.invoke("getCapabilities", {}, context, signal, metadata()),
    ).resolves.toMatchObject({
      adapter: "host.ui.navigation",
      operations: { openThread: true },
    });
  });
});

describe("keybindings adapter", () => {
  it("rejects global commands locally when the global grant is missing", async () => {
    const bridge = fakeBridge();
    const { keybindings } = makeProviders(bridge, () => Promise.resolve(false));
    const result = (await keybindings.invoke(
      "registerCommands",
      {
        commands: [
          { id: "local", title: "Local", scope: "surface" },
          { id: "global", title: "Global", scope: "global" },
        ],
      } as unknown as Json,
      context,
      signal,
      metadata(),
    )) as { commandSetToken: string; results: { commandId: string; status: string }[] };
    // The legal command still forwarded; the global one rejected locally.
    const forwarded = bridge.invoked[0]!;
    expect(forwarded.apiId).toBe("t3.client/keybindings");
    expect((forwarded.input as { commands: { id: string }[] }).commands.map((c) => c.id)).toEqual([
      "local",
    ]);
    expect(result.results).toContainEqual(
      expect.objectContaining({ commandId: "global", status: "rejected" }),
    );
  });

  it("forwards nothing when every command is rejected", async () => {
    const bridge = fakeBridge();
    const { keybindings } = makeProviders(bridge, () => Promise.resolve(false));
    await keybindings.invoke(
      "registerCommands",
      { commands: [{ id: "global", title: "G", scope: "global" }] } as unknown as Json,
      context,
      signal,
      metadata(),
    );
    expect(bridge.invoked).toHaveLength(0);
  });

  it("resolves unregister for a fully-rejected set without a client roundtrip", async () => {
    const bridge = fakeBridge();
    const { keybindings } = makeProviders(bridge, () => Promise.resolve(false));
    const registered = (await keybindings.invoke(
      "registerCommands",
      { commands: [{ id: "global", title: "G", scope: "global" }] } as unknown as Json,
      context,
      signal,
      metadata(),
    )) as { commandSetToken: string };
    expect(registered.commandSetToken).toMatch(/^cmdset-/);
    const result = (await keybindings.invoke(
      "unregisterCommands",
      { commandSetToken: registered.commandSetToken } as unknown as Json,
      context,
      signal,
      metadata(),
    )) as { unregistered: boolean };
    expect(result.unregistered).toBe(true);
    expect(bridge.invoked).toHaveLength(0);
  });
});

describe("capability directory", () => {
  const targets = [
    { connectionId: "conn-a", providers: {} },
    { connectionId: "conn-b", providers: {} },
  ];
  const principal = (kind: HostApiPrincipal["kind"], id: string): HostApiPrincipal => ({
    kind,
    id,
    environmentId: ENV,
    scopes: [],
  });

  it("scopes the client directory to the caller's principal", async () => {
    const bridge = fakeBridge({
      targets,
      sessionConnections: { "sess-1": ["conn-a"] },
    });
    const { theme } = makeProviders(bridge);
    const host = (await theme.invoke("getCapabilities", {}, context, signal, metadata())) as {
      clients: { connectionId: string }[];
    };
    expect(host.clients.map((client) => client.connectionId)).toEqual(["conn-a", "conn-b"]);

    const own = (await theme.invoke(
      "getCapabilities",
      {},
      context,
      signal,
      metadata("ext.a", principal("environment-session", "sess-1")),
    )) as { clients: { connectionId: string }[] };
    expect(own.clients.map((client) => client.connectionId)).toEqual(["conn-a"]);

    const none = (await theme.invoke(
      "getCapabilities",
      {},
      context,
      signal,
      metadata("ext.a", principal("provider-session", "prov-1")),
    )) as { clients: unknown[]; operations: Record<string, boolean> };
    expect(none.clients).toHaveLength(0);
    // Provider-session callers see the contract shape but no reachable ops.
    expect(Object.values(none.operations).every((op) => op === false)).toBe(true);
  });
});

describe("notifications adapter", () => {
  const notifyInput = (extra?: Record<string, unknown>) =>
    ({ severity: "info", title: "Build done", ...extra }) as unknown as Json;

  it("mints the id, registers an outcome correlation, and forwards the nested shape", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const result = (await notifications.invoke(
      "notify",
      notifyInput(),
      context,
      signal,
      metadata(),
    )) as { notificationId: string };
    expect(result.notificationId).toMatch(/^ntf-/);
    const forwarded = bridge.invoked[0]!;
    expect(forwarded.apiId).toBe("t3.client/notifications");
    expect(forwarded.method).toBe("notify");
    expect(forwarded.input).toMatchObject({
      notification: { notificationId: result.notificationId, severity: "info" },
    });
    expect(bridge.correlations.has(result.notificationId)).toBe(true);
  });

  it("resolves a pending awaitAction when the outcome arrives", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const { notificationId } = (await notifications.invoke(
      "notify",
      notifyInput(),
      context,
      signal,
      metadata(),
    )) as { notificationId: string };
    const action = notifications.invoke(
      "awaitAction",
      { notificationId } as unknown as Json,
      context,
      signal,
      metadata(),
    );
    bridge.correlations.get(notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { actionId: "open" },
    });
    await expect(action).resolves.toEqual({ actionId: "open" });
    // Settled outcomes release their correlation.
    expect(bridge.correlations.has(notificationId)).toBe(false);
  });

  it("withholds a retained outcome from a foreign installation", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const { notificationId } = (await notifications.invoke(
      "notify",
      notifyInput(),
      context,
      signal,
      metadata(),
    )) as { notificationId: string };
    bridge.correlations.get(notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { actionId: "apply" },
    });
    // The outcome is retained, but only the owning installation may read it.
    await expect(
      notifications.invoke(
        "awaitAction",
        { notificationId } as unknown as Json,
        context,
        signal,
        metadata("ext.b"),
      ),
    ).rejects.toMatchObject({ code: "notification-owner-mismatch" });
    await expect(
      notifications.invoke(
        "awaitAction",
        { notificationId } as unknown as Json,
        context,
        signal,
        metadata(),
      ),
    ).resolves.toEqual({ actionId: "apply" });
  });

  it("resolves awaitAction from the retained outcome after settlement", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const { notificationId } = (await notifications.invoke(
      "notify",
      notifyInput(),
      context,
      signal,
      metadata(),
    )) as { notificationId: string };
    bridge.correlations.get(notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { actionId: "apply" },
    });
    // The notification already settled — a late awaitAction still resolves.
    await expect(
      notifications.invoke(
        "awaitAction",
        { notificationId } as unknown as Json,
        context,
        signal,
        metadata(),
      ),
    ).resolves.toEqual({ actionId: "apply" });
  });

  it("records an API dismiss as the settled outcome", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const { notificationId } = (await notifications.invoke(
      "notify",
      notifyInput(),
      context,
      signal,
      metadata(),
    )) as { notificationId: string };
    await notifications.invoke(
      "dismiss",
      { notificationId } as unknown as Json,
      context,
      signal,
      metadata(),
    );
    await expect(
      notifications.invoke(
        "awaitAction",
        { notificationId } as unknown as Json,
        context,
        signal,
        metadata(),
      ),
    ).resolves.toEqual({ dismissed: true });
  });

  it("enforces owner-only management and expires unknown ids", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const { notificationId } = (await notifications.invoke(
      "notify",
      notifyInput(),
      context,
      signal,
      metadata(),
    )) as { notificationId: string };
    await expect(
      notifications.invoke(
        "dismiss",
        { notificationId } as unknown as Json,
        context,
        signal,
        metadata("ext.b"),
      ),
    ).rejects.toMatchObject({ code: "notification-owner-mismatch" });
    await expect(
      notifications.invoke(
        "awaitAction",
        { notificationId } as unknown as Json,
        context,
        signal,
        metadata("ext.b"),
      ),
    ).rejects.toMatchObject({ code: "notification-owner-mismatch" });
    await expect(
      notifications.invoke(
        "dismiss",
        { notificationId: "ntf-ghost" } as unknown as Json,
        context,
        signal,
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "notification-expired" });
    // A settled notification is expired for management but retained for awaitAction.
    bridge.correlations.get(notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { dismissed: true },
    });
    await expect(
      notifications.invoke(
        "update",
        { notificationId, patch: { title: "late" } } as unknown as Json,
        context,
        signal,
        metadata(),
      ),
    ).rejects.toMatchObject({ code: "notification-expired" });
  });
});

describe("notification connection ownership", () => {
  it("another connection cannot await a retained outcome", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const owner = { ...metadata(), clientConnectionId: "conn-a" };
    const { notificationId } = (await notifications.invoke(
      "notify",
      { severity: "info", title: "x" },
      context,
      signal,
      owner,
    )) as { notificationId: string };
    bridge.correlations.get(notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { actionId: "yes" },
    });
    await expect(
      notifications.invoke("awaitAction", { notificationId }, context, signal, {
        ...metadata(),
        clientConnectionId: "conn-b",
      }),
    ).rejects.toBeDefined();
  });

  it("a provider-session cannot await a retained outcome", async () => {
    const bridge = fakeBridge();
    const { notifications } = makeProviders(bridge);
    const { notificationId } = (await notifications.invoke(
      "notify",
      { severity: "info", title: "x" },
      context,
      signal,
      { ...metadata(), clientConnectionId: "conn-a" },
    )) as { notificationId: string };
    bridge.correlations.get(notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { actionId: "yes" },
    });
    await expect(
      notifications.invoke(
        "awaitAction",
        { notificationId },
        context,
        signal,
        metadata("ext.a", {
          kind: "provider-session",
          id: "provider",
          environmentId: ENV,
          scopes: [],
        }),
      ),
    ).rejects.toBeDefined();
  });
});

it("an ordinary view registration is not installation-scoped", async () => {
  const bridge = fakeBridge();
  const { keybindings } = makeProviders(bridge);
  await keybindings.invoke(
    "registerCommands",
    {
      commands: [
        {
          id: "open",
          title: "Open",
          scope: "global",
          activation: { surfaceId: "ext.a/panel", placement: "side-panel" },
        },
      ],
    },
    {
      ...context,
      resource: { ...context.resource, namespace: "ext.a", id: "ext.a/panel" },
    },
    signal,
    metadata(),
  );
  expect(bridge.invoked[0]?.input).not.toMatchObject({ installationScoped: true });
});

it("notification retention cap is per connection", async () => {
  const bridge = fakeBridge();
  const { notifications } = makeProviders(bridge);
  const settle = async (conn: string) => {
    const meta = { ...metadata(), clientConnectionId: conn };
    const result = (await notifications.invoke(
      "notify",
      { title: "x", severity: "info" },
      context,
      signal,
      meta,
    )) as { notificationId: string };
    bridge.correlations.get(result.notificationId)!.deliver({
      type: "notificationOutcome",
      outcome: { actionId: "yes" },
    });
    return result.notificationId;
  };
  const id = await settle("conn-a");
  for (let i = 0; i < 257; i++) await settle("conn-b");
  await expect(
    notifications.invoke("awaitAction", { notificationId: id }, context, signal, {
      ...metadata(),
      clientConnectionId: "conn-a",
    }),
  ).resolves.toEqual({ actionId: "yes" });
});
