import { describe, it, expect } from "vitest";

import { judgePageAtomicChange } from "./llm-judge";
import { applyDeterministicGate, deterministicPageDecision } from "./page-decision";
import type { EvidencePacket, GscEvidence } from "./contract";

function gsc(query: string, over: Partial<GscEvidence> = {}): GscEvidence {
  const impressions = over.impressions ?? 5000;
  return {
    windowStart: "2026-05-01",
    windowEnd: "2026-06-15",
    impressions,
    clicks: over.clicks ?? 10,
    ctr: over.ctr ?? 0.002,
    avgPosition: over.avgPosition ?? 3,
    topQueries: [{ query, impressions, clicks: over.clicks ?? 10, ctr: over.ctr ?? 0.002, position: over.avgPosition ?? 3 }],
    expectedCtrForPosition: 0.1,
    ctrGap: over.ctrGap ?? 0.098,
  };
}
function packet(over: Partial<EvidencePacket["current"]> & { gsc?: GscEvidence; clarity?: EvidencePacket["clarity"]; profound?: EvidencePacket["profound"] } = {}): EvidencePacket {
  return {
    current: {
      tenantId: "t",
      pageUrl: "https://x.com/p",
      changeType: "title",
      elementKey: null,
      sectionLabel: null,
      currentText: over.currentText ?? "Current Title",
      cmsFieldMapped: over.cmsFieldMapped ?? true,
      publishChannel: "wix_cms",
    },
    gsc: over.gsc,
    clarity: over.clarity,
    profound: over.profound,
    sourcesPresent: over.gsc ? ["gsc"] : [],
    sourcesConnectedButEmpty: [],
  };
}

/** A fake OpenAI fetch returning a strict-JSON decision in the chat shape. */
function fakeOpenAI(decision: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

describe("Page Surgeon — LLM judge (10x operator, gated)", () => {
  it("parses an LLM decision and KEEPS a non-title atomic action when evidence backs it", async () => {
    const dec = await judgePageAtomicChange({
      packet: packet({ gsc: gsc("zero trust security"), profound: { aiVisibility: 12, citations: 3 } }),
      brand: null,
      fetchImpl: fakeOpenAI({
        recommended_atomic_action: "intro_answer_block",
        title_candidate: null,
        rejected_alternatives: [{ action: "title", reason: "title already matches the query" }],
        evidence_by_source: { gsc: "ranks #3, low CTR", profound: "cited 3x" },
        hypothesis: "A 40-60 word answer block will win the AI overview slot.",
        risk: "none material",
        before_after_diff: { before: null, after: "Add a concise answer block." },
        measurement_plan: "Track Profound citations + GSC CTR.",
        rollback_plan: "Remove the block.",
        confidence: "high",
        operator_insight: "High impressions + AI-overview SERP but no answer block on page.",
      }),
    });
    expect(dec.recommended_atomic_action).toBe("intro_answer_block");
    expect(dec.decided_by).toBe("llm_judge");
    // Profound present → AEO claim allowed → confidence not force-capped to low.
    expect(dec.confidence).toBe("high");
  });

  it("GATE caps an AEO action's confidence when Profound is absent (no AI-citation claim without AI evidence)", async () => {
    const dec = await judgePageAtomicChange({
      packet: packet({ gsc: gsc("zero trust security") }), // no profound
      brand: null,
      fetchImpl: fakeOpenAI({
        recommended_atomic_action: "faq",
        title_candidate: null,
        rejected_alternatives: [],
        evidence_by_source: { gsc: "ranks #3" },
        hypothesis: "FAQ block wins PAA.",
        risk: "",
        before_after_diff: { before: null, after: "Add FAQ." },
        measurement_plan: "AI citations.",
        rollback_plan: "Remove FAQ.",
        confidence: "high",
        operator_insight: "PAA present.",
      }),
    });
    expect(dec.recommended_atomic_action).toBe("faq");
    expect(["low", "needs_more_evidence"]).toContain(dec.confidence);
    expect(dec.risk.toLowerCase()).toContain("profound");
  });

  it("GATE downgrades an action whose required source is absent (ux_cta_fix needs Clarity)", () => {
    const dec = applyDeterministicGate(
      {
        pageUrl: "https://x.com/p",
        recommended_atomic_action: "ux_cta_fix",
        title_candidate: null,
        rejected_alternatives: [],
        evidence_by_source: { gsc: "x" }, // no clarity
        hypothesis: "fix CTA",
        risk: "",
        before_after_diff: { before: null, after: null },
        measurement_plan: "",
        rollback_plan: "",
        confidence: "high",
        operator_insight: "",
        publishability: "review_only",
        decided_by: "llm_judge",
      },
      packet({ gsc: gsc("q") }),
    );
    expect(dec.recommended_atomic_action).toBe("needs_more_evidence");
  });

  it("falls back to the deterministic decision when no fetchImpl is supplied in tests", async () => {
    const dec = await judgePageAtomicChange({
      packet: packet({ currentText: "Persian Boy Names With Meanings", gsc: gsc("persian boy names", { ctr: 0.06, ctrGap: 0 }) }),
      brand: null,
    });
    expect(dec.decided_by).toBe("deterministic_fallback");
  });

  it("GATE never returns publishable; a confident mapped title change is at most staged", () => {
    const dec = deterministicPageDecision(
      packet({ currentText: "Old Off Topic", gsc: gsc("persian boy names", { impressions: 8000, ctrGap: 0.09 }), cmsFieldMapped: true }),
      null,
    );
    expect(dec.publishability === "staged" || dec.publishability === "review_only").toBe(true);
    expect(dec.publishability).not.toBe("publishable");
  });
});
