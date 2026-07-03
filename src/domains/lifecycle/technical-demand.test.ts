import { describe, expect, it } from "vitest";

import {
  classifyTechnicalDemand,
  robotsSaysNoindex,
  isBrokenStatus,
  TECHNICAL_DEMAND_MIN_IMPRESSIONS_90D,
  type TechnicalDemandPageInput,
} from "./technical-demand";

function page(over: Partial<TechnicalDemandPageInput> = {}): TechnicalDemandPageInput {
  return {
    url: "https://x.com/iran-visa",
    httpStatus: 200,
    robotsMeta: null,
    hasCanonicalMismatch: false,
    impressions90d: 300,
    ...over,
  };
}

describe("robotsSaysNoindex", () => {
  it("detects a standalone noindex token", () => {
    expect(robotsSaysNoindex("noindex")).toBe(true);
    expect(robotsSaysNoindex("noindex, follow")).toBe(true);
    expect(robotsSaysNoindex("follow, noindex")).toBe(true);
    expect(robotsSaysNoindex("NOINDEX")).toBe(true);
  });
  it("does not fire on lookalikes or an empty/null value", () => {
    expect(robotsSaysNoindex(null)).toBe(false);
    expect(robotsSaysNoindex("index, follow")).toBe(false);
    expect(robotsSaysNoindex("noindexing-guide")).toBe(false);
  });
});

describe("isBrokenStatus", () => {
  it("true for 4xx/5xx and redirects", () => {
    expect(isBrokenStatus(404)).toBe(true);
    expect(isBrokenStatus(500)).toBe(true);
    expect(isBrokenStatus(301)).toBe(true);
    expect(isBrokenStatus(302)).toBe(true);
  });
  it("false for 200", () => {
    expect(isBrokenStatus(200)).toBe(false);
  });
});

describe("classifyTechnicalDemand - demand gate", () => {
  it("emits nothing below the demand floor even with real defects", () => {
    const out = classifyTechnicalDemand(
      page({
        impressions90d: TECHNICAL_DEMAND_MIN_IMPRESSIONS_90D - 1,
        httpStatus: 404,
        robotsMeta: "noindex",
        hasCanonicalMismatch: true,
      }),
    );
    expect(out).toEqual([]);
  });

  it("fires at exactly the demand floor", () => {
    const out = classifyTechnicalDemand(
      page({ impressions90d: TECHNICAL_DEMAND_MIN_IMPRESSIONS_90D, httpStatus: 404 }),
    );
    expect(out).toHaveLength(1);
  });
});

describe("classifyTechnicalDemand - findings", () => {
  it("flags a broken status on a demand page with the status number in the copy", () => {
    const out = classifyTechnicalDemand(page({ httpStatus: 404, impressions90d: 340 }));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("bad_status");
    expect(out[0]!.reason).toContain("/iran-visa");
    expect(out[0]!.reason).toContain("404");
    expect(out[0]!.reason).toContain("340");
    expect(out[0]!.reason).not.toMatch(/[—–]/);
  });

  it("flags noindex on a demand page with the mistake framing", () => {
    const out = classifyTechnicalDemand(page({ robotsMeta: "noindex, follow", impressions90d: 340 }));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("noindex");
    expect(out[0]!.reason).toContain("tells search engines not to index it");
    expect(out[0]!.reason).toContain("likely a mistake");
  });

  it("flags a canonical pointing elsewhere on a demand page", () => {
    const out = classifyTechnicalDemand(page({ hasCanonicalMismatch: true, impressions90d: 340 }));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("canonical_elsewhere");
    expect(out[0]!.reason).toContain("canonical tag points at a different page");
  });

  it("a dead page (>=400) does NOT also carry noindex/canonical findings (status leads)", () => {
    const out = classifyTechnicalDemand(
      page({ httpStatus: 404, robotsMeta: "noindex", hasCanonicalMismatch: true }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("bad_status");
  });

  it("a 301 redirect CAN co-carry a noindex/canonical finding (it still indexes)", () => {
    const out = classifyTechnicalDemand(
      page({ httpStatus: 301, robotsMeta: "noindex", hasCanonicalMismatch: true }),
    );
    const kinds = out.map((f) => f.kind);
    expect(kinds).toContain("bad_status");
    expect(kinds).toContain("noindex");
    expect(kinds).toContain("canonical_elsewhere");
  });

  it("a clean healthy page emits nothing", () => {
    expect(classifyTechnicalDemand(page())).toEqual([]);
  });
});
