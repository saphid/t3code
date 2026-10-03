import { useAtomValue } from "@effect/atom-react";
import {
  type PluginSettingRow,
  pluginSettingDraftChange,
  pluginSettingRows,
} from "@t3tools/client-runtime/state/pluginSettings";
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
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const view = Option.getOrNull(AsyncResult.value(result));
  if (fields.length === 0 || view === null || view._tag === "unsupported") return null;

  const disabled = readOnly || pending !== null;
  const save = (change: PluginSettingChange) => {
    setPending(change.key);
    void update({ environmentId, input: { installationId, changes: [change] } }).finally(() =>
      setPending(null),
    );
  };
  const commit = (row: PluginSettingRow, draft: string | boolean) => {
    const outcome = pluginSettingDraftChange(row.field, draft);
    setProblems((current) => {
      const next = { ...current };
      if (outcome._tag === "invalid") next[row.field.key] = outcome.message;
      else delete next[row.field.key];
      return next;
    });
    if (outcome._tag === "change" && outcome.change.value !== row.value) save(outcome.change);
  };

  return (
    <SettingsSection title={installation.manifest?.name ?? "Plugin"}>
      {pluginSettingRows(fields, view.values).map((row, index) => {
        const { field } = row;
        const problem = problems[field.key];
        const separated = index > 0 ? "border-t border-border-subtle" : "";
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
                  // Remount on a saved change so the field shows the server's value.
                  key={`${row.saved}:${String(row.value)}`}
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
                  onEndEditing={(event) => commit(row, event.nativeEvent.text)}
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
            {row.saved ? (
              <SettingsActionRow
                icon={field.type === "secret" ? "trash" : "arrow.uturn.backward"}
                label={field.type === "secret" ? `Clear ${field.label}` : `Reset ${field.label}`}
                tone={field.type === "secret" ? "danger" : "default"}
                disabled={disabled}
                loading={pending === field.key}
                onPress={() => save({ key: field.key, value: null })}
              />
            ) : null}
          </View>
        );
      })}
    </SettingsSection>
  );
}
