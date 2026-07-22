/**
 * ONBOARDING VALIDATION (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/onboarding/scope-validation.test.ts
 *   src/domains/onboarding/profile-validation.test.ts
 *   src/domains/onboarding/competitors-validation.test.ts
 * Pins kept: empty scope/competitors are VALID (north-star onboarding, no
 * vertical hard-block), XSS-hardened domain normalization, operator-friendly
 * labels (no raw enums), URL-shaped competitor rejection, count caps.
 */
import { describe, expect, it } from "vitest";
import {
  CITIES_MAX_COUNT,
  CITY_NAME_MAX_LENGTH,
  PROJECT_MIX_LABELS,
  PROJECT_MIX_TAGS,
  isProjectMixTag,
  normalizeCityList,
  validateScopeProfile,
} from "@/domains/onboarding/scope-validation";
import {
  BUSINESS_NAME_MAX_LENGTH,
  normalizeDomain,
  validateBusinessProfile,
} from "@/domains/onboarding/profile-validation";
import {
  COMPETITOR_NAME_MAX_LENGTH,
  COMPETITORS_MAX_COUNT,
  COMPETITORS_MIN_COUNT,
  normalizeCompetitorList,
  validateCompetitorsProfile,
} from "@/domains/onboarding/competitors-validation";

describe("normalizeCityList", () => {
  it("splits comma/newline input, trims, title-cases, and dedupes case-insensitively", () => {
    expect(normalizeCityList("atherton, MENLO PARK,los altos")).toEqual(["Atherton", "Menlo Park", "Los Altos"]);
    expect(normalizeCityList("atherton, ca\nmenlo park, ca")).toEqual(["Atherton, CA", "Menlo Park, CA"]);
    expect(normalizeCityList("atherton, ATHERTON, Atherton")).toEqual(["Atherton"]);
  });

  it("drops empty tokens, over-long tokens, and non-string elements; [] on junk input", () => {
    const longCity = "X".repeat(CITY_NAME_MAX_LENGTH + 1);
    expect(normalizeCityList(`,,Atherton, , ${longCity},Menlo Park,`)).toEqual(["Atherton", "Menlo Park"]);
    expect(normalizeCityList(["Atherton", null, undefined, 42, "Menlo Park"] as unknown[])).toEqual(["Atherton", "Menlo Park"]);
    expect(normalizeCityList(undefined)).toEqual([]);
    expect(normalizeCityList(" , , , ")).toEqual([]);
  });
});

describe("project mix tags + labels", () => {
  it("accepts every tag, rejects unknown/non-string, and labels are operator-friendly", () => {
    for (const t of PROJECT_MIX_TAGS) {
      expect(isProjectMixTag(t)).toBe(true);
      expect(PROJECT_MIX_LABELS[t]).toBeTruthy();
      expect(PROJECT_MIX_LABELS[t]).not.toContain("_");
    }
    expect(isProjectMixTag("foo")).toBe(false);
    expect(isProjectMixTag(null)).toBe(false);
  });
});

describe("validateScopeProfile", () => {
  it("accepts a clean submission, dedupes cities + mix, drops unknown tags", () => {
    const r = validateScopeProfile({
      cities: "atherton, ATHERTON, Menlo Park",
      projectMix: ["new_construction", "new_construction", "unknown_tag", "kitchen_bath"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.cities).toEqual(["Atherton", "Menlo Park"]);
      expect(r.normalized.projectMix).toEqual(["new_construction", "kitchen_bath"]);
    }
  });

  it("both fields empty is a VALID scope (brand-prompts-only launch; no vertical hard-block)", () => {
    const r = validateScopeProfile({ cities: "", projectMix: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.cities).toEqual([]);
      expect(r.normalized.projectMix).toEqual([]);
    }
    const missing = validateScopeProfile({} as unknown as Parameters<typeof validateScopeProfile>[0]);
    expect(missing.ok).toBe(true);
  });

  it("rejects more than CITIES_MAX_COUNT cities, accepts exactly the cap", () => {
    const tooMany = Array.from({ length: CITIES_MAX_COUNT + 1 }, (_, i) => `City${i}`);
    expect(validateScopeProfile({ cities: tooMany, projectMix: [] }).ok).toBe(false);
    const exactly = Array.from({ length: CITIES_MAX_COUNT }, (_, i) => `City${i}`);
    expect(validateScopeProfile({ cities: exactly, projectMix: [] }).ok).toBe(true);
  });
});

describe("normalizeDomain (XSS-hardened)", () => {
  it("strips scheme/path/query/port/userinfo, lowercases, keeps www + multi-label TLDs", () => {
    expect(normalizeDomain("HTTPS://Acme.Com/about?utm=x#frag")).toBe("acme.com");
    expect(normalizeDomain("https://www.acme.com/about")).toBe("www.acme.com");
    expect(normalizeDomain("https://user:pass@acme.com:8080")).toBe("acme.com");
    expect(normalizeDomain("acme.co.uk")).toBe("acme.co.uk");
  });

  it("rejects single labels, empty, dangerous schemes, bare IPs, malformed labels, non-strings", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("javascript:alert(1)")).toBeNull();
    expect(normalizeDomain("data:text/html,<script>")).toBeNull();
    expect(normalizeDomain("192.168.1.1")).toBeNull();
    expect(normalizeDomain("-acme.com")).toBeNull();
    expect(normalizeDomain("ac me.com")).toBeNull();
    expect(normalizeDomain(null as unknown as string)).toBeNull();
  });
});

describe("validateBusinessProfile", () => {
  it("accepts and normalizes a clean name + domain; enforces the 80-char boundary", () => {
    const r = validateBusinessProfile({ businessName: "  Acme Builders  ", domain: "https://www.acme.com/about" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.businessName).toBe("Acme Builders");
      expect(r.normalized.domain).toBe("www.acme.com");
    }
    expect(validateBusinessProfile({ businessName: "A".repeat(BUSINESS_NAME_MAX_LENGTH), domain: "acme.com" }).ok).toBe(true);
    expect(validateBusinessProfile({ businessName: "A".repeat(BUSINESS_NAME_MAX_LENGTH + 1), domain: "acme.com" }).ok).toBe(false);
  });

  it("returns BOTH errors when both fields are invalid; safe on missing keys", () => {
    const r = validateBusinessProfile({ businessName: "", domain: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.businessName).toBeTruthy();
      expect(r.errors.domain).toBeTruthy();
    }
    expect(validateBusinessProfile({} as { businessName: string; domain: string }).ok).toBe(false);
  });
});

describe("normalizeCompetitorList + validateCompetitorsProfile", () => {
  it("splits, preserves case, dedupes case-insensitively, drops junk", () => {
    expect(normalizeCompetitorList("deMattei, BNB Builders")).toEqual(["deMattei", "BNB Builders"]);
    expect(normalizeCompetitorList("Kasten, kasten, KASTEN, Kasten Builders")).toEqual(["Kasten", "Kasten Builders"]);
    const longName = "X".repeat(COMPETITOR_NAME_MAX_LENGTH + 1);
    expect(normalizeCompetitorList(`De Mattei, ${longName}`)).toEqual(["De Mattei"]);
    expect(normalizeCompetitorList([null, 42, "Kasten"] as unknown[])).toEqual(["Kasten"]);
  });

  it("empty is VALID (auto-seed takes over post-launch); constants pinned min 0 / max 5", () => {
    const r = validateCompetitorsProfile({ competitors: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.competitors).toEqual([]);
    expect(COMPETITORS_MIN_COUNT).toBe(0);
    expect(COMPETITORS_MAX_COUNT).toBe(5);
    const tooMany = Array.from({ length: COMPETITORS_MAX_COUNT + 1 }, (_, i) => `Builder ${i}`);
    expect(validateCompetitorsProfile({ competitors: tooMany }).ok).toBe(false);
  });

  it("rejects URL-shaped entries (names, not URLs), keeps bare brands and names with whitespace", () => {
    const mixed = validateCompetitorsProfile({ competitors: "De Mattei Construction, kasten.com, Supple Homes" });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.errors.competitors).toMatch(/kasten\.com/);
    expect(validateCompetitorsProfile({ competitors: "Houzz" }).ok).toBe(true);
    expect(validateCompetitorsProfile({ competitors: "Acme.com Builders" }).ok).toBe(true);
  });
});
