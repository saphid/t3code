import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ClientProviderCaller, ClientProviderEmitEvent } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";

const persistenceMocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: persistenceMocks }),
}));

vi.mock("../components/ThreadTerminalDrawer", () => ({
  terminalThemeFromApp: () => ({}),
}));

import {
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
  persistClientSettingsPatch,
} from "../hooks/useSettings";
import { createPreferencesClientProvider, type ClientProviderDeps } from "./clientProviders";
import type { ClientProviderInvokeCall } from "./clientProviderTypes";
import type { InstalledPackage } from "./installedController";

const ENV = "env-a";
const INSTALL = "ext.a";
const READ = "t3.ui/preferences.read";
const WRITE = "t3.ui/preferences.write";

const caller: ClientProviderCaller = {
  installationId: INSTALL,
  contentHash: "hash-a",
  installationGeneration: 1,
};

const context: ViewContext = {
  client: "web",
  resource: {
    namespace: "t3.extensions",
    id: INSTALL,
    environmentId: ENV,
    projectId: "project-a",
  },
};

function makeDeps(capabilities: readonly string[]): ClientProviderDeps {
  const installed = {
    id: INSTALL,
    contentHash: "hash-a",
    enabled: true,
    installationGeneration: 1,
    grants: { capabilities: [...capabilities], projectIds: [ProjectId.make("project-a")] },
  } as unknown as InstalledPackage;
  return {
    environmentId: EnvironmentId.make(ENV),
    client: "web",
    emit: vi.fn(),
    installations: () => [installed],
  };
}

const invokeCall = (method: string, input: Json): ClientProviderInvokeCall => ({
  method,
  input,
  context,
  caller,
  signal: new AbortController().signal,
});

beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  persistenceMocks.getClientSettings
    .mockReset()
    .mockResolvedValue({ ...DEFAULT_CLIENT_SETTINGS, wordWrap: false });
  persistenceMocks.setClientSettings.mockReset().mockResolvedValue(undefined);
});

describe("preferences client provider", () => {
  it("reads the persisted value, not the pre-hydration default", async () => {
    const provider = createPreferencesClientProvider(makeDeps([READ]));
    await expect(provider.invoke(invokeCall("getPreferences", {}))).resolves.toEqual({
      wordWrap: false,
    });
  });

  it("denies reads and writes without their grants", async () => {
    const provider = createPreferencesClientProvider(makeDeps([READ]));
    await expect(
      createPreferencesClientProvider(makeDeps([])).invoke(invokeCall("getPreferences", {})),
    ).rejects.toMatchObject({ code: "client-target-denied" });
    await expect(
      provider.invoke(
        invokeCall("applyPreferences", { writer: INSTALL, patch: { wordWrap: true } }),
      ),
    ).rejects.toMatchObject({ code: "client-target-denied" });
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
  });

  it("rejects a writer other than the calling installation", async () => {
    const provider = createPreferencesClientProvider(makeDeps([READ, WRITE]));
    await expect(
      provider.invoke(
        invokeCall("applyPreferences", { writer: "ext.other", patch: { wordWrap: true } }),
      ),
    ).rejects.toMatchObject({ code: "client-target-denied" });
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
  });

  it("persists before its receipt and keeps the rest of the settings", async () => {
    const provider = createPreferencesClientProvider(makeDeps([READ, WRITE]));
    const receipt = await provider.invoke(
      invokeCall("applyPreferences", { writer: INSTALL, patch: { wordWrap: true } }),
    );
    expect(receipt).toEqual({ applied: true, preferences: { wordWrap: true } });
    expect(persistenceMocks.setClientSettings).toHaveBeenCalledWith({
      ...DEFAULT_CLIENT_SETTINGS,
      wordWrap: true,
    });
    expect(getClientSettings().wordWrap).toBe(true);
  });

  it("reports a failed persist without publishing the value", async () => {
    persistenceMocks.setClientSettings.mockRejectedValue(new Error("disk full"));
    const provider = createPreferencesClientProvider(makeDeps([READ, WRITE]));
    const receipt = await provider.invoke(
      invokeCall("applyPreferences", { writer: INSTALL, patch: { wordWrap: true } }),
    );
    expect(receipt).toEqual({
      applied: false,
      reason: "persist-failed",
      preferences: { wordWrap: false },
    });
    expect(getClientSettings().wordWrap).toBe(false);
  });

  it("names an empty patch instead of claiming a write", async () => {
    const provider = createPreferencesClientProvider(makeDeps([READ, WRITE]));
    await expect(
      provider.invoke(invokeCall("applyPreferences", { writer: INSTALL, patch: {} })),
    ).resolves.toEqual({ applied: false, reason: "empty-patch", preferences: { wordWrap: false } });
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
  });

  it("streams a hydrated snapshot, then one frame per preference change", async () => {
    const provider = createPreferencesClientProvider(makeDeps([READ]));
    const events: ClientProviderEmitEvent[] = [];
    const close = await provider.openStream!({
      name: "watchPreferences",
      input: null,
      context,
      caller,
      emit: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "snapshot", value: { wordWrap: false } }]);
    // An unrelated setting is not a preference change.
    await persistClientSettingsPatch({ fontSizeTerminal: 20 }, async () => {});
    expect(events).toHaveLength(1);
    await persistClientSettingsPatch({ wordWrap: true }, async () => {});
    expect(events).toEqual([
      { type: "snapshot", value: { wordWrap: false } },
      { type: "data", value: { wordWrap: true } },
    ]);
    close();
    await persistClientSettingsPatch({ wordWrap: false }, async () => {});
    expect(events).toHaveLength(2);
  });
});
