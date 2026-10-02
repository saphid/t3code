import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { MobileExtensionTransport, MobileInstallation } from "./mobileExtensionHost";
import type { MobileUiProviders } from "./mobileClientProviderConnection";
import { DEFAULT_MOBILE_THEME_ID, getMobileThemeVariables } from "../../lib/mobileTheme";
import { MobileExtensionSurface } from "./MobileExtensionSurface";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const native = vi.hoisted(() => ({
  currentState: "active",
  appStateChanged: (_state: string) => {},
  changed: () => {},
  transport: undefined as MobileExtensionTransport | undefined,
  ui: undefined as MobileUiProviders | undefined,
  linkTo: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return native.currentState;
    },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      native.appStateChanged = callback;
      return { remove() {} };
    },
  },
  Keyboard: { addListener: () => ({ remove() {} }) },
  Pressable: "pressable",
  Text: "text",
  View: "view",
}));
vi.mock("react-native-webview", async () => {
  const React = await import("react");
  return {
    WebView: React.forwardRef((props: Record<string, unknown>, ref) => {
      const [packState, setPackState] = React.useState(0);
      React.useImperativeHandle(ref, () => ({ injectJavaScript() {} }));
      return React.createElement("webview", { ...props, packState, setPackState });
    }),
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("../../../.generated/mobile-extension/page", () => ({ default: "fixture page" }));
vi.mock("./mobileExtensionTransport", () => ({
  mobileExtensionTransport: async (
    _environment: string,
    _installation: string,
    _hash: () => string,
    _signal: AbortSignal,
    ui: MobileUiProviders,
  ) => {
    native.ui = ui;
    return native.transport;
  },
}));

vi.mock("@effect/atom-react", () => ({ useAtomSet: () => async () => {} }));
vi.mock("@react-navigation/native", () => ({ useLinkTo: () => native.linkTo }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({
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
  }),
}));
vi.mock("../../state/preferences", () => ({ updateMobilePreferencesAtom: {} }));
vi.mock("../../state/shell", () => ({ environmentSnapshotAtom: (id: string) => id }));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: { get: () => ({ threads: [{ id: "target", projectId: "p" }] }) },
}));
vi.mock("../../lib/openExternalUrl", () => ({ tryOpenExternalUrl: async () => true }));

const context = {
  resource: { namespace: "t3.thread", id: "t", environmentId: "e", projectId: "p", threadId: "t" },
  client: "mobile",
};
function installation(): MobileInstallation {
  return {
    id: "t3.pack",
    enabled: true,
    contentHash: "a".repeat(64),
    installationGeneration: 37,
    grants: {
      capabilities: ["t3.test/read", "t3.ui/theme.read", "t3.ui/navigation.open"],
      projectIds: ["p"],
    },
    package: {
      format: 4,
      clientEntry: "client.mjs",
      manifest: {
        id: "t3.pack",
        apiVersion: 1,
        version: "1.0.0",
        surfaces: [
          {
            id: "t3.pack/view",
            title: "Pack",
            scope: "thread",
            placements: ["side-panel"],
            clients: ["mobile"],
            stateVersion: 1,
            capabilities: ["t3.test/read"],
          },
        ],
      },
      tools: [],
      dependencies: [],
      provides: [],
      requires: [],
      assets: [],
    },
  };
}
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  native.currentState = "active";
  native.ui = undefined;
  native.linkTo.mockClear();
  vi.restoreAllMocks();
});
async function mount() {
  let item = installation();
  const list = vi.fn(async () => [item]);
  native.transport = {
    list,
    client: async (_id, contentHash) => ({ code: "fixture code", contentHash }),
    asset: async () => new Uint8Array(),
    invokeApi: async () => null,
    invokeTool: async () => null,
    discoverApis: async () => [],
    subscribeApi: async function* () {},
    watch: (changed) => {
      native.changed = changed;
      // The server replays the current catalogue on every subscription.
      queueMicrotask(changed);
      return () => {};
    },
  };
  await act(async () => {
    renderer = create(
      <MobileExtensionSurface
        environmentId="e"
        installationId="t3.pack"
        surfaceId="t3.pack/view"
        context={context}
        environmentLabel="fixture"
        cssVars={{}}
      />,
    );
  });
  const webview = () => renderer!.root.findByType("webview");
  await act(async () => {
    webview().props.setPackState(42);
  });
  return {
    webview,
    list,
    set: (value: MobileInstallation) => {
      item = value;
    },
  };
}
it("retains the WebView instance and pack state during reconnect replay and unrelated catalogue changes", async () => {
  const f = await mount();
  const first = f.webview();
  let finish: (items: MobileInstallation[]) => void = () => {};
  f.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    native.changed();
  });
  expect(f.webview()).toBe(first);
  expect(f.webview().props.packState).toBe(42);
  await act(async () => {
    finish([installation(), { ...installation(), id: "other" }]);
  });
  expect(f.webview()).toBe(first);
  expect(f.webview().props.packState).toBe(42);
  // Grant ordering carries no change in authority.
  f.set({
    ...installation(),
    grants: { capabilities: ["extra", "t3.test/read"], projectIds: ["p", "q"] },
  });
  await act(async () => {
    native.changed();
  });
  const reordered = f.webview();
  await act(async () => {
    reordered.props.setPackState(42);
  });
  f.set({
    ...installation(),
    grants: { capabilities: ["t3.test/read", "extra"], projectIds: ["q", "p"] },
  });
  await act(async () => {
    native.changed();
  });
  expect(f.webview()).toBe(reordered);
  expect(f.webview().props.packState).toBe(42);
});
it("retains the WebView and pack state through inactive -> active", async () => {
  const f = await mount();
  const first = f.webview();
  await act(async () => {
    native.appStateChanged("inactive");
  });
  expect(f.webview()).toBe(first);
  expect(f.webview().props.packState).toBe(42);
  await act(async () => {
    native.appStateChanged("active");
  });
  expect(f.webview()).toBe(first);
  expect(f.webview().props.packState).toBe(42);
});
it("can mount while inactive, but still suspends in background and remounts on active", async () => {
  native.currentState = "inactive";
  const f = await mount();
  const first = f.webview();
  await act(async () => {
    native.appStateChanged("background");
  });
  expect(renderer!.root.findAllByType("webview")).toHaveLength(0);
  await act(async () => {
    native.appStateChanged("inactive");
  });
  expect(renderer!.root.findAllByType("webview")).toHaveLength(0);
  await act(async () => {
    native.appStateChanged("active");
  });
  expect(f.webview()).not.toBe(first);
  expect(f.webview().props.packState).toBe(0);
});
it.each(["hash", "grants"])("remounts the WebView for a real %s change", async (change) => {
  const f = await mount();
  const first = f.webview();
  const item = installation();
  f.set(
    change === "hash"
      ? { ...item, contentHash: "b".repeat(64) }
      : {
          ...item,
          grants: { ...item.grants, capabilities: [...item.grants.capabilities, "extra"] },
        },
  );
  await act(async () => {
    native.changed();
  });
  expect(f.webview()).not.toBe(first);
  expect(f.webview().props.packState).toBe(0);
});
it("stops automatic recovery after three WebView process crashes until Retry", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const f = await mount();
  await act(async () => {
    f.webview().props.onContentProcessDidTerminate();
  });
  await act(async () => {
    f.webview().props.onRenderProcessGone();
  });
  await act(async () => {
    f.webview().props.onContentProcessDidTerminate();
  });
  expect(renderer!.root.findAllByType("webview")).toHaveLength(0);
  expect(renderer!.root.findAllByType("text")[0]!.props.children).toBe("Connection unavailable");
  await act(async () => {
    native.changed();
    native.appStateChanged("background");
    native.appStateChanged("active");
  });
  expect(renderer!.root.findAllByType("webview")).toHaveLength(0);
  await act(async () => {
    renderer!.root.findByProps({ accessibilityRole: "button" }).props.onPress();
  });
  expect(f.webview().props.packState).toBe(0);
  await act(async () => {
    f.webview().props.onRenderProcessGone();
  });
  expect(renderer!.root.findAllByType("webview")).toHaveLength(1);
});

it("mounts native UI providers with the catalogue epoch and disposes them with the surface owner", async () => {
  await mount();
  const ui = native.ui!;
  const caller = {
    installationId: "t3.pack",
    contentHash: "a".repeat(64),
    installationGeneration: 37,
  };
  const request = {
    method: "openThread",
    input: { threadId: "target" },
    context: {
      ...context,
      resource: {
        ...context.resource,
        environmentId: "e" as import("@t3tools/contracts").EnvironmentId,
        projectId: "p" as import("@t3tools/contracts").ProjectId,
        threadId: "t" as import("@t3tools/contracts").ThreadId,
      },
    },
    caller,
    signal: new AbortController().signal,
  };
  expect(await ui.providers.get("t3.client/navigation")!.invoke(request)).toEqual({
    status: "opened",
    threadId: "target",
  });
  expect(native.linkTo).toHaveBeenCalledWith("/threads/e/target");
  await expect(
    ui.providers
      .get("t3.client/navigation")!
      .invoke({ ...request, caller: { ...caller, installationGeneration: 1 } }),
  ).rejects.toMatchObject({ code: "client-target-denied" });
  await act(async () => renderer!.unmount());
  renderer = undefined;
  await expect(ui.providers.get("t3.client/navigation")!.invoke(request)).rejects.toMatchObject({
    code: "client-provider-unavailable",
  });
});
