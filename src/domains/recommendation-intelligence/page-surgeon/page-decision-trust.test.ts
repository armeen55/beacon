import { describe, it, expect } from "vitest";

import {
  applyDeterministicGate,
  detectPageProblems,
  type AtomicChange,
  type PageAtomicDecision,
} from "./page-decision";
import type { EvidencePacket, GscEvidence } from "./contract";

type Q = { query: string; impressions: number; clicks: number; ctr: number; position: number };
function gsc(over: Partial<GscEvidence> & { topQueries?: Q[] } = {}): GscEvidence {
  return {
    windowStart: "", windowEnd: "",
    impressions: over.impressions ?? 20000,
    clicks: over.clicks ?? 500,
    ctr: over.ctr ?? 0.025,
    avgPosition: over.avgPosition ?? 7,
    topQueries: over.topQueries ?? [{ query: "alpha beta", impressions: 800, clicks: 20, ctr: 0.025, position: 7 }],
    expectedCtrForPosition: over.expectedCtrForPosition ?? 0.05,
    ctrGap: over.ctrGap ?? 0.025,
  };
}
function packet(over: Partial<EvidencePacket> & { title?: string } = {}): EvidencePacket {
  return {
    current: {
      tenantId: "t", pageUrl: "https://x.com/p", changeType: "title", elementKey: null,
      sectionLabel: null, currentText: over.title ?? "Alpha Beta Guide", cmsFieldMapped: true, publishChannel: "wix_cms",
    },
    gsc: over.gsc, clarity: over.clarity, ga4: over.ga4, semrush: over.semrush,
    crawl: over.crawl ?? {
      title: over.title ?? "Alpha Beta Guide", h1: "Alpha Beta", metaDescription: "m",
      h2List: [], h3List: [], faqs: [], schemaTypes: [], wordCount: 1000, internalLinkCount: 10, cardTexts: [],
    },
    sourcesPresent: over.sourcesPresent ?? ["gsc", "crawl"],
    sourcesConnectedButEmpty: over.sourcesConnectedButEmpty ?? ["ga4", "clarity", "semrush", "profound"],
  };
}
function change(action: AtomicChange["action"], over: Partial<AtomicChange> = {}): AtomicChange {
  return {
    action, exact_change: over.exact_change ?? `do ${action}`, evidence: over.evidence ?? "x",
    hypothesis: over.hypothesis ?? "h", risk: over.risk ?? "", before_after: over.before_after ?? { before: null, after: "y" },
    measurement: over.measurement ?? "m", rollback: over.rollback ?? "r", publishability: "review_only",
    dependency_order: over.dependency_order ?? 1,
  };
}
function decision(primary: AtomicChange | null, supporting: AtomicChange[] = []): PageAtomicDecision {
  return {
    pageUrl: "https://x.com/p",
    recommended_atomic_action: primary ? primary.action : "keep_current",
    primary_atomic_change: primary,
    supporting_atomic_changes: supporting,
    rejected_changes: [], source_coverage: [], wording_research: [],
    confidence: "medium", operator_insight: "i", what_normal_seo_misses: "", why_not_just_title: "x",
    evidence_gaps: [], decided_by: "llm_judge",
  };
}

describe("Page Surgeon trust gate — P1 over-recommendation suppression", () => {
  it("HEALTHY page (CTR ≥ expected, title covers dominant query) → keep_current, title rejected", () => {
    // /persian-male-names shape: ctrGap 0, title contains the dominant query.
    const p = packet({
      title: "Popular Persian Boy Names List with Meanings",
      gsc: gsc({ ctr: 0.044, expectedCtrForPosition: 0.04, ctrGap: 0, avgPosition: 6.7,
        topQueries: [{ query: "persian boy names", impressions: 4312, clicks: 428, ctr: 0.099, position: 4 }] }),
      clarity: { windowStart: "", windowEnd: "", scrollDepthMedian: null, engagementTimeSec: null, deadClicks: 1, rageClicks: 0, quickbacks: 5, scriptErrors: 0 },
      sourcesPresent: ["gsc", "crawl", "clarity"], sourcesConnectedButEmpty: ["ga4", "semrush", "profound"],
    });
    const out = applyDeterministicGate(decision(change("title"), [change("meta"), change("intro_answer_block"), change("image_alt")]), p);
    expect(out.recommended_atomic_action).toBe("keep_current");
    expect(out.primary_atomic_change).toBeNull();
    expect(out.supporting_atomic_changes).toHaveLength(0);
    expect(out.rejected_changes.some((r) => r.action === "title")).toBe(true);
    expect(detectPageProblems(p).hasAnyProblem).toBe(false);
  });

  it("page WITH a snippet deficit keeps its title change", () => {
    const p = packet({ title: "Alpha Beta Guide", gsc: gsc({ ctrGap: 0.023 }) });
    const out = applyDeterministicGate(decision(change("title")), p);
    expect(out.recommended_atomic_action).toBe("title");
    expect(out.primary_atomic_change).not.toBeNull();
  });

  it("no deficit BUT title missing the dominant query → title still eligible", () => {
    const p = packet({
      title: "Iran Cities Overview", // missing "swear"
      gsc: gsc({ ctr: 0.05, expectedCtrForPosition: 0.05, ctrGap: 0,
        topQueries: [{ query: "persian swear words", impressions: 800, clicks: 40, ctr: 0.05, position: 6 }] }),
    });
    expect(detectPageProblems(p).titleMissingDominantQuery).toBe(true);
    const out = applyDeterministicGate(decision(change("title")), p);
    expect(out.recommended_atomic_action).toBe("title");
  });

  it("no deficit BUT a page-1 zero-click query → intro_answer_block eligible", () => {
    const p = packet({
      title: "Pedar Sag Meaning Explained",
      gsc: gsc({ ctr: 0.05, expectedCtrForPosition: 0.05, ctrGap: 0,
        topQueries: [{ query: "pedar sag meaning", impressions: 438, clicks: 1, ctr: 0.002, position: 7 }] }),
    });
    expect(detectPageProblems(p).zeroClickPage1).toBe(true);
    const out = applyDeterministicGate(decision(change("intro_answer_block")), p);
    expect(out.recommended_atomic_action).toBe("intro_answer_block");
  });
});

describe("Page Surgeon trust gate — create_new_page + cluster-only safety (/persian-male-names class)", () => {
  const clusterSemrush = {
    keywords: [{ keyword: "omega zeta", volume: 800, kd: 20, cpc: 0, intent: null, position: 12 }],
    relatedKeywords: [], questionKeywords: [],
  };
  it("a high-value cluster ALONE (no deficit / zero-click / friction) → keep_current, not a new page", () => {
    const p = packet({
      title: "Alpha Guide",
      gsc: gsc({ ctr: 0.05, expectedCtrForPosition: 0.05, ctrGap: 0,
        topQueries: [{ query: "alpha", impressions: 500, clicks: 50, ctr: 0.1, position: 4 }] }),
      semrush: clusterSemrush,
      sourcesPresent: ["gsc", "crawl", "semrush"], sourcesConnectedButEmpty: ["ga4", "clarity", "profound"],
    });
    expect(detectPageProblems(p).highValueUnservedCluster).toBe(true);
    expect(detectPageProblems(p).hasAnyProblem).toBe(false);
    const out = applyDeterministicGate(decision(change("create_new_page"), [change("title")]), p);
    expect(out.recommended_atomic_action).toBe("keep_current");
    expect(out.primary_atomic_change).toBeNull();
  });
  it("create_new_page rejected without a cluster, even when a deficit exists", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const out = applyDeterministicGate(decision(change("create_new_page"), [change("intro_answer_block")]), p);
    expect(out.rejected_changes.some((r) => r.action === "create_new_page")).toBe(true);
    expect(out.recommended_atomic_action).not.toBe("create_new_page");
  });
});

describe("Page Surgeon trust gate — P2 evidence-citation sanitizer", () => {
  it("rejects a change citing SEMrush question keywords when none were pulled (/farsi-numbers class)", () => {
    const p = packet({
      gsc: gsc({ ctrGap: 0.03 }),
      semrush: { keywords: [{ keyword: "farsi numbers", volume: 140, kd: 14, cpc: 0, intent: null, position: 8 }], relatedKeywords: [], questionKeywords: [] },
      sourcesPresent: ["gsc", "crawl", "semrush"], sourcesConnectedButEmpty: ["ga4", "clarity", "profound"],
    });
    const faq = change("faq", { evidence: "SEMrush question keywords show users ask how to count in Farsi." });
    const out = applyDeterministicGate(decision(change("title"), [faq]), p);
    expect(out.supporting_atomic_changes.some((c) => c.action === "faq")).toBe(false);
    expect(out.rejected_changes.some((r) => r.action === "faq" && /question keyword/i.test(r.reason))).toBe(true);
  });

  it("does NOT reject a change that HONESTLY acknowledges the absent field", () => {
    const p = packet({
      gsc: gsc({ ctrGap: 0.03 }),
      semrush: { keywords: [{ keyword: "k", volume: 100, kd: 1, cpc: 0, intent: null, position: 8 }], relatedKeywords: [], questionKeywords: [] },
      sourcesPresent: ["gsc", "crawl", "semrush"], sourcesConnectedButEmpty: ["ga4", "clarity", "profound"],
    });
    const ib = change("intro_answer_block", { evidence: "No SEMrush question keywords were returned, so this is grounded in the GSC ctrGap of 0.03." });
    const out = applyDeterministicGate(decision(ib), p);
    expect(out.recommended_atomic_action).toBe("intro_answer_block");
  });

  it("rejects a GA4 engagement claim when GA4 has no rows", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const s = change("internal_link", { evidence: "GA4 shows high engagement; conversions justify more links." });
    const out = applyDeterministicGate(decision(change("title"), [s]), p);
    expect(out.rejected_changes.some((r) => r.action === "internal_link" && /GA4/i.test(r.reason))).toBe(true);
  });

  it("rejects a Clarity behavior claim when Clarity has no data", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) }); // clarity absent by default
    const s = change("internal_link", { evidence: "Clarity shows dead clicks and rage clicks, so add navigation links." });
    const out = applyDeterministicGate(decision(change("title"), [s]), p);
    expect(out.rejected_changes.some((r) => r.action === "internal_link" && /Clarity/i.test(r.reason))).toBe(true);
  });
});

describe("Page Surgeon trust gate — P3 candidate eligibility", () => {
  it("image_alt is always rejected (no image/alt data is crawled)", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const out = applyDeterministicGate(decision(change("title"), [change("image_alt")]), p);
    expect(out.supporting_atomic_changes.some((c) => c.action === "image_alt")).toBe(false);
    expect(out.rejected_changes.some((r) => r.action === "image_alt")).toBe(true);
  });

  it("schema rejected when the page already has schema; eligible when missing", () => {
    const withSchema = packet({ gsc: gsc({ ctrGap: 0.03 }), crawl: { title: "t", h1: "h", metaDescription: "m", h2List: [], h3List: [], faqs: [], schemaTypes: ["Article"], wordCount: 900, internalLinkCount: 5, cardTexts: [] } });
    const a = applyDeterministicGate(decision(change("title"), [change("schema")]), withSchema);
    expect(a.rejected_changes.some((r) => r.action === "schema")).toBe(true);
    const noSchema = packet({ gsc: gsc({ ctrGap: 0.03 }) }); // schemaTypes [] by default
    const b = applyDeterministicGate(decision(change("title"), [change("schema")]), noSchema);
    expect(b.supporting_atomic_changes.some((c) => c.action === "schema")).toBe(true);
  });

  it("ux_cta_fix rejected on a tiny Clarity sample", () => {
    const p = packet({
      gsc: gsc({ ctrGap: 0.03 }),
      clarity: { windowStart: "", windowEnd: "", scrollDepthMedian: null, engagementTimeSec: null, deadClicks: 3, rageClicks: 0, quickbacks: 1, scriptErrors: 0 },
      sourcesPresent: ["gsc", "crawl", "clarity"], sourcesConnectedButEmpty: ["ga4", "semrush", "profound"],
    });
    const out = applyDeterministicGate(decision(change("title"), [change("ux_cta_fix")]), p);
    expect(out.supporting_atomic_changes.some((c) => c.action === "ux_cta_fix")).toBe(false);
    expect(out.rejected_changes.some((r) => r.action === "ux_cta_fix")).toBe(true);
  });
});

describe("Page Surgeon trust gate — Clarity friction rescue (/iran-flags class)", () => {
  it("meaningful friction → a ux_cta_fix is SURFACED even if the judge rejected it", () => {
    const p = packet({
      gsc: gsc({ ctrGap: 0.016, avgPosition: 11.6 }),
      clarity: { windowStart: "", windowEnd: "", scrollDepthMedian: null, engagementTimeSec: null, deadClicks: 67, rageClicks: 10, quickbacks: 5, scriptErrors: 0 },
      sourcesPresent: ["gsc", "crawl", "clarity"], sourcesConnectedButEmpty: ["ga4", "semrush", "profound"],
    });
    const d = decision(change("title"), [change("meta")]);
    d.rejected_changes = [{ action: "ux_cta_fix", reason: "judge declined" }];
    const out = applyDeterministicGate(d, p);
    const ux = out.supporting_atomic_changes.find((c) => c.action === "ux_cta_fix");
    expect(ux).toBeDefined();
    expect(ux!.evidence).toMatch(/67 dead clicks/);
    expect(out.rejected_changes.some((r) => r.action === "ux_cta_fix")).toBe(false);
  });
});

describe("Page Surgeon trust gate — WL1 keep_current narrative honesty", () => {
  const LEAK = "Deploy this rewritten title and add an intro answer block to win the citation.";

  it("healthy-page collapse overwrites leftover change-plan prose with a protective insight", () => {
    const p = packet({
      title: "Persian Boy Names With Meanings",
      gsc: gsc({ ctr: 0.05, expectedCtrForPosition: 0.05, ctrGap: 0,
        topQueries: [{ query: "persian boy names", impressions: 4000, clicks: 400, ctr: 0.1, position: 4 }] }),
    });
    const d = decision(change("title"), [change("intro_answer_block")]);
    d.operator_insight = LEAK;
    d.what_normal_seo_misses = "Normal SEO would just tweak the title.";
    d.why_not_just_title = "Because the body also needs an answer block.";
    const out = applyDeterministicGate(d, p);
    expect(out.recommended_atomic_action).toBe("keep_current");
    expect(out.operator_insight).not.toContain("Deploy");
    expect(out.operator_insight).not.toBe(LEAK);
    expect(out.operator_insight).toMatch(/healthy|no change is recommended/i);
    expect(out.what_normal_seo_misses).toBe("");
    expect(out.why_not_just_title).toBe("");
  });

  it("explicit keep_current (problem present, judge declines) also sheds change-plan prose", () => {
    // A real problem exists (ctrGap deficit) yet the judge returned keep_current —
    // hits the P4 NON_CHANGE_ACTIONS exit, which must still sanitize the narrative.
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const d = decision(null);
    d.operator_insight = LEAK;
    d.what_normal_seo_misses = "x";
    d.why_not_just_title = "y";
    const out = applyDeterministicGate(d, p);
    expect(out.recommended_atomic_action).toBe("keep_current");
    expect(out.operator_insight).not.toContain("Deploy");
    expect(out.what_normal_seo_misses).toBe("");
    expect(out.why_not_just_title).toBe("");
  });

  it("escalation (needs_llm_review) keeps its bottleneck insight, not a protective one", () => {
    // Problem exists, only proposed change is image_alt (always rejected) → escalate.
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const d = decision(change("image_alt"));
    d.operator_insight = "The real bottleneck is a missing answer block the crawl can't yet confirm.";
    const out = applyDeterministicGate(d, p);
    expect(out.recommended_atomic_action).toBe("needs_llm_review");
    expect(out.operator_insight).toMatch(/bottleneck/);
    expect(out.what_normal_seo_misses).toBe("");
  });
});

describe("Page Surgeon trust gate — WL2 per-claim absent-evidence", () => {
  it("one honest absent-source caveat does NOT whitewash a different fabricated citation", () => {
    // GA4 honestly absent in one clause; SEMrush question keywords fabricated in another.
    // Old global acknowledgement would have let this pass — per-clause must still reject.
    const p = packet({
      gsc: gsc({ ctrGap: 0.03 }),
      semrush: { keywords: [{ keyword: "farsi numbers", volume: 140, kd: 14, cpc: 0, intent: null, position: 8 }], relatedKeywords: [], questionKeywords: [] },
      sourcesPresent: ["gsc", "crawl", "semrush"], sourcesConnectedButEmpty: ["ga4", "clarity", "profound"],
    });
    const faq = change("faq", {
      evidence: "No GA4 rows were returned for this page. SEMrush question keywords show users ask how to count in Farsi.",
    });
    const out = applyDeterministicGate(decision(change("title"), [faq]), p);
    expect(out.supporting_atomic_changes.some((c) => c.action === "faq")).toBe(false);
    expect(out.rejected_changes.some((r) => r.action === "faq" && /question keyword/i.test(r.reason))).toBe(true);
  });

  it("still rejects a multi-source fabrication where every cited source is empty", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) }); // ga4 + clarity absent
    const s = change("internal_link", {
      evidence: "GA4 shows high engagement and Clarity shows rage clicks, so add navigation links.",
    });
    const out = applyDeterministicGate(decision(change("title"), [s]), p);
    expect(out.rejected_changes.some((r) => r.action === "internal_link")).toBe(true);
  });
});

describe("Page Surgeon trust gate — WL3 numeric fidelity", () => {
  it("rejects a change whose prose fabricates impressions the packet doesn't have", () => {
    // packet impressions = 20000 (page) / 800 (top query); 5,000 matches neither.
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const t = change("title", { evidence: 'Top query "alpha beta" pulls 5,000 impressions at 2.50% CTR.' });
    const out = applyDeterministicGate(decision(t), p);
    expect(out.rejected_changes.some((r) => /impressions/.test(r.reason) && /5,000/.test(r.reason))).toBe(true);
    expect(out.recommended_atomic_action).not.toBe("title");
  });

  it("keeps a change that cites the packet's real impressions / CTR / position", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const t = change("title", { evidence: "Page gets 20,000 impressions, 2.50% CTR, ranks position 7." });
    const out = applyDeterministicGate(decision(t), p);
    expect(out.recommended_atomic_action).toBe("title");
    expect(out.rejected_changes.some((r) => /doesn't match/.test(r.reason))).toBe(false);
  });

  it("does NOT flag forward-looking targets (reach position 1, lift CTR toward 5%)", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const t = change("title", { evidence: "Ranks position 7 at 2.50% CTR; aim to reach position 1 and lift CTR toward 5%." });
    const out = applyDeterministicGate(decision(t), p);
    expect(out.recommended_atomic_action).toBe("title");
  });

  it("rejects a fabricated Clarity dead-click count (cites 67, page has 3)", () => {
    const p = packet({
      gsc: gsc({ ctrGap: 0.03 }),
      clarity: { windowStart: "", windowEnd: "", scrollDepthMedian: null, engagementTimeSec: null, deadClicks: 3, rageClicks: 0, quickbacks: 1, scriptErrors: 0 },
      sourcesPresent: ["gsc", "crawl", "clarity"], sourcesConnectedButEmpty: ["ga4", "semrush", "profound"],
    });
    const s = change("internal_link", { evidence: "Clarity shows 67 dead clicks on this page, so add navigation." });
    const out = applyDeterministicGate(decision(change("title"), [s]), p);
    expect(out.rejected_changes.some((r) => r.action === "internal_link" && /dead clicks/.test(r.reason) && /67/.test(r.reason))).toBe(true);
    expect(out.recommended_atomic_action).toBe("title");
  });

  it("rejects a fabricated rank (cites position 2, page ranks 7)", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const t = change("title", { evidence: 'This page ranks position 2 for "alpha beta".' });
    const out = applyDeterministicGate(decision(t), p);
    expect(out.rejected_changes.some((r) => /position/.test(r.reason))).toBe(true);
    expect(out.recommended_atomic_action).not.toBe("title");
  });
});

describe("Page Surgeon trust gate — WL5 per-query snippet deficit", () => {
  it("catches a deficit blended CTR HIDES: a winner masks a high-impression bleeder", () => {
    const p = packet({
      gsc: gsc({
        ctr: 0.06, expectedCtrForPosition: 0.05, ctrGap: 0, avgPosition: 5,
        topQueries: [
          { query: "alpha winner", impressions: 200, clicks: 60, ctr: 0.3, position: 2 }, // inflates the blend
          { query: "beta bleeder", impressions: 1500, clicks: 30, ctr: 0.02, position: 4 }, // pos-4 expects ~7%
        ],
      }),
    });
    expect(detectPageProblems(p).snippetDeficit).toBe(true);
  });

  it("does NOT fire on a coarse blended gap driven only by a tiny low-impression tail", () => {
    const p = packet({
      gsc: gsc({
        ctr: 0.04, expectedCtrForPosition: 0.05, ctrGap: 0.01, avgPosition: 6,
        topQueries: [
          { query: "big winner", impressions: 3000, clicks: 300, ctr: 0.1, position: 3 }, // pos-3 expects ~10% → fine
          { query: "tiny tail", impressions: 30, clicks: 0, ctr: 0.0, position: 8 }, // below the impression floor
        ],
      }),
    });
    // Old blended-only logic (gap 0.01 ≥ 0.005) over-fired here; per-query is honest.
    expect(detectPageProblems(p).snippetDeficit).toBe(false);
  });
});

describe("Page Surgeon trust gate — WL4 cap + defer supporting changes", () => {
  it("a ready plan is primary + at most 2 supports; the rest are deferred, not dropped", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const out = applyDeterministicGate(
      decision(change("title"), [change("meta"), change("h1"), change("internal_link"), change("section_add")]),
      p,
    );
    expect(out.recommended_atomic_action).toBe("title");
    expect(out.supporting_atomic_changes.length).toBeLessThanOrEqual(2);
    expect(out.deferred_changes ?? []).not.toHaveLength(0);
    // Nothing is lost: primary + supporting + deferred == the 5 proposed (all eligible).
    const total = 1 + out.supporting_atomic_changes.length + (out.deferred_changes?.length ?? 0);
    expect(total).toBe(5);
    // Highest-leverage supports stay ready (meta/h1 outrank section_add/internal_link).
    const kept = out.supporting_atomic_changes.map((c) => c.action);
    expect(kept).toContain("meta");
    const deferredActions = (out.deferred_changes ?? []).map((c) => c.action);
    expect(deferredActions).toContain("internal_link");
  });

  it("a plan with ≤2 supports defers nothing", () => {
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const out = applyDeterministicGate(decision(change("title"), [change("meta")]), p);
    expect(out.deferred_changes ?? []).toHaveLength(0);
  });
});

describe("Page Surgeon trust gate — P4 fallback consistency", () => {
  it("when everything is gated out and a problem exists → needs_llm_review, no artifacts", () => {
    // deficit exists (problem) but the only proposed change is image_alt (always rejected).
    const p = packet({ gsc: gsc({ ctrGap: 0.03 }) });
    const out = applyDeterministicGate(decision(change("image_alt")), p);
    expect(out.recommended_atomic_action).toBe("needs_llm_review");
    expect(out.primary_atomic_change).toBeNull();
    expect(out.supporting_atomic_changes).toHaveLength(0);
  });

  it("keep_current carries no change artifacts (no rollback / before-after)", () => {
    const p = packet({
      title: "Persian Boy Names With Meanings",
      gsc: gsc({ ctr: 0.05, expectedCtrForPosition: 0.05, ctrGap: 0,
        topQueries: [{ query: "persian boy names", impressions: 4000, clicks: 400, ctr: 0.1, position: 4 }] }),
    });
    const out = applyDeterministicGate(decision(change("title", { rollback: "revert title", before_after: { before: "A", after: "B" } })), p);
    expect(out.recommended_atomic_action).toBe("keep_current");
    expect(out.primary_atomic_change).toBeNull();
    expect(out.supporting_atomic_changes).toHaveLength(0);
  });
});
