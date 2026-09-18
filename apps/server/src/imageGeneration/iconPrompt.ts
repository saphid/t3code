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
    "Layout: square canvas. The three variants sit side by side in one row, with clear empty space between and around them. Each variant is one self-contained square app icon: a solid saturated background color covering the icon square edge to edge, with one bold symbol centered on it. The icon square has a hard edge — nothing is drawn outside it: no glow, no shadows, no scenery spilling past it. The space between icons stays empty.",
    "",
    "These icons render at 16 pixels, so boldness wins: one clear focal symbol per icon, wide and blocky, filling at least 60% of the icon square; never a tall or narrow subject; thick simple shapes; strong contrast between symbol and background; background colors must be mid-bright and saturated, never black, near-black, dark gray, or washed out; no thin lines, no small details, no fine gradients; nothing important near the corners; no text, letters, or numbers anywhere.",
    "Keep each icon to a single flat filled silhouette, or at most two large shapes. Never a busy scene: no multiple small objects, no patterns, no outlines or line art, no overlapping elements.",
    "",
    "The three variants must be clearly different compositions of the same concept — vary the symbol and/or the background color while keeping the style. Never leave a slot empty, never merge several symbols into one icon, and never draw one icon spanning multiple slots.",
  ].join("\n");
}
