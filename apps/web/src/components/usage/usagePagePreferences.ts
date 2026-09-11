import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";

const STORAGE_KEY = "t3code:usage-page-preferences:v2";

const UsageDimensionSchema = Schema.Literals(["projects", "providers", "models"]);
export type UsageDimension = typeof UsageDimensionSchema.Type;

const BreakdownSortSchema = Schema.Struct({
  column: Schema.Literals([
    "name",
    "cost",
    "tokens",
    "share",
    "cacheWrites",
    "cacheReads",
    "input",
    "output",
    "sessions",
  ]),
  direction: Schema.Literals(["asc", "desc"]),
});
export type BreakdownSort = typeof BreakdownSortSchema.Type;

/** `null` follows the active metric until the user picks a column themselves. */
const OptionalSort = Schema.NullOr(BreakdownSortSchema);

const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
  dimension: Schema.Literals(["projects", "providers", "models", "threads"]),
  grouping: Schema.Literals(["auto", "30m", "1h", "6h", "12h", "1d"]),
  hiddenColumns: Schema.optional(
    Schema.Array(
      Schema.Literals([
        "cost",
        "tokens",
        "share",
        "cacheWrites",
        "cacheReads",
        "input",
        "output",
        "sessions",
      ]),
    ),
  ),
  favoriteProjects: Schema.optional(Schema.Array(Schema.String)),
  sort: Schema.Struct({
    projects: OptionalSort,
    providers: OptionalSort,
    models: OptionalSort,
    threads: OptionalSort,
  }),
});
export type UsagePagePreferences = Omit<typeof UsagePagePreferencesSchema.Type, "dimension"> & {
  readonly dimension: UsageDimension;
};

export const DEFAULT_USAGE_PAGE_PREFERENCES: UsagePagePreferences = {
  metric: "cost",
  windowDays: 7,
  dimension: "projects",
  grouping: "auto",
  sort: { projects: null, providers: null, models: null, threads: null },
};

/**
 * Presentation choices the page restores on its next visit. Hidden rows and
 * custom date ranges are deliberately not persisted: they describe one look at
 * the data, not how the user likes to read it.
 */
export function readUsagePagePreferences(): UsagePagePreferences {
  if (typeof window === "undefined") return DEFAULT_USAGE_PAGE_PREFERENCES;
  try {
    const stored = getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema);
    if (stored === null) return DEFAULT_USAGE_PAGE_PREFERENCES;
    return { ...stored, dimension: stored.dimension === "threads" ? "projects" : stored.dimension };
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);
    return DEFAULT_USAGE_PAGE_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  if (typeof window === "undefined") return;
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
  }
}
