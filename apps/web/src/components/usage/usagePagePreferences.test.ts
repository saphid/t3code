import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_USAGE_PAGE_PREFERENCES,
  readUsagePagePreferences,
  saveUsagePagePreferences,
} from "./usagePagePreferences";

const key = "t3code:usage-page-preferences:v2";
let values: Map<string, string>;
let storage: Pick<Storage, "getItem" | "setItem">;

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Usage page preferences", () => {
  it("defaults to seven days of cost by project with automatic grouping", () => {
    expect(readUsagePagePreferences()).toEqual(DEFAULT_USAGE_PAGE_PREFERENCES);
    expect(DEFAULT_USAGE_PAGE_PREFERENCES).toMatchObject({
      metric: "cost",
      windowDays: 7,
      dimension: "projects",
      grouping: "auto",
    });
  });

  it("round-trips every choice including a per-dimension sort", () => {
    const preferences = {
      metric: "tokens" as const,
      windowDays: 30 as const,
      dimension: "models" as const,
      grouping: "1d" as const,
      sort: {
        projects: { column: "name" as const, direction: "asc" as const },
        providers: null,
        models: { column: "cacheWrites" as const, direction: "desc" as const },
        threads: { column: "tokens" as const, direction: "asc" as const },
      },
    };
    saveUsagePagePreferences(preferences);
    expect(readUsagePagePreferences()).toEqual(preferences);
  });

  it.each([
    "not-json",
    '{"metric":"limits","windowDays":30}',
    '{"metric":"cost","windowDays":7,"dimension":"weeks","grouping":"auto","sort":{}}',
  ])("falls back to defaults for %s", (raw) => {
    values.set(key, raw);
    expect(readUsagePagePreferences()).toEqual(DEFAULT_USAGE_PAGE_PREFERENCES);
  });

  it("returns defaults without touching storage outside a browser", () => {
    vi.unstubAllGlobals();
    expect(readUsagePagePreferences()).toEqual(DEFAULT_USAGE_PAGE_PREFERENCES);
  });

  it("restores favorites and hidden columns and migrates the old Threads view", () => {
    const saved = {
      ...DEFAULT_USAGE_PAGE_PREFERENCES,
      favoriteProjects: ["project:environment:id:one"],
      hiddenColumns: ["sessions"] as const,
    };
    saveUsagePagePreferences(saved);
    expect(readUsagePagePreferences()).toEqual(saved);
    values.set(key, JSON.stringify({ ...saved, dimension: "threads" }));
    expect(readUsagePagePreferences()).toEqual(saved);
  });
});
