/**
 * Prompt assembly for AI project-icon generation.
 *
 * The mechanical framing (one image, three variants in a row, flat icon
 * conventions) lives here and not in the client so it always matches what
 * the grid slicer expects, no matter how the UI composes the user's prompt.
 *
 * @module imageGeneration/iconPrompt
 */

export interface ProjectIconPromptInput {
  /** What the icon should depict, as edited by the user in the picker. */
  readonly prompt: string;
  /** Optional vibe the user picked for the icon. */
  readonly vibe?: string | null | undefined;
}

export function buildProjectIconImagePrompt(input: ProjectIconPromptInput): string {
  const vibe = input.vibe?.trim();
  return [
    "Generate one image: a single horizontal row of exactly three distinct app icon variants for the same concept.",
    "",
    `Icon concept: ${input.prompt.trim()}`,
    ...(vibe ? [`Visual style: ${vibe}.`] : []),
    "",
    "Each variant sits centered inside its own equal third of the canvas and fills that third edge to edge vertically. Flat vector icon style with bold, simple shapes, high contrast, and one clear focal subject per icon. Solid background color fills each third. No text, no letters, no numbers, and no dividing borders between the thirds. Square canvas.",
    "",
    "Every third must contain one complete icon: never leave a third empty or as a plain color panel, and never merge several symbols into one icon. Each variant shows exactly one focal symbol on its own background, and the three variants must be clearly different compositions of the concept.",
  ].join("\n");
}
