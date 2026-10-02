import type { EnvironmentId, ExtensionInstallation } from "@t3tools/contracts";
import { MOBILE_UI_THEME_CSS_VARS } from "./mobileUiThemeTokens";
import type * as Schema from "effect/Schema";
import type { ThemeColors } from "@t3tools/shared/themePalettes";
import {
  MOBILE_THEME_IDS,
  type MobileThemeId,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../lib/mobileTheme";
import type {
  MobileThemePreferencePatch,
  createMobileExtensionThemeOverlayStore,
} from "./mobileExtensionThemeOverlay";
import { checkMobileUiAbort, withMobileUiSignal } from "./mobileUiAbort";

type Json = typeof Schema.Json.Type;

import { ClientProviderOpError as MobileUiProviderError } from "@t3tools/client-runtime/client-provider-connection";
export { ClientProviderOpError as MobileUiProviderError } from "@t3tools/client-runtime/client-provider-connection";
export type {
  ClientProviderInvokeCall as MobileUiProviderCall,
  ClientProviderStreamCall as MobileUiProviderStreamCall,
} from "@t3tools/client-runtime/client-provider-connection";
import type {
  ClientLocalProvider as SharedLocalProvider,
  ClientProviderInvokeCall as MobileUiProviderCall,
  ClientProviderStreamCall as MobileUiProviderStreamCall,
} from "@t3tools/client-runtime/client-provider-connection";

/** Native providers retain their synchronous watcher and async invoke boundary. */
export interface MobileUiLocalProvider extends SharedLocalProvider {
  invoke(call: MobileUiProviderCall): Promise<Json>;
  openStream?(call: MobileUiProviderStreamCall): () => void;
}

export interface MobileUiAppearanceSnapshot {
  readonly isReady: boolean;
  readonly theme: MobileThemeId;
  readonly themeIds: MobileThemeIds;
  readonly themeMode: MobileThemeMode;
  readonly systemDark: boolean;
  readonly effectiveTheme: MobileThemeId;
  readonly effectiveMode: MobileThemeMode;
  readonly appearance: "light" | "dark";
  readonly tokensByAppearance: Readonly<Record<"light" | "dark", ThemeColors>>;
}

export interface MobileUiProviderDeps {
  readonly environmentId: EnvironmentId;
  readonly installations: () => readonly ExtensionInstallation[] | undefined;
  /** The host's live registration epoch, independent of a WebView generation. */
  readonly installationGeneration: (id: string) => number | null;
  readonly readAppearance: () => MobileUiAppearanceSnapshot;
  readonly saveThemePreferences: (
    patch: MobileThemePreferencePatch,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly overlay: ReturnType<typeof createMobileExtensionThemeOverlayStore>;
  readonly readThread: (id: string) => { readonly projectId: string } | null;
  readonly navigateThread: (
    ref: { readonly environmentId: EnvironmentId; readonly threadId: string },
    signal: AbortSignal,
  ) => void | Promise<void>;
  /** The broker resolves URLs from the invoking thread's agent roster; the page supplies no URL. */
  readonly openSession: (url: string, signal: AbortSignal) => Promise<boolean>;
}

function denied(message: string): never {
  throw new MobileUiProviderError("client-target-denied", message);
}
function unavailable(operation: string): never {
  throw new MobileUiProviderError(
    "client-provider-unavailable",
    `${operation} is unsupported on mobile`,
  );
}
const object = (value: Json | undefined): Record<string, Json> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new MobileUiProviderError("provider-rejected", "Expected object input");
  return value as Record<string, Json>;
};
const string = (input: Record<string, Json>, key: string): string => {
  const value = input[key];
  if (typeof value !== "string" || !value)
    throw new MobileUiProviderError("provider-rejected", `Invalid ${key}`);
  return value;
};

const operations = (names: readonly string[], supported: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, supported.includes(name)]));
const unsupported = (names: readonly string[]) => ({
  reason: "unsupported-on-mobile",
  operations: operations(names, []),
});
/** Local discovery must filter other UI adapters even when a web sibling provides them. */
export const MOBILE_UI_CAPABILITIES: Readonly<
  Record<
    string,
    { readonly reason?: string; readonly operations: Readonly<Record<string, boolean>> }
  >
> = {
  "t3.ui/theme": {
    operations: operations(
      [
        "getState",
        "getTokens",
        "setPreference",
        "subscribeState",
        "getTerminalAppearance",
        "subscribeTerminalAppearance",
      ],
      ["getState", "getTokens", "setPreference", "subscribeState"],
    ),
  },
  "t3.ui/navigation": {
    operations: operations(
      ["openThread", "openAgentSession", "openFile", "openFileInBrowser"],
      ["openThread", "openAgentSession"],
    ),
  },
  "t3.ui/preferences": unsupported(["getPreferences", "setPreferences", "subscribePreferences"]),
  "t3.ui/keybindings": unsupported(["registerCommands", "unregisterCommands", "listConflicts"]),
  "t3.ui/notifications": unsupported(["notify", "update", "dismiss", "awaitAction"]),
  "t3.ui/panels": unsupported([
    "openSurface",
    "activateSurface",
    "closeSurface",
    "listSurfaces",
    "hideDock",
    "showDock",
    "getBrowserMiniPlayer",
    "setBrowserMiniPlayer",
  ]),
  "t3.ui/editor": unsupported(["openPath"]),
  "t3.ui/external": unsupported(["open", "openLink"]),
};

function preferencePatch(
  input: Record<string, Json>,
  current: MobileUiAppearanceSnapshot,
): MobileThemePreferencePatch | null {
  const theme = input.theme;
  const halves = input.themeHalves === undefined ? {} : object(input.themeHalves);
  const isTheme = (value: Json | undefined): value is MobileThemeId =>
    typeof value === "string" && (MOBILE_THEME_IDS as readonly string[]).includes(value);
  if (
    (theme !== undefined && !isTheme(theme)) ||
    Object.entries(halves).some(
      ([key, value]) => !["light", "dark"].includes(key) || !isTheme(value),
    )
  )
    return null;
  const mode = input.appearanceMode;
  if (mode !== undefined && mode !== "system" && mode !== "light" && mode !== "dark")
    throw new MobileUiProviderError("provider-rejected", "Invalid appearanceMode");
  const light = (halves.light ?? theme ?? current.themeIds.light) as MobileThemeId;
  const dark = (halves.dark ?? theme ?? current.themeIds.dark) as MobileThemeId;
  const nextAppearance =
    mode === "system"
      ? current.systemDark
        ? "dark"
        : "light"
      : mode === "light" || mode === "dark"
        ? mode
        : current.appearance;
  return {
    themeId: nextAppearance === "light" ? light : dark,
    lightThemeId: light,
    darkThemeId: dark,
    ...(mode === undefined ? {} : { themeMode: mode }),
  };
}

export function createMobileUiProviders(deps: MobileUiProviderDeps) {
  let disposed = false;
  const lifecycle = new AbortController();
  let ownedOverlay: ReturnType<typeof deps.overlay.getSnapshot> = null;
  const watchers = new Set<{ readonly call: MobileUiProviderStreamCall; last: string }>();
  const closeWatcher = (watcher: { readonly call: MobileUiProviderStreamCall; last: string }) => {
    watchers.delete(watcher);
    try {
      watcher.call.emit({ type: "closed", value: null });
    } catch {
      /* A retired socket must not prevent native cleanup. */
    }
  };
  const active = () => {
    if (disposed)
      throw new MobileUiProviderError(
        "client-provider-unavailable",
        "Mobile UI provider is disposed",
      );
  };
  const authorize = (
    call: Pick<MobileUiProviderCall, "caller" | "context">,
    grants: readonly string[],
  ) => {
    active();
    const installation = deps
      .installations()
      ?.find((item) => item.id === call.caller.installationId);
    if (
      !installation?.enabled ||
      installation.contentHash !== call.caller.contentHash ||
      deps.installationGeneration(installation.id) !== call.caller.installationGeneration
    )
      denied("Unknown, disabled or stale installation");
    if (
      call.context.client !== "mobile" ||
      call.context.resource.environmentId !== deps.environmentId
    )
      denied("Foreign mobile environment context");
    if (
      call.context.resource.projectId !== undefined &&
      !installation.grants.projectIds.includes(call.context.resource.projectId)
    )
      denied("Context outside granted project scope");
    if (grants.some((grant) => !installation.grants.capabilities.includes(grant)))
      denied("Missing mobile UI grant");
    return installation;
  };
  const appearance = () => {
    const snapshot = deps.readAppearance();
    if (!snapshot.isReady)
      throw new MobileUiProviderError(
        "client-provider-unavailable",
        "Mobile appearance settings are loading",
      );
    return snapshot;
  };
  const snapshot = (): Json => {
    const value = appearance();
    const overlay = deps.overlay.getSnapshot();
    return {
      theme: value.theme,
      resolvedTheme: value.appearance,
      systemDark: value.systemDark,
      followSystem: value.effectiveMode === "system",
      appearanceMode: value.themeMode,
      themeHalves: value.themeIds,
      effectiveTheme: overlay
        ? {
            kind: "session-overlay",
            theme: value.effectiveTheme,
            writer: overlay.owner.installationId,
          }
        : { kind: "stored", theme: value.effectiveTheme },
      sessionOverlay: overlay
        ? {
            theme: overlay.patch.themeId ?? value.effectiveTheme,
            writer: overlay.owner.installationId,
            ...(overlay.patch.themeMode === undefined
              ? {}
              : { appearanceMode: overlay.patch.themeMode }),
            themeHalves: {
              ...(overlay.patch.lightThemeId === undefined
                ? {}
                : { light: overlay.patch.lightThemeId }),
              ...(overlay.patch.darkThemeId === undefined
                ? {}
                : { dark: overlay.patch.darkThemeId }),
            },
          }
        : null,
    };
  };
  const notifyAppearanceChanged = () => {
    if (disposed) return;
    for (const watcher of watchers) {
      try {
        authorize(watcher.call, ["t3.ui/theme.read"]);
        const value = snapshot();
        const encoded = JSON.stringify([value, appearance().tokensByAppearance]);
        if (encoded === watcher.last) continue;
        watcher.last = encoded;
        watcher.call.emit({ type: "data", value });
      } catch {
        closeWatcher(watcher);
      }
    }
  };
  const theme: MobileUiLocalProvider = {
    async invoke(call): Promise<Json> {
      active();
      checkMobileUiAbort(call.signal);
      authorize(call, [
        call.method === "applyPreference" ? "t3.ui/theme.write" : "t3.ui/theme.read",
      ]);
      const input = object(call.input);
      if (call.method === "getState") return snapshot();
      if (call.method === "resolveTokens") {
        const mode = input.appearance ?? appearance().appearance;
        if (mode !== "light" && mode !== "dark")
          throw new MobileUiProviderError("provider-rejected", "Invalid appearance");
        return {
          tokens: { ...appearance().tokensByAppearance[mode] },
          cssVars: MOBILE_UI_THEME_CSS_VARS,
        };
      }
      if (call.method !== "applyPreference") return unavailable(call.method);
      if (string(input, "writer") !== call.caller.installationId)
        denied("Writer must be the calling installation");
      const preference = object(input.preference);
      if (preference.mode !== "persist" && preference.mode !== "session")
        throw new MobileUiProviderError("provider-rejected", "Invalid preference mode");
      const owner = {
        ...call.caller,
        environmentId: deps.environmentId,
        ...(call.context.resource.projectId === undefined
          ? {}
          : { projectId: call.context.resource.projectId }),
      };
      if (preference.clear === true) {
        deps.overlay.clear(owner);
        notifyAppearanceChanged();
        return { applied: true, propagatedTo: "connection" };
      }
      const patch = preferencePatch(preference, appearance());
      if (!patch) return { applied: false, reason: "unknown-theme" };
      if (preference.mode === "session") {
        if (typeof preference.theme !== "string")
          throw new MobileUiProviderError("provider-rejected", "Session preference needs a theme");
        ownedOverlay = { owner, patch };
        deps.overlay.set(ownedOverlay);
      } else {
        return withMobileUiSignal(
          [call.signal, lifecycle.signal],
          async (signal): Promise<Json> => {
            try {
              await deps.saveThemePreferences(patch, signal);
            } catch {
              checkMobileUiAbort(signal);
              return { applied: false, reason: "theme-write-failed" };
            }
            checkMobileUiAbort(signal);
            authorize(call, ["t3.ui/theme.write"]);
            deps.overlay.clear(owner);
            notifyAppearanceChanged();
            return { applied: true, propagatedTo: "storage-origin" };
          },
        );
      }
      // The native appearance layout effect publishes after the overlay has painted.
      return { applied: true, propagatedTo: "connection" };
    },
    openStream(call) {
      authorize(call, ["t3.ui/theme.read"]);
      if (call.name !== "watchState") return unavailable(call.name);
      const value = snapshot();
      const watcher = { call, last: JSON.stringify([value, appearance().tokensByAppearance]) };
      watchers.add(watcher);
      try {
        call.emit({ type: "snapshot", value });
      } catch (error) {
        watchers.delete(watcher);
        throw error;
      }
      return () => {
        watchers.delete(watcher);
      };
    },
  };
  const navigation: MobileUiLocalProvider = {
    async invoke(call): Promise<Json> {
      active();
      checkMobileUiAbort(call.signal);
      const installation = authorize(
        call,
        call.method === "openSession"
          ? ["t3.ui/navigation.open-session"]
          : ["t3.ui/navigation.open"],
      );
      const input = object(call.input);
      if (call.method !== "openThread" && call.method !== "openSession")
        return unavailable(call.method);
      const threadId =
        call.method === "openThread" ? string(input, "threadId") : call.context.resource.threadId;
      const thread = threadId ? deps.readThread(threadId) : null;
      if (!thread || !threadId) return { status: "refused", reason: "unknown-thread" };
      if (
        thread.projectId !== call.context.resource.projectId ||
        !installation.grants.projectIds.some((id) => id === thread.projectId)
      ) {
        if (call.method === "openThread") return { status: "refused", reason: "out-of-scope" };
        denied("Navigation target outside invoking project");
      }
      return withMobileUiSignal([call.signal, lifecycle.signal], async (signal): Promise<Json> => {
        if (call.method === "openThread") {
          if (input.surfaceId !== undefined)
            return { status: "refused", reason: "surface-not-found" };
          await deps.navigateThread({ environmentId: deps.environmentId, threadId }, signal);
          checkMobileUiAbort(signal);
          return { status: "opened", threadId };
        }
        const agentId = string(input, "agentId");
        let url: URL;
        try {
          url = new URL(string(input, "url"));
        } catch {
          return { status: "refused", reason: "no-session" };
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          !url.hostname ||
          url.username ||
          url.password
        )
          return { status: "refused", reason: "no-session" };
        let opened = false;
        try {
          opened = await deps.openSession(url.href, signal);
        } catch {
          checkMobileUiAbort(signal);
        }
        checkMobileUiAbort(signal);
        return opened
          ? { status: "opened", agentId, opener: "browser-window" }
          : { status: "refused", reason: "opener-refused" };
      });
    },
  };
  return {
    providers: new Map<string, MobileUiLocalProvider>([
      ["t3.client/theme", theme],
      ["t3.client/navigation", navigation],
    ]),
    // 1.0 navigation includes thread/session routing. Advertising 1.1 would falsely promise file panels.
    descriptors: [
      { id: "t3.client/theme", version: "1.0.0" },
      { id: "t3.client/navigation", version: "1.0.0" },
    ],
    capabilities: MOBILE_UI_CAPABILITIES,
    notifyAppearanceChanged,
    resetConnection() {
      for (const watcher of watchers) closeWatcher(watcher);
      const overlay = deps.overlay.getSnapshot();
      if (overlay && overlay === ownedOverlay) deps.overlay.clear(overlay.owner);
      ownedOverlay = null;
    },
    notifyInstallationsChanged() {
      if (disposed) return;
      const overlay = deps.overlay.getSnapshot();
      if (overlay && overlay === ownedOverlay) {
        const installation = deps
          .installations()
          ?.find((item) => item.id === overlay.owner.installationId);
        if (
          !installation?.enabled ||
          installation.contentHash !== overlay.owner.contentHash ||
          deps.installationGeneration(installation.id) !== overlay.owner.installationGeneration ||
          !installation.grants.capabilities.includes("t3.ui/theme.write") ||
          (overlay.owner.projectId !== undefined &&
            !installation.grants.projectIds.some((id) => id === overlay.owner.projectId))
        )
          deps.overlay.clear(overlay.owner);
      }
      notifyAppearanceChanged();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.abort();
      for (const watcher of watchers) {
        closeWatcher(watcher);
      }
      const overlay = deps.overlay.getSnapshot();
      if (overlay && overlay === ownedOverlay) deps.overlay.clear(overlay.owner);
    },
  };
}
