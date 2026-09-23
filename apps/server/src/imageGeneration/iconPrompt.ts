/**
 * Prompt assembly for AI project-icon generation.
 *
 * Each variant is its own image generation, so every prompt asks for exactly
 * one icon; the variant direction keeps the parallel generations from
 * converging on the same design. The rendering constraints live here and not
 * in the client so they hold no matter how the UI composes the user's prompt.
 *
 * @module imageGeneration/iconPrompt
 */

export interface ProjectIconPromptInput {
  /** What the icon should depict, as edited by the user in the picker. */
  readonly prompt: string;
  /** Optional vibe the user picked for the icon. */
  readonly vibe?: string | null | undefined;
}

/** One direction per variant; the adapter generates one icon for each. */
export const ICON_VARIANT_DIRECTIONS = [
  "Use the most direct, instantly recognizable symbol for the concept.",
  "Use a clever metaphor for the concept instead of the obvious symbol.",
  "Use a chunky badge or emblem version of the concept, in a contrasting color scheme.",
] as const;

export function buildProjectIconImagePrompt(
  input: ProjectIconPromptInput,
  direction: string,
): string {
  const vibe = input.vibe?.trim();
  return [
    "Generate exactly one image: a single square app icon.",
    "",
    `Icon concept: ${input.prompt.trim()}`,
    ...(vibe ? [`Visual style: ${vibe}.`] : []),
    `Direction: ${direction}`,
    "",
    "The icon fills the entire square canvas edge to edge: a solid, saturated, bright or mid-tone background color reaches every edge and corner. The background is never black, near-black, dark brown, dark gray, or navy, even when the style is dark; express a dark style through the symbol instead. No border, no rounded corners, no frame, no drop shadow, no mockup, no surrounding scene; the app rounds the corners itself.",
    "",
    "It is displayed at 16 pixels, so boldness wins: one oversized, flat, solid silhouette of a concrete, recognizable object (never an abstract shape), centered and filling about 75% of the canvas; chunky shapes; very strong contrast against the background; no thin lines, fine detail, gradients, patterns, small secondary objects, or tiny subjects floating in empty space; no text, letters, or numbers.",
  ].join("\n");
}
