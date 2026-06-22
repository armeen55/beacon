import { describe, expect, it } from "vitest";

import { buildWorkbenchMatrix, type LeverKey } from "./workbench-matrix";
import type {
  EvidencePacket,
  CurrentState,
  CrawlEvidence,
  GscEvidence,
} from "@/domains/recommendation-intelligence/page-surgeon/contract";
import type { AtomicChangePack } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { ChangeArtifact } from "@/domains/recommendation-intelligence/page-surgeon/artifact-bundle";

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
  return { current: CURRENT, sourcesPresent: [], sourcesConnectedButEmpty: [], ...over };
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
    impressions: 10000,
    clicks: 10,
    ctr: 0.001,
    avgPosition: 4,
    topQueries: [
      { query: "iran flag", impressions: 9000, clicks: 9, ctr: 0.001, position: 4 },
    ],
    expectedCtrForPosition: 0.07,
    ctrGap: 0.069,
    ...over,
  };
}

/** Minimal ChangeArtifact for a brief-backed lever. */
function artifact(over: Partial<ChangeArtifact> & { action: ChangeArtifact["action"] }): ChangeArtifact {
  return {
    label: "x",
    dependencyOrder: 1,
    publishability: "publishable",
    before: null,
    after: null,
    rollback: "",
    measurement: "",
    evidence: "",
    hypothesis: "",
    risk: "low",
    ...over,
  } as ChangeArtifact;
}

/** Minimal pack — the matrix only reads bundle.{primary,supporting,deferred}
 *  + pushability, so we cast a partial. */
function pack(primary: ChangeArtifact | null, supporting: ChangeArtifact[] = []): AtomicChangePack {
  return {
    bundle: { primary, supporting, deferred: [] },
    pushability: [],
  } as unknown as AtomicChangePack;
}

const KEYS: LeverKey[] = [
  "title", "meta", "h1", "answer_block", "h2_sections",
  "visible_qa", "internal_links", "schema", "new_page", "cannibalization",
];

describe("buildWorkbenchMatrix — structure", () => {
  it("emits exactly the 10 levers in order", () => {
    const m = buildWorkbenchMatrix(packet({ crawl: crawl(), gsc: gsc() }), null);
    expect(m.rows.map((r) => r.lever)).toEqual(KEYS);
    for (const r of m.rows) {
      expect(["attention", "monitor", "ok", "unknown"]).toContain(r.status);
      expect(r.whyNeeded.length).toBeGreaterThan(0);
    }
  });

  it("never fabricates a draft: with no pack, copy levers are needs_endpoint, not blank-but-llm", () => {
    const m = buildWorkbenchMatrix(packet({ crawl: crawl({ schemaTypes: [] }), gsc: gsc() }), null);
    const byLever = Object.fromEntries(m.rows.map((r) => [r.lever, r]));
    // No LLM endpoint configured ⇒ title/meta/h1/answer copy is needs_endpoint.
    for (const k of ["title", "meta", "h1", "answer_block", "visible_qa", "h2_sections"] as const) {
      expect(byLever[k].proposedSource).not.toBe("llm_brief");
      if (byLever[k].proposedSource === "needs_endpoint") expect(byLever[k].proposed).toBeNull();
    }
  });
});

describe("buildWorkbenchMatrix — deterministic title (no LLM, no pack)", () => {
  it("drafts a title from evaluateTitle when the current title omits the dominant query", () => {
    const m = buildWorkbenchMatrix(
      packet({
        crawl: crawl({ title: "Random Unrelated Page" }),
        gsc: gsc({
          topQueries: [
            { query: "persian swear words", impressions: 9000, clicks: 9, ctr: 0.001, position: 4 },
          ],
        }),
      }),
      null, // no Change Pack ⇒ deterministic path
    );
    const title = m.rows.find((r) => r.lever === "title")!;
    // Never a fabricated llm_brief without a pack; a real deterministic draft here.
    expect(title.proposedSource).toBe("deterministic");
    expect(title.proposed).toBeTruthy();
    expect(title.proposed!.toLowerCase()).toContain("swear words");
  });
});

describe("buildWorkbenchMatrix — benefit + SERP guard (CTR levers)", () => {
  it("carries the page Opportunity estimate + SERP guard on a top-5 low-CTR page", () => {
    const m = buildWorkbenchMatrix(packet({ crawl: crawl(), gsc: gsc({ avgPosition: 4 }) }), null);
    const title = m.rows.find((r) => r.lever === "title")!;
    expect(title.benefit).not.toBeNull();
    expect(title.benefit!.estClicksAtStake).toBeGreaterThan(0);
    // pos 4 + unknown SERP ⇒ the guard fires (don't blind-rewrite the title).
    expect(title.benefit!.serpGuardLabel).toBeTruthy();
    // Structural levers carry no fabricated number.
    expect(m.rows.find((r) => r.lever === "schema")!.benefit).toBeNull();
    expect(m.rows.find((r) => r.lever === "internal_links")!.benefit).toBeNull();
  });
});

describe("buildWorkbenchMatrix — deterministic schema (works with zero LLM)", () => {
  it("drafts real JSON-LD for a page with no structured data and no pack", () => {
    const m = buildWorkbenchMatrix(packet({ crawl: crawl({ schemaTypes: [] }), gsc: gsc() }), null);
    const schema = m.rows.find((r) => r.lever === "schema")!;
    expect(schema.proposedSource).toBe("deterministic");
    expect(schema.proposed).toBeTruthy();
    expect(schema.proposed!).toContain("schema.org");
  });
});

describe("buildWorkbenchMatrix — brief-backed proposals", () => {
  it("uses the Change Pack artifact copy (llm_brief) when a brief exists; absent levers stay needs_endpoint", () => {
    const titleArt = artifact({
      action: "title",
      cmsField: { field: "title", value: "Persian Swear Words, Insults & Funny Farsi Phrases", limit: 60, withinLimit: true } as ChangeArtifact["cmsField"],
      after: "Persian Swear Words, Insults & Funny Farsi Phrases",
    });
    const m = buildWorkbenchMatrix(packet({ crawl: crawl(), gsc: gsc() }), pack(titleArt));
    const title = m.rows.find((r) => r.lever === "title")!;
    expect(title.proposedSource).toBe("llm_brief");
    expect(title.proposed).toBe("Persian Swear Words, Insults & Funny Farsi Phrases");
    // No artifact for answer_block ⇒ honest needs_endpoint, never invented.
    const ab = m.rows.find((r) => r.lever === "answer_block")!;
    expect(ab.proposedSource).toBe("needs_endpoint");
    expect(ab.proposed).toBeNull();
  });
});

describe("buildWorkbenchMatrix — cannibalization is a structural note, never a draft", () => {
  it("renders the cannibalization lever with no proposed draft and an n/a source", () => {
    const m = buildWorkbenchMatrix(
      packet({ crawl: crawl(), gsc: gsc() }),
      null,
      { query: "iran flag", urlCount: 3, combinedImpressions: 3000, combinedClicks: 2, bestPosition: 4 },
    );
    const cn = m.rows.find((r) => r.lever === "cannibalization")!;
    expect(cn.proposed).toBeNull();
    expect(cn.proposedSource).toBe("n/a");
    expect(cn.status).toBe("attention"); // a real case was passed
    expect(cn.needed).toBe(true);
  });
});
