import { useAtomSet } from "@effect/atom-react";
import { useLinkTo } from "@react-navigation/native";
import { useLayoutEffect, useRef, useState } from "react";
import type { EnvironmentId, ExtensionInstallation } from "@t3tools/contracts";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentSnapshotAtom } from "../../state/shell";
import { appAtomRegistry } from "../../state/atom-registry";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { mobileExtensionThemeOverlayStore } from "./mobileExtensionThemeOverlay";
import { createMobileUiProviders, type MobileUiAppearanceSnapshot } from "./mobileUiProviders";
import { mobileUiThemeTokens } from "./mobileUiThemeTokens";
import { checkMobileUiAbort } from "./mobileUiAbort";

type Providers = ReturnType<typeof createMobileUiProviders>;

/** A1 passes this provider map/descriptors to its socket-owned connect loop and stamps only its connection id. */
export function useMobileUiProviders(options: {
  readonly environmentId: EnvironmentId;
  readonly installations: readonly ExtensionInstallation[] | undefined;
  readonly installationGeneration: (id: string) => number | null;
}) {
  const { environmentId, installations, installationGeneration } = options;
  const appearance = useAppearancePreferences();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const linkTo = useLinkTo();
  const [mounted, setMounted] = useState<{
    environmentId: EnvironmentId;
    providers: Providers;
  } | null>(null);
  const runtime = useRef({
    installations,
    installationGeneration,
    appearance,
    savePreferences,
    linkTo,
  });
  useLayoutEffect(() => {
    runtime.current = {
      installations,
      installationGeneration,
      appearance,
      savePreferences,
      linkTo,
    };
    if (mounted?.environmentId === environmentId) {
      mounted.providers.notifyInstallationsChanged();
    }
  }, [
    environmentId,
    installations,
    installationGeneration,
    appearance,
    savePreferences,
    linkTo,
    mounted,
  ]);

  useLayoutEffect(() => {
    const providers = createMobileUiProviders({
      environmentId,
      installations: () => runtime.current.installations,
      installationGeneration: (id) => runtime.current.installationGeneration(id),
      overlay: mobileExtensionThemeOverlayStore,
      readAppearance: (): MobileUiAppearanceSnapshot => {
        const value = runtime.current.appearance;
        return {
          isReady: value.isReady,
          theme: value.storedThemeId,
          themeIds: value.storedThemeIds,
          themeMode: value.storedThemeMode,
          systemDark: value.systemDark,
          effectiveTheme: value.themeId,
          effectiveMode: value.themeMode,
          appearance: value.themeAppearance,
          tokensByAppearance: {
            light: mobileUiThemeTokens(
              value.themeIds.light,
              "light",
              value.themeVariablesByAppearance.light,
            ),
            dark: mobileUiThemeTokens(
              value.themeIds.dark,
              "dark",
              value.themeVariablesByAppearance.dark,
            ),
          },
        };
      },
      saveThemePreferences: async (patch, signal) => {
        checkMobileUiAbort(signal);
        await runtime.current.savePreferences(patch);
        checkMobileUiAbort(signal);
      },
      readThread: (id) =>
        appAtomRegistry
          .get(environmentSnapshotAtom(environmentId))
          ?.threads.find((thread) => thread.id === id) ?? null,
      navigateThread: (ref, signal) => {
        checkMobileUiAbort(signal);
        runtime.current.linkTo(
          `/threads/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`,
        );
      },
      openSession: (url, signal) => {
        checkMobileUiAbort(signal);
        return tryOpenExternalUrl(url, "markdown-link");
      },
    });
    setMounted({ environmentId, providers });
    return () => providers.dispose();
  }, [environmentId]);

  return mounted?.environmentId === environmentId ? mounted.providers : null;
}
