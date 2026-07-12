/** Property-local calendar helpers for GA4 date dimensions.
 * GA4 buckets `date` and `yearMonth` in the property's reporting timezone, so
 * UTC calendar keys are wrong near day and month boundaries. */

function partsFor(now: Date, timeZone: string): { year: string; month: string; day: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    return /^\d{4}$/.test(year) && /^\d{2}$/.test(month) && /^\d{2}$/.test(day)
      ? { year, month, day }
      : null;
  } catch {
    return null;
  }
}

export function propertyDateKey(now: Date, timeZone: string): string | null {
  const p = partsFor(now, timeZone);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

export function propertyMonthKey(now: Date, timeZone: string): string | null {
  const p = partsFor(now, timeZone);
  return p ? `${p.year}-${p.month}-01` : null;
}

/** Date-only calendar subtraction. Start from a validated property-local key,
 * then use UTC arithmetic only as a timezone-neutral calendar calculator. */
export function dateKeyDaysBefore(dateKey: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(days) || days < 0) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
