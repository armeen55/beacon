/**
 * reporting-day - THE one definition of "today" (V1 Closure, 2026-08-01).
 *
 * Beacon had two. Daily tracking counted a UTC day while the product, the
 * operator and Google Search Console all speak Pacific, so from 5 PM onward the
 * app quietly moved on to tomorrow while the person reading it was still in
 * today. Every "today" a customer is shown, and every day label a daily plan is
 * filed under, resolves through here instead.
 *
 * THE CONTRACT, in one sentence: V1 binds the reporting day and the research day
 * to America/Los_Angeles for every account until tenant timezones exist, so
 * nothing anywhere may imply an account's own local midnight. Every other module
 * points here instead of restating it; a second definition is exactly the defect
 * this module exists to end.
 *
 * PURE and dependency-free: Intl already carries the zone rules, including the
 * daylight-saving shift, so nothing here has to know that Pacific is seven hours
 * behind in August and eight in December.
 *
 * DAYS ALREADY STORED UNDER A UTC LABEL ARE HISTORY and are never rewritten.
 * Because Pacific runs behind UTC, the day this returns can be a day that
 * already holds rows; those rows simply mean that work is done, and the identity
 * upsert keeps the same reading on the same row.
 */

/** The one reporting timezone. Search Console reports in Pacific and so does Beacon. */
const REPORTING_TIME_ZONE = "America/Los_Angeles";

const dayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

/** The YYYY-MM-DD reporting day for an instant (default: now). An unreadable instant falls back to right
 *  now, and THROUGH THE SAME PACIFIC FORMATTER: the fallback used to slice a UTC string, so the one module
 *  that exists to end UTC-derived days named tomorrow between 5 PM and midnight Pacific. */
export function reportingDay(now: number | Date = Date.now()): string {
  const asked = new Date(now);
  const at = Number.isNaN(asked.getTime()) ? new Date() : asked;
  const parts = dayParts.formatToParts(at);
  const of = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${of("year")}-${of("month")}-${of("day")}`;
}
