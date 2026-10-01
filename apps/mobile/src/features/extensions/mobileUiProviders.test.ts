import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ExtensionInstallation,
  type ExtensionViewContext,
} from "@t3tools/contracts";
import {
  createMobileUiProviders,
  type MobileUiProviderCall,
  type MobileUiAppearanceSnapshot,
} from "./mobileUiProviders";
import {
  createMobileExtensionThemeOverlayStore,
  type MobileThemePreferencePatch,
} from "./mobileExtensionThemeOverlay";
import {
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemeColors,
  resolveMobileThemeIds,
  type MobileThemeId,
  type MobileThemeMode,
} from "../../lib/mobileTheme";

const ENV = EnvironmentId.make("env-a");
const PROJECT = ProjectId.make("project-a");
const context: ExtensionViewContext = {
  resource: {
    namespace: "t3.thread",
    id: "thread-a",
    environmentId: ENV,
    projectId: PROJECT,
    threadId: ThreadId.make("thread-a"),
  },
  client: "mobile",
};
const caller = { installationId: "agents", contentHash: "a".repeat(64), installationGeneration: 1 };
const grants = [
  "t3.ui/theme.read",
  "t3.ui/theme.write",
  "t3.ui/navigation.open",
  "t3.ui/navigation.open-session",
];
const call = (
  method: string,
  input: MobileUiProviderCall["input"] = {},
  ctx = context,
): MobileUiProviderCall => ({
  method,
  input,
  context: ctx,
  caller,
  signal: new AbortController().signal,
});

function fixture(environmentId = ENV, overlay = createMobileExtensionThemeOverlayStore()) {
  let installations: readonly ExtensionInstallation[] = [
    {
      id: "agents",
      contentHash: caller.contentHash,
      enabled: true,
      grants: { capabilities: grants, projectIds: [PROJECT] },
      package: {},
    },
  ];
  let generation = 1;
  let preferences: MobileThemePreferencePatch = {};
  let mode: MobileThemeMode = "system";
  let dark = false;
  let ready = true;
  const navigateThread = vi.fn();
  const openSession = vi.fn(async () => true);
  const save = vi.fn(async (patch: MobileThemePreferencePatch) => {
    preferences = { ...preferences, ...patch };
    mode = patch.themeMode ?? mode;
  });
  const readAppearance = (): MobileUiAppearanceSnapshot => {
    const session = overlay.getSnapshot();
    const effectiveMode = session?.patch.themeMode ?? mode;
    const appearance = effectiveMode === "system" ? (dark ? "dark" : "light") : effectiveMode;
    const themeIds = resolveMobileThemeIds(preferences);
    const storedAppearance = mode === "system" ? (dark ? "dark" : "light") : mode;
    const theme = themeIds[storedAppearance];
    const effectiveThemeIds = resolveMobileThemeIds({ ...preferences, ...session?.patch });
    const effectiveTheme = effectiveThemeIds[appearance];
    return {
      isReady: ready,
      theme,
      themeIds,
      themeMode: mode,
      systemDark: dark,
      effectiveTheme,
      appearance,
      effectiveMode,
      tokensByAppearance: {
        light: getMobileThemeColors(
          effectiveThemeIds.light === "material-you"
            ? DEFAULT_MOBILE_THEME_ID
            : effectiveThemeIds.light,
          "light",
        ),
        dark: getMobileThemeColors(
          effectiveThemeIds.dark === "material-you"
            ? DEFAULT_MOBILE_THEME_ID
            : effectiveThemeIds.dark,
          "dark",
        ),
      },
    };
  };
  const providers = createMobileUiProviders({
    environmentId,
    installations: () => installations,
    installationGeneration: () => generation,
    readAppearance,
    saveThemePreferences: save,
    overlay,
    readThread: (id) =>
      id === "missing" ? null : { projectId: id === "foreign" ? "project-b" : PROJECT },
    navigateThread,
    openSession,
  });
  const themeProvider = providers.providers.get("t3.client/theme")!;
  const navigation = providers.providers.get("t3.client/navigation")!;
  return {
    providers,
    themeProvider,
    navigation,
    overlay,
    save,
    navigateThread,
    openSession,
    setInstallations: (value: typeof installations) => {
      installations = value;
      providers.notifyInstallationsChanged();
    },
    installations: () => installations,
    setGeneration: (value: number) => {
      generation = value;
      providers.notifyInstallationsChanged();
    },
    setAppearance: (nextTheme: MobileThemeId, nextMode: MobileThemeMode, systemDark: boolean) => {
      preferences = { themeId: nextTheme };
      mode = nextMode;
      dark = systemDark;
      providers.notifyAppearanceChanged();
    },
    setStoredPreferences: (value: MobileThemePreferencePatch) => {
      preferences = value;
    },
    setReady: (value: boolean) => {
      ready = value;
    },
  };
}

describe("mobile UI providers", () => {
  it("advertises only implemented seam areas and explicit unsupported UI capabilities", async () => {
    const f = fixture();
    expect(f.providers.descriptors).toEqual([
      { id: "t3.client/theme", version: "1.0.0" },
      { id: "t3.client/navigation", version: "1.0.0" },
    ]);
    expect(f.providers.capabilities["t3.ui/theme"]!.operations.getTerminalAppearance).toBe(false);
    expect(f.providers.capabilities["t3.ui/navigation"]!.operations.openFile).toBe(false);
    for (const id of [
      "t3.ui/preferences",
      "t3.ui/notifications",
      "t3.ui/keybindings",
      "t3.ui/panels",
      "t3.ui/editor",
      "t3.ui/external",
    ])
      expect(f.providers.capabilities[id]!.reason).toBe("unsupported-on-mobile");
    await expect(
      f.navigation.invoke(call("openFile", { relativePath: "a.ts" })),
    ).rejects.toMatchObject({
      code: "client-provider-unavailable",
      message: expect.stringContaining("unsupported on mobile"),
    });
    await expect(f.themeProvider.invoke(call("getTerminalAppearance"))).rejects.toMatchObject({
      code: "client-provider-unavailable",
    });
  });

  it("reports stored choices, effective system appearance and native palette tokens", async () => {
    const f = fixture();
    f.setAppearance("grove", "system", true);
    expect(await f.themeProvider.invoke(call("getState"))).toMatchObject({
      theme: "grove",
      resolvedTheme: "dark",
      systemDark: true,
      followSystem: true,
      sessionOverlay: null,
      effectiveTheme: { kind: "stored", theme: "grove" },
    });
    const result = await f.themeProvider.invoke(call("resolveTokens"));
    expect(result).toMatchObject({
      tokens: { canvas: getMobileThemeColors("grove", "dark").canvas },
      cssVars: {
        canvas: "--app-theme-canvas",
        terminalSelection: "--app-theme-terminal-selection-background",
      },
    });
  });

  it("emits one initial snapshot and changes from settings/system changes without redundant frames", () => {
    const f = fixture();
    const emit = vi.fn();
    const close = f.themeProvider.openStream!({
      name: "watchState",
      input: {},
      context,
      caller,
      emit,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    f.providers.notifyAppearanceChanged();
    expect(emit).toHaveBeenCalledTimes(1);
    f.setAppearance("grove", "system", true);
    expect(emit).toHaveBeenLastCalledWith({
      type: "data",
      value: expect.objectContaining({ resolvedTheme: "dark", theme: "grove" }),
    });
    close();
    f.setAppearance(DEFAULT_MOBILE_THEME_ID, "light", false);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it.each(["disabled", "hash", "grant", "generation", "environment", "project", "client"])(
    "denies %s callers before state reads or effects",
    async (denial) => {
      const f = fixture();
      let ctx = context;
      if (denial === "disabled")
        f.setInstallations(f.installations().map((i) => ({ ...i, enabled: false })));
      if (denial === "hash")
        f.setInstallations(f.installations().map((i) => ({ ...i, contentHash: "b".repeat(64) })));
      if (denial === "grant")
        f.setInstallations(
          f.installations().map((i) => ({ ...i, grants: { ...i.grants, capabilities: [] } })),
        );
      if (denial === "generation") f.setGeneration(2);
      if (denial === "environment")
        ctx = {
          ...context,
          resource: { ...context.resource, environmentId: EnvironmentId.make("env-b") },
        };
      if (denial === "project")
        ctx = {
          ...context,
          resource: { ...context.resource, projectId: ProjectId.make("project-b") },
        };
      if (denial === "client") ctx = { ...context, client: "web" };
      await expect(f.themeProvider.invoke(call("getState", {}, ctx))).rejects.toMatchObject({
        code: "client-target-denied",
      });
      await expect(
        f.navigation.invoke(call("openThread", { threadId: "thread-a" }, ctx)),
      ).rejects.toMatchObject({ code: "client-target-denied" });
      expect(f.navigateThread).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it("persists theme settings through native storage and clears an owned temporary preview", async () => {
    const f = fixture();
    await f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove", appearanceMode: "dark" },
      }),
    );
    expect(f.save).not.toHaveBeenCalled();
    expect(await f.themeProvider.invoke(call("getState"))).toMatchObject({
      theme: DEFAULT_MOBILE_THEME_ID,
      effectiveTheme: { kind: "session-overlay", theme: "grove", writer: "agents" },
    });
    expect(
      await f.themeProvider.invoke(
        call("applyPreference", {
          writer: "agents",
          preference: {
            mode: "persist",
            theme: "ocean",
            appearanceMode: "light",
            themeHalves: { dark: "grove" },
          },
        }),
      ),
    ).toEqual({ applied: true, propagatedTo: "storage-origin" });
    expect(f.save).toHaveBeenCalledWith(
      { themeId: "ocean", lightThemeId: "ocean", darkThemeId: "grove", themeMode: "light" },
      expect.any(AbortSignal),
    );
    expect(f.overlay.getSnapshot()).toBeNull();
  });

  for (const [name, preferences] of [
    ["default", {}],
    ["legacy", { themeId: "ocean" }],
    ["explicit", { themeId: "ocean", lightThemeId: "ocean", darkThemeId: "iris" }],
  ] as const) {
    it.each(["light", "dark"] as const)(
      `preserves the untouched half when persisting only %s from ${name} preferences`,
      async (selectedAppearance) => {
        for (const activeAppearance of ["light", "dark"] as const) {
          const f = fixture();
          f.setAppearance(DEFAULT_MOBILE_THEME_ID, activeAppearance, activeAppearance === "dark");
          f.setStoredPreferences(preferences);
          const before = resolveMobileThemeIds(preferences);
          const expected = { ...before, [selectedAppearance]: "grove" };
          await f.themeProvider.invoke(
            call("applyPreference", {
              writer: "agents",
              preference: { mode: "persist", themeHalves: { [selectedAppearance]: "grove" } },
            }),
          );
          expect(await f.themeProvider.invoke(call("getState"))).toMatchObject({
            themeHalves: expected,
            effectiveTheme: { kind: "stored", theme: expected[activeAppearance] },
          });
          f.providers.dispose();
        }
      },
    );
  }

  it("keeps both stored halves and the active legacy theme when switching back to system appearance", async () => {
    const f = fixture();
    f.setAppearance("ocean", "light", true);
    f.setStoredPreferences({ themeId: "ocean", lightThemeId: "ocean", darkThemeId: "iris" });
    await f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "persist", appearanceMode: "system" },
      }),
    );
    expect(f.save).toHaveBeenCalledWith(
      { themeId: "iris", lightThemeId: "ocean", darkThemeId: "iris", themeMode: "system" },
      expect.any(AbortSignal),
    );
    expect(await f.themeProvider.invoke(call("getState"))).toMatchObject({
      themeHalves: { light: "ocean", dark: "iris" },
      resolvedTheme: "dark",
      effectiveTheme: { kind: "stored", theme: "iris" },
    });
  });

  it("delivers the session overlay frame after native appearance updates", async () => {
    const f = fixture();
    const emit = vi.fn();
    f.themeProvider.openStream!({ name: "watchState", input: {}, context, caller, emit });
    await f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove" },
      }),
    );
    expect(emit).toHaveBeenCalledTimes(1);
    f.providers.notifyAppearanceChanged();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith({
      type: "data",
      value: expect.objectContaining({
        effectiveTheme: { kind: "session-overlay", theme: "grove", writer: "agents" },
      }),
    });
    f.providers.dispose();
  });

  it("refuses unknown themes and forged writers without partially saving settings", async () => {
    const f = fixture();
    expect(
      await f.themeProvider.invoke(
        call("applyPreference", {
          writer: "agents",
          preference: { mode: "persist", theme: "unknown", appearanceMode: "dark" },
        }),
      ),
    ).toEqual({ applied: false, reason: "unknown-theme" });
    await expect(
      f.themeProvider.invoke(
        call("applyPreference", {
          writer: "other",
          preference: { mode: "persist", theme: "grove" },
        }),
      ),
    ).rejects.toMatchObject({ code: "client-target-denied" });
    expect(f.save).not.toHaveBeenCalled();
  });

  it("does not claim a failed save or unloaded settings are applied", async () => {
    const f = fixture();
    f.setReady(false);
    await expect(f.themeProvider.invoke(call("getState"))).rejects.toMatchObject({
      code: "client-provider-unavailable",
    });
    f.setReady(true);
    f.save.mockRejectedValueOnce(new Error("storage failed"));
    expect(
      await f.themeProvider.invoke(
        call("applyPreference", {
          writer: "agents",
          preference: { mode: "persist", theme: "grove" },
        }),
      ),
    ).toEqual({ applied: false, reason: "theme-write-failed" });
  });

  it("closes revoked watchers and restores stored appearance when the writer is revoked", async () => {
    const f = fixture();
    const emit = vi.fn();
    f.themeProvider.openStream!({ name: "watchState", input: {}, context, caller, emit });
    await f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove" },
      }),
    );
    f.setInstallations([]);
    expect(f.overlay.getSnapshot()).toBeNull();
    expect(emit).toHaveBeenLastCalledWith({ type: "closed", value: null });
    const count = emit.mock.calls.length;
    f.setAppearance("ocean", "dark", true);
    expect(emit).toHaveBeenCalledTimes(count);
  });

  it("restores stored appearance when the writer loses its project grant", async () => {
    const f = fixture();
    await f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove" },
      }),
    );
    f.setInstallations(
      f.installations().map((item) => ({ ...item, grants: { ...item.grants, projectIds: [] } })),
    );
    expect(f.overlay.getSnapshot()).toBeNull();
  });

  it("stale disposal cannot clear a replacement on the same environment and installation", async () => {
    const overlay = createMobileExtensionThemeOverlayStore();
    const a = fixture(ENV, overlay);
    const b = fixture(ENV, overlay);
    await a.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove" },
      }),
    );
    await b.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "ocean" },
      }),
    );
    a.providers.dispose();
    expect(overlay.getSnapshot()?.patch.themeId).toBe("ocean");
    b.providers.dispose();
    expect(overlay.getSnapshot()).toBeNull();
  });

  it("fences a pending settings response after environment disposal", async () => {
    const f = fixture();
    let saved!: () => void;
    f.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    const result = f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "persist", theme: "grove" },
      }),
    );
    f.providers.dispose();
    saved();
    await expect(result).rejects.toBeDefined();
    expect(f.overlay.getSnapshot()).toBeNull();
  });

  it("isolates same thread IDs across environments and disposes the old provider", async () => {
    const overlay = createMobileExtensionThemeOverlayStore();
    const a = fixture(ENV, overlay);
    const b = fixture(EnvironmentId.make("env-b"), overlay);
    const bContext = {
      ...context,
      resource: { ...context.resource, environmentId: EnvironmentId.make("env-b") },
    };
    await a.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove" },
      }),
    );
    await b.themeProvider.invoke(
      call(
        "applyPreference",
        { writer: "agents", preference: { mode: "session", theme: "ocean" } },
        bContext,
      ),
    );
    a.providers.dispose();
    expect(overlay.getSnapshot()?.patch.themeId).toBe("ocean");
    await expect(
      a.navigation.invoke(call("openThread", { threadId: "thread-a" })),
    ).rejects.toMatchObject({ code: "client-provider-unavailable" });
    await b.navigation.invoke(call("openThread", { threadId: "thread-a" }, bContext));
    expect(b.navigateThread).toHaveBeenCalledWith(
      { environmentId: "env-b", threadId: "thread-a" },
      expect.any(AbortSignal),
    );
    b.providers.dispose();
    expect(overlay.getSnapshot()).toBeNull();
  });

  it("routes only existing same-project threads and refuses unavailable pack surfaces", async () => {
    const f = fixture();
    expect(await f.navigation.invoke(call("openThread", { threadId: "missing" }))).toEqual({
      status: "refused",
      reason: "unknown-thread",
    });
    expect(await f.navigation.invoke(call("openThread", { threadId: "foreign" }))).toEqual({
      status: "refused",
      reason: "out-of-scope",
    });
    expect(
      await f.navigation.invoke(
        call("openThread", { threadId: "thread-a", surfaceId: "agents/main" }),
      ),
    ).toEqual({ status: "refused", reason: "surface-not-found" });
    expect(f.navigateThread).not.toHaveBeenCalled();
    expect(await f.navigation.invoke(call("openThread", { threadId: "thread-a" }))).toEqual({
      status: "opened",
      threadId: "thread-a",
    });
    expect(f.navigateThread).toHaveBeenCalledWith(
      { environmentId: ENV, threadId: "thread-a" },
      expect.any(AbortSignal),
    );
  });

  it("opens only broker-resolved http(s) agent sessions in the scoped thread", async () => {
    const f = fixture();
    for (const url of [
      "javascript:alert(1)",
      "file:///secret",
      "https://user:pass@example.com",
      "t3code://threads/foreign",
    ])
      expect(await f.navigation.invoke(call("openSession", { agentId: "agent-a", url }))).toEqual({
        status: "refused",
        reason: "no-session",
      });
    expect(f.openSession).not.toHaveBeenCalled();
    expect(
      await f.navigation.invoke(
        call("openSession", { agentId: "agent-a", url: "https://example.com/session" }),
      ),
    ).toEqual({ status: "opened", agentId: "agent-a", opener: "browser-window" });
    expect(f.openSession).toHaveBeenCalledWith(
      "https://example.com/session",
      expect.any(AbortSignal),
    );
    f.openSession.mockResolvedValueOnce(false);
    expect(
      await f.navigation.invoke(
        call("openSession", { agentId: "agent-a", url: "https://example.com/session" }),
      ),
    ).toEqual({ status: "refused", reason: "opener-refused" });
  });

  it("denies cancelled calls without effects and closes all watchers on disposal", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.navigation.invoke({
        ...call("openThread", { threadId: "thread-a" }),
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
    expect(f.navigateThread).not.toHaveBeenCalled();
    const emit = vi.fn();
    f.themeProvider.openStream!({ name: "watchState", input: {}, context, caller, emit });
    f.providers.dispose();
    expect(emit).toHaveBeenLastCalledWith({ type: "closed", value: null });
    expect(() =>
      f.themeProvider.openStream!({ name: "watchState", input: {}, context, caller, emit }),
    ).toThrow();
  });
  it("supports native AbortSignals without throwIfAborted or static any", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    Object.defineProperty(signal, "throwIfAborted", { value: undefined });
    const any = vi.spyOn(AbortSignal, "any").mockImplementation(() => {
      throw new Error("native has no AbortSignal.any");
    });
    try {
      expect(
        await f.navigation.invoke({ ...call("openThread", { threadId: "thread-a" }), signal }),
      ).toEqual({ status: "opened", threadId: "thread-a" });
      expect(
        await f.themeProvider.invoke({
          ...call("applyPreference", {
            writer: "agents",
            preference: { mode: "persist", theme: "grove" },
          }),
          signal,
        }),
      ).toEqual({ applied: true, propagatedTo: "storage-origin" });
    } finally {
      any.mockRestore();
    }
  });
  it("disposes every watcher and restores a preview when a stream sink throws", async () => {
    const f = fixture();
    await f.themeProvider.invoke(
      call("applyPreference", {
        writer: "agents",
        preference: { mode: "session", theme: "grove" },
      }),
    );
    const broken = vi.fn();
    const healthy = vi.fn();
    f.themeProvider.openStream!({ name: "watchState", input: {}, context, caller, emit: broken });
    f.themeProvider.openStream!({ name: "watchState", input: {}, context, caller, emit: healthy });
    broken.mockImplementation(() => {
      throw new Error("socket closed");
    });
    expect(() => f.providers.dispose()).not.toThrow();
    expect(healthy).toHaveBeenLastCalledWith({ type: "closed", value: null });
    expect(f.overlay.getSnapshot()).toBeNull();
  });
});
