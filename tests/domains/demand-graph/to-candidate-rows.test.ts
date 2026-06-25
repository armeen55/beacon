import { describe, it, expect } from "vitest";
import { demandGraphToCandidateRows } from "@/domains/demand-graph/to-candidate-rows";
import type { DemandGraph, MoveCandidate } from "@/domains/demand-graph/build-graph";

function move(p: Partial<MoveCandidate> & { gap: MoveCandidate["gap"] }): MoveCandidate {
  return {
    demandKey: p.demandKey ?? "k",
    label: p.label ?? "persian wedding",
    gap: p.gap,
    score: p.score ?? 1000,
    components: p.components ?? { demand: 5000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.6, friction: 0 },
    confidence: p.confidence ?? "high",
    signals: p.signals ?? ["GSC", "AI"],
    ownedUrl: p.ownedUrl ?? null,
    competitorUrls: p.competitorUrls ?? [],
    fanoutSeeds: p.fanoutSeeds ?? [],
    rationale: p.rationale ?? "",
  };
}

function graph(moves: MoveCandidate[]): DemandGraph {
  return { demandNodes: [], pageNodes: [], edges: [], moves };
}

const NOW = "2026-06-24T00:00:00.000Z";

describe("demandGraphToCandidateRows (engine → live pipeline bridge)", () => {
  it("maps each gap to a real ActionType + trigger_signal", () => {
    const rows = demandGraphToCandidateRows({
      tenantId: "tenant-iranopedia",
      nowIso: NOW,
      graph: graph([
        move({ gap: "create_page", label: "persian wedding", competitorUrls: ["https://theknot.com/x"] }),
        move({ gap: "answer_block", label: "iran flag", ownedUrl: "https://iranopedia.com/iran-flag" }),
        move({ gap: "edit_page", label: "cities in iran", ownedUrl: "https://iranopedia.com/cities" }),
        move({ gap: "fix_experience", label: "persian boy names", ownedUrl: "https://iranopedia.com/persian-boy-names" }),
      ]),
    });
    expect(rows.map((r) => r.action_type)).toEqual(["create_page", "add_answer_block", "edit_title", "fix_page_experience"]);
    expect(rows.map((r) => r.trigger_signal)).toEqual([
      "demand_graph_create_page",
      "demand_graph_answer_block",
      "demand_graph_edit_page",
      "demand_graph_fix_experience",
    ]);
  });

  it("excludes healthy + low_demand moves", () => {
    const rows = demandGraphToCandidateRows({
      tenantId: "t",
      nowIso: NOW,
      graph: graph([move({ gap: "healthy" }), move({ gap: "low_demand" }), move({ gap: "create_page" })]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("create_page");
  });

  it("customer copy is plain + competitor-name-free; operator evidence carries the trace", () => {
    const rows = demandGraphToCandidateRows({
      tenantId: "t",
      nowIso: NOW,
      graph: graph([move({ gap: "create_page", label: "persian wedding", competitorUrls: ["https://theknot.com/x"] })]),
    });
    const r = rows[0]!;
    expect(r.customer_copy).toContain("persian wedding");
    expect(r.customer_copy.toLowerCase()).not.toContain("theknot"); // no competitor name in customer copy
    expect(r.customer_copy).not.toMatch(/\b(CTR|schema|SoV|impressions)\b/);
    expect(r.operator_evidence).toContain("theknot.com"); // raw trace is operator-only
    expect(r.operator_evidence).toContain("demand-graph");
    expect(r.generator_kind).toBe("deterministic");
  });

  it("create_page (no owned URL) gets a stable demand-key identity + distinct keys", () => {
    const rows = demandGraphToCandidateRows({
      tenantId: "t",
      nowIso: NOW,
      graph: graph([
        move({ gap: "create_page", demandKey: "a", label: "persian wedding" }),
        move({ gap: "create_page", demandKey: "b", label: "nowruz" }),
      ]),
    });
    expect(rows[0]!.target_url).toBeNull();
    expect(rows[0]!.dedupe_key).not.toBe(rows[1]!.dedupe_key);
    expect(rows[0]!.cooldown_key).not.toBe(rows[1]!.cooldown_key);
  });

  it("respects the limit", () => {
    const rows = demandGraphToCandidateRows({
      tenantId: "t",
      nowIso: NOW,
      limit: 2,
      graph: graph([move({ gap: "create_page", demandKey: "a" }), move({ gap: "create_page", demandKey: "b" }), move({ gap: "create_page", demandKey: "c" })]),
    });
    expect(rows).toHaveLength(2);
  });
});
