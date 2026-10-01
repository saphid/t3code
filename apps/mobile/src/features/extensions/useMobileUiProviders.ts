import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLinkTo } from "@react-navigation/native";
import { useLayoutEffect, useRef, useState } from "react";
import type { EnvironmentId, ExtensionInstallation } from "@t3tools/contracts";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentSnapshotAtom } from "../../state/shell";
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
  const appearance = useAppearancePreferences();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const shell = useAtomValue(environmentSnapshotAtom(options.environmentId));
  const linkTo = useLinkTo();
  const [mounted, setMounted] = useState<{
    environmentId: EnvironmentId;
    providers: Providers;
  } | null>(null);
  const runtime = useRef({ options, appearance, shell, savePreferences, linkTo });
  useLayoutEffect(() => {
    runtime.current = { options, appearance, shell, savePreferences, linkTo };
    if (mounted?.environmentId === options.environmentId) {
      mounted.providers.notifyInstallationsChanged();
    }
  }, [options, appearance, shell, savePreferences, linkTo, mounted]);

  useLayoutEffect(() => {
    const environmentId = options.environmentId;
    const providers = createMobileUiProviders({
      environmentId,
      installations: () => runtime.current.options.installations,
      installationGeneration: (id) => runtime.current.options.installationGeneration(id),
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
      readThread: (id) => runtime.current.shell?.threads.find((thread) => thread.id === id) ?? null,
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
  }, [options.environmentId]);

  return mounted?.environmentId === options.environmentId ? mounted.providers : null;
}
