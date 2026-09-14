import { describe, expect, it } from "vite-plus/test";
import { customUsageRange, usageSeriesColor } from "./usagePresentation";

describe("usage presentation", () => {
  it("keeps colors keyed to identity across reorders and subsets", () => {
    const colors = ["red", "green", "blue"];
    const byKey = (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, usageSeriesColor(key, colors)]));
    expect(byKey(["project-a", "project-b"])).toEqual(byKey(["project-b", "project-a"]));
    expect(byKey(["project-b"])["project-b"]).toBe(byKey(["project-a", "project-b"])["project-b"]);
  });
  it("explains reversed, missing, impossible, and oversized custom ranges", () => {
    expect(customUsageRange("2026-09-14", "2026-09-13").error).toMatch(/End date/);
    expect(customUsageRange("", "2026-09-13").error).toMatch(/valid/);
    expect(customUsageRange("2026-02-30", "2026-03-01").error).toMatch(/valid/);
    expect(customUsageRange("2026-01-01", "2026-04-01").error).toMatch(/90 days/);
  });
  it("uses both whole-day boundaries and accepts an inclusive 90-day range", () => {
    const range = customUsageRange("2026-01-01", "2026-03-31");
    expect(range.error).toBeUndefined();
    expect(new Date(range.sinceTime!).getHours()).toBe(0);
    expect(new Date(range.untilTime!).getDate()).toBe(1);
    expect(new Date(range.untilTime!).getMonth()).toBe(3);
  });
});
