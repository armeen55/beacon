import { describe, expect, it } from "vitest";
import { computeLocalOperatorSurface } from "@/domains/local-operator/surface";
import type { BusinessConfig } from "@/lib/business-config";

const minimalBusiness: BusinessConfig = {
  name: "Test Co",
  domain: "test.example",
  industry: "services",
  phone: "",
  address: "",
  yelpBusinessId: "",
  locations: ["Austin"],
  services: ["repair"],
  primaryCompetitors: [],
  keyPages: ["/"],
  locationTerms: [],
  serviceTerms: [],
  directoryDomains: ["yelp.com", "google.com"],
  scanSettings: {
    preferredHour: 9,
    timezone: "America/Chicago",
    scope: "full",
    enabled: true,
  },
};

describe("computeLocalOperatorSurface", () => {
  it("does not set Today urgent strip without import signals", () => {
    const s = computeLocalOperatorSurface({
      business: minimalBusiness,
      importRow: null,
      geoGap: null,
      meaningfulDecayCount: 0,
    });
    expect(s.todayUrgentStrip).toBeNull();
    expect(s.presenceSignals.length).toBeGreaterThanOrEqual(1);
    expect(s.reviewTasks.length).toBeGreaterThanOrEqual(1);
  });

  it("sets Today urgent strip when unresponded reviews cross threshold", () => {
    const s = computeLocalOperatorSurface({
      business: minimalBusiness,
      importRow: { unresponded_reviews_estimate: 4 },
      geoGap: null,
      meaningfulDecayCount: 0,
    });
    expect(s.todayUrgentStrip).not.toBeNull();
    expect(s.todayUrgentStrip?.href).toContain("local-ops");
  });

  it("sets changes hook when review velocity down and decay is meaningful", () => {
    const s = computeLocalOperatorSurface({
      business: minimalBusiness,
      importRow: { review_velocity_vs_prior: "down" },
      geoGap: null,
      meaningfulDecayCount: 2,
    });
    expect(s.changesOutcomesHook).not.toBeNull();
  });
});
