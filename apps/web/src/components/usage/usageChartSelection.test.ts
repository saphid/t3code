import { UsageDay } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { chartSelection, selectedUsageWindow } from "./usageChartSelection";

const since = Date.parse("2026-09-01T00:00:00Z");
const until = since + 24 * 60 * 60_000;
const bucket = 30 * 60_000;

describe("chartSelection", () => {
  it("snaps either drag direction to whole source buckets", () => {
    const expected = {
      sinceTime: "2026-09-01T06:00:00.000Z",
      untilTime: "2026-09-01T12:30:00.000Z",
    };
    expect(chartSelection(251, 510, 1000, since, until, bucket)).toEqual(expected);
    expect(chartSelection(510, 251, 1000, since, until, bucket)).toEqual(expected);
  });
  it("clamps releases outside the plot to the current window", () => {
    expect(chartSelection(-50, 1100, 1000, since, until, bucket)).toEqual({
      sinceTime: new Date(since).toISOString(),
      untilTime: new Date(until).toISOString(),
    });
  });
  it("ignores clicks, tiny movements, and unusable plots", () => {
    expect(chartSelection(10, 14, 1000, since, until, bucket)).toBeNull();
    expect(chartSelection(10, 400, 0, since, until, bucket)).toBeNull();
    expect(chartSelection(10, 400, 1000, since, since, bucket)).toBeNull();
  });
});

describe("selectedUsageWindow", () => {
  it("uses local days and treats midnight at the end as exclusive across DST", () => {
    const range = { sinceTime: "2026-10-03T14:00:00.000Z", untilTime: "2026-10-04T13:00:00.000Z" };
    expect(
      selectedUsageWindow(
        {
          sinceDay: UsageDay.make("2026-10-01"),
          untilDay: UsageDay.make("2026-10-07"),
          timeZone: "Australia/Sydney",
          resolution: "halfHour",
        },
        range,
      ),
    ).toEqual({
      ...range,
      sinceDay: "2026-10-04",
      untilDay: "2026-10-04",
      timeZone: "Australia/Sydney",
      resolution: "halfHour",
    });
  });
});
