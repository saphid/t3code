import {
  type PluginSettingRow,
  pluginSettingDraftChange,
} from "@t3tools/client-runtime/state/pluginSettings";
import type { PluginSettingChange } from "@t3tools/contracts";

/**
 * What ending an edit of a text, number, or secret field does: save the change,
 * say why the text cannot be saved, or nothing when it matches what is saved
 * (an empty secret keeps the saved one).
 */
export const endPluginSettingEdit = (
  row: PluginSettingRow,
  text: string,
):
  | { readonly _tag: "save"; readonly change: PluginSettingChange }
  | { readonly _tag: "invalid"; readonly message: string }
  | { readonly _tag: "none" } => {
  const outcome = pluginSettingDraftChange(row.field, text);
  if (outcome._tag === "invalid") return outcome;
  if (outcome._tag === "unchanged" || outcome.change.value === row.value) return { _tag: "none" };
  return { _tag: "save", change: outcome.change };
};

/**
 * Identity of a field's input; the input remounts, showing what the server has,
 * when it changes. `saves` counts the field's successful saves, so a submitted
 * secret never stays in the input (its row looks the same before and after a
 * replacement), while text whose save failed stays for another try.
 */
export const pluginSettingInputKey = (row: PluginSettingRow, saves: number) =>
  `${row.saved}:${String(row.value)}:${saves}`;
