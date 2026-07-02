/**
 * seasonal/event-calendar tests (BEACON_500 item 69).
 *
 * Pins: derivation names an event after the family slug (never a curated
 * holiday), idempotent derived ids, merge never clobbers an existing/edited
 * entry, nextOccurrenceOf math for both rule kinds, and the hard no-dash rule.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveEventFromFamilyProfile,
  deriveEventsFromProfiles,
  derivedEventId,
  mergeDerivedEntries,
  nextOccurrenceOf,
  type EventCalendarEntry,
} from "./event-calendar";
import type { FamilyDemandProfile } from "./family-demand-profile";

const NOW_ISO = "2026-07-02T00:00:00.000Z";

function profile(pageFamily: string, over: Partial<FamilyDemandProfile> = {}): FamilyDemandProfile {
  return {
    pageFamily,
    weeksOfHistory: 0,
    yearsOfHistory: 1,
    weekly: [],
    annual: [{ months: [3], share: 0.8, annualImpressions: 4000, confidence: "one_season" }],
    samplePages: [`/${pageFamily}/page`],
    ...over,
  };
}

describe("deriveEventFromFamilyProfile", () => {
  it("names the entry after the family slug, never a curated holiday name", () => {
    const entry = deriveEventFromFamilyProfile(profile("cheetah"), NOW_ISO);
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("Cheetah");
    expect(entry!.learnedFromData).toBe(true);
    expect(entry!.pageFamilies).toEqual(["cheetah"]);
  });

  it("title-cases multi-word / hyphenated family slugs", () => {
    const entry = deriveEventFromFamilyProfile(profile("iran-flags"), NOW_ISO);
    expect(entry!.name).toBe("Iran Flags");
  });

  it("carries the source window's months and confidence through unchanged", () => {
    const p = profile("x", { annual: [{ months: [11, 12], share: 0.75, annualImpressions: 9000, confidence: "repeated" }] });
    const entry = deriveEventFromFamilyProfile(p, NOW_ISO);
    expect(entry!.dateRule).toEqual({ kind: "learned_annual", months: [11, 12] });
    expect(entry!.confidence).toBe("repeated");
    expect(entry!.observedImpressions).toBe(9000);
  });

  it("returns null when the family has no annual window (weekly-only profile)", () => {
    const p = profile("weekly-only", { annual: [], weekly: [{ weeks: [10], share: 0.7, observedImpressions: 500 }] });
    expect(deriveEventFromFamilyProfile(p, NOW_ISO)).toBeNull();
  });

  it("produces a stable, idempotent id for the same family + window", () => {
    const a = deriveEventFromFamilyProfile(profile("cheetah"), NOW_ISO)!;
    const b = deriveEventFromFamilyProfile(profile("cheetah"), "2026-08-01T00:00:00.000Z")!;
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(derivedEventId("cheetah", [3]));
  });
});

describe("deriveEventsFromProfiles", () => {
  it("derives one entry per family that has an annual window, skipping weekly-only ones", () => {
    const profiles = [profile("cheetah"), profile("weekly-only", { annual: [] })];
    const out = deriveEventsFromProfiles(profiles, NOW_ISO);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Cheetah");
  });
});

describe("mergeDerivedEntries", () => {
  it("adds a freshly-derived entry not yet present", () => {
    const existing: EventCalendarEntry[] = [];
    const fresh = [deriveEventFromFamilyProfile(profile("cheetah"), NOW_ISO)!];
    const merged = mergeDerivedEntries(existing, fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("Cheetah");
  });

  it("never overwrites an existing entry with the same id, even if the operator renamed it", () => {
    const operatorEdited: EventCalendarEntry = {
      ...deriveEventFromFamilyProfile(profile("cheetah"), NOW_ISO)!,
      name: "Cheetah Season (operator renamed this)",
    };
    const fresh = [deriveEventFromFamilyProfile(profile("cheetah"), "2026-09-01T00:00:00.000Z")!];
    const merged = mergeDerivedEntries([operatorEdited], fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("Cheetah Season (operator renamed this)");
  });

  it("preserves an operator-created entry (learnedFromData false) untouched", () => {
    const manual: EventCalendarEntry = {
      id: "manual-1",
      name: "Spring Promo",
      dateRule: { kind: "fixed", month: 4, day: 1 },
      learnedFromData: false,
      pageFamilies: ["cheetah"],
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    };
    const fresh = [deriveEventFromFamilyProfile(profile("cheetah"), NOW_ISO)!];
    const merged = mergeDerivedEntries([manual], fresh);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.id === "manual-1")).toEqual(manual);
  });
});

describe("nextOccurrenceOf", () => {
  it("fixed rule: rolls to next year when the date already passed this year", () => {
    const now = new Date("2026-07-02T00:00:00Z");
    const next = nextOccurrenceOf({ kind: "fixed", month: 3, day: 15 }, now);
    expect(next).toBe("2027-03-15");
  });

  it("fixed rule: stays this year when the date has not passed yet", () => {
    const now = new Date("2026-07-02T00:00:00Z");
    const next = nextOccurrenceOf({ kind: "fixed", month: 12, day: 25 }, now);
    expect(next).toBe("2026-12-25");
  });

  it("learned_annual rule: uses the first day of the earliest peak month", () => {
    const now = new Date("2026-07-02T00:00:00Z");
    const next = nextOccurrenceOf({ kind: "learned_annual", months: [11, 12] }, now);
    expect(next).toBe("2026-11-01");
  });

  it("learned_annual rule: rolls to next year when the peak month already passed", () => {
    const now = new Date("2026-07-02T00:00:00Z");
    const next = nextOccurrenceOf({ kind: "learned_annual", months: [3] }, now);
    expect(next).toBe("2027-03-01");
  });
});

describe("dash guard (hard rule)", () => {
  it("the event-calendar module contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "event-calendar.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
