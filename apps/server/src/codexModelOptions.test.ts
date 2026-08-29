import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelCapabilities, createModelSelection } from "@t3tools/shared/model";

import {
  getCodexServiceTierOptionValue,
  normalizeCodexModelSelection,
} from "./codexModelOptions.ts";

it("returns the selected Codex service tier id", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "serviceTier", value: "flex" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "flex");
});

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});

it("falls legacy service tiers back to the current catalog without changing effort", () => {
  const capabilities = createModelCapabilities({
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "high", label: "High" },
          { id: "xhigh", label: "Extra High", isDefault: true },
        ],
        currentValue: "xhigh",
      },
      {
        id: "serviceTier",
        label: "Service Tier",
        type: "select",
        options: [
          { id: "default", label: "Standard", isDefault: true },
          { id: "priority", label: "Fast" },
        ],
        currentValue: "default",
      },
    ],
  });
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "fast" },
  ]);

  assert.deepStrictEqual(normalizeCodexModelSelection(selection, capabilities), {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "default" },
    ],
  });
});

it("keeps a legacy runtime tier when that runtime still advertises it", () => {
  const capabilities = createModelCapabilities({
    optionDescriptors: [
      {
        id: "serviceTier",
        label: "Service Tier",
        type: "select",
        options: [
          { id: "default", label: "Standard", isDefault: true },
          { id: "fast", label: "Fast" },
        ],
        currentValue: "default",
      },
    ],
  });
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "serviceTier", value: "fast" },
  ]);

  assert.deepStrictEqual(normalizeCodexModelSelection(selection, capabilities), selection);
});

it("does not invent a reasoning effort while migrating a legacy tier", () => {
  const capabilities = createModelCapabilities({
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "xhigh", label: "Extra High", isDefault: true }],
        currentValue: "xhigh",
      },
      {
        id: "serviceTier",
        label: "Service Tier",
        type: "select",
        options: [
          { id: "default", label: "Standard", isDefault: true },
          { id: "priority", label: "Fast" },
        ],
        currentValue: "default",
      },
    ],
  });
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
    { id: "fastMode", value: true },
  ]);

  assert.deepStrictEqual(normalizeCodexModelSelection(selection, capabilities).options, [
    { id: "serviceTier", value: "default" },
  ]);
});

it("drops a saved tier when the runtime advertises no service-tier capability", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "custom-model", [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "flex" },
  ]);

  assert.deepStrictEqual(normalizeCodexModelSelection(selection, {}).options, [
    { id: "reasoningEffort", value: "high" },
  ]);
});
