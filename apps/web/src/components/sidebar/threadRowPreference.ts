import { moveOrderedItem, sameOrder } from "../../personalization/orderedItems";

export type ThreadRowFieldId =
  | "project"
  | "branch"
  | "terminal"
  | "pullRequest"
  | "environment"
  | "provider";

export interface ThreadRowFieldDef {
  id: ThreadRowFieldId;
  label: string;
  description: string;
  kind: "text" | "glyph";
}

export const THREAD_ROW_FIELDS: readonly ThreadRowFieldDef[] = [
  { id: "project", label: "Project name", description: "Project label on the first line.", kind: "text" },
  { id: "branch", label: "Branch", description: "Branch or worktree on the second line.", kind: "text" },
  { id: "terminal", label: "Terminal activity", description: "Running terminal processes.", kind: "glyph" },
  { id: "pullRequest", label: "Pull request", description: "Linked pull request status.", kind: "glyph" },
  {
    id: "environment",
    label: "Remote environment",
    description: "Machine glyph when the thread is on another environment.",
    kind: "glyph",
  },
  { id: "provider", label: "Provider", description: "Provider or model marker.", kind: "glyph" },
];

export const DEFAULT_THREAD_ROW_FIELDS: readonly ThreadRowFieldId[] = THREAD_ROW_FIELDS.map(
  (field) => field.id,
);

const THREAD_ROW_FIELD_ID_SET = new Set<string>(DEFAULT_THREAD_ROW_FIELDS);

const TEXT_THREAD_ROW_FIELD_IDS = new Set(
  THREAD_ROW_FIELDS.filter((field) => field.kind === "text").map((field) => field.id),
);

export interface ResolvedThreadRowPresentation {
  density: "comfortable" | "compact";
  /** Enabled fields in effective order, known ids only. */
  fields: readonly ThreadRowFieldId[];
  /** Fast lookups. */
  has: (id: ThreadRowFieldId) => boolean;
  /** Glyph fields in order; compact rows and the card's right cluster use this. */
  glyphs: readonly ThreadRowFieldId[];
}

function knownThreadRowFields(fields: readonly string[]): readonly ThreadRowFieldId[] {
  return fields.filter((id): id is ThreadRowFieldId => THREAD_ROW_FIELD_ID_SET.has(id));
}

export function resolveThreadRowPresentation(
  density: "comfortable" | "compact",
  fields: readonly string[] | null,
): ResolvedThreadRowPresentation {
  const resolved = fields === null ? DEFAULT_THREAD_ROW_FIELDS : knownThreadRowFields(fields);
  return {
    density,
    fields: resolved,
    has: (id) => resolved.includes(id),
    glyphs: resolved.filter((id) => !TEXT_THREAD_ROW_FIELD_IDS.has(id)),
  };
}

/**
 * The recommended arrangement: comfortable density with either the untouched
 * preference (null) or an explicit field list identical to the current
 * defaults in order. Editors use it to store null so untouched users keep
 * evolving with the defaults.
 */
export function isRecommendedThreadRows(
  density: "comfortable" | "compact",
  fields: readonly string[] | null,
): boolean {
  if (density !== "comfortable") return false;
  if (fields === null) return true;
  return sameOrder(knownThreadRowFields(fields), DEFAULT_THREAD_ROW_FIELDS);
}

/**
 * Enabled-field list after toggling one field. A null preference materializes
 * from the defaults. Removing keeps the order of the rest (and returns the
 * same reference when the id is absent). Adding places the field where
 * `mergeOrderedItems` would put a re-adopted default: right after the nearest
 * preceding default neighbour the user kept, else at the end — so toggling a
 * field off and back on restores its default position.
 */
export function toggleThreadRowField(
  fields: readonly string[] | null,
  id: ThreadRowFieldId,
  enabled: boolean,
): readonly string[] {
  const base = fields ?? [...DEFAULT_THREAD_ROW_FIELDS];
  if (!enabled) {
    if (!base.includes(id)) return base;
    return base.filter((entry) => entry !== id);
  }
  if (base.includes(id) || !THREAD_ROW_FIELD_ID_SET.has(id)) return base;
  const defaultIndex = DEFAULT_THREAD_ROW_FIELDS.indexOf(id);
  let at = base.length;
  let anchorDefaultIndex = -1;
  for (let index = 0; index < base.length; index++) {
    const entry = base[index]!;
    const keptDefaultIndex = DEFAULT_THREAD_ROW_FIELDS.findIndex((candidate) => candidate === entry);
    if (
      keptDefaultIndex !== -1 &&
      keptDefaultIndex < defaultIndex &&
      keptDefaultIndex > anchorDefaultIndex
    ) {
      anchorDefaultIndex = keptDefaultIndex;
      at = index + 1;
    }
  }
  const next = [...base];
  next.splice(at, 0, id);
  return next;
}

/** Move one enabled field a step; a null preference materializes from the defaults. */
export function moveThreadRowField(
  fields: readonly string[] | null,
  id: ThreadRowFieldId,
  direction: "up" | "down",
): readonly string[] {
  return moveOrderedItem(fields ?? [...DEFAULT_THREAD_ROW_FIELDS], id, direction);
}
