import { describe, it, expect } from "vitest";
import { computeOutreachLeads, leadId } from "./compute-leads";

describe("computeOutreachLeads - wiki-gap citing contexts", () => {
  it("turns a non-Wikipedia citing url into a lead with a real evidence line", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [
        { citingUrl: "https://persianculture.example/nowruz", articleDisplayTitle: "Nowruz", queryText: "when is nowruz" },
      ],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.targetDomain).toBe("persianculture.example");
    expect(leads[0]!.leadSource).toBe("wiki_gap");
    expect(leads[0]!.evidence).toContain("when is nowruz");
  });

  it("skips wiki-gap contexts with no citing url (nothing invented)", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [{ citingUrl: null, articleDisplayTitle: "Chaharshanbe Suri", queryText: null }],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
    });
    expect(leads).toHaveLength(0);
  });
});

describe("computeOutreachLeads - keyword-gap competitors", () => {
  it("names the competitor, the keyword, and the volume when known", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [{ competitorDomain: "supplehomes.com", sampleKeyword: "persian rugs", volume: 1900 }],
      profoundCitationDomains: [],
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.leadSource).toBe("keyword_gap_competitor");
    expect(leads[0]!.evidence).toContain("persian rugs");
    expect(leads[0]!.evidence).toContain("1,900");
  });

  it("is honest when volume is unknown", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [{ competitorDomain: "example.com", sampleKeyword: "persian food", volume: null }],
      profoundCitationDomains: [],
    });
    expect(leads[0]!.evidence).not.toMatch(/\d+ searches/);
  });
});

describe("computeOutreachLeads - profound citation domains", () => {
  it("surfaces a domain AI cited with an honest topic label", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [],
      profoundCitationDomains: [{ domain: "blog.example.com", url: "https://blog.example.com/persian-poetry", topicLabel: "Persian poetry" }],
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.leadSource).toBe("profound_citation");
    expect(leads[0]!.evidence).toContain("Persian poetry");
  });

  it("never shows a raw UUID as a topic label", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [],
      profoundCitationDomains: [{ domain: "blog.example.com", url: "https://blog.example.com/x", topicLabel: null }],
    });
    expect(leads[0]!.evidence).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("computeOutreachLeads - link-gap targets (RANK-7)", () => {
  it("turns a link-gap competitor into a lead with a build-authority evidence line", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
      linkGapTargets: [
        { competitorDomain: "supplehomes.com", keyword: "persian rugs", referringDomainMultiple: 70, volume: 1900 },
      ],
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.leadSource).toBe("link_gap");
    expect(leads[0]!.targetDomain).toBe("supplehomes.com");
    expect(leads[0]!.evidence).toContain("70x");
    expect(leads[0]!.evidence).toContain("persian rugs");
    expect(leads[0]!.evidence).toContain("Study who links to their page");
  });

  it("is byte-identical to before when linkGapTargets is omitted (optional field)", () => {
    const withField = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [{ competitorDomain: "example.com", sampleKeyword: "k", volume: 100 }],
      profoundCitationDomains: [],
      linkGapTargets: [],
    });
    const withoutField = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [{ competitorDomain: "example.com", sampleKeyword: "k", volume: 100 }],
      profoundCitationDomains: [],
    });
    expect(withField).toEqual(withoutField);
  });

  it("drops the tenant's own domain and noise from link-gap targets too", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
      linkGapTargets: [
        { competitorDomain: "iranopedia.com", keyword: "x", referringDomainMultiple: 60, volume: null },
        { competitorDomain: "facebook.com", keyword: "y", referringDomainMultiple: 60, volume: null },
      ],
    });
    expect(leads).toEqual([]);
  });
});

describe("computeOutreachLeads - filters + dedupe", () => {
  it("drops the tenant's own domain", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [{ citingUrl: "https://www.iranopedia.com/other-page", articleDisplayTitle: "X", queryText: null }],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
    });
    expect(leads).toHaveLength(0);
  });

  it("drops noise and reference mega-domains (wikipedia, facebook, etc.)", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [
        { citingUrl: "https://en.wikipedia.org/wiki/Nowruz", articleDisplayTitle: "Nowruz", queryText: null },
        { citingUrl: "https://www.facebook.com/somepage", articleDisplayTitle: "X", queryText: null },
      ],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
    });
    expect(leads).toHaveLength(0);
  });

  it("dedupes the same domain across multiple sources - first source wins the slot", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [{ citingUrl: "https://shared.example/a", articleDisplayTitle: "A", queryText: "topic a" }],
      keywordGapCompetitors: [{ competitorDomain: "shared.example", sampleKeyword: "topic b", volume: 500 }],
      profoundCitationDomains: [],
    });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.leadSource).toBe("wiki_gap");
  });

  it("sorts leads by domain for stable rendering", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [
        { competitorDomain: "zzz.example", sampleKeyword: "k", volume: null },
        { competitorDomain: "aaa.example", sampleKeyword: "k", volume: null },
      ],
      profoundCitationDomains: [],
    });
    expect(leads.map((l) => l.targetDomain)).toEqual(["aaa.example", "zzz.example"]);
  });

  it("returns an honest empty list when every source is thin", () => {
    const leads = computeOutreachLeads({
      ownDomain: "iranopedia.com",
      wikiCitingContexts: [],
      keywordGapCompetitors: [],
      profoundCitationDomains: [],
    });
    expect(leads).toEqual([]);
  });
});

describe("leadId", () => {
  it("is stable for the same inputs and differs across sources", () => {
    const a = leadId("wiki_gap", "example.com", "https://example.com/x");
    const b = leadId("wiki_gap", "example.com", "https://example.com/x");
    const c = leadId("keyword_gap_competitor", "example.com", "https://example.com/x");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
