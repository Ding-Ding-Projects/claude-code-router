import type { ProviderModelMetadata, ProviderReasoningLevel } from "@ccr/core/contracts/app";

export type ProviderReasoningLevelOption = {
  description: string;
  effort: string;
  label: string;
};

/** Effort name that outranks every other tier; only offered when a model exposes it. */
export const ultracodeReasoningEffort = "ultracode";

/**
 * Full ordered reasoning-effort ladder. "ultracode" stays last so it always
 * reads as the top of the ladder, above "max" and "ultra".
 */
export const providerReasoningLevelOptions: ProviderReasoningLevelOption[] = [
  { description: "Low", effort: "low", label: "Low" },
  { description: "Medium", effort: "medium", label: "Medium" },
  { description: "High", effort: "high", label: "High" },
  { description: "Extra high", effort: "xhigh", label: "Extra high" },
  { description: "Max", effort: "max", label: "Max" },
  { description: "Ultra", effort: "ultra", label: "Ultra" },
  { description: "Ultracode", effort: "ultracode", label: "Ultracode" }
];

export function reasoningEffortsFromLevels(levels?: ProviderReasoningLevel[] | null): Set<string> {
  return new Set((levels ?? []).map((level) => level.effort.trim().toLowerCase()));
}

/**
 * Options a model may offer, gated by backend capability data: "ultracode"
 * appears only when the model's exposed reasoning levels include it (or when a
 * saved selection already carries it, so persisted choices stay editable
 * instead of vanishing). No model-name allowlist lives here.
 */
export function reasoningLevelOptionsForModel(
  modelDefaults?: ProviderModelMetadata,
  modelMetadata?: ProviderModelMetadata
): ProviderReasoningLevelOption[] {
  const exposed = reasoningEffortsFromLevels(modelDefaults?.supportedReasoningLevels);
  const configured = reasoningEffortsFromLevels(modelMetadata?.supportedReasoningLevels);
  return providerReasoningLevelOptions.filter(
    (option) => option.effort !== ultracodeReasoningEffort || exposed.has(option.effort) || configured.has(option.effort)
  );
}
