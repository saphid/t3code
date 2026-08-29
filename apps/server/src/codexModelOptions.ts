import type { ModelCapabilities, ModelSelection } from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

export function normalizeCodexModelSelection(
  modelSelection: ModelSelection,
  capabilities: ModelCapabilities,
): ModelSelection {
  const selectedServiceTier = getModelSelectionStringOptionValue(modelSelection, "serviceTier");
  const legacyFastMode = getModelSelectionBooleanOptionValue(modelSelection, "fastMode");
  const preservedOptions = (modelSelection.options ?? []).filter(
    (selection) => selection.id !== "serviceTier" && selection.id !== "fastMode",
  );
  if (selectedServiceTier === undefined && legacyFastMode === undefined) {
    return modelSelection;
  }

  const serviceTierDescriptor = capabilities.optionDescriptors?.find(
    (descriptor) => descriptor.id === "serviceTier" && descriptor.type === "select",
  );
  if (!serviceTierDescriptor) {
    return createModelSelection(modelSelection.instanceId, modelSelection.model, preservedOptions);
  }

  const candidateServiceTier =
    selectedServiceTier ?? (legacyFastMode === true ? "fast" : "default");
  const normalizedServiceTier = buildProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({
      caps: { optionDescriptors: [serviceTierDescriptor] },
      selections: [{ id: "serviceTier", value: candidateServiceTier }],
    }),
  );
  return createModelSelection(modelSelection.instanceId, modelSelection.model, [
    ...preservedOptions,
    ...(normalizedServiceTier ?? []),
  ]);
}

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}
