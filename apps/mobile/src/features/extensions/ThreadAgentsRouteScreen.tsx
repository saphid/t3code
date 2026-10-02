import { useMemo } from "react";
import { mobileExtensionCssVars } from "./mobileUiThemeTokens";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { View } from "react-native";
import { EmptyState } from "../../components/EmptyState";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { EnvironmentId } from "@t3tools/contracts";
import { useMobileAgentsEntry } from "./useMobileAgentsEntry";
import { mobileAgentsNotice } from "./mobileAgentsEntry";
import { MobileExtensionSurface } from "./MobileExtensionSurface";

export function ThreadAgentsRouteScreen(
  props: StaticScreenProps<{ environmentId: string; threadId: string }>,
) {
  const navigation = useNavigation();
  const { entry, context, catalogue, refresh, environment } = useMobileAgentsEntry(
    props.route.params.environmentId,
  );
  const { themeVariables, themeId, themeAppearance } = useAppearancePreferences();
  const cssVars = useMemo(
    () => mobileExtensionCssVars(themeId, themeAppearance, themeVariables),
    [themeId, themeAppearance, themeVariables],
  );
  const { onReconnectEnvironment } = useRemoteConnections();
  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Thread", props.route.params));
  };
  return (
    <View className="flex-1 bg-screen">
      <ScreenHeader
        title="Agents"
        onBack={close}
        backInSplitView={{
          accessibilityLabel: "Back to chat",
          icon: "chevron.left",
          onPress: close,
        }}
        actions={[{ accessibilityLabel: "Close Agents", icon: "xmark", onPress: close }]}
      />
      {entry.status === "ready" && context && entry.installation ? (
        <MobileExtensionSurface
          environmentId={props.route.params.environmentId}
          installationId={entry.installation.id}
          surfaceId="t3.agents/view"
          context={context}
          environmentLabel={environment.presentation?.entry.target.label ?? "Environment"}
          cssVars={cssVars}
          catalogue={catalogue}
          headerConsumesTopInset
        />
      ) : (
        <View className="flex-1 justify-center">
          <EmptyState
            variant="plain"
            {...mobileAgentsNotice[entry.status === "ready" ? "thread-unavailable" : entry.status]}
            actionLabel={
              entry.status === "offline"
                ? "Reconnect environment"
                : entry.status === "thread-unavailable"
                  ? "Go to threads"
                  : "Refresh"
            }
            onAction={() => {
              if (entry.status === "offline")
                onReconnectEnvironment(EnvironmentId.make(props.route.params.environmentId));
              else if (entry.status === "thread-unavailable")
                navigation.dispatch(StackActions.replace("Home"));
              else refresh();
            }}
          />
        </View>
      )}
    </View>
  );
}
