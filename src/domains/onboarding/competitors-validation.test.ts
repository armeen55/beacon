/**
 * Behavioral tests — Gap C.3 competitors-validation (2026-05-07).
 *
 * Pure unit tests, no I/O. Pin the competitors-step validation contract.
 */

import { describe, expect, it } from "vitest";
import {
  COMPETITOR_NAME_MAX_LENGTH,
  COMPETITORS_MAX_COUNT,
  COMPETITORS_MIN_COUNT,
  normalizeCompetitorList,
  validateCompetitorsProfile,
} from "./competitors-validation";

describe("normalizeCompetitorList — string input", () => {
  it("splits comma-separated input + trims whitespace", () => {
    expect(
      normalizeCompetitorList("De Mattei Construction, Kasten, Supple Homes"),
    ).toEqual(["De Mattei Construction", "Kasten", "Supple Homes"]);
  });

  it("splits newline-separated input", () => {
    expect(
      normalizeCompetitorList(
        "De Mattei Construction\nKasten\nSupple Homes",
      ),
    ).toEqual(["De Mattei Construction", "Kasten", "Supple Homes"]);
  });

  it("preserves the user's case (does not title-case)", () => {
    expect(normalizeCompetitorList("deMattei, BNB Builders")).toEqual([
      "deMattei",
      "BNB Builders",
    ]);
  });

  it("dedupes case-insensitively (first occurrence wins)", () => {
    expect(
      normalizeCompetitorList("Kasten, kasten, KASTEN, Kasten Builders"),
    ).toEqual(["Kasten", "Kasten Builders"]);
  });

  it("drops empty tokens + extra whitespace", () => {
    expect(
      normalizeCompetitorList(",,De Mattei, , ,Kasten,"),
    ).toEqual(["De Mattei", "Kasten"]);
  });

  it("rejects a token longer than COMPETITOR_NAME_MAX_LENGTH", () => {
    const longName = "X".repeat(COMPETITOR_NAME_MAX_LENGTH + 1);
    expect(
      normalizeCompetitorList(`De Mattei, ${longName}, Kasten`),
    ).toEqual(["De Mattei", "Kasten"]);
  });

  it("returns [] on empty / whitespace input", () => {
    expect(normalizeCompetitorList("")).toEqual([]);
    expect(normalizeCompetitorList("   ")).toEqual([]);
    expect(normalizeCompetitorList(" , , , ")).toEqual([]);
  });
});

describe("normalizeCompetitorList — array input", () => {
  it("accepts an array of strings", () => {
    expect(
      normalizeCompetitorList(["De Mattei", "Kasten", "Supple Homes"]),
    ).toEqual(["De Mattei", "Kasten", "Supple Homes"]);
  });

  it("dedupes within the array", () => {
    expect(
      normalizeCompetitorList(["Kasten", "kasten", "KASTEN"]),
    ).toEqual(["Kasten"]);
  });

  it("ignores non-string array elements safely", () => {
    expect(
      normalizeCompetitorList([
        "De Mattei",
        null,
        undefined,
        42,
        "Kasten",
      ] as unknown[]),
    ).toEqual(["De Mattei", "Kasten"]);
  });

  it("returns [] on non-array, non-string input", () => {
    expect(normalizeCompetitorList(undefined)).toEqual([]);
    expect(normalizeCompetitorList(null)).toEqual([]);
    expect(normalizeCompetitorList(42 as unknown)).toEqual([]);
    expect(normalizeCompetitorList({ a: 1 } as unknown)).toEqual([]);
  });
});

describe("validateCompetitorsProfile — accept paths", () => {
  it("accepts a single competitor (boundary: minimum)", () => {
    const r = validateCompetitorsProfile({ competitors: "De Mattei" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual(["De Mattei"]);
  });

  it("accepts COMPETITORS_MAX_COUNT competitors (boundary: max)", () => {
    const exactly = Array.from(
      { length: COMPETITORS_MAX_COUNT },
      (_, i) => `Builder ${i}`,
    );
    const r = validateCompetitorsProfile({ competitors: exactly });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.competitors.length).toBe(COMPETITORS_MAX_COUNT);
    }
  });

  it("accepts a clean comma-separated list", () => {
    const r = validateCompetitorsProfile({
      competitors: "De Mattei Construction, Kasten, Supple Homes",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.competitors).toEqual([
        "De Mattei Construction",
        "Kasten",
        "Supple Homes",
      ]);
    }
  });

  it("dedupes input case-insensitively before counting", () => {
    const r = validateCompetitorsProfile({
      competitors: "Kasten, kasten, KASTEN, De Mattei",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.competitors).toEqual(["Kasten", "De Mattei"]);
    }
  });
});

describe("validateCompetitorsProfile — reject paths", () => {
  // North-star onboarding (2026-06-11): empty is now a VALID scope —
  // the old ≥1 rule blocked strangers who don't know their AI rivals,
  // and the 2026-06 co-mention audit showed manually-guessed
  // competitors were wrong; auto-seed fills real rivals post-launch.
  it("accepts empty input (auto-seed takes over post-launch)", () => {
    const r = validateCompetitorsProfile({ competitors: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual([]);
  });

  it("whitespace-only input normalizes to empty (accepted)", () => {
    const r = validateCompetitorsProfile({ competitors: " , , " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual([]);
  });

  it("rejects more than COMPETITORS_MAX_COUNT competitors", () => {
    const tooMany = Array.from(
      { length: COMPETITORS_MAX_COUNT + 1 },
      (_, i) => `Builder ${i}`,
    );
    const r = validateCompetitorsProfile({ competitors: tooMany });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.competitors).toBeTruthy();
      expect(r.errors.competitors).toMatch(/5/);
    }
  });

  it("rejects when EVERY entry is URL-shaped", () => {
    const r = validateCompetitorsProfile({
      competitors: "demattei.com, kasten.com, supplehomes.com",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.competitors).toBeTruthy();
      expect(r.errors.competitors).toMatch(/name/i);
      expect(r.errors.competitors).toMatch(/url/i);
    }
  });

  it("rejects when ANY entry is URL-shaped (mixed list)", () => {
    const r = validateCompetitorsProfile({
      competitors: "De Mattei Construction, kasten.com, Supple Homes",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.competitors).toBeTruthy();
      expect(r.errors.competitors).toMatch(/kasten\.com/);
    }
  });

  it("accepts single-word brands that are NOT URL-shaped (e.g. 'Houzz')", () => {
    // normalizeDomain rejects single-label inputs (no TLD), so the
    // URL-shape heuristic doesn't fire on bare brands.
    const r = validateCompetitorsProfile({
      competitors: "Houzz",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual(["Houzz"]);
  });

  it("accepts a name that contains a domain-like substring but has whitespace", () => {
    // "Acme.com Builders" has whitespace — heuristic: name, not URL.
    const r = validateCompetitorsProfile({
      competitors: "Acme.com Builders",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual(["Acme.com Builders"]);
  });

  it("handles missing keys safely (normalizes to empty)", () => {
    const r = validateCompetitorsProfile(
      {} as unknown as Parameters<typeof validateCompetitorsProfile>[0],
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual([]);
  });
});

describe("validateCompetitorsProfile — constants pinned", () => {
  it("COMPETITORS_MIN_COUNT = 0 (optional step), COMPETITORS_MAX_COUNT = 5", () => {
    expect(COMPETITORS_MIN_COUNT).toBe(0);
    expect(COMPETITORS_MAX_COUNT).toBe(5);
  });
});
