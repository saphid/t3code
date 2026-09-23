import type { ComposerControlPlacement, ComposerControlsPreference } from "@t3tools/contracts";

import { mergeOrderedItems, moveOrderedItem, sameOrder } from "../../personalization/orderedItems";

export interface ComposerControlBlockDef {
  id: string;
  label: string;
  description: string;
  canHide: boolean;
}

/** Designed defaults, in recommended order. Only blocks that exist on this base. */
export const COMPOSER_CONTROL_BLOCKS: readonly ComposerControlBlockDef[] = [
  {
    id: "traits",
    label: "Effort",
    description: "Effort and other model traits, when the provider offers them.",
    canHide: true,
  },
  {
    id: "mode",
    label: "Access mode",
    description: "Access mode, plus the Chat / Plan toggle when legacy plan mode is on.",
    canHide: false,
  },
];

const COMPOSER_CONTROL_DEFAULT_IDS = COMPOSER_CONTROL_BLOCKS.map((block) => block.id);
const COMPOSER_CONTROL_DEFAULT_ID_SET = new Set(COMPOSER_CONTROL_DEFAULT_IDS);

function composerControlCanHide(id: string): boolean {
  return COMPOSER_CONTROL_BLOCKS.find((block) => block.id === id)?.canHide ?? true;
}

export interface ResolvedComposerControls {
  /** Effective order over all known block ids (available or not). */
  order: readonly string[];
  /** Effective placement per known id after coercion (mode: hidden → more). */
  placements: Readonly<Record<string, ComposerControlPlacement>>;
  /** Pinned ids that are available this render, in effective order. Feed to the inline strip. */
  pinned: readonly string[];
  /** In-More ids available this render. Always in the ellipsis menu. */
  more: readonly string[];
}

export function resolveComposerControls(
  pref: ComposerControlsPreference,
  availableIds: ReadonlySet<string>,
): ResolvedComposerControls {
  const order = mergeOrderedItems(COMPOSER_CONTROL_DEFAULT_IDS, pref.order);
  const placements: Record<string, ComposerControlPlacement> = {};
  const pinned: string[] = [];
  const more: string[] = [];
  for (const id of order) {
    const placement = pref.placements[id] ?? "pinned";
    const effective = placement === "hidden" && !composerControlCanHide(id) ? "more" : placement;
    placements[id] = effective;
    if (!availableIds.has(id)) continue;
    if (effective === "more") {
      more.push(id);
    } else if (effective === "pinned") {
      pinned.push(id);
    }
  }
  return { order, placements, pinned, more };
}

/**
 * True when the preference is indistinguishable from the designed default:
 * the recommended order (or none at all) and no placement that changes the
 * strip. Pinned entries are explicit no-ops, so they stay recommended.
 */
export function isRecommendedComposerControls(pref: ComposerControlsPreference): boolean {
  const orderRecommended =
    pref.order.length === 0 || sameOrder(pref.order, COMPOSER_CONTROL_DEFAULT_IDS);
  if (!orderRecommended) return false;
  return Object.values(pref.placements).every((placement) => placement === "pinned");
}

export function setComposerControlPlacement(
  pref: ComposerControlsPreference,
  id: string,
  placement: ComposerControlPlacement,
): ComposerControlsPreference {
  const effective = placement === "hidden" && !composerControlCanHide(id) ? "more" : placement;
  return { ...pref, placements: { ...pref.placements, [id]: effective } };
}

export function moveComposerControl(
  pref: ComposerControlsPreference,
  id: string,
  direction: "up" | "down",
): ComposerControlsPreference {
  const known = mergeOrderedItems(COMPOSER_CONTROL_DEFAULT_IDS, pref.order);
  const moved = moveOrderedItem(known, id, direction);
  if (moved === known) return pref;
  // Ids the user saved that this build no longer knows stay in storage, so a
  // downgrade does not silently rewrite them away.
  const movedSet = new Set(moved);
  const unknown = pref.order.filter(
    (key) => !COMPOSER_CONTROL_DEFAULT_ID_SET.has(key) && !movedSet.has(key),
  );
  return { ...pref, order: [...moved, ...unknown] };
}
