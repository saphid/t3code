// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ExtensionInstallation } from "@t3tools/contracts";
import { DEFAULT_MOBILE_THEME_ID, getMobileThemeVariables } from "../../lib/mobileTheme";
import { useMobileUiProviders } from "./useMobileUiProviders";

const state = vi.hoisted(() => ({
  shell: { threads: [{ id: "thread-a", projectId: "project-a" }] },
  listeners: new Set<() => void>(),
  save: vi.fn(),
  linkTo: vi.fn(),
  appearance: {},
}));
vi.mock("@effect/atom-react", () => ({
  useAtomSet: () => state.save,
  useAtomValue: () =>
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      () => state.shell,
    ),
}));
vi.mock("@react-navigation/native", () => ({ useLinkTo: () => state.linkTo }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => state.appearance,
}));
vi.mock("../../state/preferences", () => ({ updateMobilePreferencesAtom: {} }));
vi.mock("../../state/shell", () => ({ environmentSnapshotAtom: (id: string) => id }));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: { get: () => state.shell },
}));
vi.mock("../../lib/openExternalUrl", () => ({ tryOpenExternalUrl: vi.fn() }));

const environmentId = EnvironmentId.make("env-a");
const projectId = ProjectId.make("project-a");
const caller = { installationId: "agents", contentHash: "a".repeat(64), installationGeneration: 1 };
const installations: readonly ExtensionInstallation[] = [
  {
    id: "agents",
    contentHash: caller.contentHash,
    enabled: true,
    grants: {
      capabilities: ["t3.ui/theme.read", "t3.ui/navigation.open"],
      projectIds: [projectId],
    },
    package: {},
  },
];
const installationGeneration = () => 1;

describe("mobile UI provider binding", () => {
  it("reads current threads lazily and skips appearance work for unrelated host renders", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.appearance = {
      isReady: true,
      storedThemeId: DEFAULT_MOBILE_THEME_ID,
      storedThemeIds: { light: DEFAULT_MOBILE_THEME_ID, dark: DEFAULT_MOBILE_THEME_ID },
      storedThemeMode: "system",
      systemDark: false,
      themeId: DEFAULT_MOBILE_THEME_ID,
      themeIds: { light: DEFAULT_MOBILE_THEME_ID, dark: DEFAULT_MOBILE_THEME_ID },
      themeMode: "system",
      themeAppearance: "light",
      themeVariablesByAppearance: {
        light: getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "light"),
        dark: getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "dark"),
      },
    };
    let providers: ReturnType<typeof useMobileUiProviders> = null;
    let renders = 0;
    let activeInstallations = installations;
    function Host() {
      const next = useMobileUiProviders({
        environmentId,
        installations: activeInstallations,
        installationGeneration,
      });
      useLayoutEffect(() => {
        renders++;
        providers = next;
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(() => root.render(createElement(Host)));
      const mounted = providers!;
      const notify = vi.spyOn(mounted, "notifyInstallationsChanged");
      const renderCount = renders;
      await act(() => {
        state.shell = { threads: [{ id: "thread-a", projectId: "project-b" }] };
        for (const listener of state.listeners) listener();
      });
      expect(renders).toBe(renderCount);
      await act(() => root.render(createElement(Host)));
      expect(notify).not.toHaveBeenCalled();
      const navigation = mounted.providers.get("t3.client/navigation")!;
      const call = {
        method: "openThread",
        input: { threadId: "thread-a" },
        caller,
        context: {
          client: "mobile" as const,
          resource: {
            namespace: "t3.thread",
            id: "thread-a",
            environmentId,
            projectId,
            threadId: ThreadId.make("thread-a"),
          },
        },
        signal: new AbortController().signal,
      };
      expect(await navigation.invoke(call)).toEqual({ status: "refused", reason: "out-of-scope" });
      state.shell = { threads: [{ id: "thread-a", projectId: "project-a" }] };
      expect(await navigation.invoke(call)).toEqual({ status: "opened", threadId: "thread-a" });
      expect(state.linkTo).toHaveBeenLastCalledWith("/threads/env-a/thread-a");
      const emit = vi.fn();
      mounted.providers.get("t3.client/theme")!.openStream!({
        name: "watchState",
        input: {},
        caller,
        context: call.context,
        emit,
      });
      state.appearance = { ...state.appearance, systemDark: true, themeAppearance: "dark" };
      await act(() => root.render(createElement(Host)));
      expect(emit).toHaveBeenLastCalledWith({
        type: "data",
        value: expect.objectContaining({ resolvedTheme: "dark" }),
      });
      activeInstallations = [];
      await act(() => root.render(createElement(Host)));
      expect(emit).toHaveBeenLastCalledWith({ type: "closed", value: null });
    } finally {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
