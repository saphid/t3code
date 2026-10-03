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

/**
 * A field's problem after an edit ends: set when the text cannot be saved,
 * gone otherwise. Problems and save counts are Maps keyed by setting key, so
 * a key named like an object property ("constructor") reads only what was set.
 */
export const pluginSettingProblemsAfterEdit = (
  problems: ReadonlyMap<string, string>,
  key: string,
  outcome: ReturnType<typeof endPluginSettingEdit>,
): ReadonlyMap<string, string> => {
  const next = new Map(problems);
  if (outcome._tag === "invalid") next.set(key, outcome.message);
  else next.delete(key);
  return next;
};

/** Counts a field's successful save, for `pluginSettingInputKey`. */
export const pluginSettingSavesAfterSave = (
  saves: ReadonlyMap<string, number>,
  key: string,
): ReadonlyMap<string, number> => new Map(saves).set(key, (saves.get(key) ?? 0) + 1);

/**
 * Decides at dispatch time whether a field change may be sent. A native
 * edit-ending event can reach a handler created while the form was editable
 * after it turned read-only, so every save goes through `save`, which reads
 * this instead of a captured value. The form calls `set` on every commit and
 * `set(false)` when it unmounts. A dispatched save closes the gate until the
 * next commit, which sees it pending.
 */
export const createPluginSettingSaveGate = () => {
  let canSave = false;
  return {
    set: (next: boolean) => {
      canSave = next;
    },
    save: (change: PluginSettingChange, dispatch: (change: PluginSettingChange) => void) => {
      if (!canSave) return false;
      canSave = false;
      dispatch(change);
      return true;
    },
  };
};
