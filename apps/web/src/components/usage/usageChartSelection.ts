import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";

/** Snap a drag to whole source buckets, including right-to-left selections. */
export function chartSelection(
  start: number,
  end: number,
  width: number,
  since: number,
  until: number,
  bucketMs: number,
) {
  if (width <= 0 || until <= since || bucketMs <= 0 || Math.abs(end - start) < 6) return null;
  const instant = (x: number) => since + Math.min(1, Math.max(0, x / width)) * (until - since);
  const from = Math.max(since, Math.floor(instant(Math.min(start, end)) / bucketMs) * bucketMs);
  const to = Math.min(until, Math.ceil(instant(Math.max(start, end)) / bucketMs) * bucketMs);
  return to > from
    ? { sinceTime: new Date(from).toISOString(), untilTime: new Date(to).toISOString() }
    : null;
}

/** Preserve the reporting timezone and exclusive end when selecting part of a day. */
export function selectedUsageWindow(
  window: UsageSummaryInput,
  range: { sinceTime: string; untilTime: string },
): UsageSummaryInput {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: window.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return {
    ...window,
    ...range,
    sinceDay: UsageDay.make(day.format(new Date(range.sinceTime))),
    untilDay: UsageDay.make(day.format(new Date(Date.parse(range.untilTime) - 1))),
  };
}
