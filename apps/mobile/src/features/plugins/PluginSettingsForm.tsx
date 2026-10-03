import { useAtomValue } from "@effect/atom-react";
import { pluginSettingRows } from "@t3tools/client-runtime/state/pluginSettings";
import {
  type EnvironmentId,
  PLUGIN_SETTING_SECRET_MAX_LENGTH,
  PLUGIN_SETTING_TEXT_MAX_LENGTH,
  type PluginInstallation,
  type PluginSettingChange,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/AppText";
import { pluginSettingsEnvironment } from "../../state/plugins";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsChoiceRow } from "../settings/components/SettingsChoiceRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  endPluginSettingEdit,
  pluginSettingInputKey,
  pluginSettingProblemsAfterEdit,
  pluginSettingSavesAfterSave,
} from "./PluginSettingsForm.logic";

/**
 * The settings a plugin declares, for one installation on one environment.
 * Each field saves when it is changed. Renders nothing when the plugin
 * declares none or the server cannot store them. Secrets are write-only: the
 * form shows whether one is saved and can replace or clear it, never its
 * value. Pass `readOnly` when the session cannot save.
 */
export function PluginSettingsForm({
  environmentId,
  installation,
  readOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly installation: PluginInstallation;
  readonly readOnly?: boolean;
}) {
  const fields = installation.manifest?.settings ?? [];
  const installationId = installation.installationId;
  const result = useAtomValue(
    pluginSettingsEnvironment.values({ environmentId, input: { installationId } }),
  );
  const update = useAtomCommand(pluginSettingsEnvironment.update, {
    label: `save ${installation.manifest?.name ?? "plugin"} settings`,
  });
  const [pending, setPending] = useState<string | null>(null);
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [saves, setSaves] = useState<ReadonlyMap<string, number>>(() => new Map());
  const view = Option.getOrNull(AsyncResult.value(result));
  if (fields.length === 0 || view === null || view._tag === "unsupported") return null;

  const disabled = readOnly || pending !== null;
  const save = (change: PluginSettingChange) => {
    setPending(change.key);
    void update({ environmentId, input: { installationId, changes: [change] } })
      .then((outcome) => {
        if (AsyncResult.isSuccess(outcome))
          setSaves((current) => pluginSettingSavesAfterSave(current, change.key));
      })
      .finally(() => setPending(null));
  };

  return (
    <SettingsSection title={installation.manifest?.name ?? "Plugin"}>
      {pluginSettingRows(fields, view.values).map((row, index) => {
        const { field } = row;
        const problem = problems.get(field.key);
        const separated = index > 0 ? "border-t border-border-subtle" : "";
        const clear = row.saved ? (
          <SettingsActionRow
            icon={field.type === "secret" ? "trash" : "arrow.uturn.backward"}
            label={field.type === "secret" ? `Clear ${field.label}` : `Reset ${field.label}`}
            tone={field.type === "secret" ? "danger" : "default"}
            disabled={disabled}
            loading={pending === field.key}
            onPress={() => save({ key: field.key, value: null })}
          />
        ) : null;
        if (field.type === "boolean")
          return (
            <View key={field.key} className={separated}>
              <SettingsSwitchRow
                icon="slider.horizontal.3"
                label={field.label}
                {...(field.description === undefined ? {} : { subtitle: field.description })}
                disabled={disabled}
                value={row.value === true}
                onValueChange={(value) => save({ key: field.key, value })}
              />
              {clear}
            </View>
          );
        return (
          <View key={field.key} className={separated}>
            <View className="gap-2 px-4 py-3">
              <Text className="text-base text-foreground">{field.label}</Text>
              {field.description ? (
                <Text className="text-sm text-foreground-muted">{field.description}</Text>
              ) : null}
              {field.type === "select" ? null : (
                <AppTextInput
                  // Remount after a save so the field shows the server's value, never a secret.
                  key={pluginSettingInputKey(row, saves.get(field.key) ?? 0)}
                  accessibilityLabel={field.label}
                  defaultValue={row.value === undefined ? "" : String(row.value)}
                  placeholder={
                    field.type === "secret"
                      ? row.saved
                        ? "Saved. Enter a new value to replace it."
                        : "Not set"
                      : undefined
                  }
                  secureTextEntry={field.type === "secret"}
                  maxLength={
                    field.type === "secret"
                      ? PLUGIN_SETTING_SECRET_MAX_LENGTH
                      : PLUGIN_SETTING_TEXT_MAX_LENGTH
                  }
                  keyboardType={field.type === "number" ? "decimal-pad" : "default"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!disabled}
                  className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
                  onEndEditing={(event) => {
                    const outcome = endPluginSettingEdit(row, event.nativeEvent.text);
                    setProblems((current) =>
                      pluginSettingProblemsAfterEdit(current, field.key, outcome),
                    );
                    if (outcome._tag === "save") save(outcome.change);
                  }}
                />
              )}
              {problem ? <Text className="text-sm text-danger-foreground">{problem}</Text> : null}
            </View>
            {field.type === "select"
              ? field.options.map((option, optionIndex) => (
                  <SettingsChoiceRow
                    key={option.value}
                    label={option.label}
                    description=""
                    selected={row.value === option.value}
                    separated={optionIndex > 0}
                    disabled={disabled}
                    onPress={() => save({ key: field.key, value: option.value })}
                  />
                ))
              : null}
            {clear}
          </View>
        );
      })}
    </SettingsSection>
  );
}
