/** Stable across sorting, filtering, date changes, and reloads. */
export function usageSeriesColor(key: string, palette: readonly string[]): string {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return palette[(hash >>> 0) % palette.length] ?? "#777777";
}

/** Custom dates always describe complete local calendar days, including DST. */
export function customUsageRange(from: string, to: string) {
  const parse = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const [year, month, date] = day.split("-").map(Number);
    const value = new Date(year!, month! - 1, date!);
    return value.getFullYear() === year &&
      value.getMonth() === month! - 1 &&
      value.getDate() === date
      ? value
      : null;
  };
  const start = parse(from);
  const end = parse(to);
  if (!start || !end) return { error: "Enter a valid start and end date." };
  if (to < from) return { error: "End date must be on or after the start date." };
  const calendarDays =
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000 + 1;
  if (calendarDays > 90) return { error: "Choose a range of up to 90 days." };
  end.setDate(end.getDate() + 1);
  return { sinceTime: start.toISOString(), untilTime: end.toISOString() };
}
