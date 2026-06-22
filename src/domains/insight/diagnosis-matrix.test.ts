import { describe, expect, it } from "vitest";
import { buildDiagnosisMatrix, type DiagnosisDimensionKey } from "./diagnosis-matrix";
import type {
  EvidencePacket,
  CurrentState,
  CrawlEvidence,
  GscEvidence,
} from "@/domains/recommendation-intelligence/page-surgeon/contract";

const CURRENT: CurrentState = {
  tenantId: "t",
  pageUrl: "https://x.test/p",
  changeType: "title",
  elementKey: null,
  sectionLabel: null,
  currentText: null,
  cmsFieldMapped: false,
  publishChannel: "none",
};

function packet(over: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    current: CURRENT,
    sourcesPresent: [],
    sourcesConnectedButEmpty: [],
    ...over,
  };
}

function crawl(over: Partial<CrawlEvidence> = {}): CrawlEvidence {
  return {
    title: "A Title",
    h1: "A Headline",
    metaDescription: "A meta description that promises the answer.",
    h2List: ["Section one", "Section two"],
    h3List: [],
    faqs: [],
    schemaTypes: ["Article"],
    wordCount: 800,
    internalLinkCount: 6,
    cardTexts: [],
    fetchedAt: null,
    extractionCertainty: "confirmed",
    ...over,
  };
}

function gsc(over: Partial<GscEvidence> = {}): GscEvidence {
  return {
    windowStart: "2026-03-01",
    windowEnd: "2026-05-30",
    impressions: 5000,
    clicks: 250,
    ctr: 0.05,
    avgPosition: 8,
    topQueries: [],
    expectedCtrForPosition: 0.05,
    ctrGap: 0,
    ...over,
  };
}

const KEYS: DiagnosisDimensionKey[] = [
  "title",
  "meta",
  "h1",
  "answer_block",
  "section_content",
  "qa_schema",
  "internal_links",
  "ux_friction",
  "serp_presentation",
  "cannibalization",
  "keep_current",
];

function byKey(rows: ReturnType<typeof buildDiagnosisMatrix>) {
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

describe("buildDiagnosisMatrix — structure", () => {
  it("always returns the 11 fixed dimensions in order", () => {
    const rows = buildDiagnosisMatrix(packet());
    expect(rows.map((r) => r.key)).toEqual(KEYS);
    for (const r of rows) {
      expect(["attention", "monitor", "ok", "unknown"]).toContain(r.status);
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("on-page dimensions reflect the crawl (honest 'no data' when absent)", () => {
  it("no crawl ⇒ on-page dims are 'unknown', not 'ok'", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ crawl: undefined })));
    for (const k of ["title", "meta", "h1", "section_content", "qa_schema", "internal_links"] as const) {
      expect(m[k].status).toBe("unknown");
    }
  });

  it("healthy crawl ⇒ on-page dims are 'ok'", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ crawl: crawl() })));
    expect(m.title.status).toBe("ok");
    expect(m.meta.status).toBe("ok");
    expect(m.h1.status).toBe("ok");
    expect(m.section_content.status).toBe("ok");
    expect(m.qa_schema.status).toBe("ok");
    expect(m.internal_links.status).toBe("ok");
  });

  it("missing meta / H1 ⇒ attention", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ crawl: crawl({ metaDescription: null, h1: null }) })));
    expect(m.meta.status).toBe("attention");
    expect(m.h1.status).toBe("attention");
  });

  it("thin internal linking ⇒ attention with the count", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ crawl: crawl({ internalLinkCount: 1 }) })));
    expect(m.internal_links.status).toBe("attention");
    expect(m.internal_links.detail).toContain("1");
  });

  it("no structured data ⇒ monitor (support, not a guaranteed rich result)", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ crawl: crawl({ schemaTypes: [] }) })));
    expect(m.qa_schema.status).toBe("monitor");
  });
});

describe("SERP presentation — the cheap guard", () => {
  it("top-5 rank ⇒ 'Verify' (needs SERP check, not a blind title fix)", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ gsc: gsc({ avgPosition: 3 }) })));
    expect(m.serp_presentation.status).toBe("monitor");
    expect(m.serp_presentation.detail).toContain("Needs SERP check");
  });

  it("rank > 5 ⇒ 'unknown' (we don't claim a SERP feature)", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ gsc: gsc({ avgPosition: 9 }) })));
    expect(m.serp_presentation.status).toBe("unknown");
  });

  it("no GSC ⇒ 'unknown'", () => {
    const m = byKey(buildDiagnosisMatrix(packet({ gsc: undefined })));
    expect(m.serp_presentation.status).toBe("unknown");
  });
});

describe("answer_block — definitional zero-click demand (widened detection)", () => {
  it("flags attention for a 'X meaning' query that gets page-1 impressions but ~0 clicks", () => {
    const m = byKey(
      buildDiagnosisMatrix(
        packet({
          gsc: gsc({
            topQueries: [
              { query: "pedar sag meaning", impressions: 2000, clicks: 1, ctr: 0.0005, position: 3 },
            ],
          }),
        }),
      ),
    );
    // "pedar sag meaning" doesn't start with a question word but is definitional
    // intent → questionDemand now true → with zero-click page-1 demand → attention.
    expect(m.answer_block.status).toBe("attention");
  });

  it("flags monitor for translation intent ('X in farsi') even without zero-click", () => {
    const m = byKey(
      buildDiagnosisMatrix(
        packet({
          gsc: gsc({
            topQueries: [
              { query: "good morning in farsi", impressions: 300, clicks: 40, ctr: 0.13, position: 2 },
            ],
          }),
        }),
      ),
    );
    expect(m.answer_block.status).toBe("monitor");
  });
});

describe("cannibalization + keep_current", () => {
  it("a clean page (no detected problems) ⇒ keep_current 'ok'", () => {
    // No GSC/Clarity problems + healthy crawl ⇒ detectPageProblems.hasAnyProblem = false.
    const m = byKey(buildDiagnosisMatrix(packet({ crawl: crawl() })));
    expect(m.keep_current.status).toBe("ok");
  });
});

describe("buildDiagnosisMatrix — cannibalization", () => {
  it("flags cannibalization as attention (cluster fix) when a case is passed", () => {
    const m = byKey(
      buildDiagnosisMatrix(packet(), {
        query: "iran flag",
        urlCount: 4,
        combinedImpressions: 3394,
        combinedClicks: 1,
        bestPosition: 4,
      }),
    );
    expect(m.cannibalization.status).toBe("attention");
    expect(m.cannibalization.detail).toContain("4 of your pages compete");
    expect(m.cannibalization.detail).toContain("not a title rewrite");
  });

  it("reports ok (not unknown) when no cannibalization is detected", () => {
    const m = byKey(buildDiagnosisMatrix(packet()));
    expect(m.cannibalization.status).toBe("ok");
  });
});
