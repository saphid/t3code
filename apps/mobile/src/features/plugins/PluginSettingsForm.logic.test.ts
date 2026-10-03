import { pluginSettingRows } from "@t3tools/client-runtime/state/pluginSettings";
import { PluginInstallationId, type PluginSettingField } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  endPluginSettingEdit,
  pluginSettingInputKey,
  pluginSettingProblemsAfterEdit,
  pluginSettingSavesAfterSave,
} from "./PluginSettingsForm.logic";

const installationId = PluginInstallationId.make("installation-1");
const token: PluginSettingField = { type: "secret", key: "token", label: "API token" };
const retries: PluginSettingField = {
  type: "number",
  key: "retries",
  label: "Retries",
  default: 2,
  max: 5,
};

const row = (field: PluginSettingField, saved: { secrets?: string[]; retries?: number } = {}) =>
  pluginSettingRows([field], {
    installationId,
    values: saved.retries === undefined ? [] : [{ key: "retries", value: saved.retries }],
    secrets: saved.secrets ?? [],
  })[0]!;

describe("secret inputs", () => {
  it("save what is typed and start empty again after each successful save", () => {
    // Initial set.
    const unsaved = row(token);
    expect(endPluginSettingEdit(unsaved, "first")).toEqual({
      _tag: "save",
      change: { key: "token", value: "first" },
    });
    const saved = row(token, { secrets: ["token"] });
    expect(pluginSettingInputKey(saved, 1)).not.toBe(pluginSettingInputKey(unsaved, 0));

    // Replacement: the row is the same before and after, so only the save count remounts it.
    expect(endPluginSettingEdit(saved, "second")).toEqual({
      _tag: "save",
      change: { key: "token", value: "second" },
    });
    expect(pluginSettingInputKey(saved, 2)).not.toBe(pluginSettingInputKey(saved, 1));

    // Ending the edit again on the emptied input saves nothing.
    expect(endPluginSettingEdit(saved, "")).toEqual({ _tag: "none" });
  });

  it("keep a replacement whose save failed, so it can be sent again", () => {
    const saved = row(token, { secrets: ["token"] });
    // No successful save: same identity, so the input keeps its text.
    expect(pluginSettingInputKey(saved, 1)).toBe(pluginSettingInputKey(saved, 1));
    expect(endPluginSettingEdit(saved, "third")).toEqual({
      _tag: "save",
      change: { key: "token", value: "third" },
    });
  });
});

describe("number inputs", () => {
  it("save only text that differs from the value and fits the field", () => {
    expect(endPluginSettingEdit(row(retries), "2")).toEqual({ _tag: "none" });
    expect(endPluginSettingEdit(row(retries, { retries: 4 }), "3")).toEqual({
      _tag: "save",
      change: { key: "retries", value: 3 },
    });
    expect(endPluginSettingEdit(row(retries), "9")).toEqual({
      _tag: "invalid",
      message: "Retries must be at most 5.",
    });
  });
});

describe("keys named like object properties", () => {
  const constructorField: PluginSettingField = {
    type: "number",
    key: "constructor",
    label: "Constructor",
    max: 5,
  };

  it("have no problem or save count until one is recorded, and lose them again", () => {
    const fresh = new Map<string, string>();
    const constructorRow = pluginSettingRows([constructorField], {
      installationId,
      values: [],
      secrets: [],
    })[0]!;
    const invalid = pluginSettingProblemsAfterEdit(
      fresh,
      "constructor",
      endPluginSettingEdit(constructorRow, "9"),
    );
    expect(invalid.get("constructor")).toBe("Constructor must be at most 5.");
    // An edit of another field leaves it alone; a valid one clears it.
    const other = pluginSettingProblemsAfterEdit(invalid, "toString", { _tag: "none" });
    expect([...other]).toEqual([["constructor", "Constructor must be at most 5."]]);
    expect(
      pluginSettingProblemsAfterEdit(
        other,
        "constructor",
        endPluginSettingEdit(constructorRow, "3"),
      ).size,
    ).toBe(0);

    const once = pluginSettingSavesAfterSave(new Map(), "toString");
    const twice = pluginSettingSavesAfterSave(once, "toString");
    expect([...twice]).toEqual([["toString", 2]]);
    expect(pluginSettingInputKey(constructorRow, twice.get("constructor") ?? 0)).toBe(
      "false:undefined:0",
    );
  });
});
