import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ClientProviderServerFrame,
} from "@t3tools/contracts";
import { createMobileClientProviderSession } from "./mobileClientProviderConnection";
import { createMobileUiProviders } from "./mobileUiProviders";
import { createMobileExtensionThemeOverlayStore } from "./mobileExtensionThemeOverlay";
import { mobileUiThemeTokens } from "./mobileUiThemeTokens";
import { DEFAULT_MOBILE_THEME_ID, getMobileThemeVariables } from "../../lib/mobileTheme";

function fixture() {
  const caller = {
    installationId: "pack",
    contentHash: "a".repeat(64),
    installationGeneration: 37,
  };
  const context = {
    resource: {
      namespace: "t3.thread",
      id: "t",
      environmentId: EnvironmentId.make("e"),
      projectId: ProjectId.make("p"),
      threadId: ThreadId.make("t"),
    },
    client: "mobile",
  };
  const navigate = vi.fn();
  const overlay = createMobileExtensionThemeOverlayStore();
  const ui = createMobileUiProviders({
    environmentId: context.resource.environmentId,
    installations: () => [
      {
        id: "pack",
        contentHash: caller.contentHash,
        installationGeneration: 37,
        enabled: true,
        package: {},
        grants: {
          capabilities: ["t3.ui/theme.read", "t3.ui/theme.write", "t3.ui/navigation.open"],
          projectIds: [context.resource.projectId],
        },
      },
    ],
    installationGeneration: () => 37,
    overlay,
    readAppearance: () => ({
      isReady: true,
      theme: DEFAULT_MOBILE_THEME_ID,
      themeIds: { light: DEFAULT_MOBILE_THEME_ID, dark: DEFAULT_MOBILE_THEME_ID },
      themeMode: "system",
      systemDark: false,
      effectiveTheme: DEFAULT_MOBILE_THEME_ID,
      effectiveMode: "system",
      appearance: "light",
      tokensByAppearance: {
        light: mobileUiThemeTokens(
          DEFAULT_MOBILE_THEME_ID,
          "light",
          getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light"),
        ),
        dark: mobileUiThemeTokens(
          DEFAULT_MOBILE_THEME_ID,
          "dark",
          getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "dark"),
        ),
      },
    }),
    saveThemePreferences: async () => {},
    readThread: () => ({ projectId: "p" }),
    navigateThread: navigate,
    openSession: async () => true,
  });
  const respond = vi.fn();
  const emit = vi.fn();
  const session = createMobileClientProviderSession(ui, { respond, emit });
  const registered = {
    type: "registered",
    connectionId: "owned",
    accepted: ui.descriptors,
    rejected: [],
  } as const;
  const invoke = (
    method: string,
    overrides: Partial<Extract<ClientProviderServerFrame, { type: "invoke" }>> = {},
  ) =>
    session.receive({
      type: "invoke",
      requestId: "r",
      apiId: "t3.client/navigation",
      method,
      input: { threadId: "target" },
      context,
      caller,
      deadlineMs: 10000,
      ...overrides,
    });
  return { session, registered, ui, respond, emit, invoke, caller, context, navigate, overlay };
}

describe("socket-owned mobile UI dispatch", () => {
  it("records its own registration, routes authorized navigation and preserves named authority errors", async () => {
    const f = fixture();
    try {
      expect(f.session.currentConnectionId).toBeUndefined();
      await f.session.receive(f.registered);
      expect(f.session.currentConnectionId).toBe("owned");
      await f.invoke("openThread");
      expect(f.navigate).toHaveBeenCalledWith(
        { environmentId: "e", threadId: "target" },
        expect.anything(),
      );
      expect(f.respond).toHaveBeenLastCalledWith({
        requestId: "r",
        ok: true,
        value: { status: "opened", threadId: "target" },
      });
      await f.invoke("openThread", { caller: { ...f.caller, installationGeneration: 36 } });
      expect(f.respond).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "client-target-denied" }),
        }),
      );
      await f.invoke("openThread", {
        context: {
          ...f.context,
          resource: { ...f.context.resource, environmentId: EnvironmentId.make("foreign") },
        },
      });
      expect(f.respond).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "client-target-denied" }),
        }),
      );
      expect(f.navigate).toHaveBeenCalledTimes(1);
    } finally {
      f.session.dispose();
      f.ui.dispose();
    }
  });
  it("cleans watcher registrations, preview and late invokes on reconnect/disposal", async () => {
    const f = fixture();
    await f.session.receive(f.registered);
    await f.session.receive({
      type: "subscriptionOpen",
      subscriptionId: "s",
      apiId: "t3.client/theme",
      name: "watchState",
      input: {},
      caller: f.caller,
      context: f.context,
    });
    expect(f.emit).toHaveBeenCalledWith("s", expect.objectContaining({ type: "snapshot" }));
    await f.invoke("applyPreference", {
      apiId: "t3.client/theme",
      input: { writer: "pack", preference: { mode: "session", theme: DEFAULT_MOBILE_THEME_ID } },
    });
    expect(f.overlay.getSnapshot()).not.toBeNull();
    f.session.dispose();
    expect(f.overlay.getSnapshot()).toBeNull();
    const count = f.emit.mock.calls.length;
    f.ui.notifyAppearanceChanged();
    expect(f.emit).toHaveBeenCalledTimes(count);
    expect(f.session.currentConnectionId).toBeUndefined();
    const replacement = createMobileClientProviderSession(f.ui, {
      respond: f.respond,
      emit: f.emit,
    });
    await replacement.receive({ ...f.registered, connectionId: "replacement" });
    expect(replacement.currentConnectionId).toBe("replacement");
    await replacement.receive({
      type: "subscriptionOpen",
      subscriptionId: "next",
      apiId: "t3.client/theme",
      name: "watchState",
      input: {},
      caller: f.caller,
      context: f.context,
    });
    await replacement.receive({ type: "subscriptionClose", subscriptionId: "next" });
    replacement.dispose();
    f.ui.dispose();
  });
  it("rejects calls before registration and provider APIs the socket did not accept", async () => {
    const f = fixture();
    try {
      await f.invoke("openThread");
      expect(f.navigate).not.toHaveBeenCalled();
      await f.session.receive({ ...f.registered, accepted: [] });
      await f.invoke("openThread");
      expect(f.respond).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "client-provider-unavailable" }),
        }),
      );
    } finally {
      f.session.dispose();
      f.ui.dispose();
    }
  });
  it("ignores late registration when the connection is disposed", async () => {
    const f = fixture();
    try {
      f.session.dispose();
      await f.session.receive(f.registered);
      expect(f.session.currentConnectionId).toBeUndefined();
    } finally {
      f.session.dispose();
      f.ui.dispose();
    }
  });
  it.each(["unregistered", "not accepted", "no stream", "open throws"])(
    "emits a named unavailable error when subscriptionOpen fails: %s",
    async (failure) => {
      const f = fixture();
      try {
        if (failure !== "unregistered")
          await f.session.receive({
            ...f.registered,
            accepted: failure === "not accepted" ? [] : f.registered.accepted,
          });
        if (failure === "no stream" || failure === "open throws")
          f.ui.providers.set("t3.client/theme", {
            invoke: async () => null,
            ...(failure === "open throws"
              ? {
                  openStream: () => {
                    throw new Error("Open failed");
                  },
                }
              : {}),
          });
        await f.session.receive({
          type: "subscriptionOpen",
          subscriptionId: "unavailable",
          apiId: "t3.client/theme",
          name: "watchState",
          input: {},
          caller: f.caller,
          context: f.context,
        });
        expect(f.emit).toHaveBeenCalledWith("unavailable", {
          type: "closed",
          value: null,
          error: expect.objectContaining({ code: "client-provider-unavailable" }),
        });
      } finally {
        f.session.dispose();
        f.ui.dispose();
      }
    },
  );
  it("aborts a pending invocation and sends no stale response into a replacement session", async () => {
    const f = fixture();
    let finish!: () => void;
    let activeSignal!: AbortSignal;
    let started!: () => void;
    const invoked = new Promise<void>((resolve) => (started = resolve));
    const pending = new Promise<void>((resolve) => (finish = resolve));
    f.ui.providers.set("t3.client/navigation", {
      invoke: async (call) => {
        activeSignal = call.signal;
        started();
        await pending;
        return null;
      },
    });
    await f.session.receive(f.registered);
    const result = f.invoke("openThread");
    await invoked;
    f.session.dispose();
    expect(activeSignal.aborted).toBe(true);
    finish();
    await result;
    expect(f.respond).not.toHaveBeenCalled();
    f.ui.dispose();
  });
});

it.each(["invoke", "stream"])(
  "forwards a fixed message for an ordinary %s exception",
  async (kind) => {
    const f = fixture();
    try {
      await f.session.receive(f.registered);
      f.ui.providers.set("t3.client/navigation", {
        invoke: async () => {
          throw new Error("native bridge private details");
        },
        openStream: () => {
          throw new Error("native bridge private details");
        },
      });
      if (kind === "invoke") {
        await f.invoke("openThread");
        expect(f.respond).toHaveBeenLastCalledWith({
          requestId: "r",
          ok: false,
          error: { code: "provider-rejected", message: "Provider failed" },
        });
      } else {
        await f.session.receive({
          type: "subscriptionOpen",
          subscriptionId: "fixed",
          apiId: "t3.client/navigation",
          name: "watch",
          input: {},
          caller: f.caller,
          context: f.context,
        });
        expect(f.emit).toHaveBeenLastCalledWith("fixed", {
          type: "closed",
          value: null,
          error: { code: "client-provider-unavailable", message: "Provider stream is unavailable" },
        });
      }
    } finally {
      f.session.dispose();
      f.ui.dispose();
    }
  },
);
