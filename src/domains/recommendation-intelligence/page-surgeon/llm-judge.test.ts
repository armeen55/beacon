import { describe, it, expect } from "vitest";

import { judgePageAtomicChange } from "./llm-judge";
import { deterministicPageDecision } from "./page-decision";
import type { EvidencePacket, GscEvidence } from "./contract";

function gsc(query: string, over: Partial<GscEvidence> = {}): GscEvidence {
  const impressions = over.impressions ?? 5000;
  return {
    windowStart: "2026-05-01", windowEnd: "2026-06-15",
    impressions, clicks: over.clicks ?? 10, ctr: over.ctr ?? 0.002, avgPosition: over.avgPosition ?? 3,
    topQueries: [{ query, impressions, clicks: over.clicks ?? 10, ctr: over.ctr ?? 0.002, position: over.avgPosition ?? 3 }],
    expectedCtrForPosition: 0.1, ctrGap: over.ctrGap ?? 0.098,
  };
}
function packet(over: { currentText?: string | null; gsc?: GscEvidence; clarity?: EvidencePacket["clarity"]; profound?: EvidencePacket["profound"]; cmsFieldMapped?: boolean } = {}): EvidencePacket {
  const present: string[] = [];
  const empty: string[] = [];
  (over.gsc ? present : empty).push("gsc");
  (over.clarity ? present : empty).push("clarity");
  (over.profound ? present : empty).push("profound");
  empty.push("ga4");
  return {
    current: { tenantId: "t", pageUrl: "https://x.com/p", changeType: "title", elementKey: null, sectionLabel: null, currentText: over.currentText ?? "Current Title", cmsFieldMapped: over.cmsFieldMapped ?? true, publishChannel: "wix_cms" },
    gsc: over.gsc, clarity: over.clarity, profound: over.profound,
    sourcesPresent: present, sourcesConnectedButEmpty: empty,
  };
}
function change(action: string, over: Record<string, unknown> = {}) {
  return {
    action, exact_change: over.exact_change ?? `do ${action}`, evidence: "x", hypothesis: "h",
    risk: "", before_after: { before: null, after: "y" }, measurement: "m", rollback: "r",
    dependency_order: over.dependency_order ?? 1, ...over,
  };
}
function fakeOpenAI(decision: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }] }), { status: 200 })) as unknown as typeof fetch;
}

describe("Page Surgeon — LLM judge (multi-change battle plan, gated)", () => {
  it("parses a multi-change plan (primary + supporting) and keeps it when evidence backs it", async () => {
    const dec = await judgePageAtomicChange({
      packet: packet({ gsc: gsc("zero trust security"), profound: { aiVisibility: 12, citations: 3 } }),
      brand: null,
      fetchImpl: fakeOpenAI({
        recommended_atomic_action: "intro_answer_block",
        primary_atomic_change: change("intro_answer_block", { dependency_order: 1 }),
        supporting_atomic_changes: [change("faq", { dependency_order: 2 })],
        rejected_changes: [{ action: "title", reason: "already matches query" }],
        wording_research: [{ variant: "zero trust", evidence: "top query", best_placement: "title" }],
        confidence: "high",
        operator_insight: "AI-overview SERP, no answer block.",
        what_normal_seo_misses: "they'd just retitle",
        why_not_just_title: "title already matches",
      }),
    });
    expect(dec.recommended_atomic_action).toBe("intro_answer_block");
    expect(dec.primary_atomic_change?.action).toBe("intro_answer_block");
    expect(dec.supporting_atomic_changes.map((c) => c.action)).toContain("faq");
    expect(dec.decided_by).toBe("llm_judge");
    expect(dec.confidence).toBe("high"); // profound present → AEO claim allowed
    expect(dec.source_coverage.find((s) => s.source === "ga4")?.detail).toContain("no rows");
  });

  it("folds the STAGE-1 diagnosis bottleneck into operator_insight (diagnose-then-plan)", async () => {
    const dec = await judgePageAtomicChange({
      packet: packet({ gsc: gsc("zero trust security"), profound: { aiVisibility: 12, citations: 3 } }),
      brand: null,
      fetchImpl: fakeOpenAI({
        diagnosis: {
          bottleneck: "the page-1 query earns ~0 clicks because the snippet doesn't answer intent",
          evidence: "5000 impressions, 0.2% CTR at position 3",
          ruled_out: "the title already matches the query, so re-titling is not the lever",
        },
        recommended_atomic_action: "intro_answer_block",
        primary_atomic_change: change("intro_answer_block", { dependency_order: 1 }),
        supporting_atomic_changes: [],
        rejected_changes: [],
        wording_research: [],
        confidence: "high",
        operator_insight: "Add an answer block above the fold.",
        what_normal_seo_misses: "x", why_not_just_title: "x",
      }),
    });
    expect(dec.operator_insight.startsWith("Bottleneck:")).toBe(true);
    expect(dec.operator_insight).toContain("Add an answer block above the fold.");
  });

  it("GATE caps AEO confidence + drops a supporting change whose source is absent", async () => {
    const dec = await judgePageAtomicChange({
      packet: packet({ gsc: gsc("zero trust security") }), // no profound, no clarity
      brand: null,
      fetchImpl: fakeOpenAI({
        recommended_atomic_action: "faq",
        primary_atomic_change: change("faq", { dependency_order: 1 }),
        supporting_atomic_changes: [change("ux_cta_fix", { dependency_order: 2 })],
        rejected_changes: [],
        wording_research: [],
        confidence: "high",
        operator_insight: "x", what_normal_seo_misses: "x", why_not_just_title: "x",
      }),
    });
    expect(["low", "needs_more_evidence"]).toContain(dec.confidence); // AEO w/o profound
    expect(dec.supporting_atomic_changes.find((c) => c.action === "ux_cta_fix")).toBeUndefined();
    expect(dec.rejected_changes.some((r) => r.action === "ux_cta_fix")).toBe(true); // dropped → rejected
  });

  it("falls back to deterministic when no fetchImpl is supplied in tests", async () => {
    const dec = await judgePageAtomicChange({ packet: packet({ gsc: gsc("q") }), brand: null });
    expect(dec.decided_by).toBe("deterministic_fallback");
  });

  it("FALLBACK is non-contradictory: a bottleneck the title can't fix → needs_llm_review (no rollback/CTR claim)", () => {
    const dec = deterministicPageDecision(
      packet({ currentText: "Persian Boy Names With Meanings", gsc: gsc("persian boy names", { impressions: 8000, ctr: 0.003, ctrGap: 0.06 }) }),
      null,
    );
    expect(dec.recommended_atomic_action).toBe("needs_llm_review");
    expect(dec.primary_atomic_change).toBeNull();
    expect(dec.operator_insight.toLowerCase()).toContain("bottleneck");
  });

  it("FALLBACK clean keep: no bottleneck → keep_current with no change, no rollback claim", () => {
    const dec = deterministicPageDecision(
      packet({ currentText: "Persian Boy Names With Meanings", gsc: gsc("persian boy names", { impressions: 300, ctr: 0.06, ctrGap: 0 }) }),
      null,
    );
    expect(dec.recommended_atomic_action).toBe("keep_current");
    expect(dec.primary_atomic_change).toBeNull();
  });

  it("GATE never returns publishable; a mapped title change is at most staged", () => {
    const dec = deterministicPageDecision(
      packet({ currentText: "Off Topic Heading", gsc: gsc("persian boy names", { impressions: 8000, ctrGap: 0.09 }), cmsFieldMapped: true }),
      null,
    );
    const p = dec.primary_atomic_change;
    if (p) expect(p.publishability).not.toBe("publishable");
  });
});
