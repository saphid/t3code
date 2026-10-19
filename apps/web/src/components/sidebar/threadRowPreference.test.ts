import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_THREAD_ROW_FIELDS,
  isRecommendedThreadRows,
  moveThreadRowField,
  resolveThreadRowPresentation,
  THREAD_ROW_FIELDS,
  toggleThreadRowField,
  type ThreadRowFieldId,
} from "./threadRowPreference";

describe("resolveThreadRowPresentation", () => {
  it("resolves a null preference to all six fields in default order", () => {
    const resolved = resolveThreadRowPresentation("comfortable", null);
    expect(resolved.fields).toEqual([
      "project",
      "branch",
      "terminal",
      "pullRequest",
      "environment",
      "provider",
    ]);
    expect(resolved.density).toBe("comfortable");
  });

  it("honours a saved subset in its saved order", () => {
    const resolved = resolveThreadRowPresentation("compact", ["provider", "branch"]);
    expect(resolved.fields).toEqual(["provider", "branch"]);
  });

  it("drops unknown ids from fields but keeps known ones", () => {
    const resolved = resolveThreadRowPresentation("comfortable", ["branch", "unknown", "provider"]);
    expect(resolved.fields).toEqual(["branch", "provider"]);
  });

  it("exposes glyph fields in order and excludes text fields", () => {
    const resolved = resolveThreadRowPresentation("compact", ["provider", "branch", "terminal"]);
    expect(resolved.glyphs).toEqual(["provider", "terminal"]);
    expect(resolveThreadRowPresentation("comfortable", null).glyphs).toEqual([
      "terminal",
      "pullRequest",
      "environment",
      "provider",
    ]);
  });

  it("answers has() for enabled and disabled fields", () => {
    const resolved = resolveThreadRowPresentation("comfortable", ["branch"]);
    expect(resolved.has("branch")).toBe(true);
    expect(resolved.has("project")).toBe(false);
  });

  it("reports the same field definitions as the default order", () => {
    expect(DEFAULT_THREAD_ROW_FIELDS).toEqual(THREAD_ROW_FIELDS.map((field) => field.id));
  });
});

describe("isRecommendedThreadRows", () => {
  it("is true for comfortable with a null preference", () => {
    expect(isRecommendedThreadRows("comfortable", null)).toBe(true);
  });

  it("is false for compact regardless of fields", () => {
    expect(isRecommendedThreadRows("compact", null)).toBe(false);
    expect(isRecommendedThreadRows("compact", [...DEFAULT_THREAD_ROW_FIELDS])).toBe(false);
  });

  it("is true for comfortable with the default set and order", () => {
    expect(isRecommendedThreadRows("comfortable", DEFAULT_THREAD_ROW_FIELDS)).toBe(true);
  });

  it("is false when the order differs or a field is missing", () => {
    expect(
      isRecommendedThreadRows("comfortable", ["branch", "project", "terminal", "pullRequest", "environment", "provider"]),
    ).toBe(false);
    expect(
      isRecommendedThreadRows("comfortable", ["project", "terminal", "pullRequest", "environment", "provider"]),
    ).toBe(false);
  });

  it("ignores unknown ids when comparing", () => {
    expect(isRecommendedThreadRows("comfortable", [...DEFAULT_THREAD_ROW_FIELDS, "unknown"])).toBe(
      true,
    );
  });
});

describe("toggleThreadRowField", () => {
  it("materializes from the defaults when the preference is null", () => {
    expect(toggleThreadRowField(null, "branch", false)).toEqual([
      "project",
      "terminal",
      "pullRequest",
      "environment",
      "provider",
    ]);
  });

  it("restores the default position when toggled off then on", () => {
    const withoutBranch = toggleThreadRowField(null, "branch", false);
    expect(toggleThreadRowField(withoutBranch, "branch", true)).toEqual([
      ...DEFAULT_THREAD_ROW_FIELDS,
    ]);
  });

  it("appends a re-added field with no kept preceding neighbour at the end", () => {
    const fields = toggleThreadRowField(null, "project", false);
    expect(toggleThreadRowField(fields, "project", true)).toEqual([
      "branch",
      "terminal",
      "pullRequest",
      "environment",
      "provider",
      "project",
    ]);
  });

  it("never re-adds unknown ids", () => {
    const fields = ["branch"] as readonly string[];
    expect(toggleThreadRowField(fields, "unknown" as ThreadRowFieldId, true)).toBe(fields);
  });

  it("returns the same reference when there is nothing to change", () => {
    const fields = ["branch"] as readonly string[];
    expect(toggleThreadRowField(fields, "branch", true)).toBe(fields);
    expect(toggleThreadRowField(fields, "project", false)).toBe(fields);
  });
});

describe("moveThreadRowField", () => {
  it("materializes from the defaults when the preference is null", () => {
    expect(moveThreadRowField(null, "branch", "down")).toEqual([
      "project",
      "terminal",
      "branch",
      "pullRequest",
      "environment",
      "provider",
    ]);
  });

  it("moves a field within the saved order", () => {
    const fields = ["provider", "branch"] as readonly string[];
    expect(moveThreadRowField(fields, "provider", "down")).toEqual(["branch", "provider"]);
  });
});
