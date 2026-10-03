import { useAtomValue } from "@effect/atom-react";
import {
  type PluginSettingDraft,
  type PluginSettingRow,
  pluginSettingDraftChange,
  pluginSettingRows,
} from "@t3tools/client-runtime/state/pluginSettings";
import type { EnvironmentId, PluginInstallation, PluginSettingChange } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";

import { pluginSettingsEnvironment } from "../../state/plugins";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

const draftOf = (row: PluginSettingRow): PluginSettingDraft =>
  row.field.type === "boolean" ? row.value === true : row.value === undefined ? "" : String(row.value);

/** The saved change a draft makes, or why it cannot be saved; undefined when it matches what is shown. */
const draftOutcome = (row: PluginSettingRow, draft: PluginSettingDraft | undefined) => {
  if (draft === undefined || draft === draftOf(row)) return undefined;
  const outcome = pluginSettingDraftChange(row.field, draft);
  return outcome._tag === "unchanged" ? undefined : outcome;
};

/**
 * The settings a plugin declares, for one installation on one environment.
 * Renders nothing when the plugin declares none or the server cannot store
 * them. Secrets are write-only: the form shows whether one is saved and can
 * replace or clear it, never its value. Pass `readOnly` when the session
 * cannot save (saving needs administrative access).
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
  const [drafts, setDrafts] = useState<Readonly<Record<string, PluginSettingDraft>>>({});
  const [saving, setSaving] = useState(false);
  const view = Option.getOrNull(AsyncResult.value(result));
  if (fields.length === 0 || view === null || view._tag === "unsupported") return null;

  const rows = pluginSettingRows(fields, view.values);
  const outcomes = rows.map((row) => draftOutcome(row, drafts[row.field.key]));
  const changes = outcomes.flatMap((outcome) => (outcome?._tag === "change" ? [outcome.change] : []));
  const invalid = outcomes.some((outcome) => outcome?._tag === "invalid");
  const setDraft = (key: string, draft: PluginSettingDraft) =>
    setDrafts((current) => ({ ...current, [key]: draft }));

  const save = async (next: ReadonlyArray<PluginSettingChange>, clearDrafts: boolean) => {
    setSaving(true);
    try {
      const saved = await update({ environmentId, input: { installationId, changes: next } });
      if (saved._tag === "Success")
        setDrafts((current) => {
          if (clearDrafts) return {};
          const kept = { ...current };
          for (const change of next) delete kept[change.key];
          return kept;
        });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (changes.length > 0 && !invalid) void save(changes, true);
      }}
    >
      {/* Locked while saving: a successful save clears the drafts it sent. */}
      <fieldset disabled={saving || readOnly} className="contents">
        {rows.map((row, index) => {
          const { field } = row;
          const id = `plugin-setting-${installationId}-${field.key}`;
          const outcome = outcomes[index];
          const draft = drafts[field.key] ?? draftOf(row);
          const reset = () => void save([{ key: field.key, value: null }], false);
          return (
            <div key={field.key} className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={id}>{field.label}</Label>
                {field.type === "boolean" ? (
                  <Switch
                    id={id}
                    checked={draft === true}
                    onCheckedChange={(checked) => setDraft(field.key, checked)}
                  />
                ) : null}
              </div>
              {field.type === "select" ? (
                <Select
                  value={draft === "" ? null : String(draft)}
                  onValueChange={(value) => {
                    if (typeof value === "string") setDraft(field.key, value);
                  }}
                >
                  <SelectTrigger id={id} size="sm" aria-label={field.label}>
                    <SelectValue>
                      {field.options.find((option) => option.value === draft)?.label ??
                        "Choose an option"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {field.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : field.type === "boolean" ? null : (
                <Input
                  id={id}
                  size="sm"
                  autoComplete="off"
                  {...(field.type === "secret"
                    ? {
                        type: "password",
                        placeholder: row.saved
                          ? "Saved. Enter a new value to replace it."
                          : "Not set",
                      }
                    : field.type === "number"
                      ? { inputMode: "decimal" as const }
                      : {})}
                  value={String(draft)}
                  onChange={(event) => setDraft(field.key, event.target.value)}
                />
              )}
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {outcome?._tag === "invalid" ? (
                    <span className="text-destructive">{outcome.message}</span>
                  ) : (
                    (field.description ?? null)
                  )}
                </p>
                {row.saved ? (
                  <Button size="xs" variant="ghost" onClick={reset}>
                    {field.type === "secret" ? "Clear" : "Reset"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button type="submit" size="xs" disabled={changes.length === 0 || invalid}>
            Save
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
