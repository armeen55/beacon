/**
 * seasonal/event-calendar (BEACON_500 item 69) - the tenant's own event
 * calendar: named recurring windows that matter to specific page families.
 *
 * Nothing here is seeded from a curated holiday list. Every entry either:
 *   (a) comes from the operator typing it in (learnedFromData: false), or
 *   (b) is DERIVED from this tenant's own detected annual GSC peak for a
 *       family (learnedFromData: true) - deriveEventsFromProfiles below turns
 *       a FamilyAnnualInflection into a calendar entry whose name is the
 *       family slug itself (e.g. "cheetah window"), never a guessed holiday
 *       name. The operator can rename/edit/delete any entry afterward.
 *
 * PURE module: types + the derivation function. Persistence lives in
 * (store removed as dead 2026-07-02); the read-time overlap check measurement-maturity
 * needs lives in seasonal-inflection.ts.
 */

import type { FamilyAnnualInflection, FamilyDemandProfile } from "./family-demand-profile";

/** A fixed calendar date rule: the SAME month/day every year (operator-entered,
 *  e.g. a known promotion date). */
export type FixedDateRule = {
  kind: "fixed";
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
};

/** A rule learned from this tenant's own annual GSC peak for a family: the
 *  window recurs every year in the SAME 1-2 calendar months, exactly the
 *  shape detectSeasonalQueries/bestAnnualWindow already produce. */
export type LearnedAnnualRule = {
  kind: "learned_annual";
  /** 1-2 adjacent months (1-12), peak first. */
  months: number[];
};

export type EventDateRule = FixedDateRule | LearnedAnnualRule;

export type EventCalendarEntry = {
  id: string;
  /** Operator-facing name. For a derived entry this defaults to the family
   *  slug (e.g. "cheetah"); the operator can rename it to anything (a real
   *  holiday name, a promo name, whatever they call it internally). Never
   *  hardcoded to a specific culture/language in the CODE - only ever text
   *  the operator typed or the tenant's own family slug. */
  name: string;
  dateRule: EventDateRule;
  /** True when this entry was derived from the tenant's own GSC data (not
   *  typed in by the operator). An operator can still edit a learned entry;
   *  the flag just records where it came from. */
  learnedFromData: boolean;
  /** Page families this event affects (pageFamilyOf slugs). Empty means "not
   *  yet linked to a family" (an operator-created entry before they've picked
   *  one). */
  pageFamilies: string[];
  /** How strong the evidence is when learnedFromData is true (mirrors
   *  FamilyAnnualInflection's confidence); undefined for operator-entered
   *  entries (there is no data confidence to report). */
  confidence?: "one_season" | "repeated";
  /** The annual impressions the source window carried, when known (derived
   *  entries only - lets a calendar surface show "how big is this wave"). */
  observedImpressions?: number;
  createdAt: string;
  updatedAt: string;
};

function clampDay(month: number, day: number): number {
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Feb generous (leap-safe)
  const max = daysInMonth[month - 1] ?? 31;
  return Math.min(Math.max(1, Math.round(day)), max);
}

/** Build a stable id for a derived entry so re-deriving the same family's
 *  window is idempotent (upsert-by-id in the store), rather than piling up
 *  duplicate entries every time the nightly pass reruns. PURE. */
export function derivedEventId(pageFamily: string, months: number[]): string {
  return `derived:${pageFamily}:${months.join("-")}`;
}

/**
 * Turn one family's detected annual inflection into a calendar entry. PURE.
 * The name is ALWAYS the family slug (title-cased for display) - never a
 * curated holiday guess. Returns null when the family has no annual window
 * (a weekly-only profile has nothing calendar-shaped to derive yet).
 */
export function deriveEventFromFamilyProfile(
  profile: FamilyDemandProfile,
  nowIso: string = new Date().toISOString(),
): EventCalendarEntry | null {
  const annual: FamilyAnnualInflection | undefined = profile.annual[0];
  if (!annual) return null;
  return {
    id: derivedEventId(profile.pageFamily, annual.months),
    name: titleCase(profile.pageFamily),
    dateRule: { kind: "learned_annual", months: annual.months },
    learnedFromData: true,
    pageFamilies: [profile.pageFamily],
    confidence: annual.confidence,
    observedImpressions: annual.annualImpressions,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derive candidate calendar entries from every family profile that has an
 * annual window. PURE, bounded by the profiles array's own length (already
 * capped upstream by the seasonality pass). Callers merge these with any
 * operator-entered entries in the store (derived entries never overwrite an
 * operator's own edits to the same id - see mergeDerivedEntries).
 */
export function deriveEventsFromProfiles(
  profiles: readonly FamilyDemandProfile[],
  nowIso: string = new Date().toISOString(),
): EventCalendarEntry[] {
  const out: EventCalendarEntry[] = [];
  for (const p of profiles) {
    const entry = deriveEventFromFamilyProfile(p, nowIso);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Merge freshly-derived entries into the existing stored calendar: a derived
 * entry with an id the operator has already EDITED (name/dateRule/pageFamilies
 * changed from what a fresh derivation would produce) is left alone - the
 * operator's edit wins. A derived id not yet present is added. Any entry the
 * operator created by hand (learnedFromData: false) is always preserved
 * untouched. PURE.
 */
export function mergeDerivedEntries(
  existing: readonly EventCalendarEntry[],
  freshlyDerived: readonly EventCalendarEntry[],
): EventCalendarEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e] as const));
  const out: EventCalendarEntry[] = [...existing];
  for (const fresh of freshlyDerived) {
    const already = byId.get(fresh.id);
    if (already) continue; // present (operator may have edited it) - never clobber
    out.push(fresh);
  }
  return out;
}

/** Next occurrence (on/after `now`) of a date rule, as YYYY-MM-DD. PURE. */
export function nextOccurrenceOf(rule: EventDateRule, now: Date): string {
  const y = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();
  if (rule.kind === "fixed") {
    const day = clampDay(rule.month, rule.day);
    const passedThisYear = rule.month < nowMonth || (rule.month === nowMonth && day < nowDay);
    const year = passedThisYear ? y + 1 : y;
    return `${year}-${String(rule.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const earliestMonth = rule.months[0]!;
  const year = earliestMonth >= nowMonth ? y : y + 1;
  return `${year}-${String(earliestMonth).padStart(2, "0")}-01`;
}
