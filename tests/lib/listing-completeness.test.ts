import { describe, it, expect } from "vitest";
import {
  deriveListingCompletenessAudit,
  listingCompletenessMarketPhrase,
  listingCompletenessSummaryLine,
} from "@/lib/local-presence";

describe("deriveListingCompletenessAudit", () => {
  it("returns strong when 4 or 5 key fields are present", () => {
    const full = deriveListingCompletenessAudit({
      nameFromConfig: "Acme",
      nameFromGoogleLocation: null,
      address: "1 Main",
      phone: "555",
      domain: "acme.com",
      industry: "home-builder",
    });
    expect(full.coverage_state).toBe("strong");
    expect(full.missing_fields).toHaveLength(0);
    expect(full.present_fields).toHaveLength(5);

    const four = deriveListingCompletenessAudit({
      nameFromConfig: "Acme",
      nameFromGoogleLocation: null,
      address: "1 Main",
      phone: "555",
      domain: "acme.com",
      industry: "",
    });
    expect(four.coverage_state).toBe("strong");
    expect(four.missing_fields).toEqual(["Category (industry)"]);
  });

  it("treats Google selected location name as name when config name empty", () => {
    const a = deriveListingCompletenessAudit({
      nameFromConfig: "",
      nameFromGoogleLocation: "GBP Location",
      address: "1 Main",
      phone: "555",
      domain: "acme.com",
      industry: "x",
    });
    expect(a.present_fields).toContain("Business name");
    expect(a.coverage_state).toBe("strong");
  });

  it("returns partial when exactly 3 fields present", () => {
    const a = deriveListingCompletenessAudit({
      nameFromConfig: "Acme",
      nameFromGoogleLocation: null,
      address: "",
      phone: "",
      domain: "acme.com",
      industry: "svc",
    });
    expect(a.coverage_state).toBe("partial");
    expect(a.missing_fields).toEqual(
      expect.arrayContaining(["Address", "Phone"]),
    );
    expect(a.present_fields.length).toBe(3);
  });

  it("returns weak when at most 2 fields present", () => {
    const a = deriveListingCompletenessAudit({
      nameFromConfig: "",
      nameFromGoogleLocation: null,
      address: "",
      phone: "",
      domain: "only.example",
      industry: "",
    });
    expect(a.coverage_state).toBe("weak");
    expect(a.missing_fields.length).toBeGreaterThanOrEqual(3);
  });

  it("summary lines match coverage state", () => {
    expect(
      listingCompletenessSummaryLine({
        checked_field_keys: ["name", "address", "phone", "website", "category"],
        present_fields: ["a", "b", "c", "d"],
        missing_fields: ["e"],
        coverage_state: "strong",
      }),
    ).toContain("Most key listing");
    expect(
      listingCompletenessSummaryLine({
        checked_field_keys: ["name", "address", "phone", "website", "category"],
        present_fields: ["a", "b", "c"],
        missing_fields: ["d", "e"],
        coverage_state: "partial",
      }),
    ).toContain("Some key listing");
    expect(
      listingCompletenessSummaryLine({
        checked_field_keys: ["name", "address", "phone", "website", "category"],
        present_fields: ["a"],
        missing_fields: ["b", "c", "d", "e"],
        coverage_state: "weak",
      }),
    ).toContain("limited");
  });

  it("market phrase null only for strong", () => {
    expect(
      listingCompletenessMarketPhrase({
        checked_field_keys: ["name", "address", "phone", "website", "category"],
        present_fields: ["a", "b", "c", "d"],
        missing_fields: ["e"],
        coverage_state: "strong",
      }),
    ).toBeNull();
    expect(
      listingCompletenessMarketPhrase({
        checked_field_keys: ["name", "address", "phone", "website", "category"],
        present_fields: ["a", "b", "c"],
        missing_fields: ["d", "e"],
        coverage_state: "partial",
      }),
    ).toBe("Listing completeness: partial");
    expect(
      listingCompletenessMarketPhrase({
        checked_field_keys: ["name", "address", "phone", "website", "category"],
        present_fields: ["a"],
        missing_fields: ["b", "c", "d", "e"],
        coverage_state: "weak",
      }),
    ).toBe("Listing completeness: limited");
  });
});
