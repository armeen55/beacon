import { describe, it, expect } from "vitest";
import { aeoDefendCitedQuery, type AeoDefendCitedQueryInput } from "./aeo-defend-cited-query";
import type { DefendCitedQuery } from "@/domains/aeo/defense-types";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const SIGNAL_AT = "2026-07-03T12:00:00Z";

function finding(overrides: Partial<DefendCitedQuery> = {}): DefendCitedQuery {
  return {
    categoryId: "cat-1",
    topicLabel: "persian saffron",
    competitorDomain: "surfiran.com",
    competitorCitations: 3,
    ownPriorCitations: 5,
    priorCaptureDate: "2026-06-25",
    latestCaptureDate: "2026-07-02",
    ...overrides,
  };
}

function baseInput(overrides: Partial<AeoDefendCitedQueryInput> = {}): AeoDefendCitedQueryInput {
  return {
    tenantId: "tenant-iranopedia",
    findings: [],
    siteRootUrl: "https://iranopedia.com/",
    signalAt: SIGNAL_AT,
    ...overrides,
  };
}

describe("aeoDefendCitedQuery", () => {
  it("abstains when there is no configured site-root URL (empty-safe)", () => {
    expect(aeoDefendCitedQuery(baseInput({ siteRootUrl: null, findings: [finding()] }))).toEqual([]);
  });

  it("abstains when there are no findings (self-hiding)", () => {
    expect(aeoDefendCitedQuery(baseInput({ findings: [] }))).toEqual([]);
  });

  it("emits one defensive candidate per finding, anchored on the site root", () => {
    const rows = aeoDefendCitedQuery(baseInput({ findings: [finding()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].target_url).toBe("https://iranopedia.com/");
    expect(rows[0].action_type).toBe("add_answer_block");
    expect(rows[0].trigger_signal).toBe("aeo_defend_cited_query");
    expect(rows[0].generator_kind).toBe("deterministic");
    expect(rows[0].safety_flags).toEqual([]);
  });

  it("customer copy names the rival + topic, is Beacon voice, no dashes, no lab jargon", () => {
    const rows = aeoDefendCitedQuery(baseInput({ findings: [finding()] }));
    const copy = rows[0].customer_copy;
    expect(copy).toContain("surfiran.com");
    expect(copy).toContain("persian saffron");
    expect(hasBannedDash(copy)).toBe(false);
    for (const banned of ["AEO", "SERP", "SoV", "visibility", "share of voice"]) {
      expect(copy.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("operator evidence carries both capture dates for the delta", () => {
    const rows = aeoDefendCitedQuery(baseInput({ findings: [finding()] }));
    expect(rows[0].operator_evidence).toContain("2026-06-25");
    expect(rows[0].operator_evidence).toContain("2026-07-02");
  });

  it("dedupe_key differs per (category, competitor)", () => {
    const a = aeoDefendCitedQuery(baseInput({ findings: [finding({ competitorDomain: "one.com" })] }))[0];
    const b = aeoDefendCitedQuery(baseInput({ findings: [finding({ competitorDomain: "two.com" })] }))[0];
    expect(a.dedupe_key).not.toBe(b.dedupe_key);
    expect(a.topic_cluster_label).toBe("aeo_defend:cat-1:one.com");
  });
});
