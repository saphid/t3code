import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { EnvironmentId, PluginInstallationId } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { usePluginViews } from "../../../state/pluginViews";
import { SettingsActionRow } from "../../settings/components/SettingsActionRow";
import { SettingsSection } from "../../settings/components/SettingsSection";
import { PLUGIN_VIEWS_HOSTED, type PluginViewRouteParams } from "./PluginViewRouteScreen";
import { pluginViewEntries } from "./pluginViewSupport";

/**
 * A plugin's views on its settings screen, each opening the view host. Rows
 * come only from the environment's current session, so a disabled, removed
 * or changed plugin loses them at once.
 */
export function PluginViewsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly installationId: PluginInstallationId;
  readonly capabilities: ReadonlyArray<string>;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<{ SettingsPluginView: PluginViewRouteParams }>>();
  const { environmentId, installationId } = props;
  const { views } = usePluginViews(PLUGIN_VIEWS_HOSTED ? environmentId : null);
  const entries = pluginViewEntries({
    hosted: PLUGIN_VIEWS_HOSTED,
    installationId,
    capabilities: props.capabilities,
    views,
  });
  if (entries._tag === "none") return null;
  return (
    <SettingsSection title="Views">
      {entries._tag === "views" ? (
        entries.views.map((view, index) => (
          <View
            key={view.viewId}
            className={index === 0 ? undefined : "border-t border-border-subtle"}
          >
            <SettingsActionRow
              icon="sidebar.right"
              label={view.title}
              onPress={() =>
                navigation.navigate("SettingsPluginView", {
                  environmentId,
                  installationId,
                  viewId: view.viewId,
                  title: view.title,
                })
              }
            />
          </View>
        ))
      ) : (
        <Text selectable className="p-4 text-base text-foreground-muted">
          {entries._tag === "unsupported-platform"
            ? "Plugin views are not available on Android. Open them from T3 Code on iOS, the web, or the desktop app."
            : entries._tag === "waiting"
              ? "Checking views…"
              : (entries.problem ?? "Enable the plugin to open its views.")}
        </Text>
      )}
    </SettingsSection>
  );
}
